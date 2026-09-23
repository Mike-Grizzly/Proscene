"use client";

import { useCallback, useRef, useState } from "react";
import type { RebuildProgress } from "@/lib/pdf-ocr-rebuild";
import { installSearchableScript } from "@/lib/install-searchable-script";

export type RebuildStatus =
  | "idle"
  | "running" // rendering + OCR'ing pages
  | "uploading" // assembled, sending to storage + finalizing
  | "done"
  | "failed";

interface Args {
  productionId: string;
  pdfUrl: string;
  title: string;
  fileName: string;
  /** The scan being rebuilt (its applied analysis carries over). */
  sourceDocumentId?: string;
}

/**
 * Rebuilds the current (unrenderable) scan into a searchable PDF in the browser
 * and installs it as the production's new default script. The page should
 * `router.refresh()` on `done` to pick up the new file.
 */
export function useScriptRebuild({ productionId, pdfUrl, title, fileName, sourceDocumentId }: Args) {
  const [status, setStatus] = useState<RebuildStatus>("idle");
  const [progress, setProgress] = useState<RebuildProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const cancel = useCallback(() => {
    cancelRef.current.cancelled = true;
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setProgress(null);
    cancelRef.current = { cancelled: false };
    setStatus("running");
    try {
      const blob = await (await fetch(pdfUrl)).blob();
      const file = new File([blob], fileName || "script.pdf", {
        type: "application/pdf",
      });
      const res = await installSearchableScript({
        productionId,
        file,
        baseName: fileName || "script",
        title,
        sourceDocumentId,
        onProgress: (p) => {
          // The hook surfaces "uploading" once page work is done.
          setProgress(p);
        },
        signal: cancelRef.current,
      });
      if (res.cancelled || cancelRef.current.cancelled) {
        setStatus("idle");
        return;
      }
      if (res.error) throw new Error(res.error);
      setStatus("done");
    } catch (e) {
      if (cancelRef.current.cancelled) {
        setStatus("idle");
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("failed");
    }
  }, [productionId, pdfUrl, title, fileName, sourceDocumentId]);

  return { status, progress, error, run, cancel };
}
