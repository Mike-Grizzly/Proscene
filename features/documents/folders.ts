import { db } from "@/db";
import { documentFolders } from "@/db/schema";
import { DEFAULT_FOLDERS } from "./constants";

/**
 * Seed a new production with the default document folders. Server-side helper
 * only — deliberately NOT in actions.ts: a `"use server"` export becomes a
 * client-invocable endpoint, and this takes a raw productionId with no access
 * check because its callers (the production-creation actions) run it inside
 * their own already-authorized transaction.
 */
export async function createDefaultFolders(
  productionId: string,
  // Accepts either the base db or a transaction handle, so callers can include
  // the default folders in a larger atomic production-setup transaction.
  executor: Pick<typeof db, "insert"> = db,
) {
  await executor.insert(documentFolders).values(
    DEFAULT_FOLDERS.map((name, i) => ({
      productionId,
      name,
      sortOrder: i,
    })),
  );
}
