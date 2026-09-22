import { pgTable, uuid, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { productions } from "./productions";
import { documents } from "./documents";
import { profiles } from "./users";

/**
 * One AI script-analysis job per request. This is a STAGING artifact, not the
 * source of truth: the model's proposed cast list, scene breakdown, and
 * bookmarks land here as `result` and are only written into
 * `production_roles` / `production_scenes` / `script_annotations` once a human
 * approves them (see `applyScriptParse`). That keeps unreviewed AI output out
 * of the production's real tables.
 *
 * Server-only table (RLS enabled, no policies) — reached exclusively through
 * the Drizzle service connection, like `push_subscriptions`.
 */
export const scriptParses = pgTable("script_parses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: a "wizard" parse runs during new-production setup, before the
  // production (and its document) exist. Those rows are owned by `requestedBy`
  // and carry `storagePath` instead; they're linked to a production later by
  // `attachWizardScript`.
  productionId: uuid("production_id").references(() => productions.id, {
    onDelete: "cascade",
  }),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "cascade",
  }),
  // Temp storage path of the uploaded PDF for a wizard parse (no document row
  // yet). Null once a document_id is set.
  storagePath: text("storage_path"),
  // processing → ready (awaiting review) → applied; or failed. A combined
  // libretto + vocal-score book goes processing → split_suggested (awaiting the
  // user's boundary decision) → split (two documents created) or back to
  // processing ("analyse as one book").
  status: text("status").notNull().default("processing"),
  // The model's proposal: { title, roles[], scenes[], bookmarks[] }.
  result: jsonb("result"),
  // Failure detail when status = 'failed'.
  error: text("error"),
  // Director's free-text corrections for a re-analysis (drives the re-parse
  // prompt). Null for a first parse.
  notes: text("notes"),
  // Content fingerprint of the extracted text — keys the global script cache.
  fingerprint: text("fingerprint"),
  // Anthropic token usage for this parse — for cost visibility and monitoring.
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  // Resumable-run state (ParseProgress in constants.ts): chunk plan, per-chunk
  // results, detection output, invocation count. Written only by the lease
  // holder. Null until the first invocation plans the work.
  progress: jsonb("progress"),
  // PDF page count, recorded on the first invocation.
  pageCount: integer("page_count"),
  // Run lease: exactly one worker invocation may process a parse at a time. A
  // kick (client poll or server self-kick) acquires the lease with a single
  // conditional UPDATE; `updated_at` doubles as the heartbeat, so a lease whose
  // heartbeat has gone quiet is stealable even before it expires.
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  requestedBy: uuid("requested_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ScriptParse = typeof scriptParses.$inferSelect;
export type NewScriptParse = typeof scriptParses.$inferInsert;
