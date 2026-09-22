import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { productions } from "./productions";
import { profiles } from "./users";
import { documents } from "./documents";

/**
 * Which script a member is currently viewing for a production, when they've
 * chosen one other than the production default (e.g. the vocal score instead
 * of the libretto). Absent row, or a row whose document was deleted (FK sets
 * it null), means "follow the production default".
 *
 * Keyed by (user, production) rather than living on production_memberships:
 * admins/producers reach productions through `productions:manage` with no
 * membership row, and designer-only users likewise. Uniqueness of
 * (user_id, production_id) is app-enforced (select-then-write), like
 * `script_annotations` — composite unique constraints hang `drizzle-kit push`.
 *
 * Server-only table (RLS enabled, no policies), reached through Drizzle.
 */
export const scriptPreferences = pgTable("script_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  activeScriptId: uuid("active_script_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("script_prefs_user_production_idx").on(table.userId, table.productionId),
]);

export type ScriptPreference = typeof scriptPreferences.$inferSelect;
