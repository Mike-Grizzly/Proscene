"use client";

import { SCRIPT_KIND_LABELS, isScriptKind } from "@/features/scripts/constants";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  File,
  Upload as UploadIcon,
  List as ListIcon,
  Grid2X2,
  FolderPlus,
  Folder,
  Lock,
  Pencil,
} from "lucide-react";
import { deleteDocument } from "@/features/documents/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentUploadForm } from "./document-upload-form";
import { DocumentRowMenu } from "./document-row-menu";
import { DocumentDrawer } from "./document-drawer";
import { FolderSelect } from "./folder-select";
import { FolderEditor } from "./folder-editor";
import { ROLE_LABELS } from "@/features/documents/constants";
import type { Role } from "@/types/roles";
import type {
  DocumentWithUploader,
  DocumentFolder,
} from "@/features/documents/queries";
import type { ProductionMember } from "@/features/members/queries";

const PALETTE = ["clay", "sage", "plum", "amber", "dusk"] as const;
function folderColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStorageSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  documents: DocumentWithUploader[];
  folders: DocumentFolder[];
  members: ProductionMember[];
  productionId: string;
  productionTitle: string;
  slug: string;
  canUpload: boolean;
  initialDocId?: string;
  pinnedDocIds: string[];
}

const ALL_FILES = "All files";
const UNFILED = "__unfiled__";
const REMOVE_MS = 200;

