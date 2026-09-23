import { db } from "@/db";
import { documents, documentFolders, documentComments, profiles } from "@/db/schema";
import { and, eq, desc, asc, isNull, isNotNull, count } from "drizzle-orm";

export async function getFoldersByProduction(productionId: string) {
  return db
    .select({
      id: documentFolders.id,
      name: documentFolders.name,
      sortOrder: documentFolders.sortOrder,
      visibility: documentFolders.visibility,
      allowedRoles: documentFolders.allowedRoles,
    })
    .from(documentFolders)
    .where(eq(documentFolders.productionId, productionId))
    .orderBy(asc(documentFolders.sortOrder), asc(documentFolders.name));
}

export async function getDocumentsByProduction(productionId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      fileName: documents.fileName,
      fileSize: documents.fileSize,
      contentType: documents.contentType,
      storagePath: documents.storagePath,
      folderId: documents.folderId,
      folderName: documentFolders.name,
      documentType: documents.documentType,
      isDefaultScript: documents.isDefaultScript,
      scriptVersion: documents.scriptVersion,
      processingStatus: documents.processingStatus,
      scriptKind: documents.scriptKind,
      sourceDocumentId: documents.sourceDocumentId,
      renderStatus: documents.renderStatus,
      createdAt: documents.createdAt,
      uploadedByFirstName: profiles.firstName,
      uploadedByLastName: profiles.lastName,
      uploadedByEmail: profiles.email,
    })
    .from(documents)
    .innerJoin(profiles, eq(documents.uploadedBy, profiles.id))
    .leftJoin(documentFolders, eq(documents.folderId, documentFolders.id))
    .where(
      and(
        eq(documents.productionId, productionId),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.createdAt));
}

/** Non-deleted document count for a production (tab badges). */
export async function getDocumentCountByProduction(
  productionId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(documents)
    .where(
      and(
        eq(documents.productionId, productionId),
        isNull(documents.deletedAt),
      ),
    );
  return row?.value ?? 0;
}

export async function getDeletedDocumentCountByProduction(
  productionId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(documents)
    .where(
      and(
        eq(documents.productionId, productionId),
        isNotNull(documents.deletedAt),
      ),
    );
  return row?.value ?? 0;
}

export async function getDocumentById(documentId: string) {
  const rows = await db
    .select({
      id: documents.id,
      productionId: documents.productionId,
      title: documents.title,
      fileName: documents.fileName,
      fileSize: documents.fileSize,
      contentType: documents.contentType,
      storagePath: documents.storagePath,
      folderId: documents.folderId,
      folderName: documentFolders.name,
      folderVisibility: documentFolders.visibility,
      folderAllowedRoles: documentFolders.allowedRoles,
      processingStatus: documents.processingStatus,
      createdAt: documents.createdAt,
      uploadedByFirstName: profiles.firstName,
      uploadedByLastName: profiles.lastName,
      uploadedByEmail: profiles.email,
    })
    .from(documents)
    .innerJoin(profiles, eq(documents.uploadedBy, profiles.id))
    .leftJoin(documentFolders, eq(documents.folderId, documentFolders.id))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getDocumentComments(documentId: string) {
  return db
    .select({
      id: documentComments.id,
      body: documentComments.body,
      createdAt: documentComments.createdAt,
      authorId: documentComments.authorId,
      authorFirstName: profiles.firstName,
      authorLastName: profiles.lastName,
      authorEmail: profiles.email,
    })
    .from(documentComments)
    .innerJoin(profiles, eq(documentComments.authorId, profiles.id))
    .where(eq(documentComments.documentId, documentId))
    .orderBy(asc(documentComments.createdAt));
}

export type DocumentFolder = Awaited<
  ReturnType<typeof getFoldersByProduction>
>[number];

export type DocumentWithUploader = Awaited<
  ReturnType<typeof getDocumentsByProduction>
>[number];

export type DocumentCommentRow = Awaited<
  ReturnType<typeof getDocumentComments>
>[number];

export async function getDeletedDocumentsByProduction(productionId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      fileName: documents.fileName,
      fileSize: documents.fileSize,
      contentType: documents.contentType,
      storagePath: documents.storagePath,
      folderName: documentFolders.name,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .leftJoin(documentFolders, eq(documents.folderId, documentFolders.id))
    .where(
      and(
        eq(documents.productionId, productionId),
        isNotNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.deletedAt));
}
