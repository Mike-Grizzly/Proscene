import "server-only";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  documents,
  scriptAnnotations,
  scriptParses,
  scriptPreferences,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractPdfPages } from "./pdf-text";
import { loadPdf, buildImagePdf } from "./pdf-split";
import { openWithPdfium, type RasterPage } from "./pdf-raster";
import {
  decideReadableCopy,
  profileImages,
  profileImagesFromBytes,
  type ImageProfile,
} from "./readable-detect";

/**
 * Readable copies of unrenderable scans, made automatically at upload.
 *
 * pdf.js — the in-app Script tool's engine — draws 1-bit CCITT / JBIG2
 * ImageMask scans as blank pages, so the viewer used to fall back to the native
 * PDF viewer (no tools) until someone ran the manual, in-browser "Make
 * searchable" rebuild. Now every script entry point calls
 * `scheduleReadableCopy`: in the background (`after()`), the file is checked
 * and, when it's that kind of scan, pdfium renders every page to a compact
 * PNG (1-bit for black-and-white scans, ~23 KB/page) and pdf-lib assembles a
 * new PDF that pdf.js renders. The copy replaces the original as the script
 * everyone opens (default + personal choices + any analysis / bookmarks follow
 * it); the original stays in Documents, non-default. "Make searchable" remains
 * the manual fallback (and the way to get a text layer).
 */

const SCANNED_TEXT_THRESHOLD = 200;
const ONE_BIT_SCALE = 3.0; // ≈ 216 dpi on US Letter — same as the browser rebuild
const GRAY_SCALE = 2.0;

/** Mark the document pending and render its readable copy after the response. */
export async function scheduleReadableCopy(documentId: string): Promise<void> {
  await db
    .update(documents)
    .set({ renderStatus: "pending" })
    .where(eq(documents.id, documentId));
  after(() => installReadableCopy(documentId));
}

async function setRenderStatus(documentId: string, status: string): Promise<void> {
  await db.update(documents).set({ renderStatus: status }).where(eq(documents.id, documentId));
}

/** Never throws: the document's render_status is the record. */
export async function installReadableCopy(documentId: string): Promise<void> {
  const [doc] = await db
    .select({
      id: documents.id,
      productionId: documents.productionId,
      uploadedBy: documents.uploadedBy,
      folderId: documents.folderId,
      title: documents.title,
      fileName: documents.fileName,
      contentType: documents.contentType,
      storagePath: documents.storagePath,
      documentType: documents.documentType,
      isDefaultScript: documents.isDefaultScript,
      scriptKind: documents.scriptKind,
      sourceDocumentId: documents.sourceDocumentId,
      pageCount: documents.pageCount,
      processingStatus: documents.processingStatus,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return;

  let raster: Awaited<ReturnType<typeof openWithPdfium>> | null = null;
  try {
    if (doc.deletedAt || doc.documentType !== "script" || doc.contentType !== "application/pdf") {
      await setRenderStatus(doc.id, "skipped");
      return;
    }

    const supabase = createSupabaseAdminClient();
    const { data: blob, error } = await supabase.storage
      .from("attachments")
      .download(doc.storagePath);
    if (error || !blob) throw new Error(error?.message ?? "download failed");
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Scan? (no text layer) — extractor works on a copy, our bytes stay intact.
    const pages = await extractPdfPages(bytes);
    const isScanned = pages.join("\n").trim().length < SCANNED_TEXT_THRESHOLD;

    let profile: ImageProfile;
    try {
      profile = profileImages(await loadPdf(bytes));
    } catch {
      profile = profileImagesFromBytes(bytes);
    }
    const decision = decideReadableCopy(isScanned, profile);
    if (!decision.needed) {
      await setRenderStatus(doc.id, "skipped");
      return;
    }

    raster = await openWithPdfium(bytes);
    const rendered: RasterPage[] = [];
    for (let p = 1; p <= raster.pageCount; p++) {
      rendered.push(
        await raster.renderPage(p, {
          scale: decision.mode === "1bit" ? ONE_BIT_SCALE : GRAY_SCALE,
          gray: true,
          oneBit: decision.mode === "1bit",
        }),
      );
    }
    const pdfBytes = await buildImagePdf(rendered);

    const safeBase =
      doc.fileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "script";
    const storagePath = `documents/${doc.productionId}/${Date.now()}-${safeBase}-readable.pdf`;
    const up = await supabase.storage
      .from("attachments")
      .upload(storagePath, Buffer.from(pdfBytes), { contentType: "application/pdf" });
    if (up.error) throw new Error(up.error.message);

    await db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(documents)
        .values({
          productionId: doc.productionId,
          uploadedBy: doc.uploadedBy,
          folderId: doc.folderId ?? undefined,
          title: `${doc.title} (readable)`,
          fileName: `${safeBase}-readable.pdf`,
          fileSize: pdfBytes.byteLength,
          contentType: "application/pdf",
          storagePath,
          documentType: "script",
          isDefaultScript: doc.isDefaultScript,
          scriptKind: doc.scriptKind,
          // Chain provenance to the ORIGINAL upload.
          sourceDocumentId: doc.sourceDocumentId ?? doc.id,
          pageCount: doc.pageCount ?? rendered.length,
          processingStatus: doc.processingStatus,
          renderStatus: "skipped", // the copy renders fine by construction
        })
        .returning({ id: documents.id });

      // The copy takes over everything that pointed at the original: the
      // default slot, members' choices, analyses (any status — pages are 1:1,
      // an in-flight chunk plan still holds) and annotations/bookmarks.
      await tx
        .update(documents)
        .set({ isDefaultScript: false, renderStatus: "done" })
        .where(eq(documents.id, doc.id));
      await tx
        .update(scriptPreferences)
        .set({ activeScriptId: copy.id, updatedAt: new Date() })
        .where(
          and(
            eq(scriptPreferences.productionId, doc.productionId),
            eq(scriptPreferences.activeScriptId, doc.id),
          ),
        );
      await tx
        .update(scriptParses)
        .set({ documentId: copy.id })
        .where(eq(scriptParses.documentId, doc.id));
      await tx
        .update(scriptAnnotations)
        .set({ scriptId: copy.id })
        .where(eq(scriptAnnotations.scriptId, doc.id));
    });

    try {
      revalidatePath("/productions");
    } catch {
      // Not in a request scope — the pages re-fetch on their own poll.
    }
  } catch (err) {
    console.error("installReadableCopy failed:", err);
    await setRenderStatus(doc.id, "failed").catch(() => {});
  } finally {
    raster?.destroy();
  }
}
