/**
 * Pure helpers for the AI script parse: chunk planning, result merging,
 * bookmark resolution, and libretto / vocal-score section detection. No DB,
 * SDK, or server-only imports so every function here is unit-testable.
 */
import type {
  ChunkResult,
  DetectSection,
  DetectSectionKind,
  PageRange,
  ParsedBookmark,
  ParsedRole,
  ParsedScene,
  ParseProgress,
  ParseProgressSummary,
  ScriptParseResult,
  SplitRanges,
} from "./constants";
import {
  DETECT_MIN_KIND_PAGES,
  DETECT_MIN_SECTION_PAGES,
  MAX_CHUNK_ATTEMPTS,
} from "./constants";

// ── Text normalisation / model output ────────────────────────────────────────

/** Normalize text for anchor matching: lowercase, alnum + single spaces. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull the JSON object out of the model's reply, tolerating stray fences/prose. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

// ── Bookmark resolution ──────────────────────────────────────────────────────

/**
 * Resolve each bookmark's page deterministically by locating its verbatim
 * anchor (falling back to the title) in the per-page text. This removes the
 * model's page-number drift over long scripts, and drops any bookmark whose
 * anchor can't be found — which also filters hallucinated scene markers.
 * Pages are numbered from 1 relative to the `pages` array given.
 */
export function resolveBookmarks(
  raw: { kind?: string; title?: string; anchor?: string }[],
  pages: string[],
): ParsedBookmark[] {
  const pagesNorm = pages.map(normalizeText);

  // Identify front-matter "index" pages — a table of contents, "musical
  // numbers" list, or synopsis of scenes. These list many scene/song titles
  // together, so a naive first-match would resolve every bookmark to the index
  // instead of the real page. A page is treated as an index page if it names an
  // index section, or if it contains many (≥4) distinct bookmark anchors.
  const INDEX_KEYWORDS = [
    "musical numbers",
    "scenes and musical numbers",
    "synopsis of scenes",
    "table of contents",
    "list of scenes",
  ];
  const anchorTexts = raw
    .map((b) => normalizeText(b.anchor ?? b.title ?? ""))
    .filter((a) => a.length >= 4);
  const indexPages = new Set<number>();
  for (let i = 0; i < pagesNorm.length; i++) {
    const text = pagesNorm[i];
    const distinctHits = new Set(anchorTexts.filter((a) => text.includes(a)));
    const hasKeyword = INDEX_KEYWORDS.some((k) => text.includes(k));
    if (hasKeyword || distinctHits.size >= 4) indexPages.add(i);
  }
  const findBodyPage = (needle: string) =>
    pagesNorm.findIndex((p, i) => !indexPages.has(i) && p.includes(needle));

  const out: ParsedBookmark[] = [];
  const seen = new Set<string>();
  for (const b of raw) {
    const anchor = normalizeText(b.anchor ?? "");
    const title = normalizeText(b.title ?? "");
    let page = -1;
    if (anchor.length >= 4) page = findBodyPage(anchor);
    if (page === -1 && title.length >= 4) page = findBodyPage(title);
    if (page === -1) continue; // unfindable outside the index → drop
    const key = `${page}|${(b.title ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      page: page + 1,
      title: (b.title ?? "").trim() || `Page ${page + 1}`,
      kind: b.kind === "song" ? "song" : "scene",
    });
  }
  out.sort((a, b) => a.page - b.page);
  return out;
}

/**
 * Resolve bookmarks for the vision (scanned-PDF) path, where the model returns
 * a page number directly rather than a text anchor. We can't verify the page
 * against an extracted-text layer here, so we only validate it is a real page
 * of the document (or excerpt) and de-duplicate. Bookmarks are best-effort.
 */
export function resolveVisionBookmarks(
  raw: { kind?: string; title?: string; page?: number }[],
  pageCount: number,
): ParsedBookmark[] {
  const out: ParsedBookmark[] = [];
  const seen = new Set<string>();
  for (const b of raw) {
    const page = Math.round(Number(b.page));
    if (!Number.isFinite(page) || page < 1 || page > pageCount) continue;
    const title = (b.title ?? "").trim() || `Page ${page}`;
    const key = `${page}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ page, title, kind: b.kind === "song" ? "song" : "scene" });
  }
  out.sort((a, b) => a.page - b.page);
  return out;
}

