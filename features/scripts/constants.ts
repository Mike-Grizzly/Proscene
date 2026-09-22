export const ANNOTATION_COLORS = [
  { label: "Yellow", value: "#FDE68A" },
  { label: "Green", value: "#A7F3D0" },
  { label: "Blue", value: "#BFDBFE" },
  { label: "Pink", value: "#FBCFE8" },
  { label: "Coral", value: "#FCA5A5" },
] as const;

export const DEFAULT_ANNOTATION_COLOR = "#FDE68A";
export const CUE_STROKE = "#EF4444";

export type Tool = "pointer" | "highlight-box" | "highlight-text" | "note" | "cue";

export type AnnotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HighlightAnnotation = {
  id: string;
  page: number;
  type: "highlight";
  // Overall bounding box (selection outline / hit area / back-compat).
  rect: AnnotationRect;
  // Per-line boxes for a text selection, so a multi-line highlight hugs each
  // line instead of filling one big block. Absent on drawn-box highlights and
  // on highlights made before this existed — those just use `rect`.
  rects?: AnnotationRect[];
  color: string;
};

export type NoteAnnotation = {
  id: string;
  page: number;
  type: "note";
  rect: AnnotationRect;
  text: string;
  color: string;
};

export type CueAnnotation = {
  id: string;
  page: number;
  type: "cue";
  rect: AnnotationRect;
  cueNumber: string;
  cueDescription: string;
  leaderSide: "left" | "right";
  // Per-cue colour (e.g. red for lights, blue for sound). Absent on cues made
  // before colour was added — they fall back to CUE_STROKE.
  color?: string;
  // Script text captured from under the cue's box at draw time (the "line" the
  // cue is called on). Absent on cues made before this was added.
  line?: string;
  // How the cue is anchored on the page: a drawn "box" around words/lines
  // (default) or a "pipe" — a single vertical line dropped between words / at a
  // line end. For pipes, `rect` is zero-width at the pipe's x over its line,
  // and `line` carries the surrounding words with "*" marking the pipe.
  marker?: "box" | "pipe";
  // User-dragged label position (normalized page coords of the label's anchor
  // dot). When set, the label sits here instead of being auto-stacked; the
  // orthogonal leader follows it. Cleared to return the cue to auto-placement.
  labelPos?: { x: number; y: number };
  // Independent label placement for the Focus View margin gutter. Dragging a
  // card in margin mode writes here instead of `labelPos`, so it never disturbs
  // the in-page (normal editor) auto-placement. Normalized to the page width
  // (x can exceed 1 — the gutter sits past the page's right edge).
  marginLabelPos?: { x: number; y: number };
  // Multiplier for the cue number/description label text size (default 1).
  // `cueTextScale` is the legacy single control (scaled both); cueNumScale /
  // cueDescScale scale the number and description independently and take
  // precedence when present.
  cueTextScale?: number;
  cueNumScale?: number;
  cueDescScale?: number;
};

/**
 * Cue colours — saturated so leader lines / labels read clearly over the
 * script. The first (red) is the legacy default (`CUE_STROKE`). The viewer
 * remembers the last colour picked and applies it to new cues until changed.
 */
export const CUE_COLORS = [
  { label: "Black", value: "#111111" },
  { label: "Red", value: "#EF4444" },
  { label: "Blue", value: "#3B82F6" },
  { label: "Green", value: "#22C55E" },
  { label: "Amber", value: "#F59E0B" },
  { label: "Purple", value: "#8B5CF6" },
  { label: "Pink", value: "#EC4899" },
] as const;

/** Point on a page, normalized 0–1 against page width/height. */
export type InkPoint = { x: number; y: number };

/** Freehand stroke (mobile reader). Drawn with a highlighter or pen. */
export type InkAnnotation = {
  id: string;
  page: number;
  type: "ink";
  tool: "highlighter" | "pen";
  color: string;
  /** Stroke width as a fraction of page width (scales across devices/zoom). */
  size: number;
  points: InkPoint[];
};

// Ink stroke presets (size = fraction of page width).
export const INK_SIZES = { highlighter: 0.022, pen: 0.005 } as const;
export const INK_OPACITY = { highlighter: 0.42, pen: 1 } as const;

