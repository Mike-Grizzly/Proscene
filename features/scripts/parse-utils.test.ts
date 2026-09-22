import { describe, it, expect } from "vitest";
import {
  planTextChunks,
  planScanChunks,
  mergeChunkResults,
  offsetBookmarks,
  resolveBookmarks,
  deriveSections,
  sectionsFromSamples,
  proposeSplitRanges,
  validateSplitRanges,
  classifyTextPage,
  isMixedBook,
  sanitizeSections,
  progressSummary,
  buildChunkPreface,
  type PageClass,
} from "./parse-utils";
import { countsTowardQuota, type ChunkResult, type ParseProgress } from "./constants";

describe("planTextChunks", () => {
  it("keeps a normal script in one chunk", () => {
    const pages = Array.from({ length: 150 }, () => "x".repeat(2500));
    expect(planTextChunks(pages, 450_000)).toEqual([{ startPage: 1, endPage: 150 }]);
  });
  it("splits on page boundaries under the limit", () => {
    const pages = Array.from({ length: 10 }, () => "x".repeat(100));
    const chunks = planTextChunks(pages, 3 * 124 + 1); // ~3 pages per chunk
    expect(chunks[0]).toEqual({ startPage: 1, endPage: 3 });
    expect(chunks.at(-1)!.endPage).toBe(10);
    expect(chunks.every((c) => c.startPage <= c.endPage)).toBe(true);
  });
  it("gives a single oversized page its own chunk, never truncating", () => {
    const pages = ["a".repeat(50), "b".repeat(10_000), "c".repeat(50)];
    expect(planTextChunks(pages, 1000)).toEqual([
      { startPage: 1, endPage: 1 },
      { startPage: 2, endPage: 2 },
      { startPage: 3, endPage: 3 },
    ]);
  });
});

describe("planScanChunks", () => {
  it("uses the page cap when pages are small", () => {
    const chunks = planScanChunks(130, 130 * 50_000, { maxPages: 60, maxBytes: 18e6 });
    expect(chunks).toEqual([
      { startPage: 1, endPage: 60 },
      { startPage: 61, endPage: 120 },
      { startPage: 121, endPage: 130 },
    ]);
  });
  it("shrinks chunks when the byte cap binds first", () => {
    // 1 MB per page → 18 pages per chunk
    const chunks = planScanChunks(40, 40 * 1024 * 1024, { maxPages: 60, maxBytes: 18 * 1024 * 1024 });
    expect(chunks[0]).toEqual({ startPage: 1, endPage: 18 });
    expect(chunks.at(-1)!.endPage).toBe(40);
  });
});

describe("mergeChunkResults", () => {
  const a: ChunkResult = {
    title: "",
    roles: [{ name: "Mabel", type: "Supporting" }, { name: "Frederic", type: "Principal" }],
    scenes: [{ actNumber: 1, sceneNumber: 1, title: "A rocky seashore" }],
    bookmarks: [{ page: 3, title: "Pour, oh pour", kind: "song" }],
  };
  const b: ChunkResult = {
    title: "The Pirates of Penzance",
    roles: [{ name: "MABEL", type: "Principal" }, { name: "Ruth", type: "Ensemble" }],
    scenes: [
      { actNumber: 1, sceneNumber: 1, title: "dup" },
      { actNumber: 2, sceneNumber: 1, title: "A ruined chapel" },
    ],
    bookmarks: [{ page: 3, title: "Pour, Oh Pour", kind: "song" }, { page: 90, title: "Act II", kind: "scene" }],
  };
  it("unions roles by name keeping the highest rank and first order", () => {
    const merged = mergeChunkResults([a, b]);
    expect(merged.roles.map((r) => r.name)).toEqual(["Mabel", "Frederic", "Ruth"]);
    expect(merged.roles[0].type).toBe("Principal");
    expect(merged.title).toBe("The Pirates of Penzance");
  });
  it("de-duplicates scenes on (act, scene) and bookmarks on (page, title)", () => {
    const merged = mergeChunkResults([a, b]);
    expect(merged.scenes.map((s) => `${s.actNumber}.${s.sceneNumber}`)).toEqual(["1.1", "2.1"]);
    expect(merged.bookmarks.map((b) => b.page)).toEqual([3, 90]);
  });
});