/** Shift excerpt-relative bookmark pages to absolute document pages. */
export function offsetBookmarks(
  bookmarks: ParsedBookmark[],
  startPage: number,
): ParsedBookmark[] {
  const delta = startPage - 1;
  return bookmarks.map((b) => ({ ...b, page: b.page + delta }));
}

// ── Chunk planning ───────────────────────────────────────────────────────────

/** Join per-page text into a single page-tagged document for the model. */
export function buildTaggedScript(pages: string[], firstPageNumber = 1): string {
  let out = "";
  for (let i = 0; i < pages.length; i++) {
    out += `\n===== PAGE ${firstPageNumber + i} =====\n${pages[i]}\n`;
  }
  return out;
}

/**
 * Split a text PDF into page ranges whose tagged text stays under `maxChars`.
 * A typical script fits one chunk; only very long books split. A single page
 * over the limit still gets its own chunk (never truncated).
 */
export function planTextChunks(pages: string[], maxChars: number): PageRange[] {
  const ranges: PageRange[] = [];
  if (pages.length === 0) return ranges;
  let start = 1;
  let size = 0;
  for (let i = 0; i < pages.length; i++) {
    const pageChars = pages[i].length + 24; // page marker overhead
    if (size > 0 && size + pageChars > maxChars) {
      ranges.push({ startPage: start, endPage: i });
      start = i + 1;
      size = 0;
    }
    size += pageChars;
  }
  ranges.push({ startPage: start, endPage: pages.length });
  return ranges;
}

/**
 * Split a scanned PDF into page ranges bounded by both a page cap and a raw
 * byte cap (estimated from the average page size), so each base64 sub-PDF
 * stays well inside Claude's per-request limit.
 */
export function planScanChunks(
  pageCount: number,
  fileBytes: number,
  opts: { maxPages: number; maxBytes: number },
): PageRange[] {
  const ranges: PageRange[] = [];
  if (pageCount <= 0) return ranges;
  const avgPageBytes = Math.max(1, fileBytes / pageCount);
  const byBytes = Math.floor(opts.maxBytes / avgPageBytes);
  const perChunk = Math.max(1, Math.min(opts.maxPages, byBytes));
  for (let start = 1; start <= pageCount; start += perChunk) {
    ranges.push({ startPage: start, endPage: Math.min(pageCount, start + perChunk - 1) });
  }
  return ranges;
}

export function pagesInRange(r: PageRange): number[] {
  const out: number[] = [];
  for (let p = r.startPage; p <= r.endPage; p++) out.push(p);
  return out;
}

// ── Merging chunk results ────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = { Principal: 3, Supporting: 2, Ensemble: 1 };

/**
 * Combine per-chunk results into one breakdown. Roles are unioned by name,
 * keeping the most prominent classification seen and first-appearance order;
 * scenes are concatenated in reading order and de-duplicated on (act, scene);
 * bookmarks (already absolute) are de-duplicated on (page, title) and sorted.
 */
export function mergeChunkResults(chunks: ChunkResult[]): ScriptParseResult {
  const roleByKey = new Map<string, ParsedRole>();
  const sceneKeys = new Set<string>();
  const scenes: ParsedScene[] = [];
  const bookmarkKeys = new Set<string>();
  const bookmarks: ParsedBookmark[] = [];
  let title = "";

  for (const chunk of chunks) {
    if (!title && chunk.title?.trim()) title = chunk.title.trim();
    for (const r of chunk.roles ?? []) {
      const name = (r.name ?? "").trim();
      if (!name) continue;
      const key = normalizeText(name);
      if (!key) continue;
      const prev = roleByKey.get(key);
      if (!prev) {
        roleByKey.set(key, { name, type: r.type });
      } else if ((ROLE_RANK[r.type] ?? 0) > (ROLE_RANK[prev.type] ?? 0)) {
        prev.type = r.type;
      }
    }
    for (const s of chunk.scenes ?? []) {
      const key = `${s.actNumber}|${s.sceneNumber}`;
      if (sceneKeys.has(key)) continue;
      sceneKeys.add(key);
      scenes.push({ ...s });
    }
    for (const b of chunk.bookmarks ?? []) {
      const key = `${b.page}|${(b.title ?? "").trim().toLowerCase()}`;
      if (bookmarkKeys.has(key)) continue;
      bookmarkKeys.add(key);
      bookmarks.push({ ...b });
    }
  }
  bookmarks.sort((a, b) => a.page - b.page);
  return { title, roles: [...roleByKey.values()], scenes, bookmarks };
}

