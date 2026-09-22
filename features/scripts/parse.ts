import { createHash } from "crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { PDFDocument } from "pdf-lib";
import { db } from "@/db";
import { documents, productions, scriptParses, scriptCache } from "@/db/schema";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAnthropicClient, SCRIPT_PARSE_MODEL } from "@/lib/anthropic";
import { sendScriptParseReady } from "@/features/notifications/announce";
import type {
  ScriptParseResult,
  ParsedRole,
  ParsedScene,
  ParsedBookmark,
  ParseProgress,
  ParseChunk,
  ChunkResult,
  DetectSection,
  DetectSectionKind,
  PageRange,
} from "./constants";
import {
  MAX_SCRIPT_PAGES,
  TEXT_CHUNK_CHARS,
  SCAN_CHUNK_MAX_PAGES,
  SCAN_CHUNK_MAX_BYTES,
  SCAN_DETECT_MIN_PAGES,
  SCAN_DETECT_SAMPLE_PAGES,
  INVOCATION_START_BUDGET_MS,
  CHUNK_CALL_TIMEOUT_MS,
  HEARTBEAT_MS,
  MAX_CHUNK_ATTEMPTS,
  MAX_PARSE_INVOCATIONS,
} from "./constants";
import {
  normalizeText,
  extractJson,
  resolveBookmarks,
  resolveVisionBookmarks,
  offsetBookmarks,
  buildTaggedScript,
  planTextChunks,
  planScanChunks,
  mergeChunkResults,
  lastSceneOf,
  buildChunkPreface,
  classifyTextPage,
  pageDigestLine,
  deriveSections,
  sectionsFromSamples,
  sanitizeSections,
  isMixedBook,
  dominantKind,
  proposeSplitRanges,
} from "./parse-utils";
import { loadPdf, extractPages, extractPageRange } from "./pdf-split";

// Text-layer threshold: a PDF with (almost) no embedded text is a scan.
const SCANNED_TEXT_THRESHOLD = 200;
// Below this a text PDF is a one-act play or a fragment; never a combined book.
const TEXT_DETECT_MIN_PAGES = 40;
// Scans this short still take the legacy single signed-URL call when pdf-lib
// can't open the file (no chunking needed, no pdf-lib needed).
const SCAN_URL_FALLBACK_MAX_PAGES = 100;

/**
 * Extract the text of each page of a PDF, one string per page (index 0 = page
 * 1). Uses `unpdf`, which ships a serverless-safe pdfjs build — no browser
 * globals (DOMMatrix etc.), so it runs on Vercel's Node runtime.
 */
async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t) => (t ?? "").replace(/[ \t]+/g, " ").trim());
}

const OUTPUT_SHAPE = `{
  "title": string,                       // the show's title, "" if unknown
  "roles":  [{ "name": string, "type": "Principal" | "Supporting" | "Ensemble" }],
  "scenes": [{ "actNumber": integer, "sceneNumber": integer, "title": string }],
  "bookmarks": [{ "kind": "scene" | "song", "title": string, "anchor": string }]
}`;

/** Concatenate the text blocks of a model reply (ignoring thinking blocks). */
function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

const SYSTEM_PROMPT = `You analyse theatrical scripts and musical-theatre librettos to set up a production template. You are given the full script as plain text, split into pages with "===== PAGE N =====" markers.

Produce four things:
1. roles — every named speaking/singing character. Classify each as Principal (large role, drives the plot, sings/speaks frequently), Supporting (named role with meaningful but smaller presence), or Ensemble (chorus, named groups, or one-scene bit parts). Use the character name as it appears in the script (e.g. "Frederic", not "FREDERIC:"). Do not invent characters; do not list stage directions, narrators of headings, or props as characters. Each character appears once.
2. scenes — the Act/Scene structure in reading order. actNumber and sceneNumber are 1-based integers; for a single-act play use actNumber 1 throughout. title is a short scene label (the script's own scene heading if present, otherwise a brief setting like "The town square").
3. bookmarks — one entry per scene start (kind "scene") and per musical number / song (kind "song"). Do NOT return a page number. Instead return an "anchor": a short, EXACT, verbatim quote (3–8 words) copied character-for-character from the script at that point — the scene heading or the song's title/number line as printed (e.g. "No. 7 — Poor Wandering One" or "ACT II, SCENE 1"). The anchor MUST appear verbatim in the script text so it can be located; if you can't quote it exactly, omit that bookmark. For song titles and numbers, copy the script's own printed label exactly — never renumber, re-letter, or invent a sequence. Only mark genuine scene/song starts, not every page or stage direction. IMPORTANT: front-matter listing pages — a table of contents, a "Musical Numbers" list, a synopsis/list of scenes — are reference only. Use them to understand the structure, but create exactly ONE bookmark per scene/song at its ACTUAL start in the body of the script, never a bookmark for its entry in such a list.

If the script is not actually a script (e.g. a contract or a flyer), return empty arrays.

Respond with ONLY a single JSON object in this exact shape — no markdown, no code fences, no commentary:
${OUTPUT_SHAPE}`;