/** Build an SVG path `d` from normalized points scaled to a w×h box. */
export function inkPathD(points: InkPoint[], w: number, h: number): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => `${i ? "L" : "M"}${(p.x * w).toFixed(2)} ${(p.y * h).toFixed(2)}`)
    .join(" ");
}

export type Annotation =
  | HighlightAnnotation
  | NoteAnnotation
  | CueAnnotation
  | InkAnnotation;
export type PageOverrides = Record<string, string>;

export type Bookmark = {
  id: string;
  page: number;
  title: string;
  createdAt: string;
  // Set for AI-seeded bookmarks so the reader can tag/colour them. Absent on
  // bookmarks a user adds by hand.
  kind?: "scene" | "song";
};

// Cost guardrails for AI analysis. Each parse is a real per-token Anthropic
// charge, so cap how often the feature can run for one production. The window
// is generous enough for legitimate re-uploads but kills runaway loops.
export const PARSE_LIMIT_PER_PRODUCTION = 5;
export const PARSE_WINDOW_DAYS = 30;

// Designer-package subscribers pay a much lower price, so AI parsing is tighter:
// one analysis per project, and at most two across all their projects per window
// (keeps a healthy overhead on AI cost). Same rolling PARSE_WINDOW_DAYS window.
export const DESIGNER_PARSE_LIMIT_PER_PRODUCTION = 1;
export const DESIGNER_PARSE_LIMIT_PER_USER = 2;

// Org-wide denial-of-wallet backstop. The per-production and per-designer caps
// don't bound total spend on their own — a user who can create productions gets
// fresh per-production quota with every new show. This ceiling caps how many AI
// analyses an entire organization can run per calendar month. Set well above
// normal use so it only ever stops a runaway or abusive account; it resets on
// the 1st of each month.
export const ORG_PARSE_LIMIT_PER_MONTH = 50;

// ----- AI script analysis (the model's proposal, pre-review) -----

/** Character/role types the analyser may assign. Mirrors the wizard's set. */
export const PARSE_ROLE_TYPES = ["Principal", "Supporting", "Ensemble"] as const;

export type ParsedRole = {
  name: string;
  type: string;
};

export type ParsedScene = {
  actNumber: number;
  sceneNumber: number;
  title: string;
};

export type ParsedBookmark = {
  page: number;
  title: string;
  kind: "scene" | "song";
};

export type ScriptParseResult = {
  title: string;
  roles: ParsedRole[];
  scenes: ParsedScene[];
  bookmarks: ParsedBookmark[];
};

// processing → ready → applied | failed. A combined libretto + vocal-score
// book pauses at split_suggested (awaiting the user's boundary decision) and,
// once split, ends at "split" — the halves get their own parses.
export type ScriptParseStatus =
  | "processing"
  | "ready"
  | "applied"
  | "failed"
  | "split_suggested"
  | "split";

/** Parses that spent model budget and should count against the caps. */
export function countsTowardQuota(status: string): boolean {
  return status !== "failed" && status !== "split" && status !== "split_suggested";
}

// ── Script kinds (documents.script_kind) ─────────────────────────────────────
export const SCRIPT_KINDS = ["libretto", "vocal_score", "combined"] as const;
export type ScriptKind = (typeof SCRIPT_KINDS)[number];
export const SCRIPT_KIND_LABELS: Record<ScriptKind, string> = {
  libretto: "Libretto",
  vocal_score: "Vocal score",
  combined: "Combined book",
};
export function isScriptKind(value: unknown): value is ScriptKind {
  return typeof value === "string" && (SCRIPT_KINDS as readonly string[]).includes(value);
}

// ── Long-book parsing: chunked, resumable analysis ───────────────────────────
// A 1-based inclusive page range within a PDF.
export type PageRange = { startPage: number; endPage: number };

/** One chunk's model output, bookmarks already offset to absolute pages. */
export type ChunkResult = {
  title: string;
  roles: ParsedRole[];
  scenes: ParsedScene[];
  bookmarks: ParsedBookmark[];
};

export type ParseChunk = PageRange & {
  index: number;
  status: "pending" | "done" | "failed";
  attempts: number;
  result?: ChunkResult;
  inputTokens?: number;
  outputTokens?: number;
};