/** The last scene of the merged results so far (for chunk carry-forward). */
export function lastSceneOf(chunks: ChunkResult[]): ParsedScene | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const s = chunks[i].scenes;
    if (s && s.length > 0) return s[s.length - 1];
  }
  return null;
}

/**
 * The preface that tells the model which slice of the book it's reading and
 * what earlier slices already established, so numbering and role prominence
 * stay coherent across chunks.
 */
export function buildChunkPreface(input: {
  chunk: PageRange;
  index: number;
  total: number;
  pageCount: number;
  mode: "text" | "scan";
  carry: { roles: ParsedRole[]; lastScene: ParsedScene | null };
  kindHint: "libretto" | "vocal_score" | null;
}): string {
  const { chunk, index, total, pageCount, mode, carry, kindHint } = input;
  if (total <= 1 && !kindHint) return "";
  const lines: string[] = [];
  if (kindHint === "vocal_score") {
    lines.push(
      "This document is a PIANO-VOCAL SCORE (music notation with lyrics), not a dialogue script.",
    );
  } else if (kindHint === "libretto") {
    lines.push("This document is the LIBRETTO (dialogue script) of a musical.");
  }
  if (total > 1) {
    lines.push(
      `You are reading pages ${chunk.startPage}–${chunk.endPage} of a ${pageCount}-page book (part ${index + 1} of ${total}).`,
    );
    if (carry.roles.length > 0) {
      const names = carry.roles.map((r) => r.name).slice(0, 80).join(", ");
      lines.push(
        `Characters already found in earlier pages (keep their names exactly; list them again only if they appear here): ${names}.`,
      );
    }
    if (carry.lastScene) {
      lines.push(
        `The last scene that began before these pages was Act ${carry.lastScene.actNumber}, Scene ${carry.lastScene.sceneNumber} ("${carry.lastScene.title}") — it may continue into these pages. Continue the act/scene numbering from there.`,
      );
    }
    lines.push(
      "Only report scenes and musical numbers that BEGIN within these pages. Front-matter listing pages are reference only.",
    );
    if (mode === "scan") {
      lines.push(
        `IMPORTANT: report each bookmark's "page" as its page WITHIN THIS EXCERPT, where the first page of this excerpt is page 1 (do not add ${chunk.startPage - 1}; we do that).`,
      );
    }
  }
  return lines.length ? lines.join("\n") + "\n\n" : "";
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function progressSummary(p: ParseProgress | null | undefined): ParseProgressSummary | null {
  if (!p) return null;
  const total = p.chunks.length;
  const done = p.chunks.filter((c) => c.status === "done").length;
  const current = p.chunks.find((c) => c.status !== "done") ?? null;
  return {
    phase: p.phase,
    done,
    total,
    currentRange: current ? { startPage: current.startPage, endPage: current.endPage } : null,
    pageCount: p.pageCount,
  };
}

export function hasPendingChunks(p: ParseProgress | null | undefined): boolean {
  if (!p) return false;
  if (p.phase === "detect") return true;
  return p.chunks.some(
    (c) => c.status !== "done" && (c.status !== "failed" || c.attempts < MAX_CHUNK_ATTEMPTS),
  );
}

// ── Section detection (libretto vs vocal score) ──────────────────────────────

export type PageClass = DetectSectionKind | "unknown";

export type PageFeatures = {
  chars: number;
  lines: number;
  cueRatio: number;
  musicHits: number;
  syllableRatio: number;
  numberRunRatio: number;
};

const MUSIC_TERMS =
  /\b(allegro|allegretto|andante|andantino|moderato|adagio|largo|lento|vivace|presto|cresc|crescendo|decresc|diminuendo|dim\.|rit\.|ritard|ritardando|rall\.|rallentando|a tempo|tempo|segue|attacca|vamp|colla voce|rubato|fermata|soprano|alto|tenor|baritone|mezzo|d\.s\.|d\.c\.|dal segno|da capo|coda|legato|staccato|accel\.|sfz|8va|pp|ff|mf|mp)\b/gi;
const FRONT_MATTER_TERMS =
  /musical numbers|cast of characters|dramatis personae|synopsis|contents|characters\b|scenes and|orchestration|instrumentation|acknowledg/i;
// "FREDERIC." / "FREDERIC:" / "Frederic:" at the start of a line.
const CUE_LINE = /^\s*(?:[A-Z][A-Z .'&-]{1,30}[.:]|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?:)\s/;
// Engraved lyrics come through as syllables joined by spaced hyphens.
const SYLLABLE = /\b[a-z]{1,5}\s?-\s[a-z]/gi;
const NUMBER_TOKEN = /^\d{1,3}$/;

export function pageFeatures(text: string): PageFeatures {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const tokens = text.split(/\s+/).filter(Boolean);
  const cueLines = lines.filter((l) => CUE_LINE.test(l + " ")).length;
  const musicHits = (text.match(MUSIC_TERMS) ?? []).length;
  const syllables = (text.match(SYLLABLE) ?? []).length;
  const numberTokens = tokens.filter((t) => NUMBER_TOKEN.test(t)).length;
  return {
    chars: text.length,
    lines: lines.length,
    cueRatio: lines.length ? cueLines / lines.length : 0,
    musicHits,
    syllableRatio: tokens.length ? syllables / tokens.length : 0,
    numberRunRatio: tokens.length ? numberTokens / tokens.length : 0,
  };
}

/**
 * Heuristic page classifier for text PDFs. Score pages carry little prose,
 * music terms, syllabified lyrics and bar numbers; libretto pages carry
 * dialogue cues. Returns "unknown" when the signals don't agree.
 */
export function classifyTextPage(
  text: string,
  index: number,
): { cls: PageClass; features: PageFeatures } {
  const f = pageFeatures(text);
  if (f.chars < 40) return { cls: "unknown", features: f };
  if (index < 12 && f.chars < 2500 && FRONT_MATTER_TERMS.test(text)) {
    return { cls: "front_matter", features: f };
  }
  const scoreSignals =
    (f.musicHits >= 1 ? 1 : 0) +
    (f.syllableRatio > 0.04 ? 1 : 0) +
    (f.numberRunRatio > 0.15 ? 1 : 0) +
    (f.chars < 900 ? 1 : 0);
  if (scoreSignals >= 2 && f.cueRatio < 0.1) return { cls: "vocal_score", features: f };
  if (f.chars >= 600 && f.cueRatio >= 0.05) return { cls: "libretto", features: f };
  if (f.chars >= 1200 && f.musicHits === 0 && f.syllableRatio < 0.02) {
    return { cls: "libretto", features: f };
  }
  return { cls: "unknown", features: f };
}

const SECTION_LABELS: Record<DetectSectionKind, string> = {
  libretto: "Libretto",
  vocal_score: "Vocal score",
  front_matter: "Front matter",
  other: "Other",
};

type Run = { kind: DetectSectionKind; start: number; end: number };

function runLength(r: Run): number {
  return r.end - r.start + 1;
}

/**
 * Turn per-page classes into contiguous sections. Unknown pages inherit the
 * preceding known class; runs shorter than `minRun` (except a leading
 * front-matter run) are absorbed into the larger neighbour, so cue pages
 * inside a score or a title page inside a libretto don't fragment the book.
 */
export function deriveSections(
  classes: PageClass[],
  opts: { minRun?: number } = {},
): DetectSection[] {
  const minRun = opts.minRun ?? DETECT_MIN_SECTION_PAGES;
  if (classes.length === 0) return [];

  // Fill unknowns: forward from the previous known class; leading unknowns
  // take the first known class. All-unknown → one "other" section.
  const filled: DetectSectionKind[] = [];
  const firstKnown = classes.find((c) => c !== "unknown") as DetectSectionKind | undefined;
  let prev: DetectSectionKind = firstKnown ?? "other";
  for (const c of classes) {
    if (c !== "unknown") prev = c;
    filled.push(prev);
  }

  let runs: Run[] = [];
  for (let i = 0; i < filled.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.kind === filled[i]) last.end = i + 1;
    else runs.push({ kind: filled[i], start: i + 1, end: i + 1 });
  }

  // Absorb short runs into the larger neighbour until stable.
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if (runLength(r) >= minRun) continue;
      if (i === 0 && r.kind === "front_matter") continue;
      const left = i > 0 ? runs[i - 1] : null;
      const right = i < runs.length - 1 ? runs[i + 1] : null;
      const target =
        left && right
          ? runLength(left) >= runLength(right)
            ? left
            : right
          : (left ?? right);
      if (!target) continue;
      if (target === left) {
        left!.end = r.end;
      } else {
        right!.start = r.start;
      }
      runs.splice(i, 1);
      changed = true;
      break;
    }
    // Re-merge adjacent runs of the same kind produced by an absorption.
    const merged: Run[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last.kind === r.kind) last.end = r.end;
      else merged.push({ ...r });
    }
    if (merged.length !== runs.length) changed = true;
    runs = merged;
  }

  return runs.map((r) => ({
    kind: r.kind,
    startPage: r.start,
    endPage: r.end,
    label: SECTION_LABELS[r.kind],
  }));
}

