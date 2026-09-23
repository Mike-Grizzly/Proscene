# Step 6: Document Center

## Purpose
Centralized document management per production with categorized uploads, in-app viewing, and preparation for future AI script analysis.

## User story
As a stage manager, I can upload scripts, schedules, and other production files organized by type. All team members can view and download documents. The system is prepared for future AI-powered script analysis.

## Status: IMPLEMENTED
- **Document annotations/comments:** Placeholder sidebar exists in the viewer but no data model or functionality. Scaffolded only.
- **AI script analysis:** Schema fields exist (`documentType`, `processingStatus`) but no processing logic. Scaffolded only.

> **Readable copies (2026-09-23):** a script PDF that is a 1-bit scan gets an
> image-only "(readable)" copy made automatically after upload, which
> becomes the default script; the original stays badged "Original scan"
> (`render_status`). See `19-ai-script-analysis.md` → "Readable copies".

> **Folders + privacy:** documents are organized into `document_folders`
> (added after this spec). Folders can be role-restricted — see
> `13-document-folder-privacy.md`.

## Data model
- `documents` — productionId, uploadedBy, title, fileName, fileSize, contentType, storagePath, documentType, processingStatus, createdAt

### Document types (defined in `features/documents/constants.ts`)
- `script` — Script
- `schedule` — Schedule
- `design` — Design / Tech
- `music` — Music / Score
- `reference` — Reference
- `general` — General (default)

### Processing status
- `none` (default) — no AI processing
- Future values TBD for AI analysis workflow

## Routes/pages
- `/productions/[slug]/documents` — document list with upload form
- `/productions/[slug]/documents/[documentId]` — in-app document viewer with comments sidebar placeholder

## Components
- `app/(app)/productions/[slug]/documents/document-upload-form.tsx` — client form with title, type dropdown, file picker
- `app/(app)/productions/[slug]/documents/document-delete-button.tsx` — client button with confirmation dialog
- `app/(app)/productions/[slug]/documents/document-download-button.tsx` — exports `DocumentViewButton` with view (eye icon, opens in new tab) and download buttons
- `app/(app)/productions/[slug]/documents/[documentId]/document-viewer.tsx` — client component that renders based on content type:
  - PDF: iframe
  - Image: inline img tag
  - Text/JSON: iframe
  - Other: download fallback with file info

## Server actions (`features/documents/actions.ts`)
- `uploadDocument(formData)` — uploads to Supabase Storage, records in DB, validates title and 64MB size limit; requires `documents:upload`
- `deleteDocument(formData)` — removes from storage and DB; requires `documents:upload`
- `getDocumentUrl(storagePath)` — returns signed URL (1-hour expiry); **no permission check**

## Queries (`features/documents/queries.ts`)
- `getDocumentsByProduction(productionId)` — documents with uploader info, ordered by created_at desc
- `getDocumentById(documentId)` — single document with uploader info

## Permissions
- `documents:view` — required to see documents (all roles have this)
- `documents:upload` — required to upload and delete documents (admin, producer, director, stage_manager)
- Upload form and delete button only shown to users with `documents:upload`

## Edge cases
- `getDocumentUrl()` has no auth/permission check — any authenticated user who knows the storage path can get a signed URL
- No file type validation (any file type accepted)
- No duplicate file detection
- Storage path: `documents/{productionId}/{timestamp}-{filename}` — timestamp prevents collisions but filenames are not sanitized
- Delete removes from both storage and DB — no soft delete
- In-app viewer depends on browser PDF rendering capability
- The `DOCUMENT_TYPES` constant was moved from the `"use server"` actions file to `constants.ts` because non-function exports from server action files cause hydration errors

## Manual test checklist
- [ ] Documents tab appears on production detail page
- [ ] Can upload a document with title, type, and file
- [ ] Document appears in list with correct type badge, size, and uploader
- [ ] Clicking document title opens in-app viewer
- [ ] PDF documents render in iframe viewer
- [ ] Images display inline
- [ ] Download button triggers file download
- [ ] Delete button shows confirmation, removes document
- [ ] Users without `documents:upload` cannot see upload form or delete button
- [ ] Users with `documents:view` can see document list and open viewer
- [ ] Comments sidebar placeholder is visible in viewer

## Open questions
- When should document comments/annotations be built?
- Should file type validation restrict uploads to known safe types?
- Should the viewer support page-by-page PDF navigation?
- When should AI script analysis processing be implemented?
- Should `getDocumentUrl()` verify production membership before returning a signed URL?

## Architecture notes to preserve
- `DOCUMENT_TYPES` must be in `constants.ts`, NOT in a `"use server"` file — non-function exports from server action files cause hydration errors in client components
- Document viewer is a client component that switches rendering based on `contentType`
- The `processingStatus` field is reserved for future AI analysis — do not repurpose
- Documents use the same `attachments` Supabase Storage bucket as report attachments
- Storage path pattern: `documents/{productionId}/{timestamp}-{filename}`
