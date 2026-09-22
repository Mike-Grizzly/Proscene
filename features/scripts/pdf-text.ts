/**
 * Extract the text of each page of a PDF, one string per page (index 0 = page
 * 1). Uses `unpdf`, which ships a serverless-safe pdfjs build — no browser
 * globals (DOMMatrix etc.), so it runs on Vercel's Node runtime.
 *
 * IMPORTANT: pdf.js TRANSFERS the buffer it is given to its worker, which
 * DETACHES the caller's ArrayBuffer — afterwards `data.byteLength` is 0. Every
 * later consumer of the same bytes (pdf-lib, the raw-bytes fingerprint for
 * scans, pdfium) would silently see an empty file. So the extractor works on
 * a private copy and never touches the caller's buffer. (This was the cause of
 * the first live long-book failure: "No PDF header found" from pdf-lib.)
 */
export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const copy = data.slice();
  const pdf = await getDocumentProxy(copy);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t) => (t ?? "").replace(/[ \t]+/g, " ").trim());
}