// For scanned / photographed scripts there is no embedded text to match an
// anchor against, so the vision path asks the model for a page number directly.
// `page` is the sequential page of the PDF (or excerpt) given, 1 = first page.
const OUTPUT_SHAPE_VISION = `{
  "title": string,                       // the show's title, "" if unknown
  "roles":  [{ "name": string, "type": "Principal" | "Supporting" | "Ensemble" }],
  "scenes": [{ "actNumber": integer, "sceneNumber": integer, "title": string }],
  "bookmarks": [{ "kind": "scene" | "song", "title": string, "page": integer }]
}`;

const VISION_SYSTEM_PROMPT = `You analyse theatrical scripts and musical-theatre librettos to set up a production template. You are given a SCANNED or photographed script as page images — read the text off each page carefully, including handwritten-looking or low-contrast type.

Produce three things:
1. roles — every named speaking/singing character. Classify each as Principal (large role, drives the plot, sings/speaks frequently), Supporting (named role with meaningful but smaller presence), or Ensemble (chorus, named groups, or one-scene bit parts). Use the character name as it appears in the script (e.g. "Frederic", not "FREDERIC:"). Do not invent characters; do not list stage directions, narrators or headings, or props as characters. Each character appears once.
2. scenes — the Act/Scene structure in reading order. actNumber and sceneNumber are 1-based integers; for a single-act play use actNumber 1 throughout. title is a short scene label (the script's own scene heading if present, otherwise a brief setting like "The town square").
3. bookmarks — one entry per scene start (kind "scene") and per musical number / song (kind "song"). For each, give the "page": the SEQUENTIAL page number of the PDF you were given where that scene/song begins, where the first page of the file is page 1 (count pages in order — do NOT use any printed folio/page number that may differ). Only mark genuine scene/song starts, not every page. Front-matter listing pages — a table of contents, a "Musical Numbers" list, a synopsis/list of scenes — are reference only: create exactly ONE bookmark per scene/song at its ACTUAL start in the body, never at its entry in such a list. For song titles, copy the script's own printed label.

If the document is not actually a script (e.g. a contract or a flyer), return empty arrays.

Respond with ONLY a single JSON object in this exact shape — no markdown, no code fences, no commentary:
${OUTPUT_SHAPE_VISION}`;

// A piano-vocal score is music notation with lyrics: roles are the singing
// characters named at staves / number headings; scenes rarely exist; each
// musical number is a "song" bookmark titled by its printed number + title.
const SCORE_PREFACE = `This document is a PIANO-VOCAL SCORE, not a dialogue script. Adjust accordingly:
- roles: the singing characters named at the staves, at number headings, or in the cast list. Classify by how much they sing.
- scenes: return [] unless the score prints explicit ACT / SCENE headings; if it does, list only those.
- bookmarks: exactly ONE "song" bookmark per musical number, at the number's first page, titled with the printed number and title as engraved (e.g. "No. 7 Poor Wandering One"). Ignore dialogue-cue pages between numbers, and never bookmark the contents / musical-numbers list.

`;

const DETECT_SYSTEM_PROMPT = `You classify the pages of a musical-theatre book. A book may contain a LIBRETTO (dialogue script with character cues), a PIANO-VOCAL SCORE (engraved music notation with lyrics), FRONT MATTER (title page, cast list, musical-numbers list, synopsis, contents), or OTHER pages. Respond with ONLY the JSON asked for — no markdown, no commentary.`;

// ── Lease-scoped persistence ─────────────────────────────────────────────────

/** Write progress for this parse only while we still hold its lease. */
async function persistProgress(
  parseId: string,
  leaseToken: string,
  progress: ParseProgress,
): Promise<boolean> {
  const rows = await db
    .update(scriptParses)
    .set({ progress, updatedAt: new Date() })
    .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)))
    .returning({ id: scriptParses.id });
  return rows.length > 0;
}

/** Release the lease (only if we still hold it). */
async function releaseLease(parseId: string, leaseToken: string): Promise<void> {
  await db
    .update(scriptParses)
    .set({ leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)));
}

/**
 * Prove liveness by touching `updated_at` while we work. If the row no longer
 * carries our token (lease stolen after a quiet period), `lost()` flips so the
 * loop stops without writing anything further.
 */
