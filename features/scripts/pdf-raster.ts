import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PDFiumDocument, PDFiumLibrary } from "@hyzyla/pdfium";
import { encodePng } from "./png-encode";

/**
 * pdfium (Chrome's PDF engine, already a dependency for the browser OCR
 * rebuild) as a server-side RASTER fallback. pdf-lib is the primary engine for
 * cutting page ranges, but it rejects some real-world scanner output; pdfium
 * opens practically anything, and although this build can't write a new PDF
 * (no `addFunction` export for FPDF_SaveAsCopy's callback) it can render pages
 * to bitmaps, which we encode as PNG and either send to the model as images or
 * reassemble into an image-only PDF with pdf-lib.
 *
 * The wasm is loaded explicitly from node_modules (traced into the function by
 * `outputFileTracingIncludes` in next.config.ts) rather than via the package's
 * `import.meta.url` lookup, which bundlers rewrite.
 */
export type RasterPage = { page: number; png: Buffer; width: number; height: number; pointsWidth: number; pointsHeight: number };

export type RasterDoc = {
  pageCount: number;
  /** Render one 1-based page to a PNG. Gray by default (scans are gray). */
  renderPage(page: number, opts?: { scale?: number; gray?: boolean }): Promise<RasterPage>;
  destroy(): void;
};

const WASM_PATH = path.join(process.cwd(), "node_modules/@hyzyla/pdfium/dist/pdfium.wasm");

let libraryPromise: Promise<PDFiumLibrary> | null = null;
async function getLibrary(): Promise<PDFiumLibrary> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const { PDFiumLibrary: Lib } = await import("@hyzyla/pdfium");
      const wasm = await fs.readFile(WASM_PATH);
      const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
      return Lib.init({ wasmBinary });
    })().catch((err) => {
      libraryPromise = null;
      throw err;
    });
  }
  return libraryPromise;
}

export async function openWithPdfium(bytes: Uint8Array): Promise<RasterDoc> {
  const lib = await getLibrary();
  const doc: PDFiumDocument = await lib.loadDocument(Buffer.from(bytes));
  const pageCount = doc.getPageCount();
  return {
    pageCount,
    async renderPage(page, opts = {}) {
      const scale = opts.scale ?? 1.4;
      const gray = opts.gray ?? true;
      const p = doc.getPage(page - 1);
      const r = await p.render({
        scale,
        render: "bitmap",
        colorSpace: gray ? "Gray" : "BGRA",
      });
      return {
        page,
        png: encodePng(r.data, r.width, r.height, gray ? 1 : 4),
        width: r.width,
        height: r.height,
        pointsWidth: r.originalWidth,
        pointsHeight: r.originalHeight,
      };
    },
    destroy() {
      try {
        doc.destroy();
      } catch {
        // already destroyed
      }
    },
  };
}

/**
 * Render a set of pages, keeping the total PNG payload under `maxBytes` by
 * dropping the render scale (1.4 → 1.0 → 0.8) when a batch comes out heavy.
 */
export async function renderPagesBounded(
  doc: RasterDoc,
  pages: number[],
  maxBytes: number,
): Promise<RasterPage[]> {
  for (const scale of [1.4, 1.0, 0.8]) {
    const out: RasterPage[] = [];
    let total = 0;
    for (const page of pages) {
      const r = await doc.renderPage(page, { scale, gray: true });
      out.push(r);
      total += r.png.length;
      if (total > maxBytes) break;
    }
    if (total <= maxBytes) return out;
  }
  throw new Error("Rendered pages are too large to send even at reduced resolution.");
}