/**
 * Sections from a sampled classification (scans): each sampled page's kind
 * covers the pages up to the next sample. Single-sample islands whose
 * neighbours agree are smoothed away first.
 */
export function sectionsFromSamples(
  samples: { page: number; kind: DetectSectionKind }[],
  pageCount: number,
): DetectSection[] {
  const sorted = [...samples].sort((a, b) => a.page - b.page);
  if (sorted.length === 0 || pageCount <= 0) return [];
  const kinds = sorted.map((s) => s.kind);
  for (let i = 1; i < kinds.length - 1; i++) {
    if (kinds[i] !== kinds[i - 1] && kinds[i - 1] === kinds[i + 1]) kinds[i] = kinds[i - 1];
  }
  const classes: PageClass[] = new Array(pageCount).fill("unknown");
  for (let i = 0; i < sorted.length; i++) {
    const from = Math.max(1, sorted[i].page);
    const to = i + 1 < sorted.length ? sorted[i + 1].page - 1 : pageCount;
    for (let p = from; p <= Math.min(to, pageCount); p++) classes[p - 1] = kinds[i];
  }
  return deriveSections(classes, { minRun: 1 });
}

/** A book is "mixed" when it has a real libretto run AND a real score run. */
export function isMixedBook(sections: DetectSection[]): boolean {
  const longest = (kind: DetectSectionKind) =>
    Math.max(0, ...sections.filter((s) => s.kind === kind).map((s) => s.endPage - s.startPage + 1));
  return longest("libretto") >= DETECT_MIN_KIND_PAGES && longest("vocal_score") >= DETECT_MIN_KIND_PAGES;
}

