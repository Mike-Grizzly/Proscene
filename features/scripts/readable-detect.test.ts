import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { decideReadableCopy, profileImages, profileImagesFromBytes } from "./readable-detect";

async function oneBitScanPdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  // A 8×8 1-bit ImageMask XObject, the shape pdf.js renders blank.
  const stream = doc.context.stream(new Uint8Array(8).fill(0xaa), {
    Type: "XObject",
    Subtype: "Image",
    Width: 8,
    Height: 8,
    ImageMask: true,
    BitsPerComponent: 1,
  });
  const ref = doc.context.register(stream);
  page.node.setXObject(PDFName.of("Im0"), ref);
  return doc;
}

describe("readable-detect", () => {
  it("flags a 1-bit ImageMask scan for a bilevel copy", async () => {
    const doc = await oneBitScanPdf();
    const profile = profileImages(doc);
    expect(profile).toEqual({ images: 1, oneBit: 1, other: 0 });
    expect(decideReadableCopy(true, profile)).toEqual({ needed: true, mode: "1bit" });
    const bytes = await doc.save({ useObjectStreams: false });
    expect(profileImagesFromBytes(bytes).oneBit).toBe(1);
  });
  it("leaves text PDFs and image-free files alone", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("ACT ONE", { x: 40, y: 700, font, size: 18 });
    expect(decideReadableCopy(false, profileImages(doc))).toEqual({ needed: false, reason: "text" });
    expect(decideReadableCopy(true, { images: 0, oneBit: 0, other: 0 })).toEqual({ needed: false, reason: "no-images" });
  });
  it("uses a gray render for mixed (MRC) scans and skips JPEG-only scans", () => {
    expect(decideReadableCopy(true, { images: 4, oneBit: 2, other: 2 })).toEqual({ needed: true, mode: "gray" });
    expect(decideReadableCopy(true, { images: 4, oneBit: 0, other: 4 })).toEqual({ needed: false, reason: "renders-fine" });
  });
});
