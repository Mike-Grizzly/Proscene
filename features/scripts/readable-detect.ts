import type { PDFDocument } from "pdf-lib";

/**
 * Which scans the in-app viewer (pdf.js) can't draw. pdf.js renders 1-bit
 * ImageMask / CCITT / JBIG2 scans as blank pages (the "MRC/CCITT ImageMask
 * scripts" case the viewer already special-cases at render time); JPEG /
 * 8-bit scans render fine. Pure module so the classification is testable.
 */
export type ImageProfile = {
  images: number;
  oneBit: number;
  other: number;
};

const ONE_BIT_FILTERS = ["CCITTFaxDecode", "JBIG2Decode"];

/** Count the image XObjects in a pdf-lib document by bit depth. */
export function profileImages(doc: PDFDocument): ImageProfile {
  const profile: ImageProfile = { images: 0, oneBit: 0, other: 0 };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = (obj as { dict?: unknown }).dict as
      | { get?: (k: unknown) => unknown; lookup?: (k: unknown) => unknown }
      | undefined;
    if (!dict || typeof dict.lookup !== "function") continue;
    const text = String(dict);
    if (!/\/Subtype\s*\/Image\b/.test(text)) continue;
    profile.images += 1;
    const bpc = /\/BitsPerComponent\s+(\d+)/.exec(text);
    const isMask = /\/ImageMask\s+true/.test(text);
    const filter = ONE_BIT_FILTERS.some((f) => text.includes(`/${f}`));
    if (isMask || filter || (bpc && bpc[1] === "1")) profile.oneBit += 1;
    else profile.other += 1;
  }
  return profile;
}

/** Fallback when pdf-lib can't parse the file: look at the raw bytes. */
export function profileImagesFromBytes(bytes: Uint8Array): ImageProfile {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const images = (text.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
  const oneBit =
    (text.match(/\/ImageMask\s+true/g) ?? []).length +
    (text.match(/\/CCITTFaxDecode\b/g) ?? []).length +
    (text.match(/\/JBIG2Decode\b/g) ?? []).length;
  return { images, oneBit: Math.min(images, oneBit), other: Math.max(0, images - Math.min(images, oneBit)) };
}

export type ReadableDecision =
  | { needed: false; reason: "text" | "no-images" | "renders-fine" }
  | { needed: true; mode: "1bit" | "gray" };

/**
 * Decide whether a script needs a readable copy and how to render it:
 * a scan (no text layer) whose images are 1-bit → bilevel render; a scan
 * that mixes 1-bit masks with other images (MRC) → 8-bit gray render.
 */
export function decideReadableCopy(isScanned: boolean, profile: ImageProfile): ReadableDecision {
  if (!isScanned) return { needed: false, reason: "text" };
  if (profile.images === 0) return { needed: false, reason: "no-images" };
  if (profile.oneBit === 0) return { needed: false, reason: "renders-fine" };
  return { needed: true, mode: profile.other === 0 ? "1bit" : "gray" };
}
