import "server-only";
import type { PDFDocument } from "pdf-lib";
import type { PageRange } from "./constants";
import { pagesInRange } from "./parse-utils";

/**
 * pdf-lib wrapper for cutting page ranges out of an uploaded script: used to
 * build scan chunks and detection samples for the AI parse, and to split a
 * combined libretto + vocal-score book into two documents. Pure JS, so it runs
 * on Vercel's Node runtime without native deps.
 */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const { PDFDocument: PDFDocumentImpl } = await import("pdf-lib");
  return PDFDocumentImpl.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

/** A new PDF containing the given 1-based pages of `src`, in the order given. */
export async function extractPages(
  src: PDFDocument,
  pageNumbers: number[],
): Promise<Uint8Array> {
  const { PDFDocument: PDFDocumentImpl } = await import("pdf-lib");
  const out = await PDFDocumentImpl.create();
  const copied = await out.copyPages(
    src,
    pageNumbers.map((n) => n - 1),
  );
  for (const page of copied) out.addPage(page);
  return out.save({ useObjectStreams: true });
}

export async function extractPageRange(src: PDFDocument, range: PageRange): Promise<Uint8Array> {
  return extractPages(src, pagesInRange(range));
}
