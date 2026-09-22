"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestDocumentUpload,
  finalizeDocumentUpload,
} from "@/features/documents/actions";
import { setProductionDefaultScript, startScriptParse } from "@/features/scripts/actions";
import { uploadFileToSignedUrl } from "@/lib/storage-upload";

/**
 * Script empty-state for Focus View: lets an upload-capable user (incl. the
 * Creative role) drop in a PDF, set it as the production's default script, and
 * optionally kick off AI analysis — without leaving for the Documents tab.
 */
export function FocusScriptUpload({
  productionId,
  slug,
}: {
  productionId: string;
  slug: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analyze, setAnalyze] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(f: File | null) {
    setError(null);
    if (f && f.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  function upload() {
    if (!file) {
      setError("Choose a script PDF first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      setStage("Uploading…");
      const signed = await requestDocumentUpload(
        productionId,
        file.name,
        file.type,
        file.size,
      );
      if (signed.error || !signed.path || !signed.token) {
        setError(signed.error ?? "Could not start upload.");
        setStage(null);
        return;
      }
      const up = await uploadFileToSignedUrl(signed.path, signed.token, file);
      if (up.error) {
        setError(up.error);
        setStage(null);
        return;
      }
      const title = file.name.replace(/\.pdf$/i, "").trim() || "Script";
      const fin = await finalizeDocumentUpload({
        productionId,
        storagePath: signed.path,
        title,
        folderId: null,
        documentType: "script",
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      if (fin.error || !fin.documentId) {
        setError(fin.error ?? "Upload could not be completed.");
        setStage(null);
        return;
      }

      setStage("Setting as default script…");
      const fd = new FormData();
      fd.set("document_id", fin.documentId);
      fd.set("production_id", productionId);
      // First script for this production: plain default assignment (no
      // version bump / stale flag — there is nothing to mark stale).
      const def = await setProductionDefaultScript(productionId, fin.documentId);
      if (def.error) {
        setError(def.error);
        setStage(null);
        return;
      }

      if (analyze) {
        setStage("Starting AI analysis…");
        const res = await startScriptParse(fd);
        if (!res.error && res.parseId) {
          // Kick the background run, then hand off to the in-focus review.
          fetch(`/api/scripts/${res.parseId}/run`, { method: "POST" }).catch(
            () => {},
          );
          router.push(`/focus/${slug}?mode=script&view=ai`);
          return;
        }
        // Analysis couldn't start (e.g. a cost cap) — keep the uploaded script
        // and just drop the user into the editor with a note.
        setError(res.error ?? "Script uploaded; AI analysis could not start.");
      }
      router.refresh();
    });
  }

  return (
    <div className="fx-upload">
      <div className="fx-upload-card">
        <h2>Upload your script</h2>
        <p>
          Add a PDF script for this production. It becomes the default script
          everyone annotates.
        </p>

        <label
          className="fx-drop"
          data-has={file ? "1" : undefined}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <span className="fx-drop-title">
            {file ? file.name : "Choose a PDF or drop it here"}
          </span>
          <span className="fx-drop-sub">
            {file ? "Click to choose a different file" : "PDF, up to 64MB"}
          </span>
        </label>

        <label className="fx-upload-opt">
          <input
            type="checkbox"
            checked={analyze}
            onChange={(e) => setAnalyze(e.target.checked)}
          />
          <span>
            Analyze with AI after upload
            <em>Detect roles, scenes &amp; bookmarks (you review before applying)</em>
          </span>
        </label>

        {error && <p className="fx-upload-err">{error}</p>}

        <button
          type="button"
          className="btn primary"
          onClick={upload}
          disabled={pending || !file}
        >
          {pending ? (stage ?? "Working…") : "Upload script"}
        </button>
      </div>
    </div>
  );
}
