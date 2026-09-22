"use client";

import {
  Fragment,
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useTransition,
} from "react";
import {
  MousePointer2,
  Highlighter,
  StickyNote,
  Zap,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
  Type,
  AlignLeft,
  AlignRight,
  Bookmark as BookmarkIcon,
  Plus,
  Check,
  Download,
  LayoutList,
  ZoomIn,
  ZoomOut,
  Pencil,
  BookOpen,
  Maximize2,
  Sparkles,
  ScanText,
  Music,
  Clapperboard,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveAnnotations, dismissStaleBanner } from "@/features/scripts/actions";
import {
  ANNOTATION_COLORS,
  DEFAULT_ANNOTATION_COLOR,
  CUE_STROKE,
  CUE_COLORS,
  INK_OPACITY,
  inkPathD,
  type Tool,
  type Annotation,
  type AnnotationRect,
  type Bookmark,
  type PageOverrides,
} from "@/features/scripts/constants";
import type { DefaultScript, ScriptDocumentOption } from "@/features/scripts/queries";
import { ScriptSwitcher } from "./script-switcher";
import { SCRIPT_KIND_LABELS, isScriptKind } from "@/features/scripts/constants";
import { loadPdfDocument } from "@/lib/pdf";
import { useIsPhone } from "@/lib/use-is-phone";
import { MobileScriptReader } from "./mobile-script-reader";
import { useScriptOcr } from "./use-script-ocr";
import { useScriptRebuild } from "./use-script-rebuild";

// Module-level cache so re-renders don't re-decode the same page
const pdfBitmapCache = new Map<string, ImageBitmap>();
const pdfThumbnailCache = new Map<string, string>(); // "url::page" -> jpeg dataURL

const ZOOM_STEPS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;
const ZOOM_LABELS = ["75%", "100%", "125%", "150%", "200%"] as const;
const BASE_RENDER_SCALE = 1.8;

// Cursor for the pipe-cue tool: a vertical line (white halo for contrast on the
// page), hotspot at its centre — so it's obvious you're dropping a pipe and
// exactly where. Falls back to the text I-beam.
const PIPE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='26'><line x1='9' y1='4' x2='9' y2='22' stroke='white' stroke-width='4' stroke-linecap='round'/><line x1='9' y1='4' x2='9' y2='22' stroke='black' stroke-width='2' stroke-linecap='round'/></svg>",
)}") 9 13, text`;

/**
 * Is a rendered page (near-)blank? Downsamples to a small canvas and measures
 * the fraction of non-white ("ink") pixels. A scanned page that pdfjs failed to
 * rasterize (MRC/CCITT ImageMask scripts) comes out essentially white; a page
 * that actually drew its text has several percent ink. Threshold sits between.
 */
function isRenderBlank(source: HTMLCanvasElement): boolean {
  try {
    const W = 80;
    const H = Math.max(1, Math.round((source.height / source.width) * W));
    const small = document.createElement("canvas");
    small.width = W;
    small.height = H;
    const ctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(source, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Treat a pixel as "ink" if it's clearly off-white (any channel dark).
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) ink += 1;
    }
    const coverage = ink / (W * H);
    return coverage < 0.004; // < 0.4% drawn ⇒ effectively blank
  } catch {
    return false; // never block viewing on a detection failure
  }
}

interface Props {
  script: DefaultScript;
  productionId: string;
  pdfUrl: string;
  initialAnnotations: Annotation[];
  initialBookmarks: Bookmark[];
  initialPageOverrides: PageOverrides;
  initialHasStalePages: boolean;
  slug: string;
  canManage: boolean;
  /** Focus View margin mode: route cue labels into a right-hand gutter as boxed
   *  cards with orthogonal leaders. Default false = the normal tool, unchanged.
   *  Only the Focus View passes this. */
  focusMargin?: boolean;
  /** All of the production's scripts (libretto, vocal score, older uploads);
   *  the switcher appears in the toolbar when there is more than one. */
  scripts?: ScriptDocumentOption[];
  activeScriptId?: string;
}

type PendingAnnotation =
  | { type: "note"; rect: AnnotationRect; page: number }
  | { type: "cue"; rect: AnnotationRect; page: number; marker: "box" | "pipe" };