export type DetectSectionKind = "libretto" | "vocal_score" | "front_matter" | "other";
export type DetectSection = PageRange & { kind: DetectSectionKind; label: string };
export type SplitRanges = { libretto: PageRange; vocalScore: PageRange };

/**
 * Resumable-run state stored on `script_parses.progress`. Written only by the
 * invocation holding the row's lease. `mode` is decided once from the text
 * layer; `phase` moves detect → analyse; `chunks` is the analysis plan.
 */
export type ParseProgress = {
  version: 1;
  mode: "text" | "scan";
  pageCount: number;
  phase: "detect" | "analyse";
  chunks: ParseChunk[];
  invocations: number;
  // Set by "Analyse as one book" so a resumed run doesn't re-detect.
  skipDetect?: boolean;
  // Kind of book being analysed (prompt hint). From documents.script_kind or
  // from a single-kind detection result.
  kindHint?: "libretto" | "vocal_score" | null;
  // Which engine cut the scan into chunks: pdf-lib sub-PDFs, the single
  // signed-URL call, or pdfium page images (when pdf-lib can't open the file).
  engine?: "pdf-lib" | "url" | "pdfium-raster";
  // The pdf-lib error that forced the fallback, for diagnosis.
  pdfLibError?: string;
  detect?: {
    sections: DetectSection[];
    proposal: SplitRanges | null;
    inputTokens: number;
    outputTokens: number;
  };
  split?: {
    librettoDocumentId: string;
    vocalScoreDocumentId: string;
    // True when the halves were rebuilt from page images (pdf-lib couldn't
    // open the original, so pdfium rendered it): no text layer, as with scans.
    rasterized?: boolean;
  };
};

/** What the review page shows while a parse runs. */
export type ParseProgressSummary = {
  phase: "detect" | "analyse";
  done: number;
  total: number;
  currentRange: PageRange | null;
  pageCount: number;
};

// Tuning. A text libretto ≤ ~180 pages stays a single call (unchanged
// behaviour); only 400–600-page books chunk. Scan chunks are bounded by both
// pages and raw bytes so the base64 sub-PDF stays far below Claude's 32 MB
// request cap.
export const MAX_SCRIPT_PAGES = 600;
export const TEXT_CHUNK_CHARS = 450_000;
export const SCAN_CHUNK_MAX_PAGES = 60;
export const SCAN_CHUNK_MAX_BYTES = 18 * 1024 * 1024;
// Raster fallback (pdfium renders pages → PNG images when pdf-lib can't open a
// scan): fewer pages per call, since each page is a separate image block and
// the whole base64 request must stay under Claude's 32 MB ceiling.
export const RASTER_CHUNK_MAX_PAGES = 24;
export const RASTER_CHUNK_MAX_BYTES = 20 * 1024 * 1024;
export const RASTER_DETECT_SAMPLE_PAGES = 30;
// Detection: a scanned libretto alone is never this long; a combined book is.
export const SCAN_DETECT_MIN_PAGES = 160;
export const SCAN_DETECT_SAMPLE_PAGES = 60;
// Sections shorter than this are absorbed into a neighbour (cue pages inside
// a score, a title page inside a libretto) so a book yields two clean halves.
export const DETECT_MIN_SECTION_PAGES = 12;
export const DETECT_MIN_KIND_PAGES = 15;
// Time budget per worker invocation (Vercel maxDuration = 300 s): only START a
// chunk while under this, and bound each model call so the worst case still
// finishes inside the invocation.
export const INVOCATION_START_BUDGET_MS = 90_000;
export const CHUNK_CALL_TIMEOUT_MS = 190_000;
// Lease outlives any single invocation; heartbeat proves liveness.
export const LEASE_MS = 320_000;
export const HEARTBEAT_MS = 20_000;
export const DEAD_HEARTBEAT_MS = 90_000;
export const MAX_CHUNK_ATTEMPTS = 2;
export const MAX_PARSE_INVOCATIONS = 15;

// ── Scanned-script OCR (in-browser, tesseract.js — see lib/ocr.ts) ──────────
// A single OCR'd word with a box normalized to 0..1 of the page width/height,
// so it maps to any render scale in the viewer's transparent text layer.
export type OcrWord = {
  t: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type OcrPage = {
  page: number;
  words: OcrWord[];
};

export type ScriptOcrStatus = "processing" | "ready" | "failed";