export function DocumentsClient({
  documents,
  folders,
  members,
  productionId,
  productionTitle,
  slug,
  canUpload,
  initialDocId,
  pinnedDocIds,
}: Props) {
  const router = useRouter();
  const [, startDeleteTransition] = useTransition();
  // Docs animating out before their server delete + refresh lands.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [activeFolder, setActiveFolder] = useState(ALL_FILES);
  const [view, setView] = useState<"list" | "grid">("list");
  const [openDoc, setOpenDoc] = useState<DocumentWithUploader | null>(() =>
    initialDocId ? (documents.find((d) => d.id === initialDocId) ?? null) : null,
  );
  const [showUpload, setShowUpload] = useState(false);
  // null = closed; { folder } open for edit; {} open for create.
  const [folderEditor, setFolderEditor] = useState<{
    folder?: DocumentFolder;
  } | null>(null);

  const activeFolderObj = folders.find((f) => f.name === activeFolder);

  const visible =
    activeFolder === ALL_FILES
      ? documents
      : activeFolder === UNFILED
        ? documents.filter((d) => !d.folderId)
        : documents.filter((d) => {
            const f = folders.find((f) => f.name === activeFolder);
            return f && d.folderId === f.id;
          });

  const unfiledCount = documents.filter((d) => !d.folderId).length;
  const totalBytes = documents.reduce((sum, d) => sum + d.fileSize, 0);
  const limitGb = 10;
  const pct = Math.min(100, (totalBytes / (limitGb * 1024 ** 3)) * 100);

  // Animate the row/card out, then delete + refresh (which removes it from
  // props). The id stays in `removingIds` after that — harmless, since the row
  // unmounts — and avoids an un-collapse flicker if the refresh lags.
  function requestDelete(id: string) {
    setRemovingIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      const fd = new FormData();
      fd.set("document_id", id);
      startDeleteTransition(async () => {
        await deleteDocument(fd);
        router.refresh();
      });
    }, REMOVE_MS);
  }

  return (
    <>
      <div
        className="anim-in docs-shell"
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          gap: 20,
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        {/* ── Folder rail ── */}
        <div className="docs-folders">
          <div className="h-eyebrow" style={{ marginBottom: 10 }}>
            Folders
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <FolderRailItem
              name={ALL_FILES}
              count={documents.length}
              active={activeFolder === ALL_FILES}
              onClick={() => setActiveFolder(ALL_FILES)}
            />
            {folders.map((f) => {
              const count = documents.filter((d) => d.folderId === f.id).length;
              return (
                <FolderRailItem
                  key={f.id}
                  name={f.name}
                  count={count}
                  active={activeFolder === f.name}
                  restricted={f.visibility === "restricted"}
                  onClick={() => setActiveFolder(f.name)}
                  onEdit={canUpload ? () => setFolderEditor({ folder: f }) : undefined}
                />
              );
            })}
            {unfiledCount > 0 && (
              <FolderRailItem
                name="Unfiled"
                count={unfiledCount}
                active={activeFolder === UNFILED}
                onClick={() => setActiveFolder(UNFILED)}
              />
            )}
          </div>

          {canUpload && (
            <div style={{ marginTop: 6 }}>
              <button
                className="btn ghost"
                onClick={() => setFolderEditor({})}
                style={{
                  marginTop: 10,
                  height: 28,
                  padding: "0 10px",
                  fontSize: 12,
                  width: "100%",
                  justifyContent: "flex-start",
                  gap: 6,
                }}
              >
                <FolderPlus size={13} />
                <span>New folder</span>
              </button>
            </div>
          )}

          <div className="h-eyebrow" style={{ marginTop: 24, marginBottom: 10 }}>
            Storage
          </div>
          <div
            style={{
              padding: "12px 14px",
              background: "var(--bg-sunken)",
              borderRadius: "var(--radius-s)",
            }}
          >
            <div
              className="row-between"
              style={{ fontSize: 12, marginBottom: 6 }}
            >
              <span style={{ fontWeight: 500 }}>
                {formatStorageSize(totalBytes)}
              </span>
              <span style={{ color: "var(--ink-3)" }}>of {limitGb} GB</span>
            </div>
            <div
              style={{
                height: 4,
                background: "var(--bg)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: "var(--accent)",
                  minWidth: pct > 0 ? 4 : 0,
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Main area ── */}
        <div
          className="docs-main"
          style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}
        >
          {/* Header */}
          <div className="row-between">
            <div>
              <h2 className="h-section">
                {activeFolder === UNFILED ? "Unfiled" : activeFolder}
              </h2>
              <div
                style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}
              >
                {visible.length} {visible.length === 1 ? "file" : "files"} ·{" "}
                {activeFolderObj?.visibility === "restricted" ? (
                  <span
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Lock size={11} />
                    visible to{" "}
                    {(activeFolderObj.allowedRoles ?? [])
                      .map((r) => ROLE_LABELS[r as Role] ?? r)
                      .join(", ") || "managers only"}
                  </span>
                ) : (
                  <>shared with {productionTitle} team</>
                )}
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setView("list")}
                  className="btn ghost btn-icon"
                  style={{
                    borderRadius: 0,
                    height: 30,
                    width: 32,
                    background:
                      view === "list" ? "var(--bg-sunken)" : "transparent",
                  }}
                  title="List view"
                >
                  <ListIcon size={14} />
                </button>
                <button
                  onClick={() => setView("grid")}
                  className="btn ghost btn-icon"
                  style={{
                    borderRadius: 0,
                    height: 30,
                    width: 32,
                    background:
                      view === "grid" ? "var(--bg-sunken)" : "transparent",
                  }}
                  title="Grid view"
                >
                  <Grid2X2 size={14} />
                </button>
              </div>
              {canUpload && (
                <button
                  className={showUpload ? "btn primary" : "btn"}
                  onClick={() => setShowUpload((s) => !s)}
                  style={{ gap: 6 }}
                >
                  <UploadIcon size={14} />
                  <span>Upload</span>
                </button>
              )}
            </div>
          </div>

          {/* Upload form */}
          {canUpload && showUpload && (
            <div className="card card-pad anim-in">
              <DocumentUploadForm productionId={productionId} folders={folders} />
            </div>
          )}

          {/* Empty state */}
          {visible.length === 0 ? (
            <EmptyState
              icon="File"
              title="No documents yet"
              hint={
                canUpload
                  ? "Upload scripts, schedules, and other production files."
                  : "No documents have been uploaded yet."
              }
            />
          ) : view === "list" ? (
            /* ── List view ── */
            <div className="card" style={{ overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: canUpload
                    ? "40px 1fr 150px 130px 130px 40px"
                    : "40px 1fr 150px 130px 130px",
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                <span />
                <span>Name</span>
                <span>Folder</span>
                <span>Uploaded by</span>
                <span>Date</span>
                {canUpload && <span />}
              </div>
              {visible.map((doc) => {
                const color = doc.folderName
                  ? folderColor(doc.folderName)
                  : "";
                const isRemoving = removingIds.has(doc.id);
                const uploaderName =
                  doc.uploadedByFirstName || doc.uploadedByLastName
                    ? `${doc.uploadedByFirstName ?? ""} ${doc.uploadedByLastName ?? ""}`.trim()
                    : doc.uploadedByEmail;

                return (
                  <div
                    key={doc.id}
                    onClick={() => setOpenDoc(doc)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: canUpload
                        ? "40px 1fr 150px 130px 130px 40px"
                        : "40px 1fr 150px 130px 130px",
                      padding: isRemoving ? "0 16px" : "12px 16px",
                      borderBottom: isRemoving
                        ? "1px solid transparent"
                        : "1px solid var(--border)",
                      alignItems: "center",
                      fontSize: 13,
                      cursor: "pointer",
                      maxHeight: isRemoving ? 0 : 200,
                      opacity: isRemoving ? 0 : 1,
                      transform: isRemoving ? "translateX(24px)" : "none",
                      overflow: "hidden",
                      pointerEvents: isRemoving ? "none" : "auto",
                      transition:
                        "background .1s, max-height .2s ease, opacity .2s ease, transform .2s ease, padding .2s ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "var(--bg-muted)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "transparent";
                    }}
                  >
                    <div
                      className="notif-ico"
                      data-c={color || undefined}
                      style={{ width: 28, height: 28 }}
                    >
                      <File size={14} strokeWidth={1.5} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {doc.title}
                        </span>
                        {doc.isDefaultScript && (
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: ".04em",
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 999,
                              background: "var(--c-sage-soft)",
                              color: "color-mix(in oklch, var(--c-sage) 60%, var(--ink))",
                            }}
                          >
                            Default Script
                          </span>
                        )}
                        {isScriptKind(doc.scriptKind) && (
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: ".04em",
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 999,
                              background: "var(--bg-muted)",
                              color: "var(--ink-3)",
                            }}
                          >
                            {SCRIPT_KIND_LABELS[doc.scriptKind]}
                          </span>
                        )}
                        {(doc.renderStatus === "done" || doc.renderStatus === "pending") && (
                          <span
                            title={
                              doc.renderStatus === "done"
                                ? "The viewer can't draw this scan directly; a readable copy was made from it."
                                : "A readable copy of this scan is being made in the background."
                            }
                            style={{
                              flexShrink: 0,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: ".04em",
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 999,
                              background: "var(--bg-muted)",
                              color: "var(--ink-3)",
                            }}
                          >
                            {doc.renderStatus === "done" ? "Original scan" : "Preparing readable copy…"}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--ink-3)",
                          marginTop: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {doc.fileName} · {formatFileSize(doc.fileSize)}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <FolderSelect
                        documentId={doc.id}
                        currentFolderId={doc.folderId}
                        folders={folders}
                        stopPropagation
                        canEdit={canUpload}
                      />
                    </div>
                    <span
                      style={{
                        color: "var(--ink-3)",
                        fontSize: 12.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {uploaderName}
                    </span>
                    <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
                      {formatDate(doc.createdAt)}
                    </span>
                    {canUpload && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <DocumentRowMenu
                          documentId={doc.id}
                          fileName={doc.fileName}
                          slug={slug}
                          productionId={productionId}
                          documentType={doc.documentType}
                          isDefaultScript={doc.isDefaultScript}
                          onRequestDelete={requestDelete}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Grid view ── */
            <div className="grid grid-4" style={{ gap: 14 }}>
              {visible.map((doc) => {
                const color = doc.folderName
                  ? folderColor(doc.folderName)
                  : "";
                const isRemoving = removingIds.has(doc.id);

                return (
                  <div
                    key={doc.id}
                    onClick={() => setOpenDoc(doc)}
                    className="card"
                    style={{
                      padding: 0,
                      overflow: "hidden",
                      cursor: "pointer",
                      opacity: isRemoving ? 0 : 1,
                      transform: isRemoving ? "scale(0.92)" : "none",
                      pointerEvents: isRemoving ? "none" : "auto",
                      transition: "opacity .2s ease, transform .2s ease",
                    }}
                  >
                    <div
                      style={{
                        height: 100,
                        background: color
                          ? `var(--c-${color}-soft)`
                          : "var(--bg-sunken)",
                        display: "grid",
                        placeItems: "center",
                        color: color
                          ? `color-mix(in oklch, var(--c-${color}) 55%, var(--ink))`
                          : "var(--ink-4)",
                      }}
                    >
                      <File size={36} strokeWidth={1.2} />
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {doc.title}
                      </div>
                      <div
                        className="row-between"
                        style={{ marginTop: 4 }}
                      >
                        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {doc.folderName ?? "Unfiled"}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {formatFileSize(doc.fileSize)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Document drawer ── */}
      {openDoc && (
        <DocumentDrawer
          doc={openDoc}
          members={members}
          folders={folders}
          initialPinned={pinnedDocIds.includes(openDoc.id)}
          canManage={canUpload}
          onClose={() => setOpenDoc(null)}
        />
      )}

      {/* ── Folder create / edit ── */}
      {folderEditor && (
        <FolderEditor
          productionId={productionId}
          folder={folderEditor.folder}
          onClose={() => setFolderEditor(null)}
        />
      )}
    </>
  );
}

function FolderRailItem({
  name,
  count,
  active,
  onClick,
  restricted = false,
  onEdit,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
  restricted?: boolean;
  onEdit?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 13,
          border: "none",
          textAlign: "left",
          width: "100%",
          background: active || hover ? "var(--bg-elev)" : "transparent",
          boxShadow: active ? "var(--shadow-1)" : "none",
          color: active ? "var(--ink)" : "var(--ink-3)",
          fontWeight: active ? 500 : 400,
        }}
      >
        <Folder size={14} />
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          {restricted && (
            <Lock size={11} style={{ flexShrink: 0, color: "var(--ink-4)" }} />
          )}
        </span>
        {onEdit && hover ? (
          <span style={{ width: 16 }} />
        ) : (
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{count}</span>
        )}
      </button>
      {onEdit && hover && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit folder"
          className="btn-icon"
          style={{
            position: "absolute",
            right: 6,
            width: 22,
            height: 22,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: "var(--ink-3)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