function startHeartbeat(parseId: string, leaseToken: string) {
  let lost = false;
  const timer = setInterval(async () => {
    try {
      const rows = await db
        .update(scriptParses)
        .set({ updatedAt: new Date() })
        .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)))
        .returning({ id: scriptParses.id });
      if (rows.length === 0) lost = true;
    } catch {
      // Transient DB hiccup: keep going; the next tick retries.
    }
  }, HEARTBEAT_MS);
  return {
    lost: () => lost,
    stop: () => clearInterval(timer),
  };
}

/**
 * Kick the run route again from the server so a long parse continues even
 * when nobody is polling. Needs CRON_SECRET (the same internal-auth convention
 * as the billing cron). Best-effort: the review page's poll is the fallback.
 */
async function selfKick(origin: string | null, parseId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!origin || !secret) return;
  try {
    await fetch(`${origin}/api/scripts/${parseId}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("Script parse self-kick failed:", err);
  }
}

// ── Model calls ──────────────────────────────────────────────────────────────

type RawAnalysis = {
  title?: string;
  roles?: ParsedRole[];
  scenes?: ParsedScene[];
  bookmarks?: { kind?: string; title?: string; anchor?: string; page?: number }[];
};

function parseAnalysis(message: Anthropic.Message): RawAnalysis {
  const raw = JSON.parse(extractJson(textFromMessage(message))) as RawAnalysis;
  if (!Array.isArray(raw.roles) || !Array.isArray(raw.scenes)) {
    throw new Error("The analysis came back in an unexpected format.");
  }
  return raw;
}

function usageOf(message: Anthropic.Message): { input: number; output: number } {
  return {
    input: message.usage?.input_tokens ?? 0,
    output: message.usage?.output_tokens ?? 0,
  };
}

/** One text chunk: tagged pages → roles/scenes + anchor-resolved bookmarks. */
async function runTextChunk(
  client: Anthropic,
  input: { pages: string[]; range: PageRange; pageCount: number; preface: string },
): Promise<{ result: ChunkResult; usage: { input: number; output: number } }> {
  const tagged = buildTaggedScript(input.pages, input.range.startPage);
  const stream = client.messages.stream(
    {
      model: SCRIPT_PARSE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${input.preface}Analyse this script (${input.pageCount} pages):\n${tagged}`,
        },
      ],
    },
    { timeout: CHUNK_CALL_TIMEOUT_MS },
  );
  const message = await stream.finalMessage();
  const raw = parseAnalysis(message);
  // Page numbers are resolved in code from anchors within THIS chunk's pages
  // (never trusted from the model), then shifted to absolute pages.
  const local = resolveBookmarks(
    Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
    input.pages,
  );
  return {
    result: {
      title: raw.title ?? "",
      roles: raw.roles ?? [],
      scenes: raw.scenes ?? [],
      bookmarks: offsetBookmarks(local, input.range.startPage),
    },
    usage: usageOf(message),
  };
}

type PdfSource =
  | { type: "url"; url: string }
  | { type: "base64"; media_type: "application/pdf"; data: string };

/** One scan chunk: the PDF (or sub-PDF) itself → vision analysis. */
async function runScanChunk(
  client: Anthropic,
  input: { source: PdfSource; range: PageRange; pageCount: number; preface: string },
): Promise<{ result: ChunkResult; usage: { input: number; output: number } }> {
  const chunkPages = input.range.endPage - input.range.startPage + 1;
  const stream = client.messages.stream(
    {
      model: SCRIPT_PARSE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: input.source },
            {
              type: "text",
              text: `${input.preface}Analyse this scanned script (${chunkPages} pages).`,
            },
          ],
        },
      ],
    },
    { timeout: CHUNK_CALL_TIMEOUT_MS },
  );
  const message = await stream.finalMessage();
  const raw = parseAnalysis(message);
  // No text layer to anchor against on a scan — trust the model's page number
  // but validate it points at a real page of the excerpt, then offset.
  const local = resolveVisionBookmarks(
    Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
    chunkPages,
  );
  return {
    result: {
      title: raw.title ?? "",
      roles: raw.roles ?? [],
      scenes: raw.scenes ?? [],
      bookmarks: offsetBookmarks(local, input.range.startPage),
    },
    usage: usageOf(message),
  };
}

function toBase64Source(bytes: Uint8Array): PdfSource {
  return {
    type: "base64",
    media_type: "application/pdf",
    data: Buffer.from(bytes).toString("base64"),
  };
}

// ── Section detection ────────────────────────────────────────────────────────

type DetectOutcome = {
  sections: DetectSection[];
  inputTokens: number;
  outputTokens: number;
};

/**
 * Text PDF: per-page heuristics decide; a single cheap model pass (one digest
 * line per page) confirms the boundary only when the heuristics say the book
 * is mixed. Never spends model budget on an ordinary libretto.
 */