/** The single kind of a non-mixed book, if it's clearly one thing. */
export function dominantKind(sections: DetectSection[]): "libretto" | "vocal_score" | null {
  const total = (kind: DetectSectionKind) =>
    sections.filter((s) => s.kind === kind).reduce((n, s) => n + s.endPage - s.startPage + 1, 0);
  const lib = total("libretto");
  const score = total("vocal_score");
  if (lib === 0 && score === 0) return null;
  return score > lib ? "vocal_score" : "libretto";
}

/**
 * Propose one contiguous libretto range and one contiguous vocal-score range:
 * the largest run of each, each extended over immediately adjacent
 * front-matter / other sections. Contested middle sections go to whichever
 * half comes first. Null unless both kinds are present.
 */
export function proposeSplitRanges(sections: DetectSection[]): SplitRanges | null {
  const largest = (kind: DetectSectionKind) =>
    sections
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === kind)
      .sort((a, b) => b.s.endPage - b.s.startPage - (a.s.endPage - a.s.startPage))[0] ?? null;
  const lib = largest("libretto");
  const score = largest("vocal_score");
  if (!lib || !score) return null;

  const extend = (idx: number, blocked: DetectSectionKind): PageRange => {
    let start = sections[idx].startPage;
    let end = sections[idx].endPage;
    for (let i = idx - 1; i >= 0 && sections[i].kind !== blocked && sections[i].kind !== sections[idx].kind; i--) {
      start = sections[i].startPage;
    }
    for (let i = idx + 1; i < sections.length && sections[i].kind !== blocked && sections[i].kind !== sections[idx].kind; i++) {
      end = sections[i].endPage;
    }
    return { startPage: start, endPage: end };
  };

  const libretto = extend(lib.i, "vocal_score");
  const vocalScore = extend(score.i, "libretto");
  // Resolve any overlap in the contested middle: the earlier half keeps it.
  if (libretto.startPage <= vocalScore.startPage) {
    if (vocalScore.startPage <= libretto.endPage) vocalScore.startPage = libretto.endPage + 1;
  } else if (libretto.startPage <= vocalScore.endPage) {
    libretto.startPage = vocalScore.endPage + 1;
  }
  if (libretto.startPage > libretto.endPage || vocalScore.startPage > vocalScore.endPage) return null;
  return { libretto, vocalScore };
}