export function ScriptViewer({
  script,
  productionId,
  pdfUrl,
  initialAnnotations,
  initialBookmarks,
  initialPageOverrides,
  initialHasStalePages,
  slug,
  canManage,
  focusMargin = false,
  scripts,
  activeScriptId,
}: Props) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // Available height for the viewer = viewport minus whatever chrome (app
  // header, production tabs, banners) sits above it, so the script scrolls
  // inside the page instead of running off the bottom of the monitor.
  const [shellHeight, setShellHeight] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  // Refs hold the latest values so the debounced save always reads current state
  const latestAnnotationsRef = useRef<Annotation[]>(initialAnnotations);
  const latestBookmarksRef = useRef<Bookmark[]>(initialBookmarks);

  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  // "script" = the PDF + annotation canvas; "cuesheet" = the editable cue table.
  const [viewMode, setViewMode] = useState<"script" | "cuesheet">("script");

  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [pageOverrides] = useState<PageOverrides>(initialPageOverrides);
  const [hasStalePages, setHasStalePages] = useState(initialHasStalePages);

  // Default label text sizes applied to newly-placed cues (per-user, persisted
  // locally). Existing cues keep their own scale; changing a default only
  // affects cues created afterwards.
  const [cueNumScaleDefault, setCueNumScaleDefault] = useState(1);
  const [cueDescScaleDefault, setCueDescScaleDefault] = useState(1);
  useEffect(() => {
    const n = Number(localStorage.getItem("cb:cueNumScale"));
    if (n > 0) setCueNumScaleDefault(n);
    const d = Number(localStorage.getItem("cb:cueDescScale"));
    if (d > 0) setCueDescScaleDefault(d);
  }, []);
  function setNumDefault(v: number) {
    setCueNumScaleDefault(v);
    localStorage.setItem("cb:cueNumScale", String(v));
  }
  function setDescDefault(v: number) {
    setCueDescScaleDefault(v);
    localStorage.setItem("cb:cueDescScale", String(v));
  }

  const [showThumbnails, setShowThumbnails] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(1); // index into ZOOM_STEPS; 1 = 100%
  // Default to fitting the whole page in the available height, so a script
  // page presents complete (no scroll) until the user zooms in.
  const [zoomMode, setZoomMode] = useState<"step" | "fit">("fit");
  const [readMode, setReadMode] = useState(false);

  // Page-jump input (the "n / total" becomes editable on focus).
  const [pageInput, setPageInput] = useState("");
  const [pageInputFocused, setPageInputFocused] = useState(false);

  // Phones present the script view-only (see the tool note below); also gates
  // the render scale, so declared here before "fit page" math uses it.
  const isPhone = useIsPhone();

  // Intrinsic page size (points) + workspace size drive "fit whole page".
  const [pageWidthPts, setPageWidthPts] = useState(0);
  const [pageHeightPts, setPageHeightPts] = useState(0);
  const [workspaceW, setWorkspaceW] = useState(0);
  const [workspaceH, setWorkspaceH] = useState(0);

  // "Fit" = contain the whole page in the workspace box (limited by width OR
  // height, whichever is tighter), accounting for the workspace padding.
  const fitScale =
    pageWidthPts > 0 && workspaceW > 0
      ? Math.min(
          4,
          Math.max(
            0.4,
            Math.min(
              (workspaceW - 64) / pageWidthPts,
              workspaceH > 0 && pageHeightPts > 0
                ? (workspaceH - 56) / pageHeightPts
                : Infinity,
            ),
          ),
        )
      : null;
  // On phones the canvas is CSS-stretched to the column width regardless of
  // scale, so render at a fixed high scale for sharpness; "fit page" is a
  // desktop concern (it shapes the actual displayed size there).
  const renderScale = isPhone
    ? BASE_RENDER_SCALE
    : zoomMode === "fit" && fitScale
      ? fitScale
      : BASE_RENDER_SCALE * ZOOM_STEPS[zoomIndex];

  // The cue overlay (label font, leader/pipe strokes, stacking gaps) is sized
  // in screen pixels, so without this it looks huge when the page renders small
  // (Fit on a small monitor) and tiny when zoomed in. Scaling every overlay
  // dimension by renderScale/BASE keeps it a fixed size relative to the script
  // text at any zoom or monitor. =1 at the default 100%.
  const cueScale = renderScale / BASE_RENDER_SCALE;

  // Zoom in/out, transitioning cleanly to/from the whole-page "fit" baseline.
  function zoomIn() {
    if (zoomMode === "fit") {
      const fit = fitScale ?? 0;
      let idx = ZOOM_STEPS.findIndex((z) => z * BASE_RENDER_SCALE > fit + 1e-3);
      if (idx === -1) idx = ZOOM_STEPS.length - 1;
      setZoomIndex(idx);
      setZoomMode("step");
    } else {
      setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
    }
  }
  function zoomOut() {
    if (zoomMode === "fit") return; // already showing the whole page
    const nextIdx = zoomIndex - 1;
    // Zooming out past the whole-page scale snaps back to fit.
    if (
      nextIdx < 0 ||
      (fitScale !== null && BASE_RENDER_SCALE * ZOOM_STEPS[nextIdx] <= fitScale)
    ) {
      setZoomMode("fit");
    } else {
      setZoomIndex(nextIdx);
    }
  }

  // The annotation tools are mouse-built (drag to draw) — on phones the
  // script is presented view-only: the tool is locked to "pointer" so the
  // canvas only pans, and the drawing tools / edit controls are hidden.
  const [activeToolState, setActiveTool] = useState<Tool>("pointer");
  const activeTool: Tool = isPhone ? "pointer" : activeToolState;
  const [activeColor, setActiveColor] = useState(DEFAULT_ANNOTATION_COLOR);
  // The cue colour applied to new cues — sticks until changed, remembered across
  // sessions. (Lazy init from localStorage; guarded for SSR.)
  const [cueColor, setCueColorState] = useState<string>(CUE_STROKE);
  useEffect(() => {
    const saved = window.localStorage.getItem("sv-cue-color");
    if (saved) setCueColorState(saved);
  }, []);
  function setCueColor(value: string) {
    setCueColorState(value);
    try {
      window.localStorage.setItem("sv-cue-color", value);
    } catch {
      /* ignore (private mode / quota) */
    }
  }
  const [preferredLeaderSide, setPreferredLeaderSide] = useState<"left" | "right">("right");
  // Cue anchor style: drag a "box" around words/lines, or drop a "pipe" (a
  // single vertical line) between words / at a line end.
  const [cueMarker, setCueMarker] = useState<"box" | "pipe">("box");

  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [pendingCueNumber, setPendingCueNumber] = useState("");
  const [pendingCueDesc, setPendingCueDesc] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Cue-label dragging: `labelDrag` is the active drag (window listeners live
  // while it's set); `draggingLabel` is the live position the label renders at.
  const [labelDrag, setLabelDrag] = useState<{ id: string } | null>(null);
  const [draggingLabel, setDraggingLabel] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const labelDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const labelMovedRef = useRef(false);
  const draggingPosRef = useRef<{ x: number; y: number } | null>(null);

  const [showAddBookmark, setShowAddBookmark] = useState(false);
  const [newBookmarkTitle, setNewBookmarkTitle] = useState("");
  // Phone-only quick-access bookmarks sheet (the inline right panel
  // also still stacks below the canvas via `.sv-side`).
  const [mobileBookmarksOpen, setMobileBookmarksOpen] = useState(false);

  const [panning, setPanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [, startTransition] = useTransition();

  // ── Scanned-script OCR ──────────────────────────────────────────────────────
  // A scanned/image-only PDF has no extractable text, so the select/copy/search
  // tools are dead. Detect that, then offer in-browser OCR (tesseract.js) to
  // fill the text layer. The result is shared across the production.
  const [isScanned, setIsScanned] = useState<boolean | null>(null);
  // A scan whose page renders (near-)blank in pdfjs — typically MRC/CCITT
  // ImageMask scripts that pdfjs can't rasterize (the text is thousands of
  // 1-bit stencils it drops). For these, in-browser OCR is futile (it would
  // read a blank canvas), so we fall back to the browser's native PDF engine
  // for viewing, exactly like the Documents tab.
  const [renderBlank, setRenderBlank] = useState(false);
  const [nativeView, setNativeView] = useState(false);
  const ocr = useScriptOcr({
    pdfUrl,
    storagePath: script.storagePath,
    scriptVersion: script.scriptVersion ?? 1,
    documentId: script.id,
    isScanned,
    enabled: true,
  });
  // When OCR has produced a text layer, it owns `textLayerRef` (the pdfjs path
  // would otherwise wipe it on every page render). Read via a ref so the render
  // effect doesn't need OCR state in its deps.
  const ocrOwnsTextLayer = ocr.status === "ready";
  const ocrOwnsTextLayerRef = useRef(ocrOwnsTextLayer);
  useEffect(() => {
    ocrOwnsTextLayerRef.current = ocrOwnsTextLayer;
  }, [ocrOwnsTextLayer]);

  // Rebuild an unrenderable scan into a searchable PDF (PDFium + OCR) and
  // install it as the new default script. On success the page reloads to pick
  // up the rebuilt file, which pdfjs renders normally.
  const router = useRouter();
  const rebuild = useScriptRebuild({
    productionId,
    pdfUrl,
    title: script.title ?? "",
    fileName: script.fileName ?? "script.pdf",
  });
  useEffect(() => {
    if (rebuild.status === "done") router.refresh();
  }, [rebuild.status, router]);

  // ── PDF rendering ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    const cacheKey = `${pdfUrl}::${currentPage}::${renderScale}`;

    async function render() {
      const mainCanvas = pdfCanvasRef.current;
      if (!mainCanvas) return;

      const cached = pdfBitmapCache.get(cacheKey);
      if (cached) {
        mainCanvas.width = cached.width;
        mainCanvas.height = cached.height;
        mainCanvas.getContext("2d")?.drawImage(cached, 0, 0);
        if (!cancelled) {
          setCanvasSize({ w: cached.width, h: cached.height });
          setPdfLoaded(true);
        }
        return;
      }

      const pdf = await loadPdfDocument(pdfUrl);
      if (cancelled) return;
      setTotalPages(pdf.numPages);

      const page = await pdf.getPage(currentPage);
      if (cancelled) return;

      const SCALE = renderScale;
      const viewport = page.getViewport({ scale: SCALE });

      const offscreen = document.createElement("canvas");
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      await page.render({ canvas: offscreen, viewport }).promise;
      if (cancelled) return;

      mainCanvas.width = offscreen.width;
      mainCanvas.height = offscreen.height;
      mainCanvas.getContext("2d")?.drawImage(offscreen, 0, 0);

      if (!cancelled) {
        setCanvasSize({ w: offscreen.width, h: offscreen.height });
        setPdfLoaded(true);
      }

      try {
        const bitmap = await createImageBitmap(offscreen);
        if (!cancelled) pdfBitmapCache.set(cacheKey, bitmap);
      } catch {
        /* non-fatal */
      }

      // Render text layer for text-select highlighting. When OCR has produced
      // a text layer for a scanned script, it owns this element instead (see
      // the OCR text-layer effect) — skip so we don't wipe its spans.
      if (!cancelled && textLayerRef.current && !ocrOwnsTextLayerRef.current) {
        const textLayerEl = textLayerRef.current;
        textLayerEl.innerHTML = "";
        try {
          const textContent = await page.getTextContent();
          const vt = viewport.transform; // [sx, shy, shx, sy, tx, ty]
          for (const item of textContent.items) {
            if (!("str" in item) || !item.str) continue;
            const span = document.createElement("span");
            span.textContent = item.str;
            const tx = item.transform;
            const screenX = vt[0] * tx[4] + vt[2] * tx[5] + vt[4];
            const screenY = vt[1] * tx[4] + vt[3] * tx[5] + vt[5];
            const fontSize = Math.sqrt(
              (vt[0] * tx[0] + vt[2] * tx[1]) ** 2 +
                (vt[1] * tx[0] + vt[3] * tx[1]) ** 2,
            );
            const angle = Math.atan2(
              vt[1] * tx[0] + vt[3] * tx[1],
              vt[0] * tx[0] + vt[2] * tx[1],
            );
            Object.assign(span.style, {
              position: "absolute",
              left: `${screenX}px`,
              top: `${screenY - fontSize}px`,
              fontSize: `${fontSize}px`,
              color: "transparent",
              whiteSpace: "pre",
              transformOrigin: "0 0",
              transform: angle !== 0 ? `rotate(${angle}rad)` : "",
              cursor: "text",
              userSelect: "text",
            });
            textLayerEl.appendChild(span);
          }
        } catch {
          /* text layer is best-effort */
        }
      }
    }

    setPdfLoaded(false);
    render().catch(() => setPdfLoaded(false));
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, currentPage, renderScale]);

  // ── Detect a scanned/image-only script + whether pdfjs can render it ─────────
  // Sample the first few pages' extractable text; near-empty means it's a scan
  // (same heuristic the AI parser uses). For a scan, also rasterize a
  // representative content page and measure ink coverage — if pdfjs draws it
  // (near-)blank, it's a file pdfjs can't render (MRC/CCITT ImageMasks), so we
  // route to the native PDF engine instead of offering futile in-browser OCR.
  useEffect(() => {
    let active = true;
    setIsScanned(null);
    setRenderBlank(false);
    (async () => {
      try {
        const pdf = await loadPdfDocument(pdfUrl);
        const sample = Math.min(pdf.numPages, 5);
        let chars = 0;
        for (let n = 1; n <= sample && chars <= 200; n += 1) {
          const page = await pdf.getPage(n);
          const tc = await page.getTextContent();
          for (const item of tc.items) {
            if ("str" in item) chars += item.str.length;
          }
        }
        const scanned = chars < 100;
        if (active) setIsScanned(scanned);
        if (!scanned) return;

        // Rasterize a content page (skip p.1, which often carries only a
        // title/logo and would render non-blank even when the body can't).
        const probePage = pdf.numPages > 1 ? 2 : 1;
        const page = await pdf.getPage(probePage);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const blank = isRenderBlank(canvas);
        canvas.width = 0;
        canvas.height = 0;
        if (active) setRenderBlank(blank);
      } catch {
        if (active) setIsScanned(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [pdfUrl]);

  // A scan pdfjs can't rasterize is useless in the canvas editor — drop the
  // user straight into the native PDF view so they can at least read it.
  useEffect(() => {
    if (renderBlank) setNativeView(true);
  }, [renderBlank]);

  // ── OCR text layer ──────────────────────────────────────────────────────────
  // For a scanned script with a ready OCR result, paint the per-word boxes as
  // the transparent selectable text layer (same role as the pdfjs text layer),
  // turning the select / copy / find / line-highlight tools back on.
  useEffect(() => {
    const el = textLayerRef.current;
    if (!el || ocr.status !== "ready") return;
    el.innerHTML = "";
    const words = ocr.pages.get(currentPage);
    const { w, h } = canvasSize;
    if (!words || !words.length || !w || !h) return;
    const frag = document.createDocumentFragment();
    for (const word of words) {
      const span = document.createElement("span");
      span.textContent = `${word.t} `;
      const boxH = (word.y1 - word.y0) * h;
      Object.assign(span.style, {
        position: "absolute",
        left: `${word.x0 * w}px`,
        top: `${word.y0 * h}px`,
        height: `${boxH}px`,
        fontSize: `${boxH * 0.85}px`,
        lineHeight: `${boxH}px`,
        color: "transparent",
        whiteSpace: "pre",
        cursor: "text",
        userSelect: "text",
      });
      frag.appendChild(span);
    }
    el.appendChild(frag);
  }, [ocr.status, ocr.pages, currentPage, canvasSize]);

  // ── Intrinsic page size (for "fit whole page") ──────────────────────────────
  useEffect(() => {
    let active = true;
    loadPdfDocument(pdfUrl)
      .then(async (pdf) => {
        const page = await pdf.getPage(1);
        if (active) {
          const vp = page.getViewport({ scale: 1 });
          setPageWidthPts(vp.width);
          setPageHeightPts(vp.height);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pdfUrl]);

  // ── Track workspace width (drives fit-width scale) ──────────────────────────
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const measure = () => {
      // Ignore zero sizes (e.g. while the cue-sheet view hides the workspace)
      // so the fit scale keeps its last good value and the page stays put.
      if (el.clientWidth > 0) setWorkspaceW(el.clientWidth);
      if (el.clientHeight > 0) setWorkspaceH(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Bound the viewer to the visible viewport ────────────────────────────────
  useEffect(() => {
    if (isPhone) {
      setShellHeight(null);
      return;
    }
    const measure = () => {
      const el = shellRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // Leave a small gutter at the bottom so the card edge isn't flush.
      setShellHeight(Math.max(360, window.innerHeight - top - 12));
    };
    measure();
    window.addEventListener("resize", measure);
    // Re-measure after layout settles (banners mounting can shift `top`).
    const t = setTimeout(measure, 250);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [isPhone]);

  // ── Prefetch adjacent pages so next/prev is instant ─────────────────────────
  useEffect(() => {
    if (!pdfUrl || !totalPages) return;
    let cancelled = false;
    const targets = [currentPage - 1, currentPage + 1].filter(
      (p) => p >= 1 && p <= totalPages,
    );
    (async () => {
      for (const p of targets) {
        const key = `${pdfUrl}::${p}::${renderScale}`;
        if (pdfBitmapCache.has(key)) continue;
        try {
          const pdf = await loadPdfDocument(pdfUrl);
          if (cancelled) return;
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: renderScale });
          const off = document.createElement("canvas");
          off.width = viewport.width;
          off.height = viewport.height;
          await page.render({ canvas: off, viewport }).promise;
          if (cancelled) return;
          const bmp = await createImageBitmap(off);
          if (!cancelled) pdfBitmapCache.set(key, bmp);
        } catch {
          /* best-effort warm-up */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, currentPage, renderScale, totalPages]);

  // ── Keyboard navigation (desktop) ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (readMode) return; // the reader handles its own keys
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentPage((p) => Math.min(totalPages || 1, p + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentPage((p) => Math.max(1, p - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentPage(1);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentPage(totalPages || 1);
      } else if (e.key === "+" || e.key === "=") {
        setZoomMode("step");
        setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
      } else if (e.key === "-") {
        setZoomMode("step");
        setZoomIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalPages, readMode]);

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) {
      setCurrentPage(Math.min(totalPages || 1, Math.max(1, n)));
    }
    setPageInputFocused(false);
  };

  // ── Auto-save ──────────────────────────────────────────────────────────────

  const triggerSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setIsSaving(true);
      const formData = new FormData();
      formData.set("script_id", script.id);
      formData.set("production_id", productionId);
      formData.set("annotations", JSON.stringify(latestAnnotationsRef.current));
      formData.set("bookmarks", JSON.stringify(latestBookmarksRef.current));
      formData.set("page_overrides", JSON.stringify(pageOverrides));
      startTransition(async () => {
        await saveAnnotations(formData);
        setIsSaving(false);
      });
    }, 1500);
  }, [script.id, productionId, pageOverrides]);

  // ── Pan (drag to scroll) ───────────────────────────────────────────────────

  // Global move/up listeners so panning survives the cursor leaving the workspace
  useEffect(() => {
    if (!panning) return;
    function onMove(e: MouseEvent) {
      const start = panStartRef.current;
      const ws = workspaceRef.current;
      if (!start || !ws) return;
      ws.scrollLeft = start.scrollLeft - (e.clientX - start.x);
      ws.scrollTop = start.scrollTop - (e.clientY - start.y);
    }
    function onUp() {
      panStartRef.current = null;
      setPanning(false);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [panning]);

  function handleWorkspaceMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const isMiddle = e.button === 1;
    const isPrimary = e.button === 0 && activeTool === "pointer";
    if (!isMiddle && !isPrimary) return;
    const ws = workspaceRef.current;
    if (!ws) return;
    panStartRef.current = { x: e.clientX, y: e.clientY, scrollLeft: ws.scrollLeft, scrollTop: ws.scrollTop };
    setPanning(true);
    e.preventDefault();
  }

  // ── Coordinate helpers ─────────────────────────────────────────────────────

  function normFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return {
      x: svgPt.x / canvasSize.w,
      y: svgPt.y / canvasSize.h,
    };
  }

  function getSVGCoords(e: React.MouseEvent): { x: number; y: number } {
    return normFromClient(e.clientX, e.clientY);
  }

  // ── Cue-label dragging ──────────────────────────────────────────────────────
  // Grab a cue's number and place it manually; the orthogonal leader follows.
  // A drag below the move threshold is treated as a plain select (so a click
  // still opens the cue for editing).
  function startLabelDrag(id: string, e: React.MouseEvent) {
    if (!canManage || isPhone) return;
    labelDragStartRef.current = { x: e.clientX, y: e.clientY };
    labelMovedRef.current = false;
    draggingPosRef.current = null;
    setLabelDrag({ id });
  }

  useEffect(() => {
    if (!labelDrag) return;
    const dragId = labelDrag.id;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    // In margin mode the card lives in the gutter past the page's right edge, so
    // x is allowed beyond 1 (up to the gutter's outer edge) instead of snapping
    // to the page edge.
    const maxX = focusMargin
      ? (canvasSize.w + focusGutter) / Math.max(1, canvasSize.w)
      : 1;
    const clampX = (n: number) => Math.max(0, Math.min(maxX, n));
    function onMove(e: MouseEvent) {
      const start = labelDragStartRef.current;
      if (start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 3) {
        labelMovedRef.current = true;
      }
      const n = normFromClient(e.clientX, e.clientY);
      const pos = { x: clampX(n.x), y: clamp01(n.y) };
      draggingPosRef.current = pos;
      setDraggingLabel({ id: dragId, ...pos });
    }
    function onUp() {
      const pos = draggingPosRef.current;
      if (labelMovedRef.current && pos) {
        // Margin drags persist to a separate field so they don't disturb the
        // normal editor's in-page auto-placement.
        updateAnnotation(
          dragId,
          (focusMargin ? { marginLabelPos: pos } : { labelPos: pos }) as Partial<Annotation>,
        );
      } else {
        setSelectedId((cur) => (cur === dragId ? null : dragId));
      }
      setLabelDrag(null);
      setDraggingLabel(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelDrag]);

  // ── Annotation CRUD ────────────────────────────────────────────────────────

  function addAnnotation(ann: Annotation) {
    const next = [...latestAnnotationsRef.current, ann];
    latestAnnotationsRef.current = next;
    setAnnotations(next);
    triggerSave();
  }

  function deleteAnnotation(id: string) {
    const next = latestAnnotationsRef.current.filter((a) => a.id !== id);
    latestAnnotationsRef.current = next;
    setAnnotations(next);
    setSelectedId(null);
    triggerSave();
  }

  function updateAnnotation(id: string, changes: Partial<Annotation>) {
    const next = latestAnnotationsRef.current.map((a) =>
      a.id === id ? ({ ...a, ...changes } as Annotation) : a,
    );
    latestAnnotationsRef.current = next;
    setAnnotations(next);
    triggerSave();
  }

  // Clear every cue's manual label placement (both in-page and margin), so they
  // return to auto-stacking. Used to undo stale/edge-pinned placements.
  function resetAllCuePositions() {
    const next = latestAnnotationsRef.current.map((a) =>
      a.type === "cue"
        ? ({ ...a, labelPos: undefined, marginLabelPos: undefined } as Annotation)
        : a,
    );
    latestAnnotationsRef.current = next;
    setAnnotations(next);
    triggerSave();
  }

  function addBookmark() {
    const title = newBookmarkTitle.trim();
    if (!title) return;
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      page: currentPage,
      title,
      createdAt: new Date().toISOString(),
    };
    const next = [...latestBookmarksRef.current, bookmark];
    latestBookmarksRef.current = next;
    setBookmarks(next);
    setNewBookmarkTitle("");
    setShowAddBookmark(false);
    triggerSave();
  }

  function deleteBookmark(id: string) {
    const next = latestBookmarksRef.current.filter((b) => b.id !== id);
    latestBookmarksRef.current = next;
    setBookmarks(next);
    triggerSave();
  }

  // ── Drawing handlers ───────────────────────────────────────────────────────

  function handleSVGMouseDown(e: React.MouseEvent) {
    if (activeTool === "pointer" || activeTool === "highlight-text") return;
    e.preventDefault();
    setSelectedId(null);
    const coords = getSVGCoords(e);
    setDrawStart(coords);
    setDrawCurrent(coords);
  }

  function handleSVGMouseMove(e: React.MouseEvent) {
    if (!drawStart) return;
    setDrawCurrent(getSVGCoords(e));
  }

  function handleSVGMouseUp(e: React.MouseEvent) {
    if (!drawStart || !drawCurrent) return;
    const start = drawStart;
    const end = drawCurrent;

    const rect: AnnotationRect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };

    setDrawStart(null);
    setDrawCurrent(null);

    // Pipe cue: a single click drops a vertical line at that point, snapped to
    // the height of the text line under it (no drag needed).
    if (activeTool === "cue" && cueMarker === "pipe") {
      const band = pipeBandAt(end);
      setPendingAnnotation({
        type: "cue",
        page: currentPage,
        marker: "pipe",
        rect: { x: end.x, y: band.yTop, width: 0, height: band.height },
      });
      setPendingCueNumber("");
      setPendingCueDesc("");
      return;
    }

    // Ignore tiny accidental drags
    if (rect.width < 0.005 || rect.height < 0.003) return;

    if (activeTool === "highlight-box") {
      addAnnotation({
        id: crypto.randomUUID(),
        page: currentPage,
        type: "highlight",
        rect,
        color: activeColor,
      });
    } else if (activeTool === "note") {
      // Notes are sticky-note text boxes, so guarantee enough room to read the
      // note even from a quick drag; never shrink a box the user drew larger.
      const width = Math.max(rect.width, 0.2);
      const height = Math.max(rect.height, 0.06);
      const noteRect: AnnotationRect = {
        x: Math.min(rect.x, 1 - width),
        y: Math.min(rect.y, 1 - height),
        width,
        height,
      };
      setPendingAnnotation({ type: "note", rect: noteRect, page: currentPage });
      setPendingText("");
    } else if (activeTool === "cue") {
      setPendingAnnotation({ type: "cue", rect, page: currentPage, marker: "box" });
      setPendingCueNumber("");
      setPendingCueDesc("");
    }
  }

  function handleTextLayerMouseUp() {
    if (activeTool !== "highlight-text") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !pdfCanvasRef.current) return;

    const range = selection.getRangeAt(0);
    const canvasRect = pdfCanvasRef.current.getBoundingClientRect();
    const w = canvasRect.width;
    const h = canvasRect.height;
    if (w === 0 || h === 0) return;

    // getClientRects() returns one box per on-screen line fragment. Merge
    // fragments that share a line (similar top) so each line is one box, and
    // keep them separate across lines — a multi-line selection then hugs each
    // line's actual text rather than collapsing into one full-width block.
    const tol = 4;
    const lines: { top: number; bottom: number; left: number; right: number }[] = [];
    for (const r of range.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      const top = r.top - canvasRect.top;
      const bottom = r.bottom - canvasRect.top;
      const left = r.left - canvasRect.left;
      const right = r.right - canvasRect.left;
      const row = lines.find((l) => Math.abs(l.top - top) <= tol);
      if (row) {
        row.left = Math.min(row.left, left);
        row.right = Math.max(row.right, right);
        row.top = Math.min(row.top, top);
        row.bottom = Math.max(row.bottom, bottom);
      } else {
        lines.push({ top, bottom, left, right });
      }
    }
    if (lines.length === 0) return;

    const rects: AnnotationRect[] = lines.map((l) => ({
      x: l.left / w,
      y: l.top / h,
      width: (l.right - l.left) / w,
      height: (l.bottom - l.top) / h,
    }));
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));

    addAnnotation({
      id: crypto.randomUUID(),
      page: currentPage,
      type: "highlight",
      rect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      rects,
      color: activeColor,
    });

    selection.removeAllRanges();
  }

  // ── Pending annotation confirmation ────────────────────────────────────────

  // Pull the script text sitting under a box from the rendered text layer, so a
  // cue can record the "line" it's called on. Reads the positioned spans the
  // PDF (or OCR) text layer lays over the canvas and keeps those overlapping
  // the box, in reading order.
  function captureLineText(rect: AnnotationRect): string {
    const layer = textLayerRef.current;
    if (!layer || canvasSize.w === 0 || canvasSize.h === 0) return "";
    const bx = rect.x * canvasSize.w;
    const by = rect.y * canvasSize.h;
    const bw = rect.width * canvasSize.w;
    const bh = rect.height * canvasSize.h;
    // Capture at WORD granularity: a text-layer span often holds a whole line,
    // so split it into words and keep only those whose x-extent overlaps the
    // box. This records the highlighted phrase rather than the whole line.
    const items: { top: number; x: number; text: string }[] = [];
    for (const el of Array.from(layer.children) as HTMLElement[]) {
      const t = el.offsetTop;
      const l = el.offsetLeft;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const text = el.textContent ?? "";
      if (!(t + h > by && t < by + bh) || !text.trim()) continue;
      const n = text.length || 1;
      let idx = 0;
      for (const part of text.split(/(\s+)/)) {
        if (part.trim()) {
          const wx = l + (idx / n) * w; // approx word start x
          const wEnd = l + ((idx + part.length) / n) * w; // approx word end x
          if (wEnd > bx && wx < bx + bw) items.push({ top: t, x: wx, text: part });
        }
        idx += part.length;
      }
    }
    items.sort((a, b) =>
      Math.abs(a.top - b.top) > 6 ? a.top - b.top : a.x - b.x,
    );
    return items
      .map((i) => i.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Find the text line under a click (fractional point) and return its band as
  // fractional y/height, so a pipe matches the height of the line it sits on.
  function pipeBandAt(p: { x: number; y: number }): { yTop: number; height: number } {
    const fallbackH = 0.022;
    const fallback = {
      yTop: Math.max(0, Math.min(p.y - fallbackH / 2, 1 - fallbackH)),
      height: fallbackH,
    };
    const layer = textLayerRef.current;
    if (!layer || canvasSize.h === 0) return fallback;
    const py = p.y * canvasSize.h;
    let best: { top: number; h: number } | null = null;
    let bestScore = Infinity;
    for (const el of Array.from(layer.children) as HTMLElement[]) {
      const top = el.offsetTop;
      const h = el.offsetHeight;
      if (h <= 0) continue;
      const contains = py >= top && py <= top + h;
      const score = contains ? 0 : Math.abs(top + h / 2 - py);
      if (score < bestScore) {
        bestScore = score;
        best = { top, h };
      }
    }
    if (!best) return fallback;
    return { yTop: best.top / canvasSize.h, height: best.h / canvasSize.h };
  }

  // Words on the text line at a vertical band, each with an approximate x. A
  // single text-layer span often holds a whole line, so we split it into words
  // and spread their x across the span's width by character offset — letting a
  // pipe be located between words even within one span.
  function lineWordsAt(
    bandCenter: number,
    tol: number,
  ): { x: number; word: string }[] {
    const layer = textLayerRef.current;
    if (!layer) return [];
    const out: { x: number; word: string }[] = [];
    for (const el of Array.from(layer.children) as HTMLElement[]) {
      const center = el.offsetTop + el.offsetHeight / 2;
      const text = el.textContent ?? "";
      if (Math.abs(center - bandCenter) > tol || !text.trim()) continue;
      const left = el.offsetLeft;
      const width = el.offsetWidth;
      const n = text.length || 1;
      let idx = 0;
      for (const part of text.split(/(\s+)/)) {
        if (part.trim()) out.push({ x: left + (idx / n) * width, word: part });
        idx += part.length;
      }
    }
    return out.sort((a, b) => a.x - b.x);
  }

  // Build a short snippet of script around a pipe, with "*" marking it. Uses a
  // window of words on each side (with "…" when there's more), so each pipe on
  // a line captures its own surrounding words rather than the whole line.
  function capturePipeLine(rect: AnnotationRect): string {
    if (canvasSize.w === 0 || canvasSize.h === 0) return "*";
    const pipeX = rect.x * canvasSize.w;
    const bandCenter = (rect.y + rect.height / 2) * canvasSize.h;
    const tol = rect.height * canvasSize.h * 0.6 + 2;
    const words = lineWordsAt(bandCenter, tol);
    if (words.length === 0) return "*";

    const WINDOW = 3; // words kept on each side of the pipe (a short snippet)
    let i = words.findIndex((w) => w.x >= pipeX);
    if (i === -1) i = words.length; // pipe sits after the last word
    const start = Math.max(0, i - WINDOW);
    const end = Math.min(words.length, i + WINDOW);

    const parts: string[] = [];
    if (start > 0) parts.push("…");
    parts.push(...words.slice(start, i).map((w) => w.word));
    parts.push("*");
    parts.push(...words.slice(i, end).map((w) => w.word));
    if (end < words.length) parts.push("…");
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function confirmPending() {
    if (!pendingAnnotation) return;

    if (pendingAnnotation.type === "note") {
      if (!pendingText.trim()) {
        setPendingAnnotation(null);
        return;
      }
      addAnnotation({
        id: crypto.randomUUID(),
        page: pendingAnnotation.page,
        type: "note",
        rect: pendingAnnotation.rect,
        text: pendingText.trim(),
        color: activeColor,
      });
    } else if (pendingAnnotation.type === "cue") {
      if (!pendingCueNumber.trim()) {
        setPendingAnnotation(null);
        return;
      }
      const rect = pendingAnnotation.rect;
      const isPipe = pendingAnnotation.marker === "pipe";
      addAnnotation({
        id: crypto.randomUUID(),
        page: pendingAnnotation.page,
        type: "cue",
        rect,
        cueNumber: pendingCueNumber.trim(),
        cueDescription: pendingCueDesc.trim(),
        leaderSide: preferredLeaderSide,
        color: cueColor,
        marker: isPipe ? "pipe" : "box",
        line: isPipe ? capturePipeLine(rect) : captureLineText(rect),
        cueNumScale: cueNumScaleDefault,
        cueDescScale: cueDescScaleDefault,
      });
    }

    setPendingAnnotation(null);
  }

  async function downloadAnnotatedPdf() {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");

      const pdfDoc = await loadPdfDocument(pdfUrl);
      const numPages = pdfDoc.numPages;
      let doc: InstanceType<typeof jsPDF> | null = null;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        setDownloadProgress({ current: pageNum, total: numPages });

        const page = await pdfDoc.getPage(pageNum);
        const PRINT_SCALE = 2;
        const viewport = page.getViewport({ scale: PRINT_SCALE });
        const nativeViewport = page.getViewport({ scale: 1 });
        // Match the on-screen overlay sizing (fixed size in PDF-point space).
        const exportCueScale = PRINT_SCALE / BASE_RENDER_SCALE;

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;

        await page.render({ canvas, viewport }).promise;

        // Draw annotations for this page. Cue labels stack the same way they do
        // on screen, computed in this canvas's pixel space.
        const pageAnns = latestAnnotationsRef.current.filter((a) => a.page === pageNum);
        const exportCueLabels = stackCueLabels(
          pageAnns.filter(
            (a): a is Extract<Annotation, { type: "cue" }> => a.type === "cue",
          ),
          viewport.height,
          exportCueScale,
        );
        for (const ann of pageAnns) {
          drawAnnotationOnCanvas(
            ctx,
            ann,
            viewport.width,
            viewport.height,
            ann.type === "cue" ? exportCueLabels.get(ann.id) : undefined,
            exportCueScale,
          );
        }

        const imgData = canvas.toDataURL("image/jpeg", 0.93);
        // Convert PDF points to mm (1 pt = 25.4/72 mm)
        const widthMm = nativeViewport.width * (25.4 / 72);
        const heightMm = nativeViewport.height * (25.4 / 72);
        const orientation = widthMm > heightMm ? "landscape" : "portrait";

        if (!doc) {
          doc = new jsPDF({ orientation, unit: "mm", format: [widthMm, heightMm] });
        } else {
          doc.addPage([widthMm, heightMm], orientation);
        }
        doc.addImage(imgData, "JPEG", 0, 0, widthMm, heightMm);
      }

      doc?.save(`${script.title} - annotated.pdf`);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  }

  function exportCueSheetCsv() {
    const cues = latestAnnotationsRef.current.filter(
      (a): a is CueAnn => a.type === "cue",
    );
    const sections = buildCueSheetSections(cues, bookmarks);
    const csv = cueSheetToCsv(sections, script.title || "Script");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${script.title || "script"} - cue sheet.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDismissStale() {
    const formData = new FormData();
    formData.set("script_id", script.id);
    startTransition(async () => {
      await dismissStaleBanner(formData);
      setHasStalePages(false);
    });
  }

  // ── Page annotations (current page only) ──────────────────────────────────

  const pageAnnotations = annotations.filter((a) => a.page === currentPage);

  // Stacked label positions (y + lane) for this page's cues, so overlapping
  // labels offset/stagger instead of piling up (recomputed on cue/size change).
  const cueLabels = useMemo(
    () =>
      stackCueLabels(
        pageAnnotations
          .filter(
            (a): a is Extract<Annotation, { type: "cue" }> => a.type === "cue",
          )
          // In margin mode every cue stacks in the single right-hand gutter, and
          // a gutter-dragged card (marginLabelPos) opts out of auto-stacking —
          // surfaced here as `labelPos` so stackCueLabels excludes it.
          .map((c) =>
            focusMargin
              ? { ...c, leaderSide: "right" as const, labelPos: c.marginLabelPos }
              : c,
          ),
        canvasSize.h,
        cueScale,
        focusMargin, // single-column gutter stacking in margin mode
      ),
    [pageAnnotations, canvasSize.h, cueScale, focusMargin],
  );

  // Width (render px) of the focus-view cue gutter; 0 when not in margin mode.
  const focusGutter = focusMargin
    ? Math.max(260, Math.round(canvasSize.w * 0.22))
    : 0;

  // ── SVG cursor style ───────────────────────────────────────────────────────

  const svgCursor =
    activeTool === "pointer"
      ? panning ? "grabbing" : "grab"
      : activeTool === "highlight-text"
        ? "text"
        : activeTool === "cue" && cueMarker === "pipe"
          ? PIPE_CURSOR
          : "crosshair";

  const svgPointerEvents =
    activeTool === "highlight-text" ? "none" : "all";

  const textLayerPointerEvents =
    activeTool === "highlight-text" ? "auto" : "none";

  // ── Pending popover position ───────────────────────────────────────────────

  function pendingPopoverStyle(): React.CSSProperties {
    if (!pendingAnnotation) return {};
    const { rect } = pendingAnnotation;
    const pct = (n: number) => `${n * 100}%`;
    const bottom = rect.y + rect.height;
    const isNearBottom = bottom > 0.75;
    return {
      position: "absolute",
      left: `${Math.min(rect.x * 100, 60)}%`,
      ...(isNearBottom
        ? { bottom: `${(1 - rect.y) * 100 + 2}%` }
        : { top: `${bottom * 100 + 1}%` }),
      zIndex: 200,
      background: "var(--bg-elev)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 12,
      minWidth: 220,
      maxWidth: 300,
      boxShadow: "0 8px 24px rgba(0,0,0,.18)",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
    {readMode && (
      <MobileScriptReader
        scriptId={script.id}
        productionId={productionId}
        pdfUrl={pdfUrl}
        title={script.title}
        initialAnnotations={annotations}
        initialBookmarks={bookmarks}
        initialPageOverrides={pageOverrides}
        startPage={currentPage}
        allowDrawing={false}
        onExit={() => setReadMode(false)}
        onBookmarksChange={(b) => {
          setBookmarks(b);
          latestBookmarksRef.current = b;
        }}
      />
    )}
    <div
      ref={shellRef}
      className="anim-in script-viewer-shell"
      style={{
        display: "flex",
        gap: 0,
        minHeight: 0,
        maxWidth: 1440,
        margin: "0 auto",
        ...(shellHeight ? { height: shellHeight } : {}),
      }}
    >
      {/* ── Tool sidebar ── */}
      <div
        className="sv-tools"
        style={{
          width: 52,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          paddingTop: 4,
          paddingRight: 8,
        }}
      >
        <ToolButton
          icon={<LayoutList size={16} />}
          label="Page thumbnails"
          active={showThumbnails}
          onClick={() => setShowThumbnails((s) => !s)}
        />
        <div style={{ width: 28, height: 1, background: "var(--border)", margin: "2px 0" }} />
        <ToolButton
          icon={<MousePointer2 size={16} />}
          label="Select"
          active={activeTool === "pointer"}
          onClick={() => setActiveTool("pointer")}
        />
        {!isPhone && (
          <>
        <ToolButton
          icon={<Highlighter size={16} />}
          label="Highlight (draw)"
          active={activeTool === "highlight-box"}
          onClick={() => setActiveTool("highlight-box")}
        />
        <ToolButton
          icon={<Type size={16} />}
          label="Highlight (text select)"
          active={activeTool === "highlight-text"}
          onClick={() => setActiveTool("highlight-text")}
        />
        <ToolButton
          icon={<StickyNote size={16} />}
          label="Note"
          active={activeTool === "note"}
          onClick={() => setActiveTool("note")}
        />
        <ToolButton
          icon={<Zap size={16} />}
          label="Cue"
          active={activeTool === "cue"}
          onClick={() => setActiveTool("cue")}
        />

        {activeTool === "cue" && (
          <div
            style={{
              marginTop: 4,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 9, color: "var(--ink-4)", letterSpacing: ".05em", textTransform: "uppercase" }}>
              Style
            </span>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <button
                title="Box — drag around words or lines"
                onClick={() => setCueMarker("box")}
                style={{
                  width: 26,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  background: cueMarker === "box" ? "var(--accent)" : "transparent",
                  color: cueMarker === "box" ? "white" : "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                <Square size={12} />
              </button>
              <button
                title="Pipe — drop a vertical line between words / at a line end"
                onClick={() => setCueMarker("pipe")}
                style={{
                  width: 26,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  background: cueMarker === "pipe" ? "var(--accent)" : "transparent",
                  color: cueMarker === "pipe" ? "white" : "var(--ink-3)",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 15,
                  lineHeight: 1,
                }}
              >
                |
              </button>
            </div>
            <span style={{ fontSize: 9, color: "var(--ink-4)", letterSpacing: ".05em", textTransform: "uppercase", marginTop: 6 }}>
              Margin
            </span>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <button
                title="Leader to left margin"
                onClick={() => setPreferredLeaderSide("left")}
                style={{
                  width: 26,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  background: preferredLeaderSide === "left" ? "var(--accent)" : "transparent",
                  color: preferredLeaderSide === "left" ? "white" : "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                <AlignLeft size={12} />
              </button>
              <button
                title="Leader to right margin"
                onClick={() => setPreferredLeaderSide("right")}
                style={{
                  width: 26,
                  height: 24,
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  background: preferredLeaderSide === "right" ? "var(--accent)" : "transparent",
                  color: preferredLeaderSide === "right" ? "white" : "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                <AlignRight size={12} />
              </button>
            </div>
            <span style={{ fontSize: 9, color: "var(--ink-4)", letterSpacing: ".05em", textTransform: "uppercase", marginTop: 6 }}>
              Color
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, justifyItems: "center" }}>
              {CUE_COLORS.map((c) => (
                <button
                  key={c.value}
                  title={c.label}
                  onClick={() => setCueColor(c.value)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border:
                      cueColor === c.value
                        ? "2px solid var(--ink)"
                        : "2px solid transparent",
                    background: c.value,
                    cursor: "pointer",
                    padding: 0,
                    outline: "none",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {(activeTool === "highlight-box" ||
          activeTool === "highlight-text" ||
          activeTool === "note") && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "center",
            }}
          >
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => setActiveColor(c.value)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border:
                    activeColor === c.value
                      ? "2px solid var(--ink)"
                      : "2px solid transparent",
                  background: c.value,
                  cursor: "pointer",
                  padding: 0,
                  outline: "none",
                }}
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>

      {/* ── Thumbnail sidebar ── */}
      {showThumbnails && (
        <ThumbnailPanel
          pdfUrl={pdfUrl}
          totalPages={totalPages}
          currentPage={currentPage}
          onNavigate={setCurrentPage}
        />
      )}

      {/* ── Main area ── */}
      <div className="sv-canvas" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Stale banner */}
        {hasStalePages && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              background: "color-mix(in oklch, var(--c-amber) 12%, transparent)",
              border: "1px solid color-mix(in oklch, var(--c-amber) 30%, transparent)",
              borderRadius: 6,
              fontSize: 13,
              color: "var(--ink-2)",
              gap: 8,
            }}
          >
            <span>
              The default script has been updated. Some annotations may no longer match the
              current page content.
            </span>
            <button
              className="btn ghost"
              onClick={handleDismissStale}
              style={{ fontSize: 12, height: 26, flexShrink: 0 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Scanned script pdfjs can't render → rebuild searchable, or native view */}
        {/* Scanned script → offer a searchable-PDF rebuild (PDFium + OCR).
            Gated on isScanned (no text layer) — the reliable, Adobe-style
            signal — not on a blank render, since these scans often draw a faint
            background that isn't "blank". renderBlank only drives the native
            fallback for display. */}
        {isScanned === true &&
          (rebuild.status === "running" || rebuild.status === "uploading" ? (
            <div className="sv-ocr-banner">
              <span className="sv-spinner" aria-hidden />
              <div className="sv-ocr-body">
                {rebuild.status === "uploading"
                  ? "Saving the searchable script…"
                  : `Making this script searchable… ${
                      rebuild.progress
                        ? `${
                            rebuild.progress.phase === "ocr" ? "reading" : "rendering"
                          } page ${rebuild.progress.page} of ${rebuild.progress.total}`
                        : "starting"
                    }`}
                . This can take a few minutes — please keep this tab open.
                {rebuild.progress && rebuild.progress.total > 0 && (
                  <div className="sv-ocr-progress">
                    <div
                      className="sv-ocr-progress-bar"
                      style={{
                        width: `${Math.round(
                          (rebuild.progress.page / rebuild.progress.total) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="sv-ocr-actions">
                <button
                  className="btn ghost"
                  onClick={rebuild.cancel}
                  style={{ height: 30 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`sv-ocr-banner${
                rebuild.status === "failed" ? " sv-ocr-banner-error" : ""
              }`}
            >
              <ScanText size={18} className="sv-ocr-icon" />
              <div className="sv-ocr-body">
                {rebuild.status === "failed" ? (
                  <>
                    <strong>Couldn&rsquo;t make this script searchable.</strong>{" "}
                    {rebuild.error} You can try again, or read it in the native
                    viewer below.
                  </>
                ) : renderBlank ? (
                  <>
                    <strong>This scanned script can&rsquo;t be shown in the editor.</strong>{" "}
                    It&rsquo;s displayed below in your browser&rsquo;s built-in PDF
                    viewer.{" "}
                    {canManage
                      ? "Make it searchable to enable annotation and text tools across the whole project."
                      : "Ask a manager to make it searchable to enable annotation and text tools."}
                  </>
                ) : (
                  <>
                    <strong>This script is a scan.</strong> Annotation and text
                    tools (select, copy, find, line highlighting) are off because
                    it has no text layer.{" "}
                    {canManage
                      ? "Make it searchable to turn them on across the whole project — it OCRs every page, so a full script takes a few minutes."
                      : "Ask a manager to make it searchable to turn them on."}
                  </>
                )}
              </div>
              <div className="sv-ocr-actions">
                {canManage && (
                  <button
                    className="btn primary"
                    onClick={rebuild.run}
                    style={{ height: 30 }}
                  >
                    <ScanText size={14} />{" "}
                    {rebuild.status === "failed" ? "Try again" : "Make searchable"}
                  </button>
                )}
                <button
                  className="btn ghost"
                  onClick={() => setNativeView((v) => !v)}
                  style={{ height: 30 }}
                >
                  {nativeView ? "Try editor" : "Open native viewer"}
                </button>
              </div>
            </div>
          ))}

        {/* Page navigation + save status */}
        <div
          className="sv-pagenav"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="btn ghost btn-icon"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              style={{ width: 30, height: 30 }}
              title="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 13, color: "var(--ink-3)" }}>
              <input
                aria-label="Go to page"
                inputMode="numeric"
                value={
                  pageInputFocused
                    ? pageInput
                    : totalPages > 0
                      ? String(currentPage)
                      : ""
                }
                disabled={totalPages === 0}
                onFocus={(e) => {
                  setPageInput(String(currentPage));
                  setPageInputFocused(true);
                  e.currentTarget.select();
                }}
                onChange={(e) =>
                  setPageInput(e.target.value.replace(/[^0-9]/g, ""))
                }
                onBlur={commitPageInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setPageInputFocused(false);
                    e.currentTarget.blur();
                  }
                }}
                style={{
                  width: 34,
                  textAlign: "center",
                  fontSize: 13,
                  padding: "3px 2px",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                  outline: "none",
                }}
                title="Type a page number to jump"
              />
              <span>/ {totalPages > 0 ? totalPages : "—"}</span>
            </div>
            <button
              className="btn ghost btn-icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              style={{ width: 30, height: 30 }}
              title="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {/* Zoom controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className="btn ghost btn-icon"
              onClick={() => setZoomMode((m) => (m === "fit" ? "step" : "fit"))}
              title="Fit whole page"
              aria-pressed={zoomMode === "fit"}
              style={{
                width: 28,
                height: 28,
                color: zoomMode === "fit" ? "var(--accent)" : undefined,
                background: zoomMode === "fit" ? "var(--accent-soft)" : undefined,
              }}
            >
              <Maximize2 size={13} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
              <button
                className="btn ghost btn-icon"
                onClick={zoomOut}
                disabled={zoomMode === "fit"}
                title="Zoom out"
                style={{ width: 28, height: 28, borderRadius: 0, borderRight: "1px solid var(--border)" }}
              >
                <ZoomOut size={13} />
              </button>
              <span style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 38, textAlign: "center", padding: "0 4px" }}>
                {zoomMode === "fit" ? "Fit" : ZOOM_LABELS[zoomIndex]}
              </span>
              <button
                className="btn ghost btn-icon"
                onClick={zoomIn}
                disabled={zoomMode === "step" && zoomIndex === ZOOM_STEPS.length - 1}
                title="Zoom in"
                style={{ width: 28, height: 28, borderRadius: 0, borderLeft: "1px solid var(--border)" }}
              >
                <ZoomIn size={13} />
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {scripts && scripts.length > 1 && (
              <ScriptSwitcher
                productionId={productionId}
                scripts={scripts}
                activeScriptId={activeScriptId ?? script.id}
                canManage={canManage}
              />
            )}
            {canManage && (
              <Link
                href={`/productions/${slug}/script/ai`}
                className="btn ghost"
                style={{ fontSize: 12, height: 28, gap: 5, textDecoration: "none" }}
                title="Set up or refine the AI cast / scene / bookmark breakdown"
              >
                <Sparkles size={13} />
                <span>AI setup</span>
              </Link>
            )}
            <button
              className="btn ghost"
              onClick={() => {
                setShowAddBookmark((s) => !s);
                setNewBookmarkTitle("");
              }}
              style={{ fontSize: 12, height: 28, gap: 5 }}
              title="Bookmark this page"
            >
              <BookmarkIcon size={13} />
              <span>Bookmark</span>
            </button>
            <button
              className="btn ghost"
              onClick={() => setReadMode(true)}
              style={{ fontSize: 12, height: 28, gap: 5 }}
              title="Distraction-free reading"
            >
              <BookOpen size={13} />
              <span>Read mode</span>
            </button>
            <button
              className="btn ghost"
              onClick={downloadAnnotatedPdf}
              disabled={isDownloading || !pdfLoaded}
              style={{ fontSize: 12, height: 28, gap: 5 }}
              title="Download annotated PDF"
            >
              <Download size={13} />
              <span>
                {downloadProgress
                  ? `Preparing ${downloadProgress.current} / ${downloadProgress.total}…`
                  : "Download PDF"}
              </span>
            </button>
            <button
              className={viewMode === "cuesheet" ? "btn" : "btn ghost"}
              onClick={() =>
                setViewMode((m) => (m === "cuesheet" ? "script" : "cuesheet"))
              }
              style={{ fontSize: 12, height: 28, gap: 5 }}
              title="Toggle the cue sheet"
            >
              <LayoutList size={13} />
              <span>{viewMode === "cuesheet" ? "Script" : "Cue sheet"}</span>
            </button>
            <span
              style={{
                fontSize: 11.5,
                color: "var(--ink-4)",
                transition: "opacity .3s",
                opacity: isSaving ? 1 : 0,
              }}
            >
              Saving…
            </span>
          </div>
        </div>

        {/* Add-bookmark inline form */}
        {showAddBookmark && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: "var(--bg-sunken)",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            <BookmarkIcon size={13} style={{ color: "var(--ink-4)", flexShrink: 0 }} />
            <input
              autoFocus
              value={newBookmarkTitle}
              onChange={(e) => setNewBookmarkTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addBookmark();
                if (e.key === "Escape") setShowAddBookmark(false);
              }}
              placeholder={`Label for page ${currentPage}…`}
              style={{
                flex: 1,
                fontSize: 13,
                border: "none",
                background: "transparent",
                outline: "none",
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            />
            <span style={{ fontSize: 12, color: "var(--ink-4)", flexShrink: 0 }}>
              p.{currentPage}
            </span>
            <button
              className="btn-icon"
              onClick={addBookmark}
              disabled={!newBookmarkTitle.trim()}
              title="Save bookmark"
              style={{
                width: 24, height: 24, border: "none", background: "none",
                cursor: "pointer", color: "var(--accent)", display: "grid",
                placeItems: "center", flexShrink: 0,
              }}
            >
              <Check size={13} />
            </button>
            <button
              className="btn-icon"
              onClick={() => setShowAddBookmark(false)}
              title="Cancel"
              style={{
                width: 24, height: 24, border: "none", background: "none",
                cursor: "pointer", color: "var(--ink-4)", display: "grid",
                placeItems: "center", flexShrink: 0,
              }}
            >
              <X size={13} />
            </button>
          </div>
        )}

        {viewMode === "cuesheet" && (
          <CueSheetView
            cues={annotations.filter((a): a is CueAnn => a.type === "cue")}
            bookmarks={bookmarks}
            scriptTitle={script.title || "Script"}
            readOnly={isPhone}
            onEdit={updateAnnotation}
            onDelete={deleteAnnotation}
            onExportCsv={exportCueSheetCsv}
            onGoToCue={(cue) => {
              setViewMode("script");
              setCurrentPage(cue.page);
              setSelectedId(cue.id);
            }}
          />
        )}
        {/* PDF + annotation layer — kept mounted across view toggles so the
            rendered canvas (and the measured fit scale) survive; just hidden
            while the cue sheet shows, rather than unmounted and re-rendered. */}
        <div
          ref={workspaceRef}
          className="sv-workspace"
          onMouseDown={handleWorkspaceMouseDown}
          style={{
            background: "var(--bg-sunken)",
            borderRadius: 8,
            padding: "28px 32px",
            overflow: "auto",
            position: "relative",
            // Fill the remaining height inside the bounded shell and scroll the
            // PDF internally, rather than growing the page past the viewport.
            flex: shellHeight ? 1 : undefined,
            minHeight: 0,
            display: viewMode === "cuesheet" ? "none" : undefined,
            cursor: activeTool === "pointer" ? (panning ? "grabbing" : "grab") : "default",
          }}
        >
        {!pdfLoaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              zIndex: 50,
              pointerEvents: "none",
              color: "var(--accent)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div className="pdf-spinner" aria-hidden />
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                Loading script…
              </span>
            </div>
          </div>
        )}
        {nativeView && (
          <iframe
            src={pdfUrl}
            title="Script (native PDF viewer)"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
              background: "#fff",
              zIndex: 60,
            }}
          />
        )}
        <div
          ref={containerRef}
          className="sv-page"
          style={{
            position: "relative",
            display: "block",
            width: "fit-content",
            margin: "0 auto",
            borderRadius: 3,
            overflow: focusMargin ? "visible" : "hidden",
            boxShadow: "0 4px 32px rgba(0,0,0,.28), 0 1px 4px rgba(0,0,0,.12)",
            opacity: pdfLoaded ? 1 : 0.4,
            transition: "opacity .2s",
            userSelect: activeTool === "highlight-text" ? "auto" : "none",
          }}
        >
          {/* PDF canvas */}
          <canvas
            ref={pdfCanvasRef}
            style={{ display: "block" }}
          />

          {/* Text layer — transparent text for selection */}
          <div
            ref={textLayerRef}
            onMouseUp={handleTextLayerMouseUp}
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              pointerEvents: textLayerPointerEvents,
              userSelect: activeTool === "highlight-text" ? "text" : "none",
            }}
          />

          {/* SVG annotation overlay */}
          {canvasSize.w > 0 && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${canvasSize.w + focusGutter} ${canvasSize.h}`}
              preserveAspectRatio="xMinYMin meet"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: focusMargin
                  ? `${((canvasSize.w + focusGutter) / canvasSize.w) * 100}%`
                  : "100%",
                height: "100%",
                ...(focusMargin ? { overflow: "visible" as const } : {}),
                cursor: svgCursor,
                pointerEvents: svgPointerEvents,
              }}
              onMouseDown={handleSVGMouseDown}
              onMouseMove={handleSVGMouseMove}
              onMouseUp={handleSVGMouseUp}
              onMouseLeave={() => {
                if (drawStart) {
                  setDrawStart(null);
                  setDrawCurrent(null);
                }
              }}
            >
              {/* Existing annotations for this page */}
              {pageAnnotations.map((ann) => {
                // While a label is being dragged, render it at the live spot.
                const shown =
                  draggingLabel?.id === ann.id && ann.type === "cue"
                    ? {
                        ...ann,
                        ...(focusMargin
                          ? { marginLabelPos: { x: draggingLabel.x, y: draggingLabel.y } }
                          : { labelPos: { x: draggingLabel.x, y: draggingLabel.y } }),
                      }
                    : ann;
                return (
                  <AnnotationShape
                    key={ann.id}
                    annotation={shown}
                    canvasW={canvasSize.w}
                    canvasH={canvasSize.h}
                    selected={selectedId === ann.id}
                    onClick={() =>
                      setSelectedId(selectedId === ann.id ? null : ann.id)
                    }
                    cueLabel={shown.type === "cue" ? cueLabels.get(ann.id) : undefined}
                    cueScale={cueScale}
                    focusMargin={focusMargin}
                    gutter={focusGutter}
                    onLabelPointerDown={
                      canManage && !isPhone && ann.type === "cue"
                        ? (e) => startLabelDrag(ann.id, e)
                        : undefined
                    }
                  />
                );
              })}

              {/* In-progress preview — a vertical line for the pipe cue, a box
                  for everything else */}
              {drawStart && drawCurrent &&
                (activeTool === "cue" && cueMarker === "pipe" ? (
                  (() => {
                    const band = pipeBandAt(drawCurrent);
                    const px = drawCurrent.x * canvasSize.w;
                    const inset = band.height * canvasSize.h * 0.15;
                    return (
                      <line
                        x1={px}
                        y1={band.yTop * canvasSize.h + inset}
                        x2={px}
                        y2={(band.yTop + band.height) * canvasSize.h - inset}
                        stroke={cueColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="4,3"
                        pointerEvents="none"
                      />
                    );
                  })()
                ) : (
                  <rect
                    x={Math.min(drawStart.x, drawCurrent.x) * canvasSize.w}
                    y={Math.min(drawStart.y, drawCurrent.y) * canvasSize.h}
                    width={Math.abs(drawCurrent.x - drawStart.x) * canvasSize.w}
                    height={Math.abs(drawCurrent.y - drawStart.y) * canvasSize.h}
                    fill={activeTool === "cue" ? `${cueColor}1a` : `${activeColor}55`}
                    stroke={activeTool === "cue" ? cueColor : activeColor}
                    strokeWidth="1.5"
                    strokeDasharray="5,3"
                    pointerEvents="none"
                  />
                ))}
            </svg>
          )}

          {/* Delete button for selected annotation */}
          {selectedId && (() => {
            const ann = pageAnnotations.find((a) => a.id === selectedId);
            if (!ann || ann.type === "ink") return null;
            const screenLeft = ann.rect.x * 100;
            const screenTop = (ann.rect.y + ann.rect.height) * 100 + 1;
            return (
              <div
                style={{
                  position: "absolute",
                  left: `${Math.min(screenLeft, 80)}%`,
                  top: `${screenTop}%`,
                  zIndex: 200,
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,.15)",
                  padding: "4px 6px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {ann.type === "note" && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      maxWidth: 160,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ann.text}
                  </span>
                )}
                {ann.type === "cue" && (
                  <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                    {ann.cueNumber}
                    {ann.cueDescription ? ` — ${ann.cueDescription}` : ""}
                  </span>
                )}
                <button
                  className="btn-icon"
                  onClick={() => deleteAnnotation(selectedId)}
                  title="Delete annotation"
                  style={{
                    width: 24,
                    height: 24,
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: "var(--c-clay)",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 4,
                  }}
                >
                  <Trash2 size={13} />
                </button>
                <button
                  className="btn-icon"
                  onClick={() => setSelectedId(null)}
                  title="Dismiss"
                  style={{
                    width: 24,
                    height: 24,
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: "var(--ink-4)",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 4,
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })()}

          {/* Pending annotation popover */}
          {pendingAnnotation && (
            <div style={pendingPopoverStyle()}>
              {pendingAnnotation.type === "note" ? (
                <>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "var(--ink-4)",
                      marginBottom: 6,
                    }}
                  >
                    Note
                  </p>
                  <textarea
                    autoFocus
                    value={pendingText}
                    onChange={(e) => setPendingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        confirmPending();
                      }
                      if (e.key === "Escape") setPendingAnnotation(null);
                    }}
                    placeholder="Add a note…"
                    rows={3}
                    style={{
                      width: "100%",
                      fontSize: 13,
                      resize: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "6px 8px",
                      background: "var(--bg-sunken)",
                      color: "var(--ink)",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </>
              ) : (
                <>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "var(--ink-4)",
                      marginBottom: 8,
                    }}
                  >
                    Cue annotation
                  </p>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginBottom: 3,
                    }}
                  >
                    Cue number
                  </label>
                  <input
                    autoFocus
                    value={pendingCueNumber}
                    onChange={(e) => setPendingCueNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setPendingAnnotation(null);
                    }}
                    placeholder="e.g. 12.5"
                    style={{
                      width: "100%",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "5px 8px",
                      background: "var(--bg-sunken)",
                      color: "var(--ink)",
                      outline: "none",
                      marginBottom: 8,
                      fontFamily: "inherit",
                    }}
                  />
                  <label
                    style={{
                      display: "block",
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginBottom: 3,
                    }}
                  >
                    Description
                  </label>
                  <input
                    value={pendingCueDesc}
                    onChange={(e) => setPendingCueDesc(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmPending();
                      if (e.key === "Escape") setPendingAnnotation(null);
                    }}
                    placeholder="e.g. Sound: doorbell"
                    style={{
                      width: "100%",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "5px 8px",
                      background: "var(--bg-sunken)",
                      color: "var(--ink)",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button
                  className="btn primary"
                  onClick={confirmPending}
                  style={{ fontSize: 12, height: 28, flex: 1 }}
                >
                  Save
                </button>
                <button
                  className="btn ghost"
                  onClick={() => setPendingAnnotation(null)}
                  style={{ fontSize: 12, height: 28 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        </div>

        {/* Script info */}
        {viewMode !== "cuesheet" && (
          <p style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>
            {script.title} · v{script.scriptVersion}
            {isScriptKind(script.scriptKind) ? ` · ${SCRIPT_KIND_LABELS[script.scriptKind]}` : ""}
            {" "}· Your annotations are private
          </p>
        )}
      </div>

      {/* ── Right panel column ── */}
      <div
        className="sv-side"
        style={{
          width: 248,
          flexShrink: 0,
          marginLeft: 16,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          minHeight: 0,
          ...(shellHeight ? { overflowY: "auto" } : {}),
        }}
      >
        <BookmarksPanel
          bookmarks={bookmarks}
          currentPage={currentPage}
          onNavigate={(page) => setCurrentPage(page)}
          onDelete={deleteBookmark}
        />
        <AnnotationsPanel
          annotations={pageAnnotations}
          currentPage={currentPage}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
          onDelete={deleteAnnotation}
          onEdit={updateAnnotation}
          readOnly={isPhone}
          numScaleDefault={cueNumScaleDefault}
          descScaleDefault={cueDescScaleDefault}
          onNumScaleDefault={setNumDefault}
          onDescScaleDefault={setDescDefault}
          onResetPositions={resetAllCuePositions}
        />
      </div>
    </div>

    {/* Mobile-only quick-access bookmarks (floating button + bottom sheet).
        The desktop right panel and slice-6's mobile stacked panel still
        render the same bookmarks; this is a convenience affordance so
        users don't have to scroll past the whole PDF to reach them. */}
    <button
      type="button"
      className="sv-mobile-bookmarks-btn"
      onClick={() => setMobileBookmarksOpen(true)}
      aria-label="Open bookmarks"
    >
      <BookmarkIcon size={18} aria-hidden />
    </button>
    {mobileBookmarksOpen && (
      <>
        <div
          className="cal-scrim"
          onClick={() => setMobileBookmarksOpen(false)}
          aria-hidden
        />
        <div className="cal-day-sheet" role="dialog" aria-label="Bookmarks">
          <div className="cal-day-sheet-grip" aria-hidden />
          <header className="cal-day-sheet-h">
            <h2>Bookmarks</h2>
            <button
              type="button"
              onClick={() => setMobileBookmarksOpen(false)}
              className="btn ghost btn-icon"
              aria-label="Close"
            >
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="sv-sheet-body">
            <BookmarksPanel
              bookmarks={bookmarks}
              currentPage={currentPage}
              onNavigate={(page) => {
                setCurrentPage(page);
                setMobileBookmarksOpen(false);
              }}
              onDelete={deleteBookmark}
            />
          </div>
        </div>
      </>
    )}
    </>
  );
}

// ── ThumbnailPanel ────────────────────────────────────────────────────────

function ThumbnailPanel({
  pdfUrl,
  totalPages,
  currentPage,
  onNavigate,
}: {
  pdfUrl: string;
  totalPages: number;
  currentPage: number;
  onNavigate: (page: number) => void;
}) {
  const [thumbs, setThumbs] = useState<(string | null)[]>(() =>
    Array(totalPages).fill(null),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pdfUrl || totalPages === 0) return;
    let cancelled = false;

    async function renderAll() {
      const pdf = await loadPdfDocument(pdfUrl);
      if (cancelled) return;

      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) break;

        const key = `${pdfUrl}::thumb::${i}`;
        const cached = pdfThumbnailCache.get(key);
        if (cached) {
          setThumbs((prev) => {
            const next = [...prev];
            next[i - 1] = cached;
            return next;
          });
          continue;
        }

        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.25 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        if (cancelled) break;

        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        pdfThumbnailCache.set(key, dataUrl);

        setThumbs((prev) => {
          const next = [...prev];
          next[i - 1] = dataUrl;
          return next;
        });
      }
    }

    setThumbs(Array(totalPages).fill(null));
    renderAll().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, totalPages]);

  // Scroll active thumbnail into view when navigating from outside the panel
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-page="${currentPage}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentPage]);

  return (
    <div
      ref={containerRef}
      style={{
        width: 152,
        flexShrink: 0,
        alignSelf: "flex-start",
        position: "sticky",
        top: 16,
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-sunken)",
        display: "flex",
        flexDirection: "column",
        paddingTop: 8,
        paddingBottom: 8,
        gap: 0,
        marginRight: 12,
        borderRadius: "0 4px 4px 0",
      }}
    >
      {thumbs.map((thumb, i) => {
        const pageNum = i + 1;
        const isActive = pageNum === currentPage;
        return (
          <div
            key={pageNum}
            data-page={pageNum}
            onClick={() => onNavigate(pageNum)}
            title={`Page ${pageNum}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "8px 10px",
              cursor: "pointer",
              background: isActive ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent",
              borderLeft: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              transition: "background .1s",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLDivElement).style.background = "var(--bg-muted)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
          >
            {thumb ? (
              <img
                src={thumb}
                alt={`Page ${pageNum}`}
                style={{
                  width: "100%",
                  height: "auto",
                  borderRadius: 2,
                  display: "block",
                  boxShadow: isActive
                    ? "0 0 0 2px var(--accent), 0 2px 6px rgba(0,0,0,.2)"
                    : "0 1px 4px rgba(0,0,0,.22)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  aspectRatio: "8.5 / 11",
                  background: "var(--bg-muted)",
                  borderRadius: 2,
                  opacity: 0.5,
                }}
              />
            )}
            <span
              style={{
                fontSize: 10.5,
                color: isActive ? "var(--accent)" : "var(--ink-4)",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {pageNum}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Canvas annotation renderer (used for PDF export) ─────────────────────

// Cues are ordered by where they sit in the script — page, then top-to-bottom,
// then left-to-right — so the cue sheet reads in true show order regardless of
// numbering. A late sound cue (SFX4) lands among the light cues at its actual
// spot, not next to "L4". A small vertical tolerance treats near-equal heights
// as the same line so those order left-to-right.
const SAME_LINE_FRAC = 0.012; // ~one text line as a fraction of page height
function compareCuePosition(a: CueAnn, b: CueAnn): number {
  if (a.page !== b.page) return a.page - b.page;
  const rowA = Math.round(a.rect.y / SAME_LINE_FRAC);
  const rowB = Math.round(b.rect.y / SAME_LINE_FRAC);
  if (rowA !== rowB) return rowA - rowB;
  return a.rect.x - b.rect.x;
}

// Cue-label placement. Labels in a margin are laid out in CUE-NUMBER ORDER so
// the numbers always read in sequence (10, 12, 13…) top to bottom — a higher
// number never sits above a lower one. Default is a single column: each label
// sits at its anchor's height, dropping down only enough to clear the previous
// (lower-numbered) label. When a column gets busy — a label would be pushed
// more than CUE_CROWD past its anchor — the overflow spills into a second
// column nearer the text instead of pushing the whole stack further down, so
// two cues on a line still stack vertically but dense clusters fan into two
// columns. The leader runs horizontally then drops at 90°, never diagonally.
// Computed in the target surface's own pixel space, so callers pass canvasH.
const CUE_LABEL_NUMBER_UP = 20; // number baseline sits this far above its anchor
const CUE_LABEL_DESC_DOWN = 18; // description sits this far below it
const CUE_LABEL_PAD = 12; // clear whitespace kept between stacked labels
const CUE_LANE_GAP = 34; // horizontal offset of the 2nd column toward the text

type CueLabelPos = { y: number; lane: number; order: number };

function stackCueLabels(
  cues: {
    id: string;
    rect: AnnotationRect;
    leaderSide: "left" | "right";
    cueNumber: string;
    cueDescription: string;
    labelPos?: { x: number; y: number };
  }[],
  canvasH: number,
  scale = 1,
  // Single-column mode (the focus gutter): never fan into a 2nd column — every
  // label stacks vertically with full spacing so cards line up and don't overlap.
  singleColumn = false,
): Map<string, CueLabelPos> {
  // Offsets are in screen px; scale them so stacks stay proportional to the
  // page (and the text) at any zoom — see `cueScale`.
  const NUMBER_UP = CUE_LABEL_NUMBER_UP * scale;
  const DESC_DOWN = CUE_LABEL_DESC_DOWN * scale;
  const GAP = NUMBER_UP + CUE_LABEL_PAD * scale;
  // Up to this many labels stack vertically in one column before the next one
  // that can't seat at its line overflows into the second column.
  const MAX_STACK = singleColumn ? Infinity : 2;
  const out = new Map<string, CueLabelPos>();
  for (const side of ["left", "right"] as const) {
    const group = cues
      // Manually-placed labels (dragged) sit where the user put them, so they
      // don't take part in auto-stacking.
      .filter((c) => c.leaderSide === side && !c.labelPos)
      .map((c) => ({
        id: c.id,
        y: (c.rect.y + c.rect.height) * canvasH,
        hasDesc: c.cueDescription.trim().length > 0,
        cueNumber: c.cueNumber,
      }))
      // Margin gutter (single column) orders cards by their anchor's position
      // on the page, so leaders run top-to-bottom in step with the marks and
      // don't cross. The on-page columns order by cue number (numeric-aware).
      .sort((a, b) =>
        singleColumn
          ? a.y - b.y ||
            a.cueNumber.localeCompare(b.cueNumber, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          : a.cueNumber.localeCompare(b.cueNumber, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
      );
    // Greedy, in number order: keep each label at its line in the first column;
    // when the first column is mid-pile and can't seat it there, stack it
    // (up to MAX_STACK) or overflow into the second column. Earlier labels are
    // never moved, and a label is never placed above the previous (lower)
    // number — so adding a cue only places the new one and order is preserved.
    const bottom = [-Infinity, -Infinity]; // bottom of last label per column
    const run = [0, 0]; // labels stacked in the current pile, per column
    let lastY = -Infinity; // previous label's y — keeps numbers in order
    let order = 0; // position within the side group (for staggering gutter jogs)
    for (const item of group) {
      // A column's pile ends once this cue's line clears its last label.
      if (item.y >= bottom[0] + GAP) run[0] = 0;
      if (item.y >= bottom[1] + GAP) run[1] = 0;

      const floor = Math.max(item.y, lastY);
      const y0 = Math.max(floor, bottom[0] + GAP);
      let lane: number;
      let y: number;
      if (y0 <= item.y + 0.5 || run[0] < MAX_STACK) {
        // Seats at its line in column 0, or column 0's pile still has room.
        lane = 0;
        y = y0;
      } else {
        // Column 0's pile is full — overflow into column 1.
        const y1 = Math.max(floor, bottom[1] + GAP);
        if (y1 <= item.y + 0.5 || run[1] < MAX_STACK) {
          lane = 1;
          y = y1;
        } else {
          // Both piles full — push down in whichever column is shorter.
          lane = y0 <= y1 ? 0 : 1;
          y = lane === 0 ? y0 : y1;
        }
      }
      out.set(item.id, { y, lane, order: order++ });
      run[lane] = y <= item.y + 0.5 ? 1 : run[lane] + 1;
      bottom[lane] = y + (item.hasDesc ? DESC_DOWN : 0);
      lastY = y;
    }
  }
  return out;
}

// ── Cue sheet (CSV export + spreadsheet view) ───────────────────────────────

type CueAnn = Extract<Annotation, { type: "cue" }>;
type CueSheetSection = {
  label: string;
  kind?: "scene" | "song";
  rows: CueAnn[];
};

/**
 * Group every cue into ordered sections by the bookmark it falls under — scenes
 * AND songs, so a number like "#3 Our Prayer" gets its own section. Anchors are
 * matched in document reading order (page, then the order bookmarks were
 * detected), so a cue takes the most recent scene/song that starts before it.
 * Cues before the first bookmark land in "Top of show".
 *
 * Note: bookmarks only carry a page, not a within-page position, so when a
 * scene and a song share one page every cue on that page is filed under
 * whichever was detected later (usually the song). Precise "between the scene
 * and the song" ordering would need positional data we don't store yet.
 */
function buildCueSheetSections(
  cues: CueAnn[],
  bookmarks: Bookmark[],
): CueSheetSection[] {
  // Stable sort by page keeps same-page bookmarks in detection (reading) order.
  const marks = bookmarks.slice().sort((a, b) => a.page - b.page);
  const anchorFor = (page: number): { label: string; kind?: "scene" | "song" } => {
    let anchor: Bookmark | null = null;
    for (const m of marks) {
      if (m.page <= page) anchor = m;
      else break;
    }
    return anchor
      ? { label: anchor.title.trim() || "Untitled", kind: anchor.kind }
      : { label: "Top of show" };
  };
  const sorted = cues.slice().sort(compareCuePosition);
  const sections: CueSheetSection[] = [];
  for (const cue of sorted) {
    const a = anchorFor(cue.page);
    let section = sections[sections.length - 1];
    if (!section || section.label !== a.label || section.kind !== a.kind) {
      section = { label: a.label, kind: a.kind, rows: [] };
      sections.push(section);
    }
    section.rows.push(cue);
  }
  return sections;
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Cue sheet as CSV — scene sections are divider rows, à la the user's notes. */
function cueSheetToCsv(sections: CueSheetSection[], title: string): string {
  const lines: string[] = [csvCell(`Cue Sheet: ${title}`), ""];
  for (const section of sections) {
    lines.push(csvCell(section.label));
    lines.push("Cue,Line,Note,Page");
    for (const c of section.rows) {
      lines.push(
        [
          csvCell(c.cueNumber),
          csvCell(c.line ?? ""),
          csvCell(c.cueDescription),
          String(c.page),
        ].join(","),
      );
    }
    lines.push("");
  }
  return lines.join("\r\n");
}

/**
 * Editable cue-sheet view — a spreadsheet of every cue grouped by scene. Cue
 * number and note are inline-editable and write straight back to the annotation
 * (so the script view stays in sync); each row jumps to its spot in the script.
 */
function CueSheetView({
  cues,
  bookmarks,
  scriptTitle,
  readOnly,
  onEdit,
  onDelete,
  onGoToCue,
  onExportCsv,
}: {
  cues: CueAnn[];
  bookmarks: Bookmark[];
  scriptTitle: string;
  readOnly: boolean;
  onEdit: (id: string, changes: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onGoToCue: (cue: CueAnn) => void;
  onExportCsv: () => void;
}) {
  const sections = useMemo(
    () => buildCueSheetSections(cues, bookmarks),
    [cues, bookmarks],
  );

  return (
    <div className="sv-cuesheet">
      <div className="sv-cuesheet-head">
        <div>
          <div className="sv-cuesheet-title">Cue sheet</div>
          <div className="sv-cuesheet-sub">
            {cues.length} cue{cues.length === 1 ? "" : "s"} · {scriptTitle}
          </div>
        </div>
        <button
          className="btn ghost"
          onClick={onExportCsv}
          disabled={cues.length === 0}
          style={{ fontSize: 12, height: 28, gap: 5 }}
          title="Export the cue sheet as CSV"
        >
          <Download size={13} />
          <span>Export CSV</span>
        </button>
      </div>

      {cues.length === 0 ? (
        <p className="sv-cuesheet-empty">
          No cues yet. Switch to the script and place cues with the Cue tool —
          they’ll show up here.
        </p>
      ) : (
        <div className="sv-cuesheet-scroll">
          <table className="sv-cuesheet-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Cue</th>
                <th>Line</th>
                <th>Note</th>
                <th style={{ width: 66 }}>Page</th>
                {!readOnly && <th style={{ width: 34 }} />}
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <Fragment key={`${section.label}-${section.rows[0]?.id}`}>
                  <tr className="sv-cuesheet-section">
                    <td colSpan={readOnly ? 4 : 5}>
                      <span className="sv-cuesheet-section-label">
                        {section.kind === "song" ? (
                          <Music size={12} />
                        ) : section.kind === "scene" ? (
                          <Clapperboard size={12} />
                        ) : null}
                        {section.label}
                      </span>
                    </td>
                  </tr>
                  {section.rows.map((cue) => (
                    <CueSheetRow
                      key={cue.id}
                      cue={cue}
                      readOnly={readOnly}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onGoTo={() => onGoToCue(cue)}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CueSheetRow({
  cue,
  readOnly,
  onEdit,
  onDelete,
  onGoTo,
}: {
  cue: CueAnn;
  readOnly: boolean;
  onEdit: (id: string, changes: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onGoTo: () => void;
}) {
  const cc = cue.color ?? CUE_STROKE;
  return (
    <tr className="sv-cuesheet-row">
      <td>
        <span className="sv-cuesheet-cue">
          <span className="sv-cuesheet-dot" style={{ background: cc }} />
          {readOnly ? (
            <span>{cue.cueNumber}</span>
          ) : (
            <input
              className="sv-cuesheet-input"
              defaultValue={cue.cueNumber}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== cue.cueNumber)
                  onEdit(cue.id, { cueNumber: v } as Partial<Annotation>);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          )}
        </span>
      </td>
      <td>
        {readOnly ? (
          <span className="sv-cuesheet-line">{cue.line}</span>
        ) : (
          <input
            className="sv-cuesheet-input sv-cuesheet-line"
            defaultValue={cue.line ?? ""}
            placeholder="—"
            title={cue.line || undefined}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (cue.line ?? ""))
                onEdit(cue.id, { line: v } as Partial<Annotation>);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        )}
      </td>
      <td>
        {readOnly ? (
          <span>{cue.cueDescription}</span>
        ) : (
          <input
            className="sv-cuesheet-input"
            defaultValue={cue.cueDescription}
            placeholder="—"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== cue.cueDescription)
                onEdit(cue.id, { cueDescription: v } as Partial<Annotation>);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        )}
      </td>
      <td>
        <button
          className="sv-cuesheet-page"
          onClick={onGoTo}
          title="Go to this cue in the script"
        >
          p.{cue.page}
        </button>
      </td>
      {!readOnly && (
        <td>
          <button
            className="sv-cuesheet-del"
            onClick={() => onDelete(cue.id)}
            title="Delete cue"
          >
            <Trash2 size={13} />
          </button>
        </td>
      )}
    </tr>
  );
}

/** Word-wrap text into a fixed width, drawing each line; caller clips to box. */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  let cursorY = y;
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
  }
}

function drawAnnotationOnCanvas(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  canvasW: number,
  canvasH: number,
  cueLabel?: CueLabelPos,
  cueScale = 1,
) {
  if (ann.type === "ink") {
    if (ann.points.length === 0) return;
    ctx.save();
    ctx.globalAlpha = ann.tool === "highlighter" ? INK_OPACITY.highlighter : 1;
    ctx.strokeStyle = ann.color;
    ctx.lineWidth = Math.max(1, ann.size * canvasW);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ann.points.forEach((p, i) => {
      const x = p.x * canvasW;
      const y = p.y * canvasH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
    return;
  }

  const rx = ann.rect.x * canvasW;
  const ry = ann.rect.y * canvasH;
  const rw = ann.rect.width * canvasW;
  const rh = ann.rect.height * canvasH;

  ctx.save();

  if (ann.type === "highlight") {
    ctx.globalAlpha = 0.44;
    ctx.fillStyle = ann.color;
    const boxes = ann.rects && ann.rects.length > 0 ? ann.rects : [ann.rect];
    for (const b of boxes) {
      ctx.fillRect(b.x * canvasW, b.y * canvasH, b.width * canvasW, b.height * canvasH);
    }
  } else if (ann.type === "note") {
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = ann.color;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ann.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
    // The note text, wrapped + clipped inside the box.
    if (ann.text.trim()) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.fillStyle = "#1c1c1c";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      wrapCanvasText(ctx, ann.text, rx + 5, ry + 4, rw - 10, 14);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(rx + rw, ry, 5, 0, Math.PI * 2);
    ctx.fillStyle = ann.color;
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (ann.type === "cue") {
    const s = cueScale;
    const bottomY = ry + rh;
    const isLeft = ann.leaderSide === "left";
    const lineStartX = isLeft ? rx : rx + rw;
    const MARGIN_OFFSET = 14 * s;
    const lane = cueLabel?.lane ?? 0;
    const baseX = isLeft ? MARGIN_OFFSET : canvasW - MARGIN_OFFSET;
    // A dragged label sits at its stored position; otherwise it's auto-stacked.
    const labelX = ann.labelPos
      ? ann.labelPos.x * canvasW
      : isLeft
        ? baseX + lane * CUE_LANE_GAP * s
        : baseX - lane * CUE_LANE_GAP * s;
    const labelY = ann.labelPos ? ann.labelPos.y * canvasH : (cueLabel?.y ?? bottomY);
    const cc = ann.color ?? CUE_STROKE;
    const serif = 3 * s;

    if (ann.marker === "pipe") {
      // A clean vertical line, inset a little from the line band (no serifs).
      ctx.strokeStyle = cc;
      ctx.lineWidth = 2 * s;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(rx, ry + rh * 0.15);
      ctx.lineTo(rx, bottomY - rh * 0.15);
      ctx.stroke();
      ctx.lineCap = "butt";
    } else {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = cc;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cc;
      ctx.lineWidth = 1.5 * s;
      ctx.strokeRect(rx, ry, rw, rh);
    }
    // Orthogonal leader: horizontal out to the margin, then a right-angle drop
    // to the (possibly stacked) label — never a diagonal across the page.
    ctx.beginPath();
    ctx.moveTo(lineStartX, bottomY);
    ctx.lineTo(labelX, bottomY);
    if (labelY !== bottomY) ctx.lineTo(labelX, labelY);
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(labelX, labelY, serif, 0, Math.PI * 2);
    ctx.fillStyle = cc;
    ctx.fill();
    const numScale = ann.cueNumScale ?? ann.cueTextScale ?? 1;
    const descScale = ann.cueDescScale ?? ann.cueTextScale ?? 1;
    ctx.fillStyle = cc;
    ctx.textAlign = isLeft ? "left" : "right";
    ctx.font = `bold ${13 * s * numScale}px system-ui, sans-serif`;
    ctx.fillText(ann.cueNumber, isLeft ? labelX + 6 * s : labelX - 6 * s, labelY - 4 * s);
    if (ann.cueDescription) {
      ctx.font = `${9 * s * descScale}px system-ui, sans-serif`;
      ctx.fillText(ann.cueDescription, isLeft ? labelX + 6 * s : labelX - 6 * s, labelY + 12 * s * descScale);
    }
  }

  ctx.restore();
}

// ── AnnotationShape ────────────────────────────────────────────────────────

function AnnotationShape({
  annotation,
  canvasW,
  canvasH,
  selected,
  onClick,
  cueLabel,
  cueScale = 1,
  focusMargin = false,
  gutter = 0,
  onLabelPointerDown,
}: {
  annotation: Annotation;
  canvasW: number;
  canvasH: number;
  selected: boolean;
  onClick: () => void;
  cueLabel?: CueLabelPos;
  cueScale?: number;
  /** Focus margin mode: render the cue label as a boxed card in the right gutter. */
  focusMargin?: boolean;
  /** Width (render px) of the focus gutter, used to size the card. */
  gutter?: number;
  /** When provided, the cue label is a drag handle (mousedown starts a drag). */
  onLabelPointerDown?: (e: React.MouseEvent) => void;
}) {
  if (annotation.type === "ink") {
    return (
      <path
        d={inkPathD(annotation.points, canvasW, canvasH)}
        fill="none"
        stroke={annotation.color}
        strokeOpacity={annotation.tool === "highlighter" ? INK_OPACITY.highlighter : 1}
        strokeWidth={Math.max(1, annotation.size * canvasW)}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          pointerEvents: "none",
          ...(annotation.tool === "highlighter"
            ? { mixBlendMode: "multiply" as const }
            : {}),
        }}
      />
    );
  }

  const rx = annotation.rect.x * canvasW;
  const ry = annotation.rect.y * canvasH;
  const rw = annotation.rect.width * canvasW;
  const rh = annotation.rect.height * canvasH;

  if (annotation.type === "highlight") {
    // Per-line boxes for a text selection; fall back to the single bounding box
    // for drawn-box highlights (and pre-existing ones without `rects`).
    const boxes =
      annotation.rects && annotation.rects.length > 0
        ? annotation.rects
        : [annotation.rect];
    return (
      <g
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {boxes.map((b, i) => (
          <rect
            key={i}
            x={b.x * canvasW}
            y={b.y * canvasH}
            width={b.width * canvasW}
            height={b.height * canvasH}
            fill={`${annotation.color}70`}
            stroke={selected ? "var(--ink)" : "none"}
            strokeWidth="1.5"
          />
        ))}
      </g>
    );
  }

  if (annotation.type === "note") {
    return (
      <g onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ cursor: "pointer" }}>
        {/* Sticky-note box: light tinted fill so the dark note text reads on top */}
        <rect
          x={rx}
          y={ry}
          width={rw}
          height={rh}
          rx={2}
          fill={`${annotation.color}22`}
          stroke={annotation.color}
          strokeWidth={selected ? "2" : "1"}
        />
        {/* The note's text, wrapped inside the box. Always dark — the note sits
            on the white script page, so a fixed dark colour reads in any theme
            (a themed var like --ink would be white in dark mode). */}
        <foreignObject x={rx} y={ry} width={rw} height={rh} style={{ pointerEvents: "none" }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              padding: "3px 5px",
              fontSize: 11,
              lineHeight: 1.25,
              color: "#1a1a1a",
              fontWeight: 500,
              fontFamily: "system-ui, sans-serif",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "hidden",
            }}
          >
            {annotation.text}
          </div>
        </foreignObject>
        {/* Note indicator dot */}
        <circle
          cx={rx + rw}
          cy={ry}
          r={5}
          fill={annotation.color}
          stroke="white"
          strokeWidth="1"
        />
      </g>
    );
  }

  if (annotation.type === "cue") {
    const s = cueScale;
    const bottomY = ry + rh;
    const isLeft = focusMargin ? false : annotation.leaderSide === "left";
    const lineStartX = isLeft ? rx : rx + rw;
    const MARGIN_OFFSET = 14 * s;
    const lane = cueLabel?.lane ?? 0;
    // Margin mode parks labels well into the right gutter; otherwise they hug
    // the page's left/right edge as before.
    const baseX = focusMargin
      ? canvasW + 48 * s
      : isLeft
        ? MARGIN_OFFSET
        : canvasW - MARGIN_OFFSET;
    // A dragged label sits at its stored position; otherwise it's auto-stacked.
    // Margin mode uses its own placement field (marginLabelPos) so it never
    // collides with the normal editor's labelPos. In the gutter we keep a single
    // aligned column (no 2nd-column fan-out) so cards line up and each leader
    // reads cleanly to its own card.
    const placed = focusMargin ? annotation.marginLabelPos : annotation.labelPos;
    const labelX = placed
      ? placed.x * canvasW
      : focusMargin
        ? baseX
        : isLeft
          ? baseX + lane * CUE_LANE_GAP * s
          : baseX - lane * CUE_LANE_GAP * s;
    const labelY = placed
      ? placed.y * canvasH
      : (cueLabel?.y ?? bottomY);
    const textAnchor = isLeft ? "start" : "end";
    const cc = annotation.color ?? CUE_STROKE;
    const serif = 3 * s;
    const draggable = !!onLabelPointerDown;
    // Per-cue label text scale: number and description sized independently
    // (legacy cueTextScale applies to both when the split values are absent).
    const numScale = annotation.cueNumScale ?? annotation.cueTextScale ?? 1;
    const descScale = annotation.cueDescScale ?? annotation.cueTextScale ?? 1;
    const ts = Math.max(numScale, descScale); // card sizing tracks the larger
    // Gutter card geometry (margin mode only): a neutral, readable card whose
    // width fits the longer of the cue number / description rather than filling
    // the whole gutter. A thin colored bar on the left carries the cue color.
    const ACCENT_W = 3 * s;
    const padL = 9 * s;
    const padR = 11 * s;
    const numTextW = (annotation.cueNumber?.length ?? 0) * 8.2 * s * numScale;
    const descTextW = (annotation.cueDescription?.length ?? 0) * 5.0 * s * descScale;
    const contentW = Math.max(numTextW, descTextW);
    const cardX = labelX;
    const availW = canvasW + gutter - cardX - 6 * s;
    const cardW = Math.min(
      Math.max(54 * s, ACCENT_W + padL + contentW + padR),
      Math.max(60 * s, availW),
    );
    const cardH = (annotation.cueDescription ? 30 : 21) * s * ts;
    const cardY = labelY - cardH / 2;
    const textX = cardX + ACCENT_W + padL;
    // The vertical jog happens off the page, on a single shared rail just before
    // the cards. Because cards are ordered by anchor position (above), leaders
    // descend in step and form a tidy vertical bus rather than crossing lines.
    const railX = cardX - 14 * s;

    const isPipe = annotation.marker === "pipe";

    return (
      <g onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ cursor: "pointer" }}>
        {isPipe ? (
          <>
            {/* Wide transparent hit target so the thin pipe is easy to click */}
            <line x1={rx} y1={ry} x2={rx} y2={bottomY} stroke="transparent" strokeWidth={12 * s} />
            {/* The pipe: a clean vertical line, inset a little from the line band
                so it doesn't overrun the text height (no serifs). */}
            <line
              x1={rx}
              y1={ry + rh * 0.15}
              x2={rx}
              y2={bottomY - rh * 0.15}
              stroke={cc}
              strokeWidth={(selected ? 3 : 2) * s}
              strokeLinecap="round"
            />
          </>
        ) : (
          /* Box */
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill={cc}
            fillOpacity={0.08}
            stroke={cc}
            strokeWidth={(selected ? 2 : 1.5) * s}
          />
        )}
        {/* Orthogonal leader. On-page (normal): horizontal out to the margin
            then a right-angle drop. Margin mode: a single horizontal straight
            off the cue's line and off the page edge, then a 90° jog in the gutter
            (absorbing the stack/drag offset), then a short horizontal into the
            card — so nothing runs vertically across the script text. */}
        <polyline
          points={
            focusMargin
              ? labelY === bottomY
                ? `${lineStartX},${bottomY} ${cardX},${bottomY}`
                : `${lineStartX},${bottomY} ${railX},${bottomY} ${railX},${labelY} ${cardX},${labelY}`
              : labelY === bottomY
                ? `${lineStartX},${bottomY} ${labelX},${bottomY}`
                : `${lineStartX},${bottomY} ${labelX},${bottomY} ${labelX},${labelY}`
          }
          fill="none"
          stroke={cc}
          strokeWidth={1 * s}
          strokeOpacity={focusMargin ? 0.7 : 1}
        />
        {/* Label: end dot + number (+ description). Draggable when editable —
            grab it to place it manually; the leader follows. */}
        <g
          onMouseDown={
            draggable
              ? (e) => {
                  e.stopPropagation();
                  onLabelPointerDown?.(e);
                }
              : undefined
          }
          onClick={draggable ? (e) => e.stopPropagation() : undefined}
          style={draggable ? { cursor: "move" } : undefined}
        >
          {focusMargin ? (
            <>
              {/* White card + colored left accent bar — readable on the dark
                  gutter (and fine on light). Dark text, fixed (not theme vars). */}
              <rect
                x={cardX}
                y={cardY}
                width={cardW}
                height={cardH}
                rx={5 * s}
                ry={5 * s}
                style={{
                  fill: "#ffffff",
                  stroke: selected ? cc : "rgba(0,0,0,0.22)",
                  strokeWidth: (selected ? 1.5 : 1) * s,
                }}
              />
              <rect
                x={cardX}
                y={cardY}
                width={ACCENT_W}
                height={cardH}
                fill={cc}
              />
              <text
                x={textX}
                y={annotation.cueDescription ? labelY - 3 * s * numScale : labelY + 4 * s * numScale}
                textAnchor="start"
                fontSize={12.5 * s * numScale}
                fill={cc}
                fontWeight="700"
                fontFamily="system-ui, sans-serif"
              >
                {annotation.cueNumber}
              </text>
              {annotation.cueDescription && (
                <text
                  x={textX}
                  y={labelY + 10 * s * descScale}
                  textAnchor="start"
                  fontSize={9 * s * descScale}
                  fill="#52525b"
                  fontFamily="system-ui, sans-serif"
                >
                  {annotation.cueDescription}
                </text>
              )}
            </>
          ) : (
            <>
              {/* Invisible hit target so the label is easy to grab */}
              {draggable && (
                <rect
                  x={isLeft ? labelX - 4 * s : labelX - 44 * s}
                  y={labelY - 16 * s}
                  width={48 * s}
                  height={annotation.cueDescription ? 32 * s : 22 * s}
                  fill="transparent"
                />
              )}
              <circle cx={labelX} cy={labelY} r={serif} fill={cc} />
              <text
                x={isLeft ? labelX + 6 * s : labelX - 6 * s}
                y={labelY - 4 * s}
                textAnchor={textAnchor}
                fontSize={13 * s * numScale}
                fill={cc}
                fontWeight="700"
                fontFamily="system-ui, sans-serif"
              >
                {annotation.cueNumber}
              </text>
              {annotation.cueDescription && (
                <text
                  x={isLeft ? labelX + 6 * s : labelX - 6 * s}
                  y={labelY + 12 * s * descScale}
                  textAnchor={textAnchor}
                  fontSize={9 * s * descScale}
                  fill={cc}
                  fontFamily="system-ui, sans-serif"
                >
                  {annotation.cueDescription}
                </text>
              )}
            </>
          )}
        </g>
      </g>
    );
  }

  return null;
}

// ── BookmarksPanel ────────────────────────────────────────────────────────

function BookmarksPanel({
  bookmarks,
  currentPage,
  onNavigate,
  onDelete,
}: {
  bookmarks: Bookmark[];
  currentPage: number;
  onNavigate: (page: number) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...bookmarks].sort((a, b) => a.page - b.page);
  const [query, setQuery] = useState("");
  // Scenes vs. songs view. Hand-added bookmarks (no kind) group with scenes.
  const [tab, setTab] = useState<"scenes" | "songs">("scenes");
  const sceneCount = sorted.filter((b) => b.kind !== "song").length;
  const songCount = sorted.filter((b) => b.kind === "song").length;
  const tabbed = sorted.filter((b) =>
    tab === "songs" ? b.kind === "song" : b.kind !== "song",
  );
  const q = query.trim().toLowerCase();
  const filtered = q
    ? tabbed.filter((b) =>
        /^\d+$/.test(q)
          ? String(b.page).includes(q)
          : b.title.toLowerCase().includes(q),
      )
    : tabbed;

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 2px 8px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 8,
        }}
      >
        <BookmarkIcon size={12} style={{ color: "var(--ink-4)" }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-4)" }}>
          Bookmarks
        </span>
        {bookmarks.length > 0 && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 999,
              background: "var(--bg-sunken)",
              color: "var(--ink-3)",
            }}
          >
            {bookmarks.length}
          </span>
        )}
      </div>

      {bookmarks.length > 0 && (
        <div className="sv-bm-tabs">
          <button
            type="button"
            className={tab === "scenes" ? "sv-bm-tab active" : "sv-bm-tab"}
            onClick={() => setTab("scenes")}
            aria-pressed={tab === "scenes"}
          >
            <Clapperboard size={12} />
            Scenes
            <span className="sv-bm-tab-count">{sceneCount}</span>
          </button>
          <button
            type="button"
            className={tab === "songs" ? "sv-bm-tab active" : "sv-bm-tab"}
            onClick={() => setTab("songs")}
            aria-pressed={tab === "songs"}
          >
            <Music size={12} />
            Songs
            <span className="sv-bm-tab-count">{songCount}</span>
          </button>
        </div>
      )}

      {bookmarks.length > 3 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bookmarks or page #"
          aria-label="Search bookmarks"
          style={{
            width: "100%",
            fontSize: 12,
            padding: "5px 8px",
            marginBottom: 6,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-sunken)",
            color: "var(--ink)",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
      )}

      {sorted.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--ink-4)", padding: "4px 2px 12px" }}>
          No bookmarks yet.
        </p>
      ) : tabbed.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--ink-4)", padding: "4px 2px 12px" }}>
          No {tab === "songs" ? "songs" : "scenes"} yet.
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--ink-4)", padding: "4px 2px 12px" }}>
          No matching bookmarks.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 8, maxHeight: "min(340px, 42vh)", overflowY: "auto" }}>
          {filtered.map((bm) => (
            <div
              key={bm.id}
              onClick={() => onNavigate(bm.page)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 8px",
                borderRadius: 6,
                cursor: "pointer",
                background: bm.page === currentPage ? "var(--bg-muted)" : "transparent",
                transition: "background .1s",
              }}
              onMouseEnter={(e) => {
                if (bm.page !== currentPage)
                  (e.currentTarget as HTMLDivElement).style.background = "var(--bg-muted)";
              }}
              onMouseLeave={(e) => {
                if (bm.page !== currentPage)
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "var(--bg-sunken)",
                  color: "var(--ink-3)",
                  flexShrink: 0,
                }}
              >
                p.{bm.page}
              </span>
              {bm.kind && (
                <span
                  title={bm.kind === "song" ? "Song / musical number" : "Scene"}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".03em",
                    textTransform: "uppercase",
                    padding: "1px 5px",
                    borderRadius: 4,
                    flexShrink: 0,
                    background:
                      bm.kind === "song" ? "var(--c-plum-soft)" : "var(--c-dusk-soft)",
                    color: bm.kind === "song" ? "var(--c-plum)" : "var(--c-dusk)",
                  }}
                >
                  {bm.kind === "song" ? "Song" : "Scene"}
                </span>
              )}
              <span
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {bm.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(bm.id);
                }}
                title="Remove bookmark"
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  display: "grid",
                  placeItems: "center",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--ink-4)",
                  borderRadius: 3,
                  opacity: 0.6,
                  transition: "opacity .1s, color .1s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--c-clay)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "0.6";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-4)";
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AnnotationsPanel ──────────────────────────────────────────────────────

// Small labeled range used for cue label text sizing (per-cue + defaults).
function ScaleSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--ink-3)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <span style={{ flexShrink: 0, width: 46 }}>{label}</span>
      <input
        type="range"
        min={0.7}
        max={1.8}
        step={0.1}
        value={value}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <span style={{ flexShrink: 0, width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(value * 100)}%
      </span>
    </label>
  );
}

function AnnotationsPanel({
  annotations,
  currentPage,
  selectedId,
  onSelect,
  onDelete,
  onEdit,
  readOnly,
  numScaleDefault,
  descScaleDefault,
  onNumScaleDefault,
  onDescScaleDefault,
  onResetPositions,
}: {
  annotations: Annotation[];
  currentPage: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, changes: Partial<Annotation>) => void;
  readOnly: boolean;
  numScaleDefault: number;
  descScaleDefault: number;
  onNumScaleDefault: (v: number) => void;
  onDescScaleDefault: (v: number) => void;
  onResetPositions: () => void;
}) {
  // Freehand ink is rendered on the page, not listed/edited in this panel.
  const listable = annotations.filter((a) => a.type !== "ink");
  const byY = (a: Annotation, b: Annotation) =>
    "rect" in a && "rect" in b
      ? a.rect.y !== b.rect.y
        ? a.rect.y - b.rect.y
        : a.rect.x - b.rect.x
      : 0;

  // Both cues and other annotations read top-to-bottom (show order on the page).
  const cues = listable.filter((a) => a.type === "cue").sort(byY);
  const others = listable.filter((a) => a.type !== "cue").sort(byY);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 2px 8px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-4)" }}>
          Page {currentPage}
        </span>
        {listable.length > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "var(--bg-sunken)", color: "var(--ink-3)" }}>
            {listable.length}
          </span>
        )}
      </div>

      {listable.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--ink-4)", padding: "8px 2px" }}>
          No annotations on this page.
        </p>
      )}

      {/* Cues section */}
      {cues.length > 0 && (
        <div style={{ marginBottom: others.length > 0 ? 12 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 6px", marginBottom: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: CUE_STROKE }}>
              Cues
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 999, background: `color-mix(in oklch, ${CUE_STROKE} 12%, transparent)`, color: CUE_STROKE }}>
              {cues.length}
            </span>
          </div>
          {!readOnly && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                padding: "7px 8px",
                marginBottom: 8,
                borderRadius: 7,
                background: "var(--bg-sunken)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-4)" }}>
                Default label size
              </div>
              <ScaleSlider label="Number" value={numScaleDefault} onChange={onNumScaleDefault} />
              <ScaleSlider label="Descr." value={descScaleDefault} onChange={onDescScaleDefault} />
              {cues.some((c) => c.type === "cue" && (c.labelPos || c.marginLabelPos)) && (
                <button
                  type="button"
                  onClick={onResetPositions}
                  style={{ alignSelf: "flex-start", marginTop: 1, fontSize: 10.5, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                >
                  Reset all cue positions
                </button>
              )}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {cues.map((ann) => (
              <PanelAnnotationItem
                key={ann.id}
                annotation={ann}
                selected={selectedId === ann.id}
                onSelect={() => onSelect(ann.id)}
                onDelete={() => onDelete(ann.id)}
                onEdit={(changes) => onEdit(ann.id, changes)}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      )}

      {/* Notes / highlights section */}
      {others.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 6px", marginBottom: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-4)" }}>
              Notes
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 999, background: "var(--bg-sunken)", color: "var(--ink-3)" }}>
              {others.length}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {others.map((ann) => (
              <PanelAnnotationItem
                key={ann.id}
                annotation={ann}
                selected={selectedId === ann.id}
                onSelect={() => onSelect(ann.id)}
                onDelete={() => onDelete(ann.id)}
                onEdit={(changes) => onEdit(ann.id, changes)}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelAnnotationItem({
  annotation,
  selected,
  onSelect,
  onDelete,
  onEdit,
  readOnly,
}: {
  annotation: Annotation;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: (changes: Partial<Annotation>) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftCueNum, setDraftCueNum] = useState("");
  const [draftCueDesc, setDraftCueDesc] = useState("");

  const canEdit = annotation.type === "note" || annotation.type === "cue";
  const accentColor =
    annotation.type === "cue"
      ? annotation.color ?? CUE_STROKE
      : annotation.color;

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    if (annotation.type === "note") setDraftText(annotation.text);
    if (annotation.type === "cue") {
      setDraftCueNum(annotation.cueNumber);
      setDraftCueDesc(annotation.cueDescription);
    }
    setEditing(true);
  }

  function confirmEdit() {
    if (annotation.type === "note" && draftText.trim()) {
      onEdit({ text: draftText.trim() } as Partial<Annotation>);
    } else if (annotation.type === "cue" && draftCueNum.trim()) {
      onEdit({ cueNumber: draftCueNum.trim(), cueDescription: draftCueDesc.trim() } as Partial<Annotation>);
    }
    setEditing(false);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    fontSize: 12,
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 6px",
    background: "var(--bg-sunken)",
    color: "var(--ink)",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      onClick={() => { if (!editing) onSelect(); }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 6,
        borderLeft: `3px solid ${accentColor}`,
        background: selected ? "var(--bg-muted)" : "transparent",
        cursor: editing ? "default" : "pointer",
        transition: "background .1s",
      }}
      onMouseEnter={(e) => {
        if (!selected && !editing)
          (e.currentTarget as HTMLDivElement).style.background = "var(--bg-muted)";
      }}
      onMouseLeave={(e) => {
        if (!selected && !editing)
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {annotation.type === "highlight" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: annotation.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Highlight</span>
          </div>
        )}

        {annotation.type === "note" && (
          editing ? (
            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={confirmEdit}
              rows={3}
              style={{ ...inputStyle, resize: "none" }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", marginBottom: 2 }}>Note</div>
              <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                {annotation.text}
              </div>
            </>
          )
        )}

        {annotation.type === "cue" && (
          editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }} onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={draftCueNum}
                onChange={(e) => setDraftCueNum(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
                placeholder="Cue number"
                style={inputStyle}
              />
              <input
                value={draftCueDesc}
                onChange={(e) => setDraftCueDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={confirmEdit}
                placeholder="Description"
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 5, paddingTop: 2 }}>
                {CUE_COLORS.map((c) => {
                  const current = annotation.color ?? CUE_STROKE;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        onEdit({ color: c.value } as Partial<Annotation>)
                      }
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        border:
                          current === c.value
                            ? "2px solid var(--ink)"
                            : "2px solid transparent",
                        background: c.value,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 5 }}>
                <ScaleSlider
                  label="Number"
                  value={annotation.cueNumScale ?? annotation.cueTextScale ?? 1}
                  onChange={(v) =>
                    onEdit({ cueNumScale: v, cueTextScale: undefined } as Partial<Annotation>)
                  }
                />
                <ScaleSlider
                  label="Descr."
                  value={annotation.cueDescScale ?? annotation.cueTextScale ?? 1}
                  onChange={(v) =>
                    onEdit({ cueDescScale: v, cueTextScale: undefined } as Partial<Annotation>)
                  }
                />
              </div>
              {(annotation.labelPos || annotation.marginLabelPos) && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    onEdit({
                      labelPos: undefined,
                      marginLabelPos: undefined,
                    } as Partial<Annotation>)
                  }
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: "var(--ink-3)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                    textAlign: "left",
                  }}
                >
                  Reset label position
                </button>
              )}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>{annotation.cueNumber}</div>
              {annotation.cueDescription && (
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {annotation.cueDescription}
                </div>
              )}
            </>
          )
        )}
      </div>

      {!editing && !readOnly && (
        <div style={{ display: "flex", flexShrink: 0, gap: 2 }}>
          {canEdit && (
            <button
              onClick={startEdit}
              title="Edit"
              style={{ width: 20, height: 20, display: "grid", placeItems: "center", border: "none", background: "none", cursor: "pointer", color: "var(--ink-4)", borderRadius: 3, opacity: 0.6, transition: "opacity .1s, color .1s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-4)"; }}
            >
              <Pencil size={11} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            style={{ width: 20, height: 20, display: "grid", placeItems: "center", border: "none", background: "none", cursor: "pointer", color: "var(--ink-4)", borderRadius: 3, opacity: 0.6, transition: "opacity .1s, color .1s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; (e.currentTarget as HTMLButtonElement).style.color = "var(--c-clay)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-4)"; }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── ToolButton ─────────────────────────────────────────────────────────────

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        display: "grid",
        placeItems: "center",
        border: "none",
        borderRadius: 6,
        background: active ? "var(--bg-elev)" : "transparent",
        boxShadow: active ? "var(--shadow-1)" : "none",
        color: active ? "var(--accent)" : "var(--ink-3)",
        cursor: "pointer",
        transition: "background .1s, color .1s",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--bg-muted)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--ink)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-3)";
        }
      }}
    >
      {icon}
    </button>
  );
}
