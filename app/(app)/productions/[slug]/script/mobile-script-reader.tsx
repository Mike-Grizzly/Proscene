"use client";

import type { ScriptDocumentOption } from "@/features/scripts/queries";
import { ScriptSwitcher } from "./script-switcher";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  ChevronDown,
  ChevronUp,
  Eraser,
  Highlighter,
  LayoutGrid,
  Pen,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { saveAnnotations } from "@/features/scripts/actions";
import { loadPdfDocument } from "@/lib/pdf";
import {
  ANNOTATION_COLORS,
  INK_OPACITY,
  INK_SIZES,
  inkPathD,
  type Annotation,
  type Bookmark,
  type HighlightAnnotation,
  type InkAnnotation,
  type InkPoint,
  type PageOverrides,
} from "@/features/scripts/constants";

type DrawTool = "none" | "highlighter" | "pen" | "eraser";

const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Low-res page thumbnails for the grid; shared across opens of the grid.
const thumbCache = new Map<string, string>(); // "url::page" -> jpeg dataURL

const GAP = 8; // px between pages in the continuous scroll
const DEFAULT_RATIO = 11 / 8.5; // letter portrait until we measure page 1
const WINDOW = 2; // pages rendered on either side of the current page

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

type Props = {
  scriptId: string;
  productionId: string;
  pdfUrl: string;
  title: string;
  initialAnnotations: Annotation[];
  initialBookmarks: Bookmark[];
  initialPageOverrides: PageOverrides;
  /** When used as a desktop "Read mode" overlay: close instead of navigating. */
  onExit?: () => void;
  /** Bubble bookmark changes up so a host (desktop viewer) stays in sync. */
  onBookmarksChange?: (bookmarks: Bookmark[]) => void;
  /** Open scrolled to this page (e.g. the desktop viewer's current page). */
  startPage?: number;
  /** Enable the freehand drawing palette (true on phones; false for the
   *  desktop Read-mode overlay, which is reading-only). */
  allowDrawing?: boolean;
  /** All of the production's scripts; a switcher replaces the title when > 1. */
  scripts?: ScriptDocumentOption[];
  activeScriptId?: string;
};

