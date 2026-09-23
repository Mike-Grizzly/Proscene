# Feature 19 — AI Script Analysis

**Status:** Phase 1 LIVE (merged as PR #30). **Long-book pass — 2026-09-22, branch `claude/loving-babbage-ggkydb`: chunked + resumable parsing (600-page cap), libretto / vocal-score detection + split, per-member script switching, add-only score apply — IMPLEMENTED, not live-verified.** See "Long books" below.
**Phase 2 (per-role line highlighting):** SCOPED as a beta (2026-06-10) — render-only, client-side, opt-in. Not built yet. See "Phase 2 — per-role line highlighting (Beta)" below.

## Goal

When a director uploads a script, AI parses it and proposes a production
template so the team starts from a populated setup instead of a blank one.
The director's vision had four outputs; Phase 1 ships the three high-confidence
ones, **always behind a human review/approve step** — AI output never lands in
the production's real tables automatically.

| # | Output | Target table | Phase |
|---|--------|--------------|-------|
| 1 | Cast/characters + Principal/Supporting/Ensemble | `production_roles` | 1 ✅ |
| 2 | Act/Scene breakdown | `production_scenes` | 1 ✅ |
| 3 | Bookmarks for scenes + musical numbers (page-accurate) | `script_annotations.bookmarks` (per-user, seeded for all members) | 1 ✅ |
| 4 | Pre-highlight each lead/supporting role's lines | (render-only overlay — nothing persisted) | 2 🅱 SCOPED beta (see below) |

## Architecture

- **Model:** `claude-opus-4-8` via `@anthropic-ai/sdk` (new dependency, approved
  this session). Adaptive thinking; **JSON-only prompt + parse**, not
  structured outputs — `output_config.format` is beta-only in SDK 0.103.0, so
  the system prompt pins the exact JSON shape and `extractJson()` +
  `JSON.parse` reads the reply. Streamed (`messages.stream` →
  `finalMessage()`) to avoid request timeouts on long scripts.
- **Client:** `lib/anthropic.ts` — lazy, returns `null` when `ANTHROPIC_API_KEY`
  is unset (graceful, like web-push).
- **Staging table `script_parses`** (`db/schema/script-parses.ts`): one row per
  analysis — `status` (`processing`→`ready`→`applied`, or `failed`), `result`
  jsonb (the proposal), `error`, `requested_by`. Server-only: RLS enabled, no
  policies (reached only via the Drizzle service connection, like
  `push_subscriptions`). Created live via Supabase MCP migration
  `create_script_parses`.
- **Async run:** `POST /api/scripts/[parseId]/run` — `runtime=nodejs`,
  `maxDuration=300`. Authenticates the caller, verifies access + `processing`
  status, then `after(() => runScriptParse(parseId))` and returns 202 so the
  work survives the client navigating away. Chosen over a synchronous parse
  because a full script takes 30s–minutes (Vercel function-timeout risk).
- **PDF text:** `features/scripts/parse.ts` extracts per-page text with
  **`unpdf`** (a serverless-safe pdfjs build — no browser globals like
  `DOMMatrix`, which broke the original `pdfjs-dist/legacy` attempt on Vercel's
  Node runtime), tagged with `===== PAGE N =====` so the model can cite accurate
  page numbers. Capped at ~600k chars (~150k tokens) as a guard.
- **Document status:** the long-scaffolded `documents.processingStatus` column
  is now driven (`processing`/`ready`/`failed`/`applied`).

## User flow

1. Documents tab → script row menu → **Analyze with AI** (`startScriptParse`
   stages a row, sets the doc to `processing`, returns the parse id; the client
   fire-and-forget POSTs the run route and navigates to the review page).
2. `/productions/[slug]/script/ai` (`ai-review-client.tsx`) shows a spinner and
   polls `fetchLatestScriptParse` every 3s while `processing`. The requester
   also gets an in-app + push notification when it's ready
   (`sendScriptParseReady`).
3. On `ready`: an **editable** form — rename/retype/remove characters, edit
   act/scene rows, edit/remove bookmarks.
4. **Apply** (`applyScriptParse`) writes `production_roles` + `production_scenes`
   and seeds the shared bookmark set onto every production member's
   `script_annotations` for that script (idempotent via stable `ai-*` ids).
   **Discard** deletes the parse.

## Wizard cast auto-fill (new-production setup)

A second, **pre-production** entry point lives on the wizard's Roles step
(`StepRoles` in `new-production-wizard.tsx`). The wizard runs before any
production/document exists, so the parse pipeline was generalized:

- `script_parses.production_id` / `document_id` are now **nullable**, plus a
  `storage_path` column. A "wizard parse" is owned by `requested_by` and points
  at a temp upload (`wizard-scripts/{userId}/…`).
- **Flow:** upload PDF straight to storage (`requestWizardScriptUpload` →
  `uploadFileToSignedUrl`) → `startWizardScriptParse` (per-**user** cap: 5 / 30
  days, since there's no production to cap) → kick the same
  `POST /api/scripts/[parseId]/run` route (its auth falls back to
  `requested_by` when there's no production) → poll `fetchScriptParseById` →
  on ready, **append the characters into the wizard's editable roles list**
  (blank seed rows are dropped). The parse state lives at the wizard level so it
  survives step navigation.
- **Carry-over:** on launch, `attachWizardScript` moves the uploaded PDF into
  the new production (`documents/{productionId}/…`), creates a **default script**
  document, and links the parse row — so the user doesn't re-upload and the full
  Script-tab AI (scenes/bookmarks) is ready to run later.
- **Optional + non-blocking:** the step copy says they can skip and add cast by
  hand, or upload later from the Script tab.

## Accuracy & refinement (2026-06-09, after first real-script test)

First real parse: cast + scene breakdown were ~100% accurate; **bookmarks drifted
after ~20–30 pages** (page numbers off, song numbers invented, some spurious
scenes). Root cause: the model was being asked to *recall* page numbers across a
100+ page document — the one thing LLMs are bad at. Two fixes:

- **Anchor-based page resolution.** The model no longer returns page numbers.
  For each bookmark it returns a short **verbatim anchor** (the heading/song-title
  line as printed); `resolveBookmarks()` in `parse.ts` finds the page by locating
  that anchor in the per-page text (falls back to the title). Deterministic, zero
  drift. Bookmarks whose anchor can't be found are **dropped**, which also filters
  hallucinated scenes. Prompt also tells it to copy printed song numbers verbatim
  and never renumber.
- **Corrective re-parse loop.** The review page has a "Not quite right?" box:
  type what was wrong → **Re-analyze with notes** (`reparseWithNotes`). It stages
  a fresh parse carrying the `notes`; `runScriptParse` feeds the notes **and the
  previous result** back to the model for a targeted revision. Counts against the
  per-production cap; the review page flips back to processing and polls.

## Index-page handling & bookmark replacement

- **Index/contents pages are not bookmarked.** Scripts open with a table of
  contents / "Musical Numbers" / synopsis listing every song & scene. Since those
  titles appear there *first*, a naive first-match resolved every bookmark to the
  index. `resolveBookmarks` now detects index pages (named index sections, or any
  page containing ≥4 distinct bookmark anchors) and resolves each anchor to its
  first occurrence in the **body**, skipping index pages. The prompt also tells
  the model those pages are reference-only.
- **Re-parse replaces AI bookmarks, keeps personal ones.** `seedSharedBookmarks`
  drops the prior AI-seeded set (ids prefixed `ai-`) and writes the new set, while
  preserving any bookmark a user added themselves. So re-analyzing re-bookmarks
  from scratch instead of piling onto stale markers.

## Bookmark kind tags & accuracy note

- AI-seeded bookmarks carry their `kind` (`"scene"` | `"song"`) onto the stored
  `Bookmark` (optional — hand-added bookmarks have none). The desktop bookmarks
  panel shows a colour-coded tag per row: **Song** (plum) / **Scene** (dusk). The
  AI review page already lists songs and scenes in separate groups.
- The AI Setup page shows an amber caveat: results vary with script formatting
  (modern, clearly-labelled scripts read best; songs are usually spot-on, scenes
  can blend in) — review and use "Not quite right?" to refine.

## Refining without re-uploading

The `/productions/{slug}/script/ai` page is a persistent home for the breakdown.
The "Not quite right?" re-analyze box (free-text notes → `reparseWithNotes`, runs
on the **existing** uploaded file) is shown both while reviewing a fresh parse and
in the **applied** state, so a director can keep refining after applying without
re-uploading. The desktop script reader has a manager-only **"AI setup"** toolbar
link to this page (`documents:upload` capability).

## Script-recognition cache (per organization)

A `script_cache` table (server-only, RLS-on/no-policies) keyed by
**(`organization_id`, content fingerprint)** — SHA-256 of the normalized extracted
text (raw bytes for scans). It was global/cross-org at first; it became
**per-org** (decision-log 2026-06-29) because a script can carry prompt-injection
and a breakdown produced in one org must never be served to another. Flow:

- `runScriptParse` computes the fingerprint after extraction. On a **first** parse
  (not a re-analysis), if a cache entry matches the identical file, it reuses that
  result — status straight to `ready`, **no model call** (instant + free; the
  review page shows "Reused a previously verified breakdown… no AI tokens used").
- `applyScriptParse` **populates** the cache (upsert by org + fingerprint) when a
  parse is applied. It caches the **server-stored model result**
  (`scriptParses.result`), not the client-supplied apply payload — a user's review
  edits are trusted for their own production but never become the cached
  breakdown. So the cache only holds model output for files someone has actually
  applied.
- Licensing houses (MTI/Concord/…) ship the **same PDF** to every company, so a
  second production of the same show **within the same org** reuses the breakdown
  instantly. (Cross-org reuse was deliberately given up for the injection reason
  above.)

**Privacy boundary (enforced by what's stored):** `script_cache.result` holds
ONLY the structural breakdown `{ title, roles, scenes, bookmarks }`. It never
contains personal annotations (highlights/notes/cues/ink — those live per-user in
`script_annotations`), casting (the breakdown has character names + types only,
no actors), production data, or the script text.

## Scanned scripts (OCR via vision)

Theatre scripts are often distributed as scans or photocopies with no embedded
text layer. `runScriptParse` detects this (extracted text < 200 chars) and, instead
of failing, switches to a **vision path**:

- The PDF is handed to Claude's native PDF/vision pipeline (which renders each
  page to an image and OCRs it) by passing the existing Supabase **signed URL**
  as a `{ type: "url" }` `document` content block — no base64 (which would
  inflate ~33% and risk the 32 MB request ceiling) and no Files API upload.
- A **separate system prompt** (`VISION_SYSTEM_PROMPT`) asks for the same
  roles/scenes, but bookmarks return a **`page` integer** instead of a text
  anchor — there is no extracted-text layer to anchor against on a scan.
  `resolveVisionBookmarks` validates each page is within the document and
  de-dupes. **Bookmarks on scans are best-effort** (model-estimated pages); cast
  and scenes are unaffected.
- **Long scans are chunked**, not capped at 250 pages any more: see "Long
  books" below. Each scanned page costs image + text tokens (~1.5–3k), so a
  scan longer than one chunk (`SCAN_CHUNK_MAX_PAGES = 60` / 18 MB raw) is cut
  into sub-PDFs with pdf-lib and sent as base64 `document` blocks, one call per
  chunk. A single-chunk scan still uses the signed-URL path above.
- **Cache safety:** the global script cache is fingerprinted on the **raw file
  bytes** for scans (the extracted text is empty and would otherwise collide
  across different scans, poisoning the cross-org cache). Text PDFs keep the
  normalized-text fingerprint. Both are SHA-256 hex in the same column.
- The wizard auto-fill path benefits automatically — it runs the same
  `runScriptParse`.

## Long books — chunked + resumable parsing, libretto / vocal-score split, script switching (2026-09-22, not live-verified)

**Why.** The owner's combined libretto + piano-vocal score PDF was refused
("too many pages"). Two ceilings were in play: scans were hard-rejected above
`MAX_SCANNED_PAGES = 250`, and text PDFs were **silently truncated** at 600k
characters (later songs/scenes just went missing). Both are gone.

### Chunked, resumable runs (`features/scripts/parse.ts`, run route)

- **Chunk plan.** Text PDFs: page ranges whose tagged text stays under
  `TEXT_CHUNK_CHARS = 450_000` (~110k tokens) — a ≤ ~180-page libretto is still
  ONE call, exactly as before; only 400–600-page books split. Scans:
  `min(SCAN_CHUNK_MAX_PAGES = 60, 18 MB raw)` per chunk, cut into sub-PDFs with
  **pdf-lib** (new dependency, approved 2026-09-22) and sent as base64
  `document` blocks. Hard cap `MAX_SCRIPT_PAGES = 600`.
- **Sequential, with carry-forward.** Chunks run one after another (never in
  parallel): each gets a preface naming the pages it covers, the characters found
  so far and the last scene begun before it, and is told to report only
  scene/song starts that BEGIN in its pages and (scans) page numbers *within the
  excerpt* — offsets are added in code, never by the model. `mergeChunkResults`
  unions roles by normalized name (keeping the most prominent classification),
  de-dupes scenes on (act, scene) and bookmarks on (page, title). Text-chunk
  bookmarks are anchor-resolved against that chunk's pages, so the long-script
  drift fix still applies.
- **Lease + heartbeat.** `script_parses` gained `progress` (the plan, per-chunk
  results, detection output, invocation count), `page_count`, `lease_token`,
  `lease_expires_at`. `POST /api/scripts/[id]/run` acquires the lease with ONE
  conditional `UPDATE … RETURNING` (free, expired, or heartbeat quiet > 90 s);
  losing the race returns `202 { running: true }`. The worker heartbeats
  `updated_at` every 20 s, writes progress only `WHERE lease_token = mine`, and
  **yields** when it has used ~90 s of its 300 s budget (persist, release lease,
  **self-kick** the route with `Authorization: Bearer CRON_SECRET` — the billing
  cron's convention; origin = `NEXT_PUBLIC_SITE_URL` → `VERCEL_URL`, never the
  Host header). The review page's 3-s poll re-POSTs `/run` when the row looks
  `resumable` (lease released and quiet > 30 s, or held with a dead heartbeat),
  so a lost self-kick is covered while anyone is watching. Per-chunk model calls
  are bounded (`CHUNK_CALL_TIMEOUT_MS = 190 s`); a failed chunk is retried once
  from a fresh invocation, then the parse fails naming the pages. Runs are capped
  at `MAX_PARSE_INVOCATIONS = 15`.
- **Progress UI.** "Analysing pages 121–240 of 480… (2 of 8 parts done)" with a
  bar; the detect phase shows "Checking what's in this file…".

### Libretto + vocal-score detection and split

- **When.** First, non-corrective parse of a production document whose
  `script_kind` is unset; text PDFs ≥ 40 pages (free heuristics; a model call
  only if the heuristics say "mixed"), scans ≥ 160 pages (vision, sampled).
- **Text heuristics** (`classifyTextPage` in `parse-utils.ts`): per page —
  dialogue-cue line ratio (`NAME.` / `NAME:`), music-term hits (allegro, cresc.,
  rit., segue, vamp, soprano…), syllabified-lyric ratio (`wan - der - ing`),
  bar-number token ratio, character count. `deriveSections` run-length-encodes
  the classes and **absorbs islands shorter than 12 pages** into the larger
  neighbour, so dialogue-cue pages inside a score don't fragment it. If both a
  libretto run and a score run ≥ 15 pages exist, one cheap model pass (one digest
  line per page, ~15k tokens for 600 pages) confirms the boundary; its answer is
  validated (`sanitizeSections`) and falls back to the heuristic sections.
- **Scans**: a sub-PDF of every k-th page (≤ 60 pages) is classified per page
  (dialogue / music / front_matter / other); `sectionsFromSamples` expands and
  smooths single-sample islands; then ≤ 4 refinement calls on the k pages around
  each libretto↔score boundary pin the exact page.
- **Proposal** (`proposeSplitRanges`): v1 = ONE contiguous libretto range + ONE
  contiguous score range (largest run of each, extended over adjacent front
  matter; contested middle pages go to the earlier half). The parse stops at
  status **`split_suggested`** (detection output in `progress.detect`, never in
  `result`), notifies (variant `split_suggested`), and the review page shows the
  sections found plus two editable ranges (client-validated with
  `validateSplitRanges`).
- **"Split & continue"** → `splitScriptDocument(parseId, ranges)`: downloads the
  original via the admin client, cuts both halves with pdf-lib, uploads them under
  the production's `documents/{productionId}/…` prefix, and in one transaction
  inserts two `documents` rows (`documentType "script"`, `script_kind`
  `libretto` / `vocal_score`, `source_document_id`, `source_page_start/end`,
  `page_count`, folder inherited), marks the original `script_kind = "combined"`
  (it stays in Documents), makes the libretto the production default (no version
  bump / stale flag), sets the parse to status **`split`**. Then it stages the
  libretto's analysis if the quota allows (the split itself spends none —
  `countsTowardQuota` excludes `split_suggested` / `split`); the score is analysed
  from the review page's picker afterwards (one live parse per production).
  Idempotent: a repeat call returns the documents already created.
- **"Analyse as one book"** → `continueParseUnsplit`: back to `processing` with
  `progress.skipDetect`, the client kicks `/run`.
- **Score parses.** A `vocal_score` document skips detection and gets
  `SCORE_PREFACE` (roles = singing characters, scenes `[]` unless printed
  headings, one `song` bookmark per musical number by printed number + title).
  Its review form hides the scene card; **apply is add-only** (see Reliability).

### Script switching (per member, with a production default)

- New table **`script_preferences`** `(user_id, production_id, active_script_id)`
  — per member because admins/producers reach productions through
  `productions:manage` with no membership row (a column on
  `production_memberships` would have nowhere to store their choice). Uniqueness
  is app-enforced (like `script_annotations`); `on delete set null` on the
  document means a deleted script silently falls back.
- `getActiveScript(productionId, userId)` = the preference if it still points at
  a live script of this production, else the production default. The Script tab,
  Focus view and phone reader all use it; the viewer/host is keyed by
  `script.id` so a switch **remounts** (the viewer seeds its annotation state
  from props once — without a remount it would save to the wrong `scriptId`).
- `ScriptSwitcher` (toolbar next to "AI setup", compact in the phone header) →
  `setMyActiveScript` (choosing the default clears the override so the member
  follows the default again); managers get "Make default" →
  `setProductionDefaultScript`. **Neither bumps `scriptVersion` nor flags
  annotations stale** — that behaviour stays with the Documents-tab "Set as
  default script" (`setDefaultScript`), which means "a new version replaced the
  old one". The first Focus upload now uses the non-bumping path too.
- Documents tab shows a Libretto / Vocal score / Combined book badge
  (`SCRIPT_KIND_LABELS`); the review page shows a picker with each script's
  latest-analysis status and an "Analyse" button for un-analysed ones.

### Files
`features/scripts/{constants,parse-utils,parse-utils.test,pdf-split,parse,actions,queries}.ts`,
`app/api/scripts/[parseId]/run/route.ts`, `app/(app)/productions/[slug]/script/{page,script-screen,script-viewer,mobile-script-reader,script-switcher}.tsx`,
`…/script/ai/{page,ai-review-client,split-proposal}.tsx`, `app/focus/[slug]/{page,focus-script-host,focus-script-upload}.tsx`,
`…/documents/documents-client.tsx`, `features/documents/queries.ts`, `features/notifications/announce.ts`,
`db/schema/{documents,script-parses,script-preferences,index}.ts`. Migration
`script_split_and_chunked_parse` applied live via Supabase MCP (2026-09-22).
Pure helpers have 26 vitest cases (`parse-utils.test.ts`).

### Engines and fallbacks (2026-09-22, same day — first live run failed)

The owner's first live run (`Beautiful_Script.pdf`, 282-page 1-bit CCITT scan,
11.5 MB, via the wizard) reached the new pipeline and then died at "This
scanned file couldn't be opened for page-by-page analysis". Reproduced locally
with the real file: **pdf-lib opens it fine (85 ms)** — the real cause was that
`unpdf`/pdf.js **transfers the input buffer to its worker and detaches it**, so
everything that read the same `bytes` afterwards saw an empty file: pdf-lib
("No PDF header found"), and — since 2026-06-11 — the **scan fingerprint**,
which was silently `sha256("")` for every scanned script (a per-org cache
collision waiting to happen; the live cache had no such row). Fix: text
extraction lives in `features/scripts/pdf-text.ts` and works on a **copy**
(regression test asserts the caller's buffer is intact). With that, this file
takes the normal `pdf-lib` engine: five 60-page sub-PDFs of ~1.7 MB each.

Because pdf-lib is unmaintained and does choke on some scanner output, the
same session also made the scan path independent of it:

| Engine (`progress.engine`) | When | What goes to the model |
|---|---|---|
| `url` | one chunk (short scan), or pdf-lib fails on a ≤ 100-page scan | the whole PDF via the signed URL (as before) |
| `pdf-lib` | pdf-lib opens the file | base64 sub-PDFs per chunk (≤ 60 pages / 18 MB) |
| `pdfium-raster` | pdf-lib fails on a longer scan | **pdfium** (Chrome's engine, already a dependency for the browser OCR rebuild, run server-side from its Node build) renders each page to a grayscale PNG (own zlib-only encoder, `features/scripts/png-encode.ts`); chunks are re-planned at ≤ 24 pages / 20 MB (`RASTER_CHUNK_MAX_*`) and sent as one image block per page, in order; scale drops 1.4 → 1.0 → 0.8 if a batch is heavy |

- Detection uses the same abstraction: sampled pages come from pdf-lib
  sub-PDFs or pdfium images (≤ 30 samples when rasterized).
- `splitScriptDocument` falls back the same way: pdfium renders every page
  of each half at 1.6× and pdf-lib **assembles image-only PDFs**
  (`buildImagePdf`) — `progress.split.rasterized = true`, and the review page
  says so. Scans have no text layer to lose; the OCR rebuild still applies.
- pdfium can't *write* PDFs here (this build doesn't export `addFunction`, which
  `FPDF_SaveAsCopy` needs), hence images rather than real sub-PDFs.
- `pdfium.wasm` is read from `node_modules` at runtime and shipped by
  `outputFileTracingIncludes` in `next.config.ts` (run route + the two pages
  whose server actions split); the package is in `serverExternalPackages` so
  its emscripten glue isn't bundled.
- The pdf-lib error text is stored in `progress.pdfLibError` and included in
  the final failure message, so the next report is diagnosable from the DB.

### Structured outputs + "Make searchable" inherits the analysis (2026-09-23)

The owner's second live round: the in-app split and the scan libretto's parse
**worked and were applied**. Then "Make searchable" (the PDFium + OCR rebuild,
needed because pdf.js renders this 1-bit CCITT scan blank) created a new
document with **no bookmarks**, and re-analysing that copy failed twice with
malformed JSON from the model — the searchable copy has a text layer, so it
took the text path, whose verbatim anchors copied OCR's stray `"` characters
unescaped into JSON strings.

- **Every model call now declares a strict JSON schema** via
  `output_config.format` (`features/scripts/schemas.ts`; SDK 0.103, non-beta —
  this reverses the 2026-06-09 note that structured outputs were beta-only).
  Text/vision analysis, section confirmation, scan sampling and boundary
  refinement each have one. If a reply still fails to parse, ONE cheap repair
  call rewrites the broken text under the same schema before the chunk is
  retried; `stop_reason = max_tokens` fails with "reply was too long". Format
  errors now say "use Re-analyse", never "split the file".
- **`finalizeRebuiltScript` inherits the source scan's analysis** when the
  caller passes `sourceDocumentId` (the in-viewer "Make searchable" does; the
  upload-time prompt has nothing to inherit): the rebuild copies `script_kind`,
  `page_count` and provenance, and if the scan had an applied parse it gets a
  **cloned parse row** (`status applied`, `progress.clonedFrom`, no
  fingerprint, never counted toward the caps) plus the AI bookmarks seeded for
  every member (`features/scripts/bookmarks.ts`), so the rebuilt script opens
  bookmarked. Members who had picked the scan follow it to the rebuild.

### Readable copies of unrenderable scans, made automatically at upload (2026-09-23)

The owner's scan is a 1-bit CCITT ImageMask PDF that pdf.js (the in-app
viewer's engine) draws blank, so the Script tool fell back to the native PDF
viewer and every tool was useless; the only remedy was the manual, in-browser
"Make searchable" rebuild (minutes, tab must stay open, ~26 MB per 130 pages),
which is not offered on the wizard, the Focus upload, or the split halves.
Measured server-side on the real book: pdfium renders a page to a 1-bit PNG at
scale 3 (~216 dpi) in ~126 ms at ~23 KB — 282 pages ≈ 16 MB in ~36 s.

- **Detection** (`readable-detect.ts`, pure): a script PDF is a candidate when
  it is a scan (text < 200 chars) **and** its image XObjects are 1-bit
  (`/BitsPerComponent 1`, `/ImageMask true`, `CCITTFaxDecode`/`JBIG2Decode`),
  enumerated with pdf-lib or, if it can't open the file, a raw-bytes scan.
  JPEG / 8-bit scans and text PDFs are left alone (`render_status = skipped`).
- **Render + install** (`readable.ts`, server-only): pdfium → grayscale bitmap
  → **1-bit PNG** (`encodePng` `oneBit` mode; threshold 128) → `buildImagePdf`
  (page size = original points); mixed books use 8-bit gray at scale 2. The
  copy is uploaded next to the original (`…-readable.pdf`) and inserted as a
  new `documents` row titled "… (readable)" with `script_kind`, `page_count`
  and provenance copied. **It takes over as the default when the original
  was**, and `script_preferences.active_script_id`, `script_parses.document_id`
  (any status — same pages, so an in-flight chunk plan still holds) and
  `script_annotations.script_id` are re-pointed to it. The original stays in
  Documents, non-default, badged "Original scan" (`render_status = done`).
  Failures set `render_status = failed` and the viewer behaves exactly as
  before (native viewer + "Make searchable").
- **Scheduling:** `scheduleReadableCopy(documentId)` sets `render_status =
  pending` and runs the install in `after()` from `finalizeDocumentUpload`
  (Documents tab + Focus upload; script PDFs only), `attachWizardScript` /
  `attachWizardScriptByPath` (wizard) and `splitScriptDocument` (both halves).
  The Documents page and `/productions/new` export `maxDuration = 300` and
  have `pdfium.wasm` traced in, like the AI page and Focus already did.
- **Viewer:** while the active script's `render_status` is `pending`, the
  Script tab and Focus show "Preparing a readable copy of this scan…" and
  refresh every 5 s; the copy is picked up automatically once installed.
- **Not changed:** "Make searchable" stays as the manual fallback (and adds a
  text layer, which the readable copy does not have); the in-viewer OCR text
  tools now work on the copy because its pages actually render.

**Schema:** `documents.render_status text` (`null | pending | done | skipped |
failed`) — migration `document_render_status` applied live via Supabase MCP.

### Limitations (v1)
- One contiguous range per half: a book that alternates libretto / score per
  act can't be split cleanly — the proposal covers the largest run of each; the
  rest stays only in the original.
- Vercel **preview** deployments with Deployment Protection block the server
  self-kick (it would need `x-vercel-protection-bypass`); the client poll still
  resumes the parse while the review page is open. Production is unaffected.
- Detection uses the parse model (`claude-opus-4-8`); a sampled-scan detect is
  ~$1. A cheaper detect model is a one-line constant if wanted.
- A 60 MB scan means pdf-lib + unpdf both hold the file in memory — if the run
  route OOMs, add a `functions` memory override in `vercel.json`.
- pdf-lib can't open some scanner output: analysis and splitting fall back to
  pdfium page images (see "Engines and fallbacks") — slower (more, smaller
  chunks) and the split halves are image-only PDFs.
- Designer seats (1 analysis per project) can split but then can't analyse the
  score half — the UI note says so.

## Phase 2 — per-role line highlighting (Beta, SCOPED 2026-06-10, not built)

**Goal:** an actor opens the script and sees **their character's lines highlighted**, so they can scan their part at a glance. This was output #4 of the original director's vision.

**Beta positioning.** This is shipped as an explicitly-labelled **Beta** because line detection is format-dependent: it works well on cleanly-formatted text PDFs and degrades on irregular ones. It is **opt-in and off by default**, so it can never silently change anyone's experience. Messaging on the control tells the user that if the result looks wrong they just switch it off — their bookmarks and notations are unaffected.

### Reversibility (the load-bearing decision)
AI line-highlights are a **separate, render-only overlay** — they are **never written into `script_annotations`**. The user's own highlights/notes/cues/ink and the AI bookmarks are never read or mutated by this feature. Consequences:
- "Fall back to the previous parsed version with only bookmarks + my notations" is the **default state** — there is literally nothing to undo, because nothing was ever written.
- No DB writes, no schema changes, no new server actions, zero token cost.

### How it works (client-side, cue-based)
The desktop viewer (`script-viewer.tsx`) already builds a positioned text layer from `pdfjs` (`getTextContent()` → per-item x/y/width). The beta engine reuses it:
1. The viewer is given the production's **cast names** (from `production_roles`; works whether they came from the AI parse or were hand-entered).
2. The user picks a character from a **"Highlight lines (Beta)"** dropdown (default: Off).
3. A pure client util (`features/scripts/line-highlights.ts`) walks each page's text items, groups them into lines by y-position, finds the chosen character's **cue lines** (the cast name as printed — `FREDERIC.` / `FREDERIC:` / `FREDERIC (aside):`), and boxes each line of the speech from the cue until the next cue / stage direction / scene heading. Anchoring on the known cast name (not a generic ALL-CAPS heuristic) keeps false positives down.
4. Rects are emitted in the same normalized 0–1 coordinate space as existing annotations and rendered as a **non-interactive** SVG group **below** the user's annotation layer (so user highlights stay clickable), only for the current page. Results are cached per `(page, character)` in a module map so page-flips are instant.

Selection is remembered in **localStorage** (client-only — still no server write).

### Limitations (state them in the UI)
- **Text PDFs only.** Scanned/OCR scripts have no client text layer, so highlighting is unavailable there (consistent with the OCR caveat).
- **Format-dependent.** Two-column scripts, dialogue on the same line as the cue, names with spaces/abbreviations, and speeches that continue across a page break are imperfect (a continuation page has no cue, so its lines won't highlight).
- Requires the cast to be set up (roles exist). If none, the control shows a "set up the cast first" hint.

### Beta slice vs. later iterations
- **Beta v1 (this scope):** desktop `ScriptViewer` — the dropdown + render-only overlay + the `line-highlights.ts` util + passing role names from `script/page.tsx`. No DB/schema/server changes.
- **Fast follow:** the same overlay in the **mobile reader** (`mobile-script-reader.tsx`) — actors read on phones, so this is high-value.
- **Later:** opt-in **persistence** as a separate AI-owned layer (distinct id prefix, still revert-by-clearing) so highlights appear in the "Download annotated PDF" export; **auto-select** the viewer's own character via `production_memberships.character_name`; and a **server-side / AI-assisted** coordinate engine for irregular scripts (accurate but token-costly).

### Files (when built)
- New `features/scripts/line-highlights.ts` (pure, client-safe: pdfjs textContent + character name → rects; unit-testable).
- `script-viewer.tsx` (control + overlay layer), `script/page.tsx` (fetch + pass role names), optional `constants.ts` (highlight style token).
- No schema, no server actions, no new dependency.

### Open decisions (deferred)
- **Plan gating:** the beta is client-side and free to run, so it isn't naturally covered by `assertCanMutate`. Decide later whether to gate *visibility* by plan (cosmetic) — recommend showing it to anyone who can view the script until/unless the costly server engine lands.

## Permissions

Gated on `documents:upload` (admin/producer/director/choreographer/stage_manager
hold it — directors included, which is the point); the wizard path gates on
`productions:manage` (only admin/producer reach the wizard). Non-managers still
need a production membership. Cast/crew never parse (role-gated).

**Plan gating:** AI is a paid-tier perk that trial users also get. This is
exactly the existing `assertCanMutate` gate — it passes for subscribed,
trialing, and pre-trial orgs and blocks post-trial grace/locked orgs — so both
entry points call it and no new plan logic was needed (decision 2026-06-09).

## Cost & abuse guardrails

Each parse is a real per-token Anthropic charge to the org that owns the
`ANTHROPIC_API_KEY` (≈$0.30–$0.50 for a typical script; up to ~$1 for very long
ones). It is **not** billed through Stripe to end users. Guardrails in
`startScriptParse`:

- **Concurrency lock** — a new parse is refused while one is already
  `processing` for that production.
- **Rolling cap** — max `PARSE_LIMIT_PER_PRODUCTION` (5) parses per
  `PARSE_WINDOW_DAYS` (30) per production. Failed-before-the-model rows
  (e.g. non-PDF) don't count against the quota.
- **Billing guard** — `assertCanMutate` already blocks read-only/expired orgs.

**Token logging** — `runScriptParse` records `input_tokens` / `output_tokens`
on the `script_parses` row from the model's `usage`, surfaced as a muted line
on the review page, so real cost is observable per parse.

**No pricing-tier change** was made (decision 2026-06-09): per-parse cost is low
and this is a setup-time action, so caps cover the economics without a new SKU.
A per-tier monthly quota (free 5 / repertory 20 / company ∞) is the natural
future lever if AI usage becomes material — deferred until there's token data.

## Reliability (added 2026-06-10)

- **Stalled-parse watchdog.** If the async run worker dies (Vercel reclaim, or
  work > `maxDuration=300s`) the row would sit in `processing` forever — spinning
  the review page and blocking new parses via the concurrency lock. A row
  `processing` with **no heartbeat for `STALE_PARSE_MS` (8 min)** is treated as
  dead: the poll actions (`fetchLatestScriptParse`/`fetchScriptParseById`) flip it
  to `failed` (`failIfStale`), and the concurrency locks skip it
  (`hasLiveProcessing`). Since the long-book pass, staleness is measured from
  `updated_at` (the worker heartbeats it every 20 s), not from `created_at`, so a
  parse that legitimately spans several invocations is never killed.
  Lazy — no cron, since the review page polls every 3s.
- **Idempotent apply.** `applyScriptParse` re-applying an already-`applied` parse
  is a no-op (status guard). A libretto/script parse **owns its rows**: it
  replaces the production's `source = "ai"` roles (re-linking casting by character
  name) and the `source = "ai"` scenes that have **no beats** (a blocked scene is
  never deleted), and de-duplicates by name / act-scene against whatever remains
  (manual rows, blocked scenes, score-added roles). A **vocal-score** parse is
  add-only: roles it adds carry `source = "ai_score"` so the next libretto apply
  can't wipe them, and it never touches scenes.
- **Late-joiner bookmark seeding.** `seedSharedBookmarks` only seeds members
  present at apply time. Members who join later are seeded **lazily on first
  Script-tab open** by `ensureMemberBookmarks` (reads the applied parse's bookmarks
  — the canonical set — and writes the user's `ai-*` set if missing). Gated by
  `documents.processingStatus === "applied"` + the member lacking an AI set, so
  there's no extra query for productions without an AI breakdown.

## Setup the user owns

- Set `ANTHROPIC_API_KEY` in Vercel (and local `.env`). `.env.example` documents
  it. Without it, "Analyze with AI" fails with a clear "not configured" message.

## Known limitations / risks (see open-questions)

- **Long-book pass (chunking, split, switching) is not live-verified** — needs a
  real 400+-page combined book, text and scanned.
- **Scanned/image-only PDFs** are read via Claude's vision/PDF pipeline (see
  "Scanned scripts") — bookmarks on scans are best-effort. Long scans chunk;
  the hard ceiling is `MAX_SCRIPT_PAGES = 600`.
- **Very long scripts** are processed across several worker invocations (see
  "Long books"); a 600-page scan is roughly 1.5–2M input tokens — real money.
- **Position classification** (lead/supporting) is a model estimate from line
  count/presence — intended to be director-corrected in the review form.
- **Bookmark seeding** writes one annotations row per member at apply time; fine
  for small casts, not optimized for very large ones.
- **Phase 2 highlighting** deferred — the hardest piece (per-line pixel coords,
  script-format-dependent).

## Casting from parsed roles (added 2026-06-10)

The parsed cast list (`production_roles`, written by `applyScriptParse`) was
previously write-only. It now drives **cast assignment**: a "Cast list" section
on the production's Cast & Crew page (`/productions/[slug]/members`) lists each
parsed character and lets a manager cast a real person in it.

- `production_roles.assigned_user_id` (nullable FK → `profiles`, `ON DELETE SET
  NULL`) bridges a character to an org member.
- Casting (`assignRoleToMember`) also grants production access: a new member is
  added as `cast` with that `characterName`; an existing member keeps their
  production role but gets the character. One actor ↔ one character per show
  (re-assigning frees their previous role). `unassignRole` clears the link and
  the character name but leaves access intact.
- Managers (`productions:manage`) can cast existing org members; inviting a
  brand-new person inline (`inviteAndAssignRole`) reuses the People invite flow
  and so needs `settings:manage`.

---

## Scanned-script OCR (in-browser text tools) — 2026-06-11, built, not live-verified

**Problem.** A scanned/image-only script has no text layer, so the Script tool's
**select / copy / find / line-highlighting** tools are dead. The AI parser OCRs
scans *for analysis* (Claude vision → cast/scenes), but that has no per-word
coordinates, so it can't make the page text selectable. Print-to-PDF doesn't
help either (it re-wraps images, adds no text).

**Solution.** OCR the scan **in the browser with tesseract.js** and paint the
result as the viewer's transparent text layer.

- **Detect:** on open, sample the first ≤5 pages' extractable text; `< 100`
  chars ⇒ scanned (same signal `runScriptParse` uses).
- **Offer (managers):** a banner — **Run OCR** (warns it processes each page,
  minutes for a full script) / **Not now** (remembered per file in
  `localStorage`; falls back to image-only viewing). Non-managers just benefit
  from a ready result; they don't see the run UI.
- **Run:** render each page to a canvas → `ocrCanvas()` (tesseract.js, `eng`)
  → per-word boxes, **normalized 0..1** of page size. Progress is shown
  page-by-page and is **cancellable**; the worker is terminated when done.
  Zero tokens / no server compute.
- **Store once, shared:** results live in `script_ocr` keyed by
  `storage_path` + `script_version` (a property of the *file*, reused for the
  whole production). Flushed every 5 pages so a long run survives a closed tab;
  `status` goes `processing → ready` (or `failed`, with a Try-again banner).
- **Paint:** when `status==='ready'`, the viewer fills `textLayerRef` from the
  stored boxes instead of the pdfjs text content (an `ocrOwnsTextLayer` ref
  stops the pdfjs render path from wiping it). Because boxes are normalized,
  they map to any zoom. This also **unblocks Phase 2 line-highlighting on
  scans** (it's text-layer-driven).

**Files.** `db/schema/script-ocr.ts`, `lib/ocr.ts`,
`scripts/copy-tesseract-assets.mjs` (self-hosts worker + WASM core into
`public/tesseract/`; lang data from the tessdata CDN by default, override with
`NEXT_PUBLIC_TESSERACT_LANG_PATH`), `features/scripts/ocr-actions.ts`,
`app/(app)/productions/[slug]/script/use-script-ocr.ts`; plus
`features/scripts/constants.ts`, `script-viewer.tsx`, `globals.css`.

**Setup the user owns.** Create the `script_ocr` table (SQL in
`decision-log.md`, 2026-06-11) — RLS on, no policies, no composite UNIQUE.

**Scope / not yet.** v1 = desktop `ScriptViewer`. Mobile reader consumes the
*stored* result for display but its own detect/run UI is a fast-follow.
Single language (`eng`). Accuracy is good-not-perfect on clean scans; very
poor scans may need a real OCR pass (ocrmypdf/Acrobat) outside the app.

---

## Unrenderable scans → searchable-PDF rebuild (PDFium-WASM) — 2026-06-11

Some scans pdfjs **can't rasterize at all** — e.g. MRC-compressed files whose
text is thousands of `CCITTFax` 1-bit `/ImageMask` stencils that pdfjs drops
(it draws only the `DCTDecode` background). For these the in-browser tesseract
OCR (which reads the pdfjs canvas) also fails. Two-layer fix:

1. **Native fallback (read):** the viewer measures ink coverage of a
   representative rendered page (`isRenderBlank`); if a scan comes back blank,
   it shows the PDF in the browser's native engine (`<iframe>`, like Documents)
   and hides the futile OCR offer.
2. **Searchable rebuild (fix):** `lib/pdf-ocr-rebuild.ts` rasterizes each page
   with **PDFium-WASM** (`@hyzyla/pdfium`, base64-inlined — no asset hosting),
   OCRs it with `tesseract.js`, and assembles a new PDF (page image + invisible
   jsPDF text layer). Standard codecs + real text ⇒ pdfjs renders/searches it
   natively. Managers trigger it from the blank-render banner (*Make
   searchable*, progress + cancel); the result uploads direct-to-storage and
   becomes the new default script (`finalizeRebuiltScript`, version-bumped,
   original kept).

**Verified:** PDFium-WASM renders the tester's exact file (126 pp, 16–27% ink)
where pdfjs is blank; `tsc`/`eslint`/`next build` clean. **Not yet:** live
end-to-end run in a browser; relocating the prompt from the viewer into the
upload flow; non-English OCR; very long scripts may want a background job
instead of the client-side rebuild.

### Wider scan coverage + DPI (2026-06-11)

- **Image uploads:** a script uploaded as JPEG/PNG/WebP (not just PDF) is
  scan-detected (`needsScriptOcr`) and rebuilt into a one-page searchable PDF
  (`rebuildImageAsSearchablePdf`, EXIF-aware). Shared per-page assembly
  (`appendOcrPage`); `installSearchableScript` takes a `File` and dispatches
  image-vs-PDF.
- **OCR DPI:** PDFium render scale 2.0→3.0 (144→216 dpi); +11% words / higher
  confidence on the real test file.
- **Two-layer model:** the rebuilt page is the *original scan image* (nothing
  lost), with an *invisible* OCR text layer for search/select/AI. OCR errors
  only ever affect that hidden layer, never the visible script. Stronger OCR
  (cloud/Claude vision) is the upgrade path if exact search/AI fidelity is
  needed.