describe("offsetBookmarks + resolveBookmarks", () => {
  it("offsets excerpt pages to absolute pages", () => {
    expect(offsetBookmarks([{ page: 2, title: "x", kind: "scene" }], 121)[0].page).toBe(122);
  });
  it("still skips index pages within a chunk", () => {
    const pages = [
      "MUSICAL NUMBERS\n1. Pour oh pour\n2. Oh better far\n3. Climbing over\n4. Stop ladies",
      "dialogue",
      "No. 1 Pour oh pour the pirate sherry",
    ];
    const out = resolveBookmarks([{ kind: "song", title: "Pour oh pour", anchor: "Pour oh pour" }], pages);
    expect(out).toEqual([{ page: 3, title: "Pour oh pour", kind: "song" }]);
  });
});

describe("deriveSections", () => {
  const run = (kind: PageClass, n: number): PageClass[] => Array(n).fill(kind);
  it("absorbs short islands into the larger neighbour and keeps leading front matter", () => {
    const classes: PageClass[] = [
      ...run("front_matter", 4),
      ...run("libretto", 100),
      ...run("vocal_score", 6), // cue-page island inside libretto? no — a short score island
      ...run("libretto", 40),
      ...run("vocal_score", 200),
      ...run("libretto", 5), // dialogue cue pages inside the score
      ...run("vocal_score", 100),
    ];
    const sections = deriveSections(classes, { minRun: 12 });
    expect(sections.map((s) => [s.kind, s.startPage, s.endPage])).toEqual([
      ["front_matter", 1, 4],
      ["libretto", 5, 150],
      ["vocal_score", 151, 455],
    ]);
  });
  it("fills unknown pages from the previous known class", () => {
    const classes: PageClass[] = ["unknown", "libretto", "unknown", "unknown", "vocal_score", "unknown"];
    const sections = deriveSections(classes, { minRun: 1 });
    expect(sections.map((s) => [s.kind, s.startPage, s.endPage])).toEqual([
      ["libretto", 1, 4],
      ["vocal_score", 5, 6],
    ]);
  });
  it("returns one 'other' section when nothing is known", () => {
    expect(deriveSections(["unknown", "unknown"])).toEqual([
      { kind: "other", startPage: 1, endPage: 2, label: "Other" },
    ]);
  });
});

describe("sectionsFromSamples", () => {
  it("expands sampled kinds to page runs and smooths single-sample islands", () => {
    const samples = [
      { page: 1, kind: "front_matter" as const },
      { page: 9, kind: "libretto" as const },
      { page: 17, kind: "vocal_score" as const }, // island
      { page: 25, kind: "libretto" as const },
      { page: 33, kind: "vocal_score" as const },
      { page: 41, kind: "vocal_score" as const },
    ];
    const sections = sectionsFromSamples(samples, 48);
    expect(sections.map((s) => [s.kind, s.startPage, s.endPage])).toEqual([
      ["front_matter", 1, 8],
      ["libretto", 9, 32],
      ["vocal_score", 33, 48],
    ]);
  });
});

describe("proposeSplitRanges / isMixedBook", () => {
  it("extends each half over adjacent front matter and gives contested pages to the earlier half", () => {
    const sections = [
      { kind: "front_matter" as const, startPage: 1, endPage: 4, label: "" },
      { kind: "libretto" as const, startPage: 5, endPage: 150, label: "" },
      { kind: "other" as const, startPage: 151, endPage: 152, label: "" },
      { kind: "vocal_score" as const, startPage: 153, endPage: 455, label: "" },
    ];
    expect(isMixedBook(sections)).toBe(true);
    expect(proposeSplitRanges(sections)).toEqual({
      libretto: { startPage: 1, endPage: 152 },
      vocalScore: { startPage: 153, endPage: 455 },
    });
  });
  it("handles score-first books", () => {
    const sections = [
      { kind: "vocal_score" as const, startPage: 1, endPage: 300, label: "" },
      { kind: "libretto" as const, startPage: 301, endPage: 420, label: "" },
    ];
    expect(proposeSplitRanges(sections)).toEqual({
      libretto: { startPage: 301, endPage: 420 },
      vocalScore: { startPage: 1, endPage: 300 },
    });
  });
  it("returns null when a kind is missing", () => {
    expect(proposeSplitRanges([{ kind: "libretto", startPage: 1, endPage: 100, label: "" }])).toBeNull();
    expect(isMixedBook([{ kind: "libretto", startPage: 1, endPage: 100, label: "" }])).toBe(false);
  });
});