export function MobileScriptReader({
  scriptId,
  productionId,
  pdfUrl,
  title,
  initialAnnotations,
  initialBookmarks,
  initialPageOverrides,
  onExit,
  onBookmarksChange,
  startPage,
  allowDrawing = true,
  scripts,
  activeScriptId,
}: Props) {
  const router = useRouter();
  const exit = useCallback(() => {
    if (onExit) onExit();
    else router.back();
  }, [onExit, router]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const rendered = useRef<Set<number>>(new Set());
  const inFlight = useRef<Set<number>>(new Set());
  const pitchRef = useRef(0);

  const [pageCount, setPageCount] = useState(0);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [containerWidth, setContainerWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [gridOpen, setGridOpen] = useState(false);

  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const annotationsRef = useRef<Annotation[]>(initialAnnotations);
  const bookmarksRef = useRef<Bookmark[]>(initialBookmarks);
  const [, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Freehand tool state. The palette is hidden until opened; a tool is only
  // "active" (and page scroll locked) when the palette is open and a tool picked.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tool, setTool] = useState<DrawTool>("none");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setTool("none");
  }, []);

  // Highlight rects (desktop-drawn) shown read-only; freehand ink is editable.
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, HighlightAnnotation[]>();
    for (const a of annotations) {
      if (a.type !== "highlight") continue;
      (map.get(a.page) ?? map.set(a.page, []).get(a.page)!).push(a);
    }
    return map;
  }, [annotations]);

  const inkByPage = useMemo(() => {
    const map = new Map<number, InkAnnotation[]>();
    for (const a of annotations) {
      if (a.type !== "ink") continue;
      (map.get(a.page) ?? map.set(a.page, []).get(a.page)!).push(a);
    }
    return map;
  }, [annotations]);

  // ── Load the document: page count + aspect ratio from page 1 ──────────
  useEffect(() => {
    let active = true;
    loadPdfDocument(pdfUrl)
      .then(async (pdf) => {
        if (!active) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        if (active) setRatio(vp.height / vp.width);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pdfUrl]);

  // ── Measure the scroll port ───────────────────────────────────────────
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const measure = () => setContainerWidth(sc.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    return () => ro.disconnect();
  }, []);

  const slotH = containerWidth ? Math.round(containerWidth * ratio) : 0;
  useEffect(() => {
    pitchRef.current = slotH ? slotH + GAP : 0;
  }, [slotH]);

  // ── Render a single page to its canvas ────────────────────────────────
  const renderPage = useCallback(
    async (n: number) => {
      const canvas = canvases.current.get(n);
      if (
        !canvas ||
        !containerWidth ||
        rendered.current.has(n) ||
        inFlight.current.has(n)
      ) {
        return;
      }
      inFlight.current.add(n);
      try {
        const pdf = await loadPdfDocument(pdfUrl);
        const page = await pdf.getPage(n);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = (containerWidth * dpr) / vp1.width;
        const vp = page.getViewport({ scale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvas, viewport: vp }).promise;
        rendered.current.add(n);
      } catch {
        // ignore — a later scroll will retry
      } finally {
        inFlight.current.delete(n);
      }
    },
    [pdfUrl, containerWidth],
  );

  // ── Windowed rendering: keep current ± WINDOW painted, clear the rest ──
  useEffect(() => {
    if (!pageCount || !containerWidth) return;
    const lo = Math.max(1, currentPage - WINDOW);
    const hi = Math.min(pageCount, currentPage + WINDOW);
    for (let n = lo; n <= hi; n++) renderPage(n);
    rendered.current.forEach((n) => {
      if (n < lo - 1 || n > hi + 1) {
        const c = canvases.current.get(n);
        if (c) {
          c.width = 0;
          c.height = 0;
        }
        rendered.current.delete(n);
      }
    });
  }, [currentPage, pageCount, containerWidth, renderPage]);

  const onScroll = () => {
    const sc = scrollRef.current;
    const pitch = pitchRef.current;
    if (!sc || !pitch) return;
    const cur = clamp(Math.round(sc.scrollTop / pitch) + 1, 1, pageCount || 1);
    if (cur !== currentPage) setCurrentPage(cur);
  };

  const jumpTo = useCallback(
    (n: number, smooth = false) => {
      const sc = scrollRef.current;
      const pitch = pitchRef.current;
      if (!sc || !pitch) return;
      const t = clamp(n, 1, pageCount || 1);
      sc.scrollTo({ top: (t - 1) * pitch, behavior: smooth ? "smooth" : "auto" });
    },
    [pageCount],
  );

  // ── Persistence (annotations + bookmarks, debounced) ──────────────────
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const fd = new FormData();
      fd.set("script_id", scriptId);
      fd.set("production_id", productionId);
      fd.set("annotations", JSON.stringify(annotationsRef.current));
      fd.set("bookmarks", JSON.stringify(bookmarksRef.current));
      fd.set("page_overrides", JSON.stringify(initialPageOverrides));
      startTransition(() => {
        void saveAnnotations(fd);
      });
    }, 600);
  }, [scriptId, productionId, initialPageOverrides]);

  const commitAnnotations = useCallback(
    (next: Annotation[]) => {
      annotationsRef.current = next;
      setAnnotations(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const commitBookmarks = useCallback(
    (next: Bookmark[]) => {
      bookmarksRef.current = next;
      setBookmarks(next);
      onBookmarksChange?.(next);
      scheduleSave();
    },
    [scheduleSave, onBookmarksChange],
  );

  const toggleBookmark = useCallback(
    (n: number) => {
      const prev = bookmarksRef.current;
      const exists = prev.some((b) => b.page === n);
      const next = exists
        ? prev.filter((b) => b.page !== n)
        : [
            ...prev,
            { id: newId(), page: n, title: "", createdAt: new Date().toISOString() },
          ];
      commitBookmarks(next);
    },
    [commitBookmarks],
  );

  const isBookmarked = useCallback(
    (n: number) => bookmarks.some((b) => b.page === n),
    [bookmarks],
  );

  // ── Freehand drawing ──────────────────────────────────────────────────
  // The active stroke is tracked in a ref and drawn imperatively into one
  // fixed overlay path (no per-move React renders); it's committed to state
  // once on pointer-up. Eraser removes whole strokes near the touch point.
  const draftPathRef = useRef<SVGPathElement>(null);
  const drawing = useRef<{
    page: number;
    el: HTMLElement;
    pts: { x: number; y: number }[]; // viewport px
  } | null>(null);

  const strokeWidthPx = useCallback(
    (t: DrawTool) =>
      Math.max(
        1,
        (t === "pen" ? INK_SIZES.pen : INK_SIZES.highlighter) * containerWidth,
      ),
    [containerWidth],
  );

  const updateDraftPath = useCallback(() => {
    const path = draftPathRef.current;
    const d = drawing.current;
    if (!path || !d) return;
    path.setAttribute(
      "d",
      d.pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" "),
    );
    const hi = tool === "highlighter";
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-opacity", hi ? String(INK_OPACITY.highlighter) : "1");
    path.setAttribute("stroke-width", String(strokeWidthPx(tool)));
  }, [tool, color, strokeWidthPx]);

  const clearDraft = useCallback(() => {
    draftPathRef.current?.setAttribute("d", "");
  }, []);

  // Point/segment eraser: drop points within the eraser radius and keep the
  // surviving runs as separate strokes, so only the touched part disappears.
  const eraseAt = useCallback(
    (page: number, el: HTMLElement, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const rx = (clientX - rect.left) / rect.width;
      const ry = (clientY - rect.top) / rect.height;
      const aspect = rect.height / rect.width;
      const radius = 0.03; // ~3% of page width
      const prev = annotationsRef.current;
      const result: Annotation[] = [];
      let changed = false;

      for (const a of prev) {
        if (a.type !== "ink" || a.page !== page) {
          result.push(a);
          continue;
        }
        const runs: InkPoint[][] = [];
        let run: InkPoint[] = [];
        for (const p of a.points) {
          const hit = Math.hypot(p.x - rx, (p.y - ry) * aspect) < radius;
          if (hit) {
            if (run.length) runs.push(run);
            run = [];
          } else {
            run.push(p);
          }
        }
        if (run.length) runs.push(run);

        if (runs.length === 1 && runs[0].length === a.points.length) {
          result.push(a); // untouched
          continue;
        }
        changed = true;
        for (const r of runs) {
          if (r.length >= 2) result.push({ ...a, id: newId(), points: r });
        }
      }

      if (changed) commitAnnotations(result);
    },
    [commitAnnotations],
  );

  const onDrawDown = useCallback(
    (page: number, e: React.PointerEvent<SVGSVGElement>) => {
      if (tool === "none") return;
      const el = e.currentTarget as unknown as HTMLElement;
      el.setPointerCapture?.(e.pointerId);
      if (tool === "eraser") {
        drawing.current = { page, el, pts: [] };
        eraseAt(page, el, e.clientX, e.clientY);
        return;
      }
      drawing.current = { page, el, pts: [{ x: e.clientX, y: e.clientY }] };
      updateDraftPath();
    },
    [tool, eraseAt, updateDraftPath],
  );

  const onDrawMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drawing.current;
      if (!d) return;
      if (tool === "eraser") {
        eraseAt(d.page, d.el, e.clientX, e.clientY);
        return;
      }
      const last = d.pts[d.pts.length - 1];
      if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 2) return;
      d.pts.push({ x: e.clientX, y: e.clientY });
      updateDraftPath();
    },
    [tool, eraseAt, updateDraftPath],
  );

  const onDrawUp = useCallback(() => {
    const d = drawing.current;
    drawing.current = null;
    if (!d) return;
    if (tool === "eraser" || d.pts.length === 0) {
      clearDraft();
      return;
    }
    const rect = d.el.getBoundingClientRect();
    const points: InkPoint[] = d.pts.map((p) => ({
      x: clamp((p.x - rect.left) / rect.width, 0, 1),
      y: clamp((p.y - rect.top) / rect.height, 0, 1),
    }));
    const ann: InkAnnotation = {
      id: newId(),
      page: d.page,
      type: "ink",
      tool: tool === "pen" ? "pen" : "highlighter",
      color,
      size: tool === "pen" ? INK_SIZES.pen : INK_SIZES.highlighter,
      points,
    };
    commitAnnotations([...annotationsRef.current, ann]);
    clearDraft();
  }, [tool, color, commitAnnotations, clearDraft]);

  // ── Scrubber drag ─────────────────────────────────────────────────────
  const scrubDrag = useRef<{ y: number; page: number } | null>(null);
  const onScrubDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    scrubDrag.current = { y: e.clientY, page: currentPage };
  };
  const onScrubMove = (e: React.PointerEvent) => {
    if (!scrubDrag.current) return;
    const dy = e.clientY - scrubDrag.current.y;
    const track = window.innerHeight * 0.7;
    const delta = Math.round((dy / track) * (pageCount || 1));
    jumpTo(scrubDrag.current.page + delta, false);
  };
  const onScrubUp = () => {
    scrubDrag.current = null;
  };

  // Esc exits (used by the desktop Read-mode overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  // Jump to the requested start page once the layout is measured.
  const didInitialJump = useRef(false);
  useEffect(() => {
    if (didInitialJump.current) return;
    if (pageCount > 0 && containerWidth > 0 && pitchRef.current > 0) {
      didInitialJump.current = true;
      if (startPage && startPage > 1) jumpTo(startPage, false);
    }
  }, [pageCount, containerWidth, startPage, jumpTo]);

  const ready = pageCount > 0 && containerWidth > 0;
  const drawingActive = allowDrawing && tool !== "none";

  return (
    <div className="msr" data-drawing={drawingActive ? "1" : "0"}>
      <header className="msr-top">
        <button className="msr-icon" onClick={exit} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <span className="msr-brand" aria-hidden="true">
          P
        </span>
        <div className="msr-title">
          {scripts && scripts.length > 1 ? (
            <ScriptSwitcher
              productionId={productionId}
              scripts={scripts}
              activeScriptId={activeScriptId ?? scriptId}
              canManage={false}
              compact
            />
          ) : (
            title
          )}
        </div>
        <button
          className="msr-icon"
          data-on={isBookmarked(currentPage) ? "1" : "0"}
          onClick={() => toggleBookmark(currentPage)}
          aria-label={
            isBookmarked(currentPage) ? "Remove bookmark" : "Bookmark this page"
          }
        >
          <BookmarkIcon
            size={19}
            fill={isBookmarked(currentPage) ? "currentColor" : "none"}
          />
        </button>
        <button
          className="msr-icon"
          onClick={() => setGridOpen(true)}
          aria-label="All pages"
        >
          <LayoutGrid size={19} />
        </button>
      </header>

      <div className="msr-scroll" ref={scrollRef} onScroll={onScroll}>
        {ready &&
          Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className="msr-slot"
              data-page={n}
              style={{ height: slotH }}
            >
              <canvas
                className="msr-canvas"
                ref={(el) => {
                  if (el) canvases.current.set(n, el);
                  else canvases.current.delete(n);
                }}
              />
              {highlightsByPage.get(n)?.map((h) => (
                <div
                  key={h.id}
                  className="msr-hl"
                  style={{
                    left: `${h.rect.x * 100}%`,
                    top: `${h.rect.y * 100}%`,
                    width: `${h.rect.width * 100}%`,
                    height: `${h.rect.height * 100}%`,
                    background: h.color,
                  }}
                />
              ))}
              {(() => {
                const ink = inkByPage.get(n);
                if (!drawingActive && (!ink || ink.length === 0)) return null;
                return (
                  <svg
                    className="msr-ink"
                    viewBox={`0 0 ${containerWidth} ${slotH}`}
                    preserveAspectRatio="none"
                    style={{
                      pointerEvents: drawingActive ? "auto" : "none",
                      touchAction: drawingActive ? "none" : "auto",
                      cursor: drawingActive ? "crosshair" : "default",
                    }}
                    onPointerDown={(e) => onDrawDown(n, e)}
                    onPointerMove={onDrawMove}
                    onPointerUp={onDrawUp}
                    onPointerCancel={onDrawUp}
                  >
                    {ink?.map((a) => (
                      <path
                        key={a.id}
                        d={inkPathD(a.points, containerWidth, slotH)}
                        fill="none"
                        stroke={a.color}
                        strokeOpacity={
                          a.tool === "highlighter" ? INK_OPACITY.highlighter : 1
                        }
                        strokeWidth={Math.max(1, a.size * containerWidth)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={
                          a.tool === "highlighter"
                            ? { mixBlendMode: "multiply" }
                            : undefined
                        }
                      />
                    ))}
                  </svg>
                );
              })()}
              <span className="msr-slot-num">{n}</span>
            </div>
          ))}
        {!ready && (
          <div className="msr-loading">
            <span className="msr-spinner" />
            <span>Loading script…</span>
          </div>
        )}
      </div>

      {allowDrawing && (
        <svg className="msr-draft" aria-hidden="true">
          <path ref={draftPathRef} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}

      {allowDrawing && ready && !paletteOpen && (
        <button
          className="msr-annotate-fab"
          onClick={() => setPaletteOpen(true)}
          aria-label="Annotate"
        >
          <Pencil size={20} />
        </button>
      )}

      {allowDrawing && ready && paletteOpen && (
        <div className="msr-palette">
          <button
            className="msr-tool"
            data-on={tool === "highlighter" ? "1" : "0"}
            onClick={() => setTool((t) => (t === "highlighter" ? "none" : "highlighter"))}
            aria-label="Highlighter"
          >
            <Highlighter size={20} />
          </button>
          <button
            className="msr-tool"
            data-on={tool === "pen" ? "1" : "0"}
            onClick={() => setTool((t) => (t === "pen" ? "none" : "pen"))}
            aria-label="Pen"
          >
            <Pen size={20} />
          </button>
          <button
            className="msr-tool"
            data-on={tool === "eraser" ? "1" : "0"}
            onClick={() => setTool((t) => (t === "eraser" ? "none" : "eraser"))}
            aria-label="Eraser"
          >
            <Eraser size={20} />
          </button>
          {(tool === "highlighter" || tool === "pen") && (
            <>
              <span className="msr-palette-div" />
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.value}
                  className="msr-swatch"
                  data-on={color === c.value ? "1" : "0"}
                  style={{ background: c.value }}
                  onClick={() => setColor(c.value)}
                  aria-label={c.label}
                />
              ))}
            </>
          )}
          <span className="msr-palette-div" />
          <button className="msr-tool" onClick={closePalette} aria-label="Close tools">
            <X size={20} />
          </button>
        </div>
      )}

      {ready && (
        <div className="msr-scrub">
          <button
            className="msr-scrub-btn"
            onClick={() => jumpTo(currentPage - 1, true)}
            aria-label="Previous page"
          >
            <ChevronUp size={18} />
          </button>
          <div
            className="msr-scrub-num"
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
            onPointerCancel={onScrubUp}
          >
            <b>{currentPage}</b>
            <span />
            <i>{pageCount}</i>
          </div>
          <button
            className="msr-scrub-btn"
            onClick={() => jumpTo(currentPage + 1, true)}
            aria-label="Next page"
          >
            <ChevronDown size={18} />
          </button>
        </div>
      )}

      {gridOpen && (
        <PageGrid
          pageCount={pageCount}
          pdfUrl={pdfUrl}
          ratio={ratio}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          onJump={(n) => {
            setGridOpen(false);
            // Let the grid unmount before scrolling the reader.
            requestAnimationFrame(() => jumpTo(n, false));
          }}
          onClose={() => setGridOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Page grid overlay ──────────────────────────────────────────────────
function PageGrid({
  pageCount,
  pdfUrl,
  ratio,
  bookmarks,
  onToggleBookmark,
  onJump,
  onClose,
}: {
  pageCount: number;
  pdfUrl: string;
  ratio: number;
  bookmarks: Bookmark[];
  onToggleBookmark: (n: number) => void;
  onJump: (n: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | "bookmarks">("all");

  const bmByPage = useMemo(
    () => new Map(bookmarks.map((b) => [b.page, b.title] as const)),
    [bookmarks],
  );

  const pages = useMemo(() => {
    let list = Array.from({ length: pageCount }, (_, i) => i + 1);
    if (mode === "bookmarks") list = list.filter((n) => bmByPage.has(n));
    const q = query.trim().toLowerCase();
    if (q) {
      if (/^\d+$/.test(q)) {
        list = list.filter((n) => String(n).includes(q));
      } else {
        list = list.filter((n) => (bmByPage.get(n) ?? "").toLowerCase().includes(q));
      }
    }
    return list;
  }, [pageCount, mode, query, bmByPage]);

  return (
    <div className="msr-grid-screen">
      <div className="msr-grid-bar">
        <div className="msr-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search page # or bookmark"
            autoFocus
          />
        </div>
        <button className="msr-icon" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="msr-grid-filter">
        <button data-on={mode === "all" ? "1" : "0"} onClick={() => setMode("all")}>
          All pages
        </button>
        <button
          data-on={mode === "bookmarks" ? "1" : "0"}
          onClick={() => setMode("bookmarks")}
        >
          Bookmarks
        </button>
      </div>
      <div className="msr-grid">
        {pages.map((n) => (
          <PageThumb
            key={n}
            n={n}
            pdfUrl={pdfUrl}
            ratio={ratio}
            bookmarked={bmByPage.has(n)}
            title={bmByPage.get(n) || ""}
            onJump={onJump}
            onToggle={onToggleBookmark}
          />
        ))}
        {pages.length === 0 && (
          <div className="msr-grid-empty">No matching pages.</div>
        )}
      </div>
    </div>
  );
}

function PageThumb({
  n,
  pdfUrl,
  ratio,
  bookmarked,
  title,
  onJump,
  onToggle,
}: {
  n: number;
  pdfUrl: string;
  ratio: number;
  bookmarked: boolean;
  title: string;
  onJump: (n: number) => void;
  onToggle: (n: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(
    () => thumbCache.get(`${pdfUrl}::${n}`) ?? null,
  );

  useEffect(() => {
    if (src) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        (async () => {
          try {
            const pdf = await loadPdfDocument(pdfUrl);
            const page = await pdf.getPage(n);
            const vp1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: 240 / vp1.width });
            const c = document.createElement("canvas");
            c.width = Math.floor(vp.width);
            c.height = Math.floor(vp.height);
            await page.render({ canvas: c, viewport: vp }).promise;
            const data = c.toDataURL("image/jpeg", 0.7);
            thumbCache.set(`${pdfUrl}::${n}`, data);
            if (!cancelled) setSrc(data);
          } catch {
            // ignore
          }
        })();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [n, pdfUrl, src]);

  return (
    <button ref={ref} className="msr-thumb" onClick={() => onJump(n)}>
      <div className="msr-thumb-img" style={{ aspectRatio: `1 / ${ratio}` }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Page ${n}`} />
        ) : (
          <div className="msr-thumb-ph" />
        )}
        <span
          className="msr-thumb-bm"
          data-on={bookmarked ? "1" : "0"}
          role="button"
          aria-label={bookmarked ? "Remove bookmark" : "Bookmark page"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(n);
          }}
        >
          <BookmarkIcon size={15} fill={bookmarked ? "currentColor" : "none"} />
        </span>
      </div>
      <div className="msr-thumb-cap">
        <b>{n}</b>
        {title ? <span>{title}</span> : null}
      </div>
    </button>
  );
}