async function detectTextSections(
  client: Anthropic,
  pages: string[],
): Promise<DetectOutcome> {
  const classified = pages.map((text, i) => classifyTextPage(text, i));
  const heuristic = deriveSections(classified.map((c) => c.cls));
  if (!isMixedBook(heuristic)) {
    return { sections: heuristic, inputTokens: 0, outputTokens: 0 };
  }

  const digest = pages.map((text, i) => pageDigestLine(i, text, classified[i].features)).join("\n");
  const hint = heuristic
    .map((s) => `${s.kind} pages ${s.startPage}–${s.endPage}`)
    .join("; ");
  const stream = client.messages.stream(
    {
      model: SCRIPT_PARSE_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: DETECT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `A ${pages.length}-page book, one line per page: page | characters | share of lines that are dialogue cues | music-term hits | syllabified-lyric ratio | first words.\n` +
            `A first-pass heuristic thinks: ${hint}.\n\n` +
            `Return the book's sections as contiguous page ranges that together cover pages 1–${pages.length} exactly once, in order: ` +
            `{"sections":[{"kind":"libretto"|"vocal_score"|"front_matter"|"other","startPage":int,"endPage":int,"label":string}]}\n\n` +
            digest,
        },
      ],
    },
    { timeout: CHUNK_CALL_TIMEOUT_MS },
  );
  const message = await stream.finalMessage();
  const usage = usageOf(message);
  let sections = heuristic;
  try {
    const raw = JSON.parse(extractJson(textFromMessage(message))) as { sections?: unknown };
    const clean = sanitizeSections(raw.sections, pages.length);
    if (clean && isMixedBook(clean)) sections = clean;
  } catch {
    // Keep the heuristic sections.
  }
  return { sections, inputTokens: usage.input, outputTokens: usage.output };
}

const SAMPLE_KIND_MAP: Record<string, DetectSectionKind> = {
  dialogue: "libretto",
  libretto: "libretto",
  music: "vocal_score",
  score: "vocal_score",
  vocal_score: "vocal_score",
  front_matter: "front_matter",
  other: "other",
};

/**
 * Scanned PDF: classify a sampled sub-PDF (every k-th page) by vision, then
 * refine each libretto↔score boundary with the k pages around it so the
 * proposal lands on the exact page.
 */
async function detectScanSections(
  client: Anthropic,
  pdf: PDFDocument,
  pageCount: number,
): Promise<DetectOutcome> {
  const k = Math.max(1, Math.ceil(pageCount / SCAN_DETECT_SAMPLE_PAGES));
  const sampled: number[] = [];
  for (let p = 1; p <= pageCount; p += k) sampled.push(p);
  const sampleBytes = await extractPages(pdf, sampled);

  let inputTokens = 0;
  let outputTokens = 0;
  const stream = client.messages.stream(
    {
      model: SCRIPT_PARSE_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: DETECT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: toBase64Source(sampleBytes) },
            {
              type: "text",
              text:
                `These ${sampled.length} pages are sampled (every ${k}th page) from a ${pageCount}-page book. ` +
                `For EACH page of this excerpt, numbered 1..${sampled.length} in order, say what it is: ` +
                `"dialogue" (libretto page with character cues and spoken lines), "music" (engraved music notation, with or without lyrics), "front_matter" (title, cast, musical numbers, synopsis, contents), or "other". ` +
                `Respond as {"pages":[{"i":int,"kind":string}]} with exactly ${sampled.length} entries.`,
            },
          ],
        },
      ],
    },
    { timeout: CHUNK_CALL_TIMEOUT_MS },
  );
  const message = await stream.finalMessage();
  ({ input: inputTokens, output: outputTokens } = usageOf(message));
  const raw = JSON.parse(extractJson(textFromMessage(message))) as {
    pages?: { i?: number; kind?: string }[];
  };
  const samples = (Array.isArray(raw.pages) ? raw.pages : [])
    .map((p) => {
      const i = Math.round(Number(p.i));
      const kind = SAMPLE_KIND_MAP[String(p.kind ?? "").toLowerCase()] ?? "other";
      return i >= 1 && i <= sampled.length ? { page: sampled[i - 1], kind } : null;
    })
    .filter((s): s is { page: number; kind: DetectSectionKind } => s !== null);
  let sections = sectionsFromSamples(samples, pageCount);
  if (!isMixedBook(sections) || k === 1) {
    return { sections, inputTokens, outputTokens };
  }

  // Refine: each boundary between a libretto and a score section lies within
  // the k pages before the section's first sampled page. Cap the refinement
  // calls so a pathological classification can't run away.
  let refined = 0;
  for (let i = 1; i < sections.length && refined < 4; i++) {
    const prev = sections[i - 1];
    const cur = sections[i];
    const isKindBoundary =
      (prev.kind === "libretto" || prev.kind === "vocal_score") &&
      (cur.kind === "libretto" || cur.kind === "vocal_score") &&
      prev.kind !== cur.kind;
    if (!isKindBoundary) continue;
    const windowStart = Math.max(prev.startPage, cur.startPage - k + 1);
    const windowEnd = cur.startPage;
    if (windowEnd <= windowStart) continue;
    refined++;
    try {
      const windowBytes = await extractPageRange(pdf, { startPage: windowStart, endPage: windowEnd });
      const want = cur.kind === "vocal_score" ? "engraved music (the vocal score)" : "dialogue (the libretto)";
      const s2 = client.messages.stream(
        {
          model: SCRIPT_PARSE_MODEL,
          max_tokens: 500,
          thinking: { type: "adaptive" },
          system: DETECT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: toBase64Source(windowBytes) },
                {
                  type: "text",
                  text:
                    `This ${windowEnd - windowStart + 1}-page excerpt spans the point where the book changes from ${prev.kind === "vocal_score" ? "engraved music" : "dialogue"} to ${want}. ` +
                    `Which excerpt page (1 = first page of this excerpt) is the FIRST page of ${want}? Respond as {"firstPage":int}.`,
                },
              ],
            },
          ],
        },
        { timeout: CHUNK_CALL_TIMEOUT_MS },
      );
      const m2 = await s2.finalMessage();
      const u2 = usageOf(m2);
      inputTokens += u2.input;
      outputTokens += u2.output;
      const r2 = JSON.parse(extractJson(textFromMessage(m2))) as { firstPage?: number };
      const first = Math.round(Number(r2.firstPage));
      if (Number.isFinite(first) && first >= 1 && first <= windowEnd - windowStart + 1) {
        const boundary = windowStart + first - 1;
        if (boundary > prev.startPage && boundary <= cur.endPage) {
          sections = sections.map((s, j) =>
            j === i - 1 ? { ...s, endPage: boundary - 1 } : j === i ? { ...s, startPage: boundary } : s,
          );
        }
      }
    } catch (err) {
      console.error("Scan boundary refinement failed:", err);
    }
  }
  return { sections, inputTokens, outputTokens };
}

