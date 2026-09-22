import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { encodePng } from "./png-encode";

describe("encodePng", () => {
  it("produces a grayscale PNG that pdf-lib can embed", async () => {
    const w = 8, h = 4;
    const gray = new Uint8Array(w * h).map((_, i) => (i % 2 ? 255 : 0));
    const png = encodePng(gray, w, h, 1);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
  });
  it("converts BGRA input to an RGB PNG", async () => {
    const w = 3, h = 2;
    const bgra = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { bgra[i * 4] = 10; bgra[i * 4 + 1] = 20; bgra[i * 4 + 2] = 30; bgra[i * 4 + 3] = 255; }
    const png = encodePng(bgra, w, h, 4);
    // IHDR colour type byte (offset 8+4+4+9 = 25) must be 2 (RGB)
    expect(png[25]).toBe(2);
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    expect([img.width, img.height]).toEqual([w, h]);
  });
  it("rejects undersized bitmaps", () => {
    expect(() => encodePng(new Uint8Array(3), 2, 2, 1)).toThrow();
  });
});
