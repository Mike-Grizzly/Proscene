import { db } from "@/db";
import {
  documents,
  scriptAnnotations,
  scriptParses,
  scriptPreferences,
  profiles,
} from "@/db/schema";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  PARSE_LIMIT_PER_PRODUCTION,
  PARSE_WINDOW_DAYS,
  countsTowardQuota,
} from "./constants";

const scriptSelect = {
  id: documents.id,
  title: documents.title,
  fileName: documents.fileName,
  contentType: documents.contentType,
  storagePath: documents.storagePath,
  scriptVersion: documents.scriptVersion,
  processingStatus: documents.processingStatus,
  scriptKind: documents.scriptKind,
  pageCount: documents.pageCount,
  renderStatus: documents.renderStatus,
  uploadedByFirstName: profiles.firstName,
  uploadedByLastName: profiles.lastName,
};

/** The production-wide default script (managers set it), or null. */
export async function getDefaultScript(productionId: string) {
  const rows = await db
    .select(scriptSelect)
    .from(documents)
    .innerJoin(profiles, eq(documents.uploadedBy, profiles.id))
    .where(
      and(
        eq(documents.productionId, productionId),
        eq(documents.isDefaultScript, true),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The script THIS member is viewing: their own choice (`script_preferences`)
 * when it still points at a live script of this production, otherwise the
 * production default. A deleted or moved document silently falls back.
 */
export async function getActiveScript(productionId: string, userId: string) {
  const [pref] = await db
    .select({ activeScriptId: scriptPreferences.activeScriptId })
    .from(scriptPreferences)
    .where(
      and(
        eq(scriptPreferences.userId, userId),
        eq(scriptPreferences.productionId, productionId),
      ),
    )
    .limit(1);

  if (pref?.activeScriptId) {
    const rows = await db
      .select(scriptSelect)
      .from(documents)
      .innerJoin(profiles, eq(documents.uploadedBy, profiles.id))
      .where(
        and(
          eq(documents.id, pref.activeScriptId),
          eq(documents.productionId, productionId),
          eq(documents.documentType, "script"),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return getDefaultScript(productionId);
}

/** Every live script-type document of a production, default first. */
export async function getScriptDocuments(productionId: string) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      scriptKind: documents.scriptKind,
      isDefaultScript: documents.isDefaultScript,
      pageCount: documents.pageCount,
      processingStatus: documents.processingStatus,
      sourceDocumentId: documents.sourceDocumentId,
      scriptVersion: documents.scriptVersion,
      renderStatus: documents.renderStatus,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.productionId, productionId),
        eq(documents.documentType, "script"),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.isDefaultScript), desc(documents.createdAt));
}

export type ScriptDocumentOption = Awaited<ReturnType<typeof getScriptDocuments>>[number];

export async function getScriptAnnotations(scriptId: string, userId: string) {
  const rows = await db
    .select()
    .from(scriptAnnotations)
    .where(
      and(
        eq(scriptAnnotations.scriptId, scriptId),
        eq(scriptAnnotations.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Most recent AI analysis for a production (any status), for the review page.
 * With `documentId`, the most recent analysis of THAT script document — a
 * split book has one per half.
 */
export async function getLatestScriptParse(productionId: string, documentId?: string) {
  const rows = await db
    .select({
      id: scriptParses.id,
      documentId: scriptParses.documentId,
      status: scriptParses.status,
      result: scriptParses.result,
      error: scriptParses.error,
      progress: scriptParses.progress,
      pageCount: scriptParses.pageCount,
      inputTokens: scriptParses.inputTokens,
      outputTokens: scriptParses.outputTokens,
      createdAt: scriptParses.createdAt,
      updatedAt: scriptParses.updatedAt,
      leaseExpiresAt: scriptParses.leaseExpiresAt,
      documentTitle: documents.title,
      documentScriptKind: documents.scriptKind,
    })
    .from(scriptParses)
    .innerJoin(documents, eq(scriptParses.documentId, documents.id))
    .where(
      documentId
        ? and(eq(scriptParses.productionId, productionId), eq(scriptParses.documentId, documentId))
        : eq(scriptParses.productionId, productionId),
    )
    .orderBy(desc(scriptParses.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

export type LatestScriptParse = NonNullable<
  Awaited<ReturnType<typeof getLatestScriptParse>>
>;

/**
 * The review page's script picker: every script document with the status of
 * its latest analysis, so the user can see which halves are analysed and
 * start the other.
 */
export async function getScriptParseTargets(productionId: string) {
  const [docs, parses] = await Promise.all([
    getScriptDocuments(productionId),
    db
      .select({
        id: scriptParses.id,
        documentId: scriptParses.documentId,
        status: scriptParses.status,
        createdAt: scriptParses.createdAt,
      })
      .from(scriptParses)
      .where(eq(scriptParses.productionId, productionId))
      .orderBy(desc(scriptParses.createdAt)),
  ]);
  const latestByDoc = new Map<string, { id: string; status: string }>();
  for (const p of parses) {
    if (p.documentId && !latestByDoc.has(p.documentId)) {
      latestByDoc.set(p.documentId, { id: p.id, status: p.status });
    }
  }
  return docs.map((d) => ({
    documentId: d.id,
    title: d.title,
    scriptKind: d.scriptKind,
    isDefaultScript: d.isDefaultScript,
    pageCount: d.pageCount,
    latestParse: latestByDoc.get(d.id) ?? null,
  }));
}

export type ScriptParseTarget = Awaited<ReturnType<typeof getScriptParseTargets>>[number];

/**
 * AI-analysis quota for a production: how many parses have been used in the
 * rolling window and how many remain. Mirrors the cap enforced in
 * `checkParseQuota` (failed-before-the-model rows and split-detection rows
 * are free, so excluded).
 */
export async function getProductionParseUsage(productionId: string) {
  const since = new Date(Date.now() - PARSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ status: scriptParses.status, progress: scriptParses.progress })
    .from(scriptParses)
    .where(
      and(
        eq(scriptParses.productionId, productionId),
        gte(scriptParses.createdAt, since),
      ),
    );
  const used = recent.filter(
    (r) =>
      countsTowardQuota(r.status) &&
      !(r.progress as { clonedFrom?: string } | null)?.clonedFrom,
  ).length;
  return {
    used,
    limit: PARSE_LIMIT_PER_PRODUCTION,
    remaining: Math.max(0, PARSE_LIMIT_PER_PRODUCTION - used),
    windowDays: PARSE_WINDOW_DAYS,
  };
}

export type DefaultScript = NonNullable<Awaited<ReturnType<typeof getDefaultScript>>>;
export type ScriptAnnotationRow = NonNullable<Awaited<ReturnType<typeof getScriptAnnotations>>>;