// ── The worker ───────────────────────────────────────────────────────────────

/**
 * One worker invocation for a staged parse. Holds the row's lease (acquired
 * by the run route), downloads the PDF, and advances the parse as far as its
 * time budget allows:
 *   - first invocation: page count, fingerprint + cache, decide text/scan mode
 *   - detect phase: find libretto / vocal-score sections; a mixed book stops
 *     at `split_suggested` for the user's decision
 *   - analyse phase: sequential chunks with carry-forward context; results
 *     accumulate in `progress`, then merge to `ready`
 * When the budget runs out it releases the lease and kicks the route again.
 * Never throws — the row's status is the single source of truth the UI polls.
 */
export async function runScriptParse(
  parseId: string,
  leaseToken: string,
  origin: string | null = null,
): Promise<void> {
  const [parse] = await db
    .select({
      id: scriptParses.id,
      productionId: scriptParses.productionId,
      documentId: scriptParses.documentId,
      storagePath: scriptParses.storagePath,
      requestedBy: scriptParses.requestedBy,
      notes: scriptParses.notes,
      progress: scriptParses.progress,
      leaseToken: scriptParses.leaseToken,
    })
    .from(scriptParses)
    .where(eq(scriptParses.id, parseId))
    .limit(1);

  if (!parse || parse.leaseToken !== leaseToken) return;

  const startedAt = Date.now();
  const heartbeat = startHeartbeat(parseId, leaseToken);
  let progress = (parse.progress as ParseProgress | null) ?? null;

  const setDocumentStatus = async (status: string) => {
    if (!parse.documentId) return;
    await db
      .update(documents)
      .set({ processingStatus: status })
      .where(eq(documents.id, parse.documentId));
  };

  try {
    const client = getAnthropicClient();
    if (!client) {
      throw new Error(
        "AI is not configured on the server (ANTHROPIC_API_KEY is missing).",
      );
    }

    // Resolve the PDF source: a production document (Documents flow) or a temp
    // upload path (new-production wizard, before the production exists).
    let storagePath: string;
    let docScriptKind: string | null = null;
    if (parse.documentId) {
      const [doc] = await db
        .select({
          storagePath: documents.storagePath,
          contentType: documents.contentType,
          scriptKind: documents.scriptKind,
        })
        .from(documents)
        .where(eq(documents.id, parse.documentId))
        .limit(1);
      if (!doc) throw new Error("Script document no longer exists.");
      if (doc.contentType !== "application/pdf") {
        throw new Error("AI analysis currently supports PDF scripts only.");
      }
      storagePath = doc.storagePath;
      docScriptKind = doc.scriptKind;
    } else if (parse.storagePath) {
      storagePath = parse.storagePath;
    } else {
      throw new Error("No script file is attached to this analysis.");
    }

    const supabase = createSupabaseAdminClient();
    const { data: signed } = await supabase.storage
      .from("attachments")
      .createSignedUrl(storagePath, 600);
    if (!signed?.signedUrl) throw new Error("Could not read the script file.");

    const res = await fetch(signed.signedUrl);
    if (!res.ok) throw new Error("Could not download the script file.");
    const bytes = new Uint8Array(await res.arrayBuffer());

    const pages = await extractPdfPages(bytes);
    const pageCount = pages.length;
    const fullText = pages.join("\n");
    const isScanned = fullText.trim().length < SCANNED_TEXT_THRESHOLD;

    // ── First invocation: size check, fingerprint + cache, plan the run ──
    if (!progress) {
      if (pageCount > MAX_SCRIPT_PAGES) {
        throw new Error(
          `This file is ${pageCount} pages — the limit is ${MAX_SCRIPT_PAGES}. Split it into separate files (e.g. libretto and vocal score, or by act) and analyse each.`,
        );
      }

      // Content fingerprint → per-org cache. An exact-file match reuses a
      // previously human-verified breakdown (instant, free, no model call).
      // Skipped for a re-analysis, where the point is a fresh take. For scans
      // the extracted text is empty (and would collide across different
      // scans), so we fingerprint the raw file bytes instead of the text.
      const fingerprint = createHash("sha256")
        .update(isScanned ? bytes : normalizeText(fullText))
        .digest("hex");

      // The cache is scoped per organization — a breakdown produced in one org
      // (where a script could carry prompt-injection) must never be served to
      // another. Wizard parses (no production yet) have no org to scope to.
      let cacheOrgId: string | null = null;
      if (parse.productionId) {
        const [prod] = await db
          .select({ organizationId: productions.organizationId })
          .from(productions)
          .where(eq(productions.id, parse.productionId))
          .limit(1);
        cacheOrgId = prod?.organizationId ?? null;
      }

      if (!parse.notes && cacheOrgId) {
        const [hit] = await db
          .select({ result: scriptCache.result })
          .from(scriptCache)
          .where(
            and(
              eq(scriptCache.organizationId, cacheOrgId),
              eq(scriptCache.fingerprint, fingerprint),
            ),
          )
          .limit(1);
        const cached = hit?.result as ScriptParseResult | undefined;
        if (cached && ((cached.roles?.length ?? 0) > 0 || (cached.scenes?.length ?? 0) > 0)) {
          await db
            .update(scriptParses)
            .set({
              status: "ready",
              result: cached,
              fingerprint,
              pageCount,
              error: null,
              inputTokens: 0,
              outputTokens: 0,
              leaseToken: null,
              leaseExpiresAt: null,
              updatedAt: new Date(),
            })
            .where(eq(scriptParses.id, parseId));
          await setDocumentStatus("ready");
          if (parse.requestedBy && parse.productionId) {
            await sendScriptParseReady({
              userId: parse.requestedBy,
              productionId: parse.productionId,
              roleCount: cached.roles.length,
              sceneCount: cached.scenes.length,
              documentId: parse.documentId,
            });
          }
          return;
        }
      }

      const kindHint =
        docScriptKind === "vocal_score" || docScriptKind === "libretto" ? docScriptKind : null;
      // Detection only makes sense for a production document that isn't
      // already a known half, on a first (not corrective) pass, and on a book
      // long enough to plausibly be two things.
      const shouldDetect =
        !parse.notes &&
        !!parse.productionId &&
        !!parse.documentId &&
        kindHint === null &&
        docScriptKind !== "combined" &&
        (isScanned ? pageCount >= SCAN_DETECT_MIN_PAGES : pageCount >= TEXT_DETECT_MIN_PAGES);

      progress = {
        version: 1,
        mode: isScanned ? "scan" : "text",
        pageCount,
        phase: shouldDetect ? "detect" : "analyse",
        chunks: [],
        invocations: 0,
        kindHint,
      };
      await db
        .update(scriptParses)
        .set({ progress, pageCount, fingerprint, updatedAt: new Date() })
        .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)));
      if (parse.documentId) {
        await db
          .update(documents)
          .set({ pageCount })
          .where(eq(documents.id, parse.documentId));
      }
    }

    progress.invocations += 1;
    if (progress.invocations > MAX_PARSE_INVOCATIONS) {
      throw new Error(
        "The analysis needed too many attempts and was stopped. Try splitting the file into smaller parts.",
      );
    }
    if (!(await persistProgress(parseId, leaseToken, progress))) return;

    // Scan chunks and detection samples need the PDF opened once (lazily).
    let pdfDoc: PDFDocument | null | undefined;
    const openPdf = async (): Promise<PDFDocument | null> => {
      if (pdfDoc !== undefined) return pdfDoc;
      try {
        pdfDoc = await loadPdf(bytes);
      } catch (err) {
        console.error("pdf-lib could not open the script:", err);
        pdfDoc = null;
      }
      return pdfDoc;
    };

    // ── Detect phase ──
    if (progress.phase === "detect") {
      if (!progress.skipDetect) {
        let outcome: DetectOutcome = { sections: [], inputTokens: 0, outputTokens: 0 };
        if (progress.mode === "text") {
          outcome = await detectTextSections(client, pages);
        } else {
          const pdf = await openPdf();
          if (pdf) outcome = await detectScanSections(client, pdf, pageCount);
        }
        const proposal = isMixedBook(outcome.sections)
          ? proposeSplitRanges(outcome.sections)
          : null;
        progress.detect = {
          sections: outcome.sections,
          proposal,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
        };
        if (proposal) {
          progress.phase = "detect"; // stays here until the user decides
          await db
            .update(scriptParses)
            .set({
              status: "split_suggested",
              progress,
              inputTokens: outcome.inputTokens,
              outputTokens: outcome.outputTokens,
              error: null,
              leaseToken: null,
              leaseExpiresAt: null,
              updatedAt: new Date(),
            })
            .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)));
          await setDocumentStatus("ready");
          if (parse.requestedBy && parse.productionId) {
            await sendScriptParseReady({
              userId: parse.requestedBy,
              productionId: parse.productionId,
              roleCount: 0,
              sceneCount: 0,
              variant: "split_suggested",
              documentId: parse.documentId,
            });
          }
          return;
        }
        progress.kindHint = dominantKind(outcome.sections);
      }
      progress.phase = "analyse";
      if (!(await persistProgress(parseId, leaseToken, progress))) return;
    }

    // ── Analyse phase ──
    if (progress.chunks.length === 0) {
      const ranges =
        progress.mode === "text"
          ? planTextChunks(pages, TEXT_CHUNK_CHARS)
          : planScanChunks(pageCount, bytes.length, {
              maxPages: SCAN_CHUNK_MAX_PAGES,
              maxBytes: SCAN_CHUNK_MAX_BYTES,
            });
      progress.chunks = ranges.map<ParseChunk>((r, index) => ({
        ...r,
        index,
        status: "pending",
        attempts: 0,
      }));
      if (!(await persistProgress(parseId, leaseToken, progress))) return;
    }

    // On a re-analysis, prepend the director's corrections and (if available)
    // the previous result so the model fixes the specific problems.
    let notesPreface = "";
    if (parse.notes) {
      let prior: unknown = null;
      if (parse.documentId) {
        const [prev] = await db
          .select({ result: scriptParses.result })
          .from(scriptParses)
          .where(
            and(
              eq(scriptParses.documentId, parse.documentId),
              ne(scriptParses.id, parseId),
              isNotNull(scriptParses.result),
            ),
          )
          .orderBy(desc(scriptParses.createdAt))
          .limit(1);
        prior = prev?.result ?? null;
      }
      // The notes are user text; the delimiter is stripped so they can't
      // close the quoted block and impersonate instructions.
      const safeNotes = parse.notes.replace(/"""/g, "'''");
      notesPreface =
        "This is a RE-ANALYSIS. A previous analysis was reviewed by the director, " +
        "who gave these corrections — apply them precisely:\n\"\"\"\n" +
        `${safeNotes}\n"""\n` +
        (prior
          ? `\nThe previous analysis (to correct, not to copy) was:\n${JSON.stringify(prior)}\n`
          : "") +
        "\nNow re-analyse the script and produce a corrected result.\n\n";
    }
    const kindPreface = progress.kindHint === "vocal_score" ? SCORE_PREFACE : "";

    // Scans: a single chunk can go straight from the signed URL (no pdf-lib);
    // multiple chunks need sub-PDFs. If pdf-lib can't open a long scan, fall
    // back to the single call only while that is still within reason.
    let scanPdf: PDFDocument | null = null;
    if (progress.mode === "scan" && progress.chunks.length > 1) {
      scanPdf = await openPdf();
      if (!scanPdf) {
        if (pageCount <= SCAN_URL_FALLBACK_MAX_PAGES) {
          progress.chunks = [
            { index: 0, startPage: 1, endPage: pageCount, status: "pending", attempts: 0 },
          ];
          if (!(await persistProgress(parseId, leaseToken, progress))) return;
        } else {
          throw new Error(
            "This scanned file couldn't be opened for page-by-page analysis. Try re-saving it as a standard PDF, or split it into separate files.",
          );
        }
      }
    }

    const total = progress.chunks.length;
    for (const chunk of progress.chunks) {
      if (chunk.status === "done") continue;
      if (chunk.status === "failed" && chunk.attempts >= MAX_CHUNK_ATTEMPTS) {
        throw new Error(
          `Pages ${chunk.startPage}–${chunk.endPage} could not be analysed. Try splitting the file at that point.`,
        );
      }
      if (heartbeat.lost()) return;
      // Out of time for this invocation: hand off to the next one.
      if (Date.now() - startedAt > INVOCATION_START_BUDGET_MS) {
        await persistProgress(parseId, leaseToken, progress);
        await releaseLease(parseId, leaseToken);
        heartbeat.stop();
        await selfKick(origin, parseId);
        return;
      }

      chunk.attempts += 1;
      chunk.status = "pending";
      if (!(await persistProgress(parseId, leaseToken, progress))) return;

      const doneSoFar = progress.chunks
        .filter((c) => c.status === "done" && c.result)
        .map((c) => c.result as ChunkResult);
      const merged = mergeChunkResults(doneSoFar);
      const preface =
        notesPreface +
        kindPreface +
        buildChunkPreface({
          chunk,
          index: chunk.index,
          total,
          pageCount,
          mode: progress.mode,
          carry: { roles: merged.roles, lastScene: lastSceneOf(doneSoFar) },
          kindHint: total > 1 ? null : progress.kindHint ?? null,
        });

      try {
        let out: { result: ChunkResult; usage: { input: number; output: number } };
        if (progress.mode === "text") {
          out = await runTextChunk(client, {
            pages: pages.slice(chunk.startPage - 1, chunk.endPage),
            range: chunk,
            pageCount,
            preface,
          });
        } else {
          const source: PdfSource =
            total === 1 || !scanPdf
              ? { type: "url", url: signed.signedUrl }
              : toBase64Source(await extractPageRange(scanPdf, chunk));
          out = await runScanChunk(client, { source, range: chunk, pageCount, preface });
        }
        chunk.status = "done";
        chunk.result = out.result;
        chunk.inputTokens = out.usage.input;
        chunk.outputTokens = out.usage.output;
        if (!(await persistProgress(parseId, leaseToken, progress))) return;
      } catch (err) {
        console.error(`Script parse chunk ${chunk.index + 1}/${total} failed:`, err);
        chunk.status = "failed";
        if (chunk.attempts >= MAX_CHUNK_ATTEMPTS) {
          const detail = err instanceof Error ? ` (${err.message})` : "";
          throw new Error(
            `Pages ${chunk.startPage}–${chunk.endPage} could not be analysed${detail}. Try splitting the file at that point.`,
          );
        }
        // Retry from a fresh invocation (new time budget, new connection).
        await persistProgress(parseId, leaseToken, progress);
        await releaseLease(parseId, leaseToken);
        heartbeat.stop();
        await selfKick(origin, parseId);
        return;
      }
    }

    // ── All chunks done: merge and finish ──
    const results = progress.chunks.map((c) => c.result as ChunkResult);
    const result: ScriptParseResult = mergeChunkResults(results);
    const inputTokens =
      progress.chunks.reduce((n, c) => n + (c.inputTokens ?? 0), 0) +
      (progress.detect?.inputTokens ?? 0);
    const outputTokens =
      progress.chunks.reduce((n, c) => n + (c.outputTokens ?? 0), 0) +
      (progress.detect?.outputTokens ?? 0);

    await db
      .update(scriptParses)
      .set({
        status: "ready",
        result,
        progress,
        error: null,
        inputTokens,
        outputTokens,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)));
    await setDocumentStatus("ready");

    // Notify only for production-scoped (Documents flow) parses. A wizard parse
    // has no production and the user is watching it live.
    if (parse.requestedBy && parse.productionId) {
      await sendScriptParseReady({
        userId: parse.requestedBy,
        productionId: parse.productionId,
        roleCount: result.roles.length,
        sceneCount: result.scenes.length,
        documentId: parse.documentId,
      });
    }
  } catch (err) {
    const messageText =
      err instanceof Error ? err.message : "Script analysis failed.";
    await db
      .update(scriptParses)
      .set({
        status: "failed",
        error: messageText,
        progress,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(scriptParses.id, parseId), eq(scriptParses.leaseToken, leaseToken)));
    await setDocumentStatus("failed");
  } finally {
    heartbeat.stop();
  }
}

