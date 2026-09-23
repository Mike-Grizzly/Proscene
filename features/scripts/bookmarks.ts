import { db } from "@/db";
import { productionMemberships, scriptAnnotations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { Bookmark, ScriptParseResult } from "./constants";
import { aiBookmarksFromResult } from "./parse-utils";

/**
 * Seed the AI bookmark set of an applied analysis onto every production
 * member's annotations for `scriptId`. Plain server module (not "use server")
 * so it can be called from any action — applying a parse, and installing a
 * searchable rebuild that inherits the source document's analysis.
 */
export async function seedSharedBookmarks(
  productionId: string,
  scriptId: string,
  result: ScriptParseResult,
  requesterId: string,
) {
  const shared = aiBookmarksFromResult(result);
  if (shared.length === 0) return;

  const members = await db
    .select({ userId: productionMemberships.userId })
    .from(productionMemberships)
    .where(eq(productionMemberships.productionId, productionId));
  const userIds = new Set<string>([requesterId, ...members.map((m) => m.userId)]);

  const existingRows = await db
    .select({
      userId: scriptAnnotations.userId,
      bookmarks: scriptAnnotations.bookmarks,
    })
    .from(scriptAnnotations)
    .where(eq(scriptAnnotations.scriptId, scriptId));
  const byUser = new Map(existingRows.map((r) => [r.userId, r.bookmarks as Bookmark[]]));

  for (const userId of userIds) {
    const current = byUser.get(userId);
    if (current === undefined) {
      await db.insert(scriptAnnotations).values({
        scriptId,
        userId,
        productionId,
        bookmarks: shared,
      });
    } else {
      // Replace the previous AI-seeded set (ids prefixed "ai-") with the new
      // one, but preserve any bookmarks the user added themselves. This means a
      // re-parse re-bookmarks from scratch instead of piling onto stale markers.
      const userOwned = current.filter((b) => !b.id.startsWith("ai-"));
      const merged = [...userOwned, ...shared];
      const changed =
        merged.length !== current.length ||
        merged.some((b, i) => current[i]?.id !== b.id);
      if (changed) {
        await db
          .update(scriptAnnotations)
          .set({ bookmarks: merged, updatedAt: new Date() })
          .where(
            and(
              eq(scriptAnnotations.scriptId, scriptId),
              eq(scriptAnnotations.userId, userId),
            ),
          );
      }
    }
  }
}