/** Human-readable reason the ranges are invalid, or null when they're fine. */
export function validateSplitRanges(ranges: SplitRanges, pageCount: number): string | null {
  const check = (r: PageRange, label: string): string | null => {
    if (!Number.isInteger(r.startPage) || !Number.isInteger(r.endPage)) {
      return `${label}: pages must be whole numbers.`;
    }
    if (r.startPage < 1 || r.endPage > pageCount) {
      return `${label}: pages must be between 1 and ${pageCount}.`;
    }
    if (r.startPage > r.endPage) return `${label}: the first page must come before the last.`;
    if (r.endPage - r.startPage + 1 < 2) return `${label}: needs at least 2 pages.`;
    return null;
  };
  const a = check(ranges.libretto, "Libretto");
  if (a) return a;
  const b = check(ranges.vocalScore, "Vocal score");
  if (b) return b;
  const overlap =
    ranges.libretto.startPage <= ranges.vocalScore.endPage &&
    ranges.vocalScore.startPage <= ranges.libretto.endPage;
  if (overlap) return "The libretto and vocal score page ranges overlap.";
  return null;
}

/** Compact one-line-per-page digest for the text detection prompt. */
export function pageDigestLine(index: number, text: string, f: PageFeatures): string {
  const gist = text.replace(/\s+/g, " ").trim().slice(0, 100);
  return `p${index + 1} | ${f.chars}c | cues ${(f.cueRatio * 100).toFixed(0)}% | music ${f.musicHits} | syl ${f.syllableRatio.toFixed(2)} | "${gist}"`;
}

/** Validate model-returned sections: in range, ascending, contiguous. */
export function sanitizeSections(
  raw: unknown,
  pageCount: number,
): DetectSection[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const KINDS: DetectSectionKind[] = ["libretto", "vocal_score", "front_matter", "other"];
  const out: DetectSection[] = [];
  let cursor = 1;
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const kind = KINDS.includes(o.kind as DetectSectionKind) ? (o.kind as DetectSectionKind) : "other";
    const startPage = Math.round(Number(o.startPage));
    const endPage = Math.round(Number(o.endPage));
    if (!Number.isFinite(startPage) || !Number.isFinite(endPage)) return null;
    if (startPage !== cursor || endPage < startPage || endPage > pageCount) return null;
    out.push({
      kind,
      startPage,
      endPage,
      label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : SECTION_LABELS[kind],
    });
    cursor = endPage + 1;
  }
  if (cursor !== pageCount + 1) return null;
  return out;
}
