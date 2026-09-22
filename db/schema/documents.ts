import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { productions } from "./productions";
import { profiles } from "./users";

export const documentFolders = pgTable("document_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // "everyone" (default, all members) or "restricted" (only allowedRoles +
  // managers). Existing folders default to everyone, preserving behavior.
  visibility: text("visibility").notNull().default("everyone"),
  allowedRoles: text("allowed_roles").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id")
    .notNull()
    .references(() => productions.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => documentFolders.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  contentType: text("content_type").notNull(),
  storagePath: text("storage_path").notNull(),
  documentType: text("document_type").notNull().default("general"),
  isDefaultScript: boolean("is_default_script").notNull().default(false),
  scriptVersion: integer("script_version").notNull().default(1),
  processingStatus: text("processing_status").notNull().default("none"),
  // Script-kind provenance for split books. null for an ordinary upload;
  // "libretto" / "vocal_score" for the halves produced by `splitScriptDocument`;
  // "combined" on the original once it has been split. Also the AI-parse prompt
  // hint: a "vocal_score" document skips section detection and uses the score
  // preface. App-enforced enum (SCRIPT_KINDS in features/scripts/constants.ts).
  scriptKind: text("script_kind"),
  // The combined document this one was cut from, plus the 1-based page range
  // it covers in that source. Null for ordinary uploads.
  sourceDocumentId: uuid("source_document_id").references(
    (): AnyPgColumn => documents.id,
    { onDelete: "set null" },
  ),
  sourcePageStart: integer("source_page_start"),
  sourcePageEnd: integer("source_page_end"),
  // PDF page count, recorded by the AI parse / split. Null until known.
  pageCount: integer("page_count"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("documents_production_idx").on(table.productionId),
]);

export const documentComments = pgTable("document_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DocumentFolder = typeof documentFolders.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentComment = typeof documentComments.$inferSelect;
