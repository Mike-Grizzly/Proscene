import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfPages } from "./pdf-text";

describe("extractPdfPages", () => {
  it("extracts per-page text WITHOUT detaching the caller's buffer", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("ACT ONE Scene 1", { x: 40, y: 700, font, size: 18 });
    doc.addPage().drawText("No. 3 Poor Wandering One", { x: 40, y: 700, font, size: 18 });
    const bytes = await doc.save();
    const before = bytes.byteLength;

    const pages = await extractPdfPages(bytes);

    expect(pages.length).toBe(2);
    expect(pages[0]).toContain("ACT ONE");
    expect(pages[1]).toContain("Poor Wandering One");
    // pdf.js transfers (detaches) the buffer it is handed; the extractor must
    // work on a copy so pdf-lib / fingerprinting / pdfium can still read it.
    expect(bytes.byteLength).toBe(before);
    expect((bytes.buffer as ArrayBuffer).detached).toBe(false);
    await expect(PDFDocument.load(bytes)).resolves.toBeTruthy();
  });
});
