import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProductionBySlug } from "@/features/productions/queries";
import {
  getProductionMembers,
  getProductionMembership,
} from "@/features/members/queries";
import {
  getDocumentsByProduction,
  getFoldersByProduction,
} from "@/features/documents/queries";
import { getPinnedItemIds } from "@/features/pins/queries";
import { canViewFolder } from "@/features/documents/constants";
import { DocumentsClient } from "./documents-client";

// Script uploads finalise here and may render a readable copy of a scan in
// the background (about a minute for a full book).
export const maxDuration = 300;

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const [{ slug }, { doc: initialDocId }] = await Promise.all([
    params,
    searchParams,
  ]);
  const user = await requireCurrentUser();
  const production = await getProductionBySlug(user.organizationId, slug);

  if (!production) {
    notFound();
  }

  const canManage = can(user.role, "productions:manage");
  const membership = await getProductionMembership(user.id, production.id);
  if (!canManage && !membership) {
    redirect("/productions");
  }
  // Folder visibility keys off the viewer's production role (managers see all).
  const viewerRole = membership?.role ?? null;

  const [documents, folders, members, pinnedDocIds] = await Promise.all([
    getDocumentsByProduction(production.id),
    getFoldersByProduction(production.id),
    getProductionMembers(production.id),
    getPinnedItemIds(user.id, "document"),
  ]);

  // Hide restricted folders the viewer can't see, and any documents filed in
  // them. Unfiled documents (no folder) stay visible to all members.
  const visibleFolders = folders.filter((f) =>
    canViewFolder(f, viewerRole, canManage),
  );
  const visibleFolderIds = new Set(visibleFolders.map((f) => f.id));
  const visibleDocuments = documents.filter(
    (d) => !d.folderId || visibleFolderIds.has(d.folderId),
  );

  const canUpload = can(user.role, "documents:upload");

  return (
    <DocumentsClient
      documents={visibleDocuments}
      folders={visibleFolders}
      members={members}
      productionId={production.id}
      productionTitle={production.title}
      slug={slug}
      canUpload={canUpload}
      initialDocId={initialDocId}
      pinnedDocIds={pinnedDocIds}
    />
  );
}
