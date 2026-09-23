import {
  rebuildScanAsSearchablePdf,
  rebuildImageAsSearchablePdf,
  type RebuildProgress,
} from "./pdf-ocr-rebuild";
import {
  createRebuiltScriptUploadUrl,
  finalizeRebuiltScript,
} from "@/features/scripts/ocr-actions";
import { uploadFileToSignedUrl } from "./storage-upload";

export type { RebuildProgress };

/**
 * Rebuild a scanned script into a searchable PDF (PDFium/image + OCR, in the
 * browser), upload it straight to storage, and install it as the production's
 * default script. Accepts a scanned PDF or a single image (JPEG/PNG/WebP).
 * Shared by the upload-time prompt and the in-viewer "Make searchable" offer.
 */
export async function installSearchableScript(opts: {
  productionId: string;
  file: File;
  baseName: string;
  title: string;
  onProgress?: (p: RebuildProgress) => void;
  signal?: { cancelled: boolean };
  /** The scan being rebuilt, so the rebuild inherits its applied analysis. */
  sourceDocumentId?: string;
}): Promise<{ error?: string; cancelled?: boolean }> {
  const { productionId, file, baseName, title, onProgress, signal, sourceDocumentId } = opts;

  const blob = file.type.startsWith("image/")
    ? await rebuildImageAsSearchablePdf(file, { onProgress, signal })
    : await rebuildScanAsSearchablePdf(await file.arrayBuffer(), {
        onProgress,
        signal,
      });
  if (signal?.cancelled) return { cancelled: true };

  const outName = `${baseName.replace(/\.pdf$/i, "")}-searchable.pdf`;
  const signed = await createRebuiltScriptUploadUrl({
    productionId,
    fileName: outName,
  });
  if (signed.error || !signed.path || !signed.token) {
    return { error: signed.error || "Upload could not start." };
  }

  const outFile = new File([blob], outName, { type: "application/pdf" });
  const up = await uploadFileToSignedUrl(signed.path, signed.token, outFile);
  if (up.error) return { error: up.error };

  const fin = await finalizeRebuiltScript({
    productionId,
    storagePath: signed.path,
    title: title ? `${title} (searchable)` : "Script (searchable)",
    fileName: outName,
    fileSize: blob.size,
    sourceDocumentId,
  });
  if (fin.error) return { error: fin.error };

  return {};
}