describe("validateSplitRanges", () => {
  const ok = { libretto: { startPage: 1, endPage: 100 }, vocalScore: { startPage: 101, endPage: 400 } };
  it("accepts a clean split", () => expect(validateSplitRanges(ok, 400)).toBeNull());
  it("rejects overlap, out-of-range and reversed ranges", () => {
    expect(validateSplitRanges({ ...ok, vocalScore: { startPage: 90, endPage: 400 } }, 400)).toMatch(/overlap/);
    expect(validateSplitRanges({ ...ok, vocalScore: { startPage: 101, endPage: 401 } }, 400)).toMatch(/between 1 and 400/);
    expect(validateSplitRanges({ ...ok, libretto: { startPage: 50, endPage: 10 } }, 400)).toMatch(/first page/);
  });
});

describe("classifyTextPage", () => {
  it("flags a dialogue page as libretto", () => {
    const page = Array.from(
      { length: 30 },
      (_, i) => `${i % 2 ? "FREDERIC." : "MABEL."} ${"Some spoken line of dialogue that goes on for a bit. ".repeat(2)}`,
    ).join("\n");
    expect(classifyTextPage(page, 40).cls).toBe("libretto");
  });
  it("flags an engraved score page as vocal_score", () => {
    const page = "Allegro moderato\n12 13 14 15\nPour, oh pour the pi - rate sher - ry;\nfill, oh fill the pi - rate glass\ncresc. 16 17 18\nmf 19 20 21";
    expect(classifyTextPage(page, 200).cls).toBe("vocal_score");
  });
  it("flags an early musical-numbers list as front matter", () => {
    expect(classifyTextPage("MUSICAL NUMBERS\n1. Pour oh pour ..... 3\n2. Oh better far ..... 9", 2).cls).toBe("front_matter");
  });
});

describe("sanitizeSections", () => {
  it("accepts contiguous ascending sections covering the book", () => {
    const out = sanitizeSections(
      [{ kind: "libretto", startPage: 1, endPage: 10 }, { kind: "vocal_score", startPage: 11, endPage: 20, label: "Score" }],
      20,
    );
    expect(out?.map((s) => s.label)).toEqual(["Libretto", "Score"]);
  });
  it("rejects gaps, overlaps and short coverage", () => {
    expect(sanitizeSections([{ kind: "libretto", startPage: 1, endPage: 10 }], 20)).toBeNull();
    expect(sanitizeSections([{ kind: "libretto", startPage: 2, endPage: 20 }], 20)).toBeNull();
  });
});

describe("progress + quota helpers", () => {
  const progress: ParseProgress = {
    version: 1,
    mode: "scan",
    pageCount: 480,
    phase: "analyse",
    invocations: 2,
    chunks: [
      { index: 0, startPage: 1, endPage: 60, status: "done", attempts: 1 },
      { index: 1, startPage: 61, endPage: 120, status: "pending", attempts: 0 },
    ],
  };
  it("summarises chunk progress", () => {
    expect(progressSummary(progress)).toEqual({
      phase: "analyse",
      done: 1,
      total: 2,
      currentRange: { startPage: 61, endPage: 120 },
      pageCount: 480,
    });
  });
  it("counts only parses that ran the model", () => {
    expect(countsTowardQuota("ready")).toBe(true);
    expect(countsTowardQuota("split_suggested")).toBe(false);
    expect(countsTowardQuota("split")).toBe(false);
    expect(countsTowardQuota("failed")).toBe(false);
  });
  it("builds a chunk preface with carry-forward and excerpt-relative pages for scans", () => {
    const preface = buildChunkPreface({
      chunk: { startPage: 61, endPage: 120 },
      index: 1,
      total: 8,
      pageCount: 480,
      mode: "scan",
      carry: { roles: [{ name: "Mabel", type: "Principal" }], lastScene: { actNumber: 1, sceneNumber: 2, title: "The beach" } },
      kindHint: null,
    });
    expect(preface).toContain("pages 61–120 of a 480-page book (part 2 of 8)");
    expect(preface).toContain("Mabel");
    expect(preface).toContain("Act 1, Scene 2");
    expect(preface).toContain("WITHIN THIS EXCERPT");
    expect(buildChunkPreface({ chunk: { startPage: 1, endPage: 100 }, index: 0, total: 1, pageCount: 100, mode: "text", carry: { roles: [], lastScene: null }, kindHint: null })).toBe("");
  });
});
