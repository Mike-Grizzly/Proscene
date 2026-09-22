# Open Questions

Unresolved questions, risks, and concerns. Organized by area. Do not decide answers here unless the answer is clearly visible in the repo.

---

## SEO / docs-manual follow-ups (added 2026-07-02)

- **Docs content can drift from the product.** The 27 manual pages under
  `app/(marketing)/help/content/` describe the app as of 2026-07-02, verified
  against code at authoring time. Any feature/UI change now needs the matching
  content file updated in the same session, or the public manual quietly lies.
- **No screenshots on docs pages yet.** The strategy calls for a screenshot per
  how-to step; pages ship text-only until a stable demo production exists to
  screenshot from. (Framework renders fine without them.)
- **Owner-side SEO setup not done in code:** Google Search Console + Bing
  Webmaster verification, sitemap submission, Google Business Profile. Also:
  paste the four Phase 1 drafts (`docs/seo/blog-drafts/`) into Sanity Studio,
  ideally filling the new SEO title/meta/tags fields from each draft's header.
- **No default Open Graph image.** Blog posts use their Sanity cover image;
  everything else has no `og:image`. A branded default OG asset would improve
  link sharing (and the `Organization.sameAs` array in the homepage schema is
  empty until social profiles exist).
- **Spec docs found stale while writing the manual:** `03-roles-permissions.md`
  says 6 roles / 10 capabilities (reality: 8 / 18, per `lib/permissions.ts`);
  spec 05's "import from daily log" no longer exists; spec 10's calendar UI
  details predate the shared `CalendarClient`. The manual follows the code; the
  specs themselves were not rewritten this session.

---

## DB-level constraints + committed-migration workflow deferred (added 2026-06-29)

- A security review recommended belt-and-suspenders **database uniqueness
  constraints** as defense-in-depth — e.g. `(production_id, report_number)`,
  org/production membership pairs, production slug per org, production department
  key, and script-annotation `(script_id, user_id)` — plus a **committed SQL
  migration workflow** to replace the current `db:push` approach (the repo has no
  `db/migrations/` history).
- **Status: intentionally deferred, lower urgency.** The bugs these would backstop
  are already prevented in application code (this session): report numbering is
  serialized with a per-production advisory lock, all production-creation paths are
  transactional, and production-scoped actions verify child-resource ownership.
  The constraints would guard against a *future* code regression, not a live issue.
- **Why deferred:** they change the live database, and ideally a committed-migration
  workflow is set up first (itself the governance gap above) — an owner decision
  (see `decision-log.md`, 2026-06-29). When picked up: check for any existing
  duplicate rows before applying each constraint, since an apply will fail on dupes.

---

## Onboarding survey data is captured but unused (added 2026-06-15)

- The create-workspace wizard (`/workspaces/new`) now stores `organizations.annual_shows`,
  `team_size`, and `production_types`, but **nothing reads them yet**. The stated
  intent was to "tailor defaults" (e.g. pre-seed departments/seasons in the New
  Production wizard from `production_types`) and for product insight. Follow-up:
  either wire them into a default-seeding path or an analytics surface, or revisit
  whether collecting them is worth it. Until then they are write-only.
- **Schema applied live (2026-06-15).** The three columns (`annual_shows`,
  `team_size`, `production_types`) were added directly to the `CallBoard` Supabase
  project via `apply_migration` (`add_onboarding_survey_columns_to_organizations`),
  not `npm run db:push` — this project applies schema changes through Supabase
  directly since development is no longer local. No further DB step is needed.
- Wizard is **`tsc`/`eslint`-clean but not browser-verified** — the multi-step flow,
  logo-after-create upload, and best-effort invite warnings haven't been exercised
  against a live Supabase/Storage backend.

---

## Desktop-width overflow pass needs on-device verification (added 2026-06-15)

- The "right side off-screen on 4:3/16:10 MacBooks" beta item was fixed **by code
  inspection only** (no browser/screenshot in the sandbox). Changes: a `.page`
  horizontal-overflow guard promoted to all widths, `minmax(0,1fr)` on the
  calendar/day/new-production two-column grids, and a horizontal-scroll wrapper
  on the People table (see `current-status.md` 2026-06-15 desktop pass).
- **Verify at ~1280px** (and 1440px) on a deploy: walk Dashboard, Productions,
  People, Documents, Calendar, the Script tool, Blocking, Reports, Settings, and
  the new-production / new-workspace wizards — confirm no horizontal page scroll
  and nothing important clipped at the right edge.
- **Known risk to check specifically:** `.page { overflow-x: hidden }` clips
  (rather than scrolls) any *inline* popover/dropdown that extends past the right
  edge. If one is cut off, fix that component (portal to body or flip its
  placement) rather than loosening the page guard.
- If a particular screen still overflows, grab a screenshot at that width so the
  offending component can be fixed precisely instead of guessed at.

---

## Lint baseline drift in a fresh `npm install` (added 2026-06-15)

- Running `npm run lint` in a freshly-`npm install`ed sandbox reports **44
  problems (12 errors, 32 warnings)** on `main` *before any local edits* (e.g.
  `react/no-unescaped-entities` on existing apostrophes, `react-hooks/set-state-in-effect`).
  Since PRs keep merging to `main`, CI is evidently green — so CI must resolve
  different (lockfile-pinned) plugin versions than a plain `npm install` pulls,
  or gates on `next build` rather than `eslint`. The 2026-06-15 invite/sign-in
  edits were verified to add **zero** net problems (baseline 44 == with-edits 44).
- Follow-up: confirm what the CI lint step actually runs and whether the lockfile
  needs refreshing so local `npm install` matches CI. Until then, judge local
  lint by the *delta* a change introduces, not the absolute count.

---

## Soft-delete: deferred hard purge (added 2026-06-10)

- **No 30-day hard purge exists.** Productions and organizations soft-delete via
  `deleted_at`, recoverable for 30 days — but nothing actually removes them after
  that. Rows past the window just stay hidden. Need a careful, tested purge step
  (likely an extension of the billing-lifecycle cron) that cascades through child
  records + Storage objects, scoped strictly to the deleted entity. Until then,
  "permanently removed after 30 days" (shown in the delete UIs) is aspirational.
- **Storage isn't reclaimed on delete.** Deleting a workspace/production leaves
  its uploaded files in the `attachments` bucket. The purge step should remove
  them; the existing billing file-purge logic is a reference.
- **Member alert counts ignore deleted orgs.** `getWorkspaceAlertCounts` joins
  memberships→mentions/notifications without filtering `organizations.deleted_at`.
  Harmless today (the switcher hides deleted orgs so bubbles never render), but
  worth tidying if that query is reused elsewhere.
- **Deleting a paid workspace doesn't touch Stripe.** Soft-deleting an org with
  an active subscription doesn't cancel it. Decide whether delete should cancel
  at period end, or whether that's an operator step.

---

## Script tool: text not rendering for some valid PDFs (reported 2026-06-10 — ROOT-CAUSED + FIXED 2026-06-11, pending live verify)

- **Symptom:** In the **Script tool**, a tester's script rendered images (e.g. the
  show logo on p.1) but the **text was missing**, while the *same file* read fine
  in the **Documents** PDF viewer. (Earlier described as a fully "blank" page; the
  sharper report — images present, text absent — was the key clue.)
- **Root cause (confirmed in code):** `lib/pdf.ts` called `getDocument(url)` with
  **no font configuration**. `pdfjs-dist` only renders **non-embedded** fonts
  (Helvetica/Times/Arial — referenced-but-not-embedded, very common in scripts) if
  `standardFontDataUrl` (and `cMapUrl`/`cMapPacked` for CID fonts) point at its
  shipped asset folders. Without them pdfjs draws images but silently skips that
  text. The Documents tab uses `<iframe>` → the browser's native PDF engine
  (PDFium), which has its own fonts, so it rendered the text — explaining the
  Documents-vs-Script discrepancy exactly.
- **Fix:** `scripts/copy-pdfjs-assets.mjs` copies pdfjs-dist's `cmaps/` +
  `standard_fonts/` into `public/pdfjs/` (run before `dev`/`build`; `public/pdfjs/`
  gitignored), and `lib/pdf.ts` now passes `cMapUrl` / `cMapPacked` /
  `standardFontDataUrl`. Covers every `loadPdfDocument` caller (script viewer,
  mobile reader, blocking canvas); the blocking **setup wizard** was also routed
  through `loadPdfDocument` instead of its own bare `getDocument`.
- **Status:** Fix pushed on `claude/wonderful-newton-vo7sog` (PR #32). Needs live
  verification on the tester's file via the preview deploy — confirm the script
  text now renders in the Script tool. If text *still* misses after this, the
  remaining suspects are optional-content (OCG) layers hidden-by-default or an
  image-codec issue; fallback option is detect-blank-and-use-native-iframe.
- **Distinct case — genuinely scanned scripts (no text at all):** the font fix
  above only helps PDFs that *have* a text layer pdfjs was dropping. A true
  **scan/photo** has no text to render, so it stays image-only in the Script
  tool by design. As of 2026-06-11 those get an in-browser **OCR** path
  (tesseract.js) that adds a selectable text layer on demand — see
  `feature-specs/19-ai-script-analysis.md` → "Scanned-script OCR". Pending the
  `script_ocr` table being created live + real-scan verification.

## AI Script Analysis (Feature 19, Phase 1 — added 2026-06-09)

- **Not live-verified.** No real script has been parsed end-to-end — needs
  `ANTHROPIC_API_KEY` set. Parse quality (role classification, page-number
  accuracy for bookmarks) is unproven on real, irregularly-formatted scripts.
- **Long-script timeout.** The run route caps at `maxDuration=300`. A very long
  script (model latency + extraction) could exceed it; needs Vercel Fluid
  compute for a higher ceiling, or chunking. No retry/resume if it times out.
- **Stalled-parse watchdog: RESOLVED (2026-06-10).** A parse whose worker dies
  (Vercel reclaims the function, or it exceeds `maxDuration`) no longer spins the
  review page forever or blocks new parses. Anything `processing` past
  `STALE_PARSE_MS` (8 min) is treated as dead: the poll paths
  (`fetchLatestScriptParse`/`fetchScriptParseById`) flip it to `failed` via
  `failIfStale`, and the concurrency locks (`startScriptParse`/`reparseWithNotes`/
  `startWizardScriptParse`) ignore stale rows via `hasLiveProcessing`. Residual
  cosmetic edge: a parse nobody polls and nobody supersedes keeps the document's
  `processingStatus` at `processing` until something touches it — no functional
  impact (no longer blocks). A daily cron sweep could tidy this if it matters.
- **Re-apply duplicates roles/scenes: RESOLVED (2026-06-10).** `applyScriptParse`
  is now safe to re-apply: re-applying the same parse is a no-op (status guard),
  and roles/scenes are de-duplicated against what the production already has
  (roles by name, scenes by act/scene number). Note: it is **additive** — a
  re-parse that *removes* or *renames* a role/scene won't delete the old row
  (there's no AI-vs-hand-added marker, and `production_scenes` is shared with the
  blocking tool, so blind deletion is unsafe). The director curates removals in
  the review form / members page.
- **Scanned PDFs: RESOLVED (2026-06-10).** Image-only/scanned scripts are now
  read via Claude's vision/PDF pipeline (`runScriptParse` vision path — sends the
  signed URL as a `document` block). Open edges: (1) **bookmark pages on scans are
  model-estimated** (no text layer to anchor against), so less reliable than the
  anchor-resolved text path; (2) capped at `MAX_SCANNED_PAGES = 250` — a longer
  scan fails with a "split it" message rather than chunking; (3) **cost is higher**
  on scans (image + text tokens per page, ~$1–2 for a full script) — covered by
  the existing per-production/per-user caps but not separately metered; (4) not yet
  live-verified against a real scanned script.
- **Bookmark seeding scale.** `applyScriptParse` writes one `script_annotations`
  row per production member; fine for small casts, unbounded for large ones.
  **Late-joiner gap RESOLVED (2026-06-10):** members who join *after* apply are now
  seeded lazily on first Script-tab open via `ensureMemberBookmarks` (reads the
  applied parse's bookmarks, the canonical set). Residual edges: (1) it's a
  write-on-render, so two simultaneous first-opens by the same user could insert
  two annotation rows (`script_annotations` has no unique constraint — same class
  as the existing apply-time seeding; `getScriptAnnotations` uses `limit(1)`);
  (2) the per-member row-explosion for very large casts is unchanged.
- **Re-apply duplicates roles/scenes: RESOLVED (2026-06-10)** — see the
  watchdog/idempotent-apply entry above. Apply is now a no-op on an already-applied
  parse and de-duplicates roles/scenes against existing rows; it stays additive
  (never deletes), so a re-parse that drops a role/scene needs manual cleanup.
- **Cost guardrails: RESOLVED (basic).** Concurrency lock + per-production cap
  (5 / 30 days) + token logging now ship (`startScriptParse`,
  `runScriptParse`). Open: no org-level monthly quota yet (chosen to defer the
  per-tier quota until there's real token data); the per-production cap is the
  only ceiling, so a `company`-tier org with many productions is effectively
  uncapped org-wide.
- **Phase 2 (per-role line highlighting): SCOPED as a beta (2026-06-10), not
  built.** Decided to ship it as a **render-only, client-side, opt-in** overlay
  (no DB writes, no schema, no tokens) so it's reversible by construction — the
  user's bookmarks/notations are never touched; "off" is the fallback. The viewer
  detects a chosen character's speeches from the existing pdfjs text layer (cue-
  based). Full design in the feature spec. Open: text-PDF-only (no client text
  layer on scans); format-dependent accuracy (two-column, same-line cues, cross-
  page speeches); mobile-reader parity is a fast-follow; persistence (for PDF
  export) + auto-select-by-`character_name` + a server AI-assisted engine are
  later iterations; plan-gating of visibility is undecided (it's free to run).
- **Wizard auto-fill (added 2026-06-09):** parses a script during new-production
  setup to pre-fill the cast, then carries the PDF over as the default script on
  launch (`attachWizardScript`). Open edges: (1) **orphan temp files** — if a
  user uploads in the wizard but abandons it (never launches), the
  `wizard-scripts/{userId}/…` object is never moved or cleaned up; needs a sweep.
  (2) The wizard parse runs the **full** analysis (scenes/bookmarks too) but only
  the roles are used at wizard time — the rest is discarded (the user re-runs from
  the Script tab later). Minor wasted tokens. (3) If the user launches *before* the
  wizard parse finishes, the carry-over still happens but the cast isn't pre-filled.

---

## Mobile / iOS questions

- **iOS auto-zoom persists into the app after sign-in (PARKED 2026-05-27).**
  On iOS WebKit (Safari and Chrome — both use WebKit), typing into the
  sign-in inputs auto-zooms the page (font-size below 16px triggers it)
  and the zoom level carries over into the authenticated app, so the
  whole UI feels stuck zoomed-in until the user manually pinches back
  out. Two attempts at a fix were made in `components/app-shell/zoom-reset.tsx`:
  (1) detect via `visualViewport.scale` then clamp via `maximum-scale=1`
  — failed because the auto-zoom is a *layout* zoom, not a pinch zoom,
  so `visualViewport.scale` reads 1; (2) always run on mount + double-rAF
  + `maximum-scale=1, user-scalable=no` — reported as still not
  resetting. The component is kept in tree for now since it's harmless.
  Next ideas to try when revisiting: hard-reload navigation after the
  auth server action instead of the Next.js client redirect; force a
  layout via `document.body.style.zoom = 1`; remove + re-insert the
  viewport meta tag entirely; or accept the trade-off and floor the
  login form's `.field` to 16px so auto-zoom never triggers in the
  first place.

## Script editor questions

- **Page number overrides UI:** The `pageOverrides` JSONB column is stored and loaded but there is no UI to set overrides. Intended use: let users remap PDF page numbers to match the printed page numbers in the script (e.g. PDF page 1 = script page 5). Should this be added as an inline editable label per page?
- **Signed URL expiry during long sessions:** Script PDFs load via 1-hour Supabase signed URLs. The pdfjs document reference stays valid for the session, but the bitmap cache is keyed by URL — a new URL after expiry means re-rendering all visited pages. Should the page auto-refresh the signed URL before expiry (e.g. server action ping on focus regain)?
- **Multi-device annotation sync:** Annotations auto-save to the DB but a second device or tab won't see changes without a reload. Should Supabase Realtime subscriptions sync annotations live across devices?
- **Downloaded PDF is raster-only:** The "Download PDF" output is JPEG pages assembled by jsPDF — text is not selectable in the result. A pdf-lib approach (draw annotation primitives on top of the original PDF vectors) would preserve text selectability. Worth revisiting if print fidelity becomes a requirement.
- **Thumbnail panel performance on long scripts:** All pages render progressively at 0.25× when the panel opens. For 100+ page scripts this could take 30+ seconds. Should IntersectionObserver lazy-load only visible thumbnails?
- **Annotation color editing:** There is no way to change the color of an existing highlight or note — the user must delete and redraw. Should a color picker appear in the panel item edit mode?

## Blocking tool questions (future candidates)

- **Full beat breakdown export:** Directors want to print the entire blocking script — all scenes, all beats, each with a canvas snapshot. Approach: loop through every beat, render positions onto an offscreen canvas, assemble into a multi-page PDF (e.g. via `jspdf`) or a print-friendly HTML page. Should include scene/beat label and actor legend per page.
- The number line ruler uses `preserveAspectRatio="none"` on the SVG, which distorts tick mark heights on non-square viewports — is this acceptable or should it be addressed?
- **Custom set piece signed URLs:** URLs expire after 1 hour. Long blocking sessions will see broken images for custom pieces after expiry. Should the canvas auto-refresh URLs (e.g. on focus regain)?
- **Custom set piece deletion UX:** Deleting a custom set piece from the library removes it from future beats, but existing `blocking_positions` rows still reference its ID. Tokens for deleted pieces will appear as missing images on canvas. Should deletion be blocked if the piece is in use, or should positions be cleaned up on delete?

## Mentions questions

- **Mention notifications:** Currently mentions appear only on the dashboard. Should users receive email or push notifications when @mentioned?
- **Mention in deleted context:** If a report or announcement is deleted, mention rows for it remain in the DB. Should deletions cascade-delete mention rows?
- **Cross-production mention visibility:** The dashboard shows all mentions across all productions. Should users be able to filter by production?
- **`production_logs` table orphan:** The DB table was not dropped when the daily log feature was removed. It can be dropped in a future cleanup migration when convenient.

## Product questions

- Steps 1–13 are complete. What is the next feature step?
- Should rehearsal report departments be configurable per production, or remain fixed?
- Should attendance tracking be added to rehearsal reports?
- Should productions have additional statuses beyond draft/active/archived?
- Should there be a notification system when reports are filed or documents uploaded?
- Should the "requested role" from signup trigger any workflow (e.g., admin approval queue)?

## Architecture questions

- Should `drizzle-kit push` be fixed or should the project fully adopt SQL Editor for schema changes?
- When should the project move from `push` workflow to proper migrations?
- ~~Is the single-org design sufficient for launch, or will multi-org be needed before v1?~~ **Resolved 2026-05-28** — multi-org refactor shipped; see `decision-log.md` 2026-05-28 entry.
- Should an API layer be introduced between the UI and database, or is the current direct-query pattern acceptable long-term?

## Permissions questions

- Should production-level roles override org-level roles, or should they be additive?
- Currently a user's org role is used for capability checks everywhere. Should production membership roles affect what a user can do within a specific production?
- Are the current capability assignments correct? (e.g., should `stage_manager` have `announcements:create`?)
- Should `cast` and `crew` have different permissions, or are they intentionally identical?

## File upload / storage questions

- **Storage RLS is permissive:** Current policies allow any authenticated user to insert/select/delete any file in the `attachments` bucket. Signed-URL generation is now access-checked in app code (P0, 2026-05-21), so this is defense-in-depth — but should policies still be scoped to production membership?
- **No duplicate detection:** Users can upload the same file multiple times. Is this acceptable or should duplicates be detected?
- **No virus/malware scanning:** Uploaded files are served back to users via signed URLs. Should files be scanned before serving?
- **Orphaned files:** If a database insert fails after a successful storage upload, the file remains in storage with no DB record. Should there be cleanup logic?
- **Bidirectional link between report attachments and the Documents
  directory (post-beta).** Two paired behaviors that promote keeping
  every production's files in one place:
  1. *Picking from Documents:* in the rehearsal report attachment UI,
     let the user pick a file that already lives in the production's
     Documents directory instead of (or in addition to) uploading a
     new one. Avoids re-uploading the same script revision / floor
     plan / costume sheet for every report.
  2. *Auto-promoting report attachments into Documents:* when a user
     uploads a file directly inside the rehearsal report, also add
     it to the Documents directory by default — with an opt-out
     checkbox ("don't add to Documents") for one-off files where
     storage savings matter. Files that *do* get added need a target
     folder (Documents has 6 categories), so the upload flow needs
     a folder picker at attach time. Decision needed on whether the
     report-attachment row should reference the Documents row by FK
     (shared underlying storage object) or stay a separate row that
     just *also* writes a Documents entry (two refs to the same
     file). The FK approach is more efficient but harder to reason
     about for deletion semantics.

  Queued for post-beta because both flows touch the report-builder,
  Documents picker, and Storage layout — bigger than a beta fix.

_Resolved in P0 (2026-05-21): signed-URL actions now verify production access; uploads enforce a MIME allowlist; storage-path filenames are sanitized. See `decision-log.md`._

## UX questions

- TipTap bullet points do not render due to Tailwind prose CSS reset. When should this be fixed?
- Mobile navigation: sidebar is hidden on mobile with no alternative. When should a mobile drawer be added?
- Should the document viewer support page-by-page navigation for multi-page PDFs?
- Should there be a search/filter capability on the documents list?
- Should the production overview cards show more metadata (dates, member count)?

## UI port questions

- **Workspace Home vs. current `/dashboard`:** `design-reference/jsx/tab-home.jsx` is a richer workspace landing (greeting hero, "Right now" strip, announcement broadcast cards, productions browser, @mentions, pinned items). The current `/dashboard` was ported against an earlier design and does not match it. Should `/dashboard` be re-ported to the Workspace Home design? The new shell mockup (`design-reference/jsx/shell.jsx`) also adds a workspace/production/people view switcher in the rail — adopting it is a connected decision.

## Notes questions

- **Cross-production notes view:** User wants a dashboard glimpse of notes from all productions. When should this be built?
- **Real-time updates:** Notes from other team members only appear on reload. Should Supabase Realtime subscriptions be used here?
- **Note editing rights:** Currently only the author or a manage_tags user can edit a note. Should this be loosened for "shared" notes?
- **Tag deletion cascade:** Deleting a tag sets `tag_id = null` on all notes (ON DELETE SET NULL). Should users be warned how many notes will lose their tag?
- **Bullet points in TipTap:** Same issue as reports — Tailwind prose resets list styles. Should a fix be applied globally?

## Testing / hardening questions

- There are zero test files in the repo. When should testing be introduced?
- What level of testing is appropriate for MVP? (Unit tests, integration tests, E2E?)
- Password reset flow was never fully tested due to Supabase email rate limits. Needs verification.
- **Server-action ID ownership sweep:** the signed-URL read actions now verify production access (P0, 2026-05-21), but mutating actions (e.g. `uploadDocument`, `uploadCustomSetPiece`) still trust a client-supplied `productionId` without confirming the caller belongs to it. A broad ownership-check pass across mutating server actions is still outstanding.
- Leaked-password protection (HaveIBeenPwned check) must be enabled in the Supabase Auth dashboard — a project-owner action, not a code change.

## Scope control questions

- The MVP is being built in vertical slices. What is the definition of "MVP complete"?
- Is there a target launch date or user count?
- Should any of the scaffolded features (announcements, activity) be cut from MVP scope?
- When should UX polish become a priority vs. feature completion?

## Call schedule questions

- **Real-time live status:** The dashboard header badge reflects state at page load, not in real time. Should the header auto-update (e.g. via Supabase Realtime or a client-side interval revalidation) so it flips to "Live" or advances to the next call without a manual refresh?
- **Recurring calls:** There is no support for repeating calls (e.g. "Tuesday/Thursday 7–10pm for 8 weeks"). Should a recurrence system be built, or is bulk-creation sufficient?
- **Cancel vs. delete:** Currently calls can only be deleted. Should there be a "cancel" status that keeps the call visible on the calendar (greyed out) to preserve the history for the production record?
- **Rehearsal report "Next Rehearsal" ↔ calendar bidirectional link
  (post-beta).** Right now the Next Rehearsal block on a rehearsal
  report (date / time / location / notes) is plain text fields and
  doesn't talk to the production calendar at all — SMs end up
  double-entering the same information. Two paired behaviors:
  1. *Pull from calendar:* button in the Next Rehearsal block that
     looks up the next scheduled call on this production's calendar
     after `report.reportDate` and pre-fills date / time / location.
     Edit-friendly afterward in case the SM wants to override.
  2. *Push to calendar:* if the SM types Next Rehearsal info directly
     into the report and there is no existing calendar entry for
     that date/time, create one automatically on save so the calendar
     stays the source of truth. If a call already exists at that
     date+time, don't duplicate — link instead.

  Edge cases to think through: what counts as a "match" when pushing
  (same date + start time, or any call on that date?); whether
  cast/crew should be able to push-create calendar entries from a
  report or only `reports:create` holders; and whether editing the
  Next Rehearsal fields on an already-distributed report should
  edit the linked calendar entry. Queued for post-beta.

## People directory questions (Step 16)

- **Service-role key in environment:** `inviteMembers` / `resendInvite` need `SUPABASE_SERVICE_ROLE_KEY`. It is in `.env.example` and must be set in every environment (local, deploy) before invites work. The page, parsing, and UI work without it.
- **Invite email template:** Supabase's "Invite user" auth email template must be enabled in the project dashboard for invite emails to actually send.
- **`/settings/members` overlap:** the older Step 3 org-member page still exists alongside the new `/people` page. Should `/settings/members` redirect to `/people`, or stay as a lighter settings-scoped view?
- **`last_active_at` precision:** only set when an invited user is promoted to active on first sign-in — it is not a true per-request "last seen" (per-request DB writes were deliberately avoided). Is a more accurate last-seen worth a throttled write later?
- **Invite acceptance landing:** invite links route through `/auth/callback` to `/reset-password` so the user sets a password. This reuses the existing reset-password page and should be verified end-to-end against a live project.

## 2026-05-29 session — deferred / optional follow-ups

These are nice-to-haves intentionally left for a later day; each has a working
default in place today.

- **Scheduler — workspace `/calendar` "+" production picker.** When the
  workspace calendar has multiple productions, the new-call "+" asks which
  production each time. Optionally remember the last-used production and skip
  the picker (with a way to change it). Today: always asks.
- **Scheduler — edit-call as a tray.** Creating a call now opens the slide-in
  tray over the calendar, but editing an existing call (from the event drawer's
  "Edit") still navigates to the full-page form. Optionally make edit use the
  same slide-in tray for consistency. Today: edit is a full page.
- **Script reader — two-finger scroll while drawing.** With a freehand tool
  active, the page scroll is locked so one finger draws cleanly; navigation is
  via the scrubber. Optionally add two-finger pan/scroll so the user can scroll
  without deselecting the tool (GoodNotes-style). Today: scrubber-only while a
  tool is active.
- **Script reader — ink on desktop.** Freehand ink is drawn only on mobile (and
  the desktop Read-mode overlay is reading-only). Desktop renders ink read-only
  and exports it in the annotated PDF, but there's no freehand drawing on the
  desktop annotation viewer (it keeps its rectangle highlight/note/cue tools).
  Optional if desktop freehand is ever wanted.
- **New Production wizard — inviting brand-new people.** The wizard's Team step
  can assign existing org members for any `productions:manage` user, but
  inviting brand-new email addresses requires `settings:manage`; rows that
  can't be actioned are reported as skipped on the launch screen. Optionally
  let producers invite new people, or guide them to ask an admin.

## Settings — deferred from PR #20 (2026-05-29)

- **Email change (a.k.a. "email linking" / rebinding).** Deferred on
  purpose. The `/settings/account` email field renders disabled with
  a hint. Building it correctly needs Supabase's
  `updateUser({ email })` + the magic-link confirmation on the new
  address. If a fresh session reads the codebase and asks "is email
  change implemented?" the answer is **no, and that's intentional** —
  don't treat it as missing work and rebuild it. We'll revisit if
  beta testers actually ask for it.
- **Delete workspace / delete account.** Out of scope; needs cascade
  semantics + confirmation UX we don't want to get wrong.
- **Transfer ownership to a non-member.** Current flow requires the
  target be an existing workspace member. Invite-then-transfer is
  the supported path. Decide later whether a one-step
  "invite + make them admin and step down" is worth shipping.
- **Account-level avatar upload.** Workspace logo shipped; personal
  avatars deferred.

## Dashboard command center / RSVP / acks (2026-05-29)

- **RSVP confirm only on the dashboard focal call.** `confirmCall` works for
  any member of any call's production, but the only UI to call it is the
  dashboard focal-call panel (the single next call). Members can't yet RSVP to
  a *specific* non-focal call. Natural home: the calendar `EventDrawer`
  (`app/(app)/calendar/event-drawer.tsx`) — would need confirm data threaded
  through `CalEvent`/`callToEvent`. Deferred to keep the calendar pipeline
  untouched this pass.
- **Desktop bento pinned has no unpin.** The desktop bento "Pinned" card
  renders plain links; unpin is only on the phone `PinnedSection`. Add an
  unpin affordance to the bento if desktop users want it.
- **Phone dashboard not redesigned.** The command-center look is desktop-only;
  phones still get MobileTodayHero + the legacy stacked feeds. The uploaded
  Mobile_Dashboard.html referenced `mobile-dashboard.jsx`/`mobile-shell.jsx`
  which were not included, so the phone re-skin is deferred until that source
  is available. The Acknowledge button *is* reachable on phone via
  `/announcements`.
- **Countdown time format assumption.** `FocalCall`'s countdown builds the
  target as `${callDate}T${callTime}:00` (local), assuming `calls.callTime` is
  24h `HH:MM`. Verify against real call data; non-24h or null times fall back
  to "—".
- **Not verified live.** `tsc` + `eslint` pass, but there's no `DATABASE_URL`
  here so `next build` page-data collection and real-data rendering weren't
  exercised.

## Mobile dashboard (2026-05-29)

- **`mobile-today-hero.tsx` removed (RESOLVED 2026-05-29).** The phone
  dashboard was replaced by `mobile-dashboard.tsx`, orphaning
  `MobileTodayHero`. The file was deleted after confirming nothing else
  imported it (`tsc` + `eslint` clean).
- **Mobile dashboard appbar omitted.** The draft had a top app bar with
  Search + Notifications buttons; both were demo-only toasts with no real
  destinations in the app (no global search; the notifications inbox is
  deferred), so the appbar was dropped and the screen starts at the greeting.
  Revisit if/when those destinations exist.
## Notes Notion-style editor (2026-05-29)

- **Mobile keyboard accessory bar needs device verification.** The bar is kept
  above the keyboard by syncing the editor height to
  `window.visualViewport.height` (handles the common "keyboard at bottom"
  case). iOS edge cases (viewport offset when scrolled, split keyboard,
  floating iPad keyboard) are unverified — check on a real iPhone.
- **Mobile metadata uses the in-document properties row.** Tag/due/pin/to-do
  now live in a quiet row under the title (desktop + mobile) rather than a
  top bar. A future polish could tuck them behind a "⋯" sheet next to the
  Private pill for an even cleaner immersive top.
- **Inline link uses `window.prompt`.** The bubble-menu Link button prompts
  for a URL. An inline link popover (edit/remove/open) would be nicer — quick
  follow-up.

---

## Notifications questions (2026-06-03)

- **Announcement notifications are implemented but not browser-verified.**
  Scope-based fan-out (in-app + email) + a `/settings/notifications` preference
  page + a global rail bell were added this session. Not yet tested end-to-end:
  (a) that a recipient actually sees the in-app bell count update and the email
  arrives, (b) the rail bell dropdown renders correctly opening *upward* from
  the rail foot (it was originally built for a topbar; `placement="up"` flips
  it), (c) large-org fan-out performance (one `notifications` insert batch +
  Resend batch per ≤100 recipients).
- ~~**Push is modeled but inert.**~~ **SHIPPED 2026-06-04** — Web Push
  implemented (service worker + VAPID + `push_subscriptions` + per-device toggle;
  see `feature-specs/17-push-notifications.md`). Announcements now fan out to the
  push channel. Not yet device-verified end to end. Still open: (a) iOS requires
  "Add to Home Screen" before Web Push works at all — accepted for Phase 1;
  (b) a native wrapper (Capacitor + APNs/FCM) remains the eventual path for the
  most reliable phone alerts and reuses this same backend.
  **Update 2026-06-04:** @mentions now push too (batched per-write; from reports,
  notes, announcements, blocking). Onboarding added (first-dashboard dialog asks
  email + push; in-app always on). Still open: per-write batching only (no
  cross-write time-window debounce); mention pushes link to `/dashboard` rather
  than deep-linking the exact context.
- **Upcoming-rehearsal reminders (FUTURE, requested 2026-06-04).** Auto-notify
  people the morning of a scheduled rehearsal, pulled from the calendar
  (`calls`), via email (and push). Not built. Needs a scheduled trigger (cron /
  Supabase scheduled function / Vercel cron) since it fires on a clock, not on a
  user action. Rehearsal reports + these reminders are the "always both channels"
  category the product wants; everything else follows the user's chosen channels.
- **Email volume / opt-out.** Every announcement currently emails every audience
  member who hasn't turned email off. For a busy show this could feel spammy —
  consider per-production muting or digest batching before wide rollout.
- **No real-time refresh.** The rail bell count updates on next navigation, not
  live (consistent with the documented "no real-time updates" stance). Revisit
  if instant delivery is expected.

---

## Orphaned profiles / invites (2026-06-03)

- **Legacy orphan profiles** (a `profiles` row with no `auth.users` account) existed
  from an older invite/seed path. Three were deleted (director + 2 duplicates);
  **10 demo rows remain** by choice. If more real orphans
  exist in other orgs, they'll show as members but can't log in or reset a
  password until re-invited. `inviteMembers` now self-heals these on re-invite.
- **Misleading password reset.** Supabase returns 200 for reset requests on
  unknown/login-less emails (anti-enumeration) and sends nothing. The member
  list now flags `invited` status, but the public reset screen still can't tell
  a user "you were invited, accept the invite instead" without leaking account
  existence. Acceptable for now; revisit if it confuses testers.
  - **Partly addressed 2026-06-15:** the signup form now guides an invited user
    who hits "account already exists" toward the invite email / password reset,
    and existing-account invitees now get an in-app + email notification (see
    `feature-specs/02-auth.md` → "Invite / sign-in clarity"). The core
    anti-enumeration limitation above is unchanged.
  - **Hardened further 2026-06-15:** expired/used invite & recovery links now
    route to `/forgot-password?expired=1` (a self-service "get a new link" that
    also sets a first password) instead of a useless login error, and failed
    logins surface the same recovery link. Two **user-owned config** follow-ups
    remain: (1) **extend Supabase's email-link (OTP) expiry** so invites don't
    lapse before people check mail — tension with the security advisor's
    short-expiry preference, but the new recovery path makes exact TTL
    non-critical; (2) **verify Resend SMTP deliverability** (invites are sent by
    Supabase Auth, not our Resend API — a silent SMTP/domain issue would make
    invites simply never arrive, which looks identical to "sign-in is broken").
    Optional future: passwordless `signInWithOtp` on /login for near
    failure-proof joining.
- **Latent risk:** do NOT add profile↔login reconciliation by email outside the
  admin invite flow without requiring verified email ownership — that would turn
  pre-seeded roles into an account-takeover vector. Current linking is by auth
  UID, which is safe.
- **Duplicate profiles per email** were possible historically (katie had 3). The
  invite path dedupes by email now, but there's no DB-level uniqueness on
  `profiles.email`; self-signup with an email that already has a login-less
  profile still creates a separate profile + org. Consider a reconciliation step
  or a guard if this recurs.

---

## Notification surface after the banner pivot (2026-06-03)

- **Dead bell code.** `components/app-shell/notification-bell.tsx` and the
  notifications actions (`getNotifications`, `getUnreadNotificationCount`,
  `markNotificationsRead`) are no longer referenced by any UI after the rail
  bell was removed in favour of the acknowledge banner. Left in place for a
  possible future "notification center" header. Decide: build that center, or
  delete the dead chain.
- **Orphaned notification rows.** `fanoutAnnouncement` still inserts `notifications`
  rows and document comments still do too, but nothing displays them. Either wire
  a viewer or stop writing announcement rows (the banner reads acks directly, so
  in-app announcements don't need the table).
- **`notification_preferences.in_app` is currently a no-op** — the banner always
  shows for unacknowledged announcements regardless of the toggle. Only `email`
  is meaningful right now; `push` remains inert. Revisit the settings copy if the
  bell/center doesn't come back.
- **Banner scope choices to confirm with use:** 30-day window and audience-only
  (a manager isn't nagged to ack announcements for productions they're not in).

---

## Marketing website (added 2026-06-05)

Context: the ProScene marketing site is ported into `app/(marketing)/` on
branch `claude/magical-ride-usNEW` (see decision-log 2026-06-05). Open
follow-ups before it ships:

- **CTAs are placeholders.** In-page "Start free" / "Book a demo" / "Message
  support" etc. are still `data-noop` (no navigation), faithfully matching the
  uploaded mockups. Only the **nav** "Sign in" → `/login` and "Start free" →
  `/signup` are wired. Decide which CTAs route to `/signup` vs a real demo /
  contact flow, then wire them.
- **Brand casing + domain mismatch.** Mockups say "ProScene" and
  `app.proscene.live`; the live product is "Proscene" at `proscene.app`.
  Reconcile wordmark casing and the in-mock URLs during a cleanup pass.
- **Payload + Next bump pending.** CMS not installed yet; needs `next`
  16.2.3 → ≥16.2.6 and `payload` + `@payloadcms/next` + Postgres adapter,
  verified on a preview deploy before merge.
- **Set-piece SVGs are placeholders.** `public/marketing/setpieces/*.svg`
  (rug/table/throne/tree/bench) are simple stand-ins for the features
  blocking demo — replace with the real artwork.
- **Single blog post.** `/blog/[slug]` renders one post for any slug. Real
  multi-post content comes with Payload.
- **`feature-demos.css` / `dash-hero.css` are imported unscoped** (only on
  `/features`). Their `.cal-*` / `.sm-*` class names could in theory collide
  with app classes if these ever load on an app route; they currently never
  do. Scope under `.ps-site` if that assumption changes.
- **App vs marketing on the same domain.** `/` is now the marketing home and
  the app lives at `/dashboard` etc. on the same domain. At the repo split,
  decide whether the app moves to a subdomain (e.g. `app.proscene.app`).
- **Verification.** `next build` compiles and `tsc`/eslint pass, but the
  pages have **not been viewed in a browser** from this environment (no
  `.env.local`/DB). Smoke-test the routes on a preview deploy or local `npm
  run dev`.

---

## Security follow-ups (added 2026-06-05)

After the multi-tenant authorization pass (see decision-log 2026-06-05):

- **`deletePerson` is a global delete.** It now verifies the target shares the
  caller's org before running, but it still deletes the global `profiles` row +
  auth user. If a person belongs to MULTIPLE orgs, deleting them from one org's
  People page would remove them everywhere. Decide the multi-org behavior:
  remove-from-this-org-only when the user has other memberships, vs. full
  delete only when this is their last org.
- **`attachments` Storage bucket lockdown — RESOLVED, verified live 2026-07-22.**
  The 2026-07-22 security review confirmed via live SQL that `storage.objects`
  has RLS enabled with ZERO policies and the `attachments` bucket is
  `public=false` — the deny-all cutover described below is done. Kept for
  history: *(original entry)* All server-side storage operations now go
  through the service-role admin client (`createSupabaseAdminClient`), which
  bypasses storage RLS; the browser only ever uses short-lived signed
  URLs/tokens minted server-side after an org-scoped access check. The
  remaining step is to flip the live `storage.objects` policies on the
  `attachments` bucket to DENY direct anon/authenticated access (currently
  permissive). That is the only thing standing between "code-ready" and
  "closed"; defer the live toggle to the launch cutover and verify
  uploads/downloads on a preview deploy first, because a wrong policy breaks
  file access for real users.
- **Leaked-password protection** is disabled in Supabase Auth — enable it
  (HaveIBeenPwned check); may require the Pro plan.
- **A couple of read-only leaks remain low-priority** (e.g. some blocking read
  helpers were gated in this pass; `saveAnnotations` rows are self-owned). Worth
  a second skim, but no destructive cross-tenant path remains among the
  audited actions.

---

## ⏰ REMINDER — enable when we upgrade to Supabase Pro

These are deferred ONLY because they require the Supabase Pro plan. Revisit
the moment we go Pro:

- **Enable leaked-password protection** (Supabase → Authentication → Password
  security) — checks new/changed passwords against HaveIBeenPwned. Flagged by
  the Supabase security advisor (2026-06-05); deliberately deferred per user
  decision until Pro.
## Mentions questions (2026-06-04, PR #28)

- **`mention-input.tsx` contenteditable not device-verified.** The inline chip
  editor is hand-rolled (Selection/Range, caret placement, paste, serialize).
  Verified in desktop preview; unverified on iOS/Android soft keyboards (IME
  composition, autocorrect, caret-after-chip on touch). Test on real devices.
- **Plain-text mention resolution is name/email-based.** `@{Full Name}` tokens
  resolve to a user id by matching org members' full name or email at save time.
  A member renamed between typing the mention and saving, or two members sharing
  a full name, can mis-resolve or fail to notify (the chip still displays). The
  rich-text (`data-id`) path is unaffected.
- **Pre-existing report mentions weren't re-split.** Reports saved before the
  per-section change keep their old single merged `report` row; only a re-save
  rewrites them into per-section rows. No backfill was run.

---

## Marketing website — progress 2026-06-05 (branch `claude/magical-ride-usNEW`)

**Done this session:** all "Start free" CTAs wired to `/signup`; new `/contact`
page + Resend-backed form (honeypot, reason-aware) wired from Contact / Message
support / "Talk to a human" / "Verify your school"; "Book a demo" →
`/contact?reason=demo` (auto-upgrades to a scheduler link when
`NEXT_PUBLIC_DEMO_SCHEDULER_URL` is set — recommend Cal.com); footer dead links
fixed; brand "ProScene→Proscene" + `app.proscene.live→proscene.app`; removed
fabricated homepage trust logos / testimonial / stats; Reviews page replaced
with an honest "coming soon" and pulled from the nav.

**Still open for the website:**
- **Blog truthfulness:** posts still have invented authors and a fabricated
  "Hart House" case study — soften/replace before promoting the blog.
- **Social links** in the footer are still inert (no accounts yet).
- **Newsletter signup** (blog page) has no provider wired — connect to Resend
  audiences or remove.
- **Demo scheduler:** set up Cal.com and add `NEXT_PUBLIC_DEMO_SCHEDULER_URL`.
- **Contact delivery:** defaults to `feedback@proscene.app` (forwards to owner);
  override with `CONTACT_EMAIL` if desired. Consider CAPTCHA if spam appears.
- **Placeholder images** (blog cards, product mock) → real screenshots.
- **CMS (Payload), GTM/tracking, Stripe checkout, repo split** — still pending
  (see decision-log 2026-06-05).

---

## 2026-06-09 — Billing & monetization (post-launch follow-ups)

**Resolved this session:** CMS decision (Sanity, embedded Studio at `/studio` — not Payload); Stripe checkout/webhook/portal built (3 tiers); GTM live; trial/gating model and pricing PAGE both built. The pre-2026-06-09 "Still pending: CMS/GTM/Stripe" notes above are superseded.

**Owner setup before/at go-live (not code):**
- ~~Add `CRON_SECRET` in Vercel~~ — **DONE 2026-06-09.**
- ~~Stripe Customer Portal → enable "Customers can switch plans" + add the 3 products~~ — **DONE 2026-06-09.**
- ~~Confirm `RESEND_FROM_EMAIL` domain is verified in Resend~~ — **DONE 2026-06-09** (`proscene.app` verified).
- **Pending — swap Stripe test keys → live keys + a live webhook** (use the `www` canonical URL) when ready to charge.
- **Pending (cleanliness, non-urgent) — rotate the Sanity API token** pasted in chat: sanity.io/manage → project `dsciikio` → API → Tokens → revoke the old `sk…`. Nothing in the app depends on it (reads are public/published; Studio uses your login), so revoking breaks nothing.

**Open product questions:**
- **15%-off trial nudge** currently asks the admin to *reply* for a code. To make it self-serve, create a Stripe coupon and wire **per-org unique promotion codes** (restricted to the org's customer, single-use) into the day-30 email.
- **AI tooling** is unbuilt but reserved as the headline Company differentiator — plan to meter it as **per-tier AI credits** (the one feature with real per-use cost). Don't advertise as live until built.
- **Downgrade behavior** (e.g. Company→Season with 3 active shows): currently keeps all shows editable, only blocks *new* creation over the limit. Confirm before launch.
- **Lifecycle nudge dedup** advances one milestone per cron run; if the cron is down for many days it sends only the latest milestone (skips intermediates) — acceptable, revisit if it matters.
- **Cross-org alert bubble** counts "activity since last switch-in," so new activity arriving *while* you're in a workspace can show a bubble after you leave it. Matches the "clear on switch" spec; revisit if it feels off.

**Deferred UI follow-ups:**
- **Decided NOT to build:** one-click "Repertory after my trial" CTA (2026-06-09); filtering `/productions` so participants don't see other shows' names — **intentionally left as-is** (cast may see all org show titles but can only open shows they're assigned to; the rail/dashboard/calendar are already scoped to their own shows).
- **Still available if wanted:** explicit in-app upgrade buttons (vs routing through the Stripe portal); per-org unique 15%-off promo codes auto-wired into the day-30 nudge; the AI-credits Company model when AI tooling is built.

---

## OCR accuracy of the searchable-scan text layer (2026-06-11)

The browser rebuild (PDFium + tesseract) preserves the **visible** scanned page
exactly; OCR only populates an **invisible** text layer used for search / select
/ copy / AI parse. On rough photocopies tesseract is good but imperfect, so that
hidden layer can have occasional misreads → a search miss or a copy/AI typo
(never a change to the script users read). Open question: is tesseract's
accuracy sufficient for search + AI breakdown on real scripts, or do we want a
**stronger-OCR toggle** (cloud OCR or Claude vision) for the text layer? Current
DPI is 216; 300 dpi would help accuracy at higher client memory/time cost.

---

## Rehearsal Video (link-only) — open items (added 2026-06-12)

- **DB migration applied.** `rehearsal_videos` + `video_timestamp_notes` were
  created directly on the Supabase `CallBoard` project (migration
  `add_rehearsal_videos_and_timestamp_notes`), with RLS enabled / no policies
  to match the app convention (DB access goes through the Drizzle pooler
  connection, which bypasses RLS). No `db:push` needed.
- **Not browser-verified.** The player wrapper loads the YouTube IFrame API /
  Vimeo Player SDK from a `<script>` and drives them via an imperative handle —
  this needs a real browser test (especially: seek-on-click, duration capture,
  speed change, and a Vimeo private/unlisted link with an `h=` hash).
- **Vimeo private embeds need domain allow-listing.** Unlisted/private Vimeo
  videos only embed if the Vimeo account allow-lists the app's domain;
  otherwise the player shows a privacy error. Worth surfacing in the add-video
  help text once confirmed.
- **No real thumbnails or durations until first open.** Library cards use
  deterministic gradient tiles; `durationSeconds` is null until someone opens
  the video and the player reports it (then it persists). YouTube exposes a
  thumbnail URL with no API call (`img.youtube.com/vi/{id}/...`); Vimeo needs an
  oEmbed fetch — deferred.
- **Native hosting is the real ask down the road.** This is the interim. Native
  upload/hosting (Mux/Cloudflare Stream) brings transcoding, adaptive delivery,
  Download, true clip trim and a custom scrubber — and an egress cost that
  should be priced as a paid tier. See decision-log 2026-06-12.
- **Soft-deleted videos aren't purged.** Like documents/productions, removed
  videos set `deletedAt` only; no hard purge exists (same gap as the soft-delete
  section above). Low urgency — rows are tiny metadata, no Storage objects.

---

## Google consent screen shows `…supabase.co`, not "Proscene" (2026-06-12)

**Status: DEFERRED (cosmetic, sign-in works).** On the Google "Sign in with
Google" consent screen, the headline and the "Allow … to access" / Privacy &
Terms host all read `avqgfzrcwegebtbvmcwo.supabase.co` instead of Proscene.

**What was tried and ruled out (free):** the OAuth consent screen **App name =
"Proscene"**, a logo, and the Google-Group support email are all saved — but
they **do not** appear in the actual consent test. Confirmed empirically. Cause:
the app is in **Testing** status (unverified) and the OAuth callback lives on
Supabase's **shared `…supabase.co` domain**, so Google shows the raw domain and
the App-name/logo branding doesn't override it. Reordering Authorized domains
(adding `proscene.app`, keeping `…supabase.co`) does not change this. Note:
`…supabase.co` MUST stay in Authorized domains or sign-in breaks.

**The only reliable fix (paid):** Supabase **Custom Domain** add-on (Pro plan,
~$10/mo). Moves auth to e.g. `auth.proscene.app`; re-register that callback in
Google Cloud and the whole screen reads as your domain. App-side this is just an
env change (`NEXT_PUBLIC_SUPABASE_URL` → custom domain) — the OAuth redirect
already derives from the request origin, so little/no code. Google's own
verification+publish path is free but heavy and still wouldn't remove the
`…supabase.co` text, so it's not worth it.

**Recommendation:** defer the custom domain until closer to public launch;
acceptable for beta.

---

## Pricing / storage / beta follow-ups (added 2026-06-12)

- **Lifetime founding discount is advertised but not built.** The homepage open-beta
  band promises a founding discount (`BETA_DISCOUNT_PCT`, currently 30%), but there is
  **no Stripe coupon / promotion code** and no logic to apply it at checkout. The number
  is a recommendation, not yet a committed/finalized price; needs the founder's sign-off
  before it's a real offer.
- **Storage allowances are advertised but not enforced.** `STORAGE_LIMIT_GB`
  (100/250/500 GB) is shown on the pricing page but nothing measures or caps a workspace's
  usage. Decision was "start conservative, raise for free later"; enforcement (and a
  fair-use/overage policy) is deferred. When ceilings grow / native video arrives, migrate
  file blobs to a zero-egress object store (Cloudflare R2) — see `decision-log.md`.
- **Marketing UI mockups need a visual verification pass.** The hand-built product demos
  on `/` and `/features` were rebuilt (Script) / audited (the rest) against the real
  components for accuracy, but none were rendered in-session. Eyeball them on a preview
  deploy and flag any styling drift for a precise fix.

---

## Cast & Crew board — deviations & follow-ups (added 2026-06-16)

The drag-to-assign board (`/productions/[slug]/members`, `cast-crew-board.tsx`,
rebuilt from `handoff/cast-crew-drag-assign`) is **implemented but not
browser-verified** (no display in the sandbox). Open items:

- **Team buckets are multi-occupant for every role**, including Director / Stage
  Manager, whereas the prototype treated leadership roles as single-occupant
  (drop = swap). This follows the real schema (many-per-role) and existing
  behavior. If single-occupant leadership is actually wanted, it needs a new
  app-level rule (no schema today enforces it). See decision-log 2026-06-16.
- **Positions overloaded onto `characterName` (2026-06-16 follow-up).** Crew-based
  department buckets (Lighting, Sound, Music, …, role `crew`) and Ensemble (role
  `cast`) are stored as a position label in `production_memberships.characterName`,
  so the People directory shows e.g. "Crew · Lighting". If a validated set of
  positions — or designers as a distinct permissioned role — is wanted, that's a
  schema + permissions change.
- **Board team buckets are now department-derived (resolved 2026-06-16 follow-up 2).**
  Buckets are built per production from `production_departments` via
  `buildTeamBuckets`. The Ensemble bucket and the dept→role mapping (`DEPT_BUCKET`)
  are still code constants; fully user-editable positions remain a follow-up.
- **Rehearsal reports ARE now linked to `production_departments` (resolved
  2026-06-16 follow-up 3).** Reports, both detail views, and both email renderers
  iterate the production's resolved departments; a Settings tab manages them
  (add/remove/rename/reorder + custom names). Remaining threads:
  - **Document folders / notification channels** are still NOT department-driven
    (the schema comment promised these too) — separate follow-up.
  - **Default = full standard catalog** when a production has no departments on file.
    Productions that never touched the wizard therefore still show all 12 report
    sections until trimmed in Settings. Intended (no data hidden), but means the
    feature is opt-in per existing production.
  - **Legacy wizard depts `intimacy` / `dramaturgy`** have no report column and are
    dropped from the department list on resolve (they were never report sections).
    If a production enabled them, they won't appear until re-added as customs.
  - **Custom-department notes live in `rehearsal_reports.dept_notes` (jsonb).** If a
    custom department is renamed, its key (derived from the original label) is kept so
    existing notes stay attached; renaming does not re-key. Deleting a custom
    department from Settings does not delete past reports' notes (preserved in jsonb),
    but they stop showing until the department is re-added with the same key.
  - **The schedule-change category dropdown** (`subtab-editors.tsx`) still lists the
    full standard catalog rather than the production's departments — it's a color tag,
    not a report section, so left as-is; revisit if it should match.
  - Still **not browser-verified** — needs a live pass: create/edit/distribute a
    report after trimming + adding a custom department; confirm the email + both
    detail views; confirm the board buckets update.
- **Drag-and-drop is native HTML5 only** (per dev-rules: no new libs without
  approval). The accessible/mobile path is tap-to-assign. If a keyboard-drag or a
  DnD library is wanted, that's a follow-up; both interaction paths must be kept.
- **A `cast` member with no character** appears in the roster (with an
  "Unassigned"/role label) but in neither zone of the board until cast or given a
  team role. This matches the prototype but may warrant a "cast, no character yet"
  affordance later.
- **Needs a real eyeball** on: the desktop two-column drag feel, the ≤859px
  board⇄company toggle + bottom sheets, and the four themes (the `.drop` highlight
  uses `--accent`).

---

## Sanity Visual Editing: read token + live updates (added 2026-06-18)

- The Studio's Presentation pane (click-to-edit preview) needs a **`SANITY_API_READ_TOKEN`**
  (Viewer role) in the deploy env to show *drafts* and validate the preview URL. Without it,
  preview falls back to published content only. Confirm the token is set in Vercel
  (Production + Preview) before telling the owner the feature is live.
- **No live updates yet.** Edits appear in the preview on navigation/refresh, not keystroke-
  live, because we use Draft Mode + stega rather than `defineLive` / the Live Content API
  (see `decision-log.md` 2026-06-18). If the owner wants the preview to update as they type,
  that's the follow-up: adopt `defineLive`/`SanityLive` and move queries to `sanityFetch`.
- **stega cleaning is load-bearing.** Any *new* Sanity field rendered as a URL, slug, key,
  or numeric data-attribute must be wrapped in `stegaClean` or it will break inside preview
  (invisible markers corrupt the value). Display-only text should be left encoded so it stays
  click-to-edit. Easy to forget when adding fields.
- **Not browser-verified** — the overlays, the enable/disable round-trip, and the pricing
  billing toggle inside the preview iframe all need an eyeball on a real deploy.

---

## Security audit batch 2 — remaining findings not yet fixed (added 2026-06-19)

The 2026-06-19 hardening pass fixed the highest-severity confirmed issues. The following were found but deferred — they need a dedicated pass to address safely.

**Auth hardening (lower-urgency)**
- `app/actions/auth.ts` — Auth actions return raw Supabase error strings for login failures. Supabase can return different messages for "email not registered" vs "wrong password," enabling account enumeration. Fix: normalize all login failures to a single generic message.
- `lib/rate-limit.ts` — Rate limiter keys only on IP address. An attacker can test 5 passwords against account A, get blocked, then get a fresh 5 attempts against account B. Fix: add a per-email counter alongside the per-IP counter.
- `app/api/draft-mode/disable/route.ts` — The GET endpoint that exits Sanity Draft Mode has no auth check or CSRF token. Any page with an `<img src="/api/draft-mode/disable">` can silently kick a Sanity editor out of preview mode. Low severity but trivially fixed.

**Input validation**
- `features/scripts/actions.ts` (`applyScriptParse`) — Client-supplied role names and scene titles are stored with only `.trim()`. No max-length cap; no HTML sanitization. Role names are currently rendered as plain text so XSS is not immediately exploitable, but a 1MB role name would be accepted. Fix: add a 255-char cap and run through `sanitizeHtml`.
- `features/scripts/parse.ts` (~line 368) — Director re-analysis notes are triple-quote-delimited in the AI prompt string but the note content is never checked for `"""`. A note containing `"""` closes the delimiter early, injecting arbitrary instruction text into the model. Fix: strip or escape `"""` from user-supplied notes before interpolation.
- `features/reports/attachments.ts:123` + `features/documents/actions.ts:241` — `fileSize` and `contentType` are accepted verbatim from the client at finalize time. `fileSize` is used for quota accounting. Fix: stat the actual uploaded object from Supabase Storage at finalize time and use the real size and MIME type.
- `features/notes/actions.ts` (`updateNote`) — `visibility` is stored without validation against the allowed enum values. Fix: validate against the allowed set before storing.

**Data integrity / transactions**
- `features/members/actions.ts` (`inviteMembers`) — Profile row is deleted (line ~931) before the Supabase Auth API call. If the API call fails, the profile is permanently lost with no rollback path. Fix: call the Auth API first; delete the profile only on success.
- `features/productions/actions.ts` (`createProductionFull`) — Five sequential DB writes with no wrapping transaction. A mid-sequence failure leaves a partially-constructed production. Fix: wrap in a Drizzle transaction.
- `features/billing/actions.ts` (`createCheckoutSession`) — Two concurrent clicks can both read `stripeCustomerId = null`, create two Stripe customers, and the second write overwrites the first, orphaning one. Fix: DB-level unique constraint or `INSERT ... ON CONFLICT DO NOTHING`.
- `features/scripts/actions.ts` (`startScriptParse`) — Org monthly AI parse budget check and the insert are separate statements with no lock. N concurrent calls all pass the budget check simultaneously. Fix: atomic `INSERT ... SELECT ... WHERE count < LIMIT` or a Postgres advisory lock.
- `db/schema/production-memberships.ts` — No unique constraint on `(userId, productionId)`. Application code prevents duplicates, but there's no DB-level safety net. Fix: add `uniqueIndex` on the pair. (Note: composite unique constraints previously caused `drizzle-kit push` to hang — see decision-log.md 2026-05-05; apply via direct SQL migration instead.)

**Low severity**
- `features/reports/send-report.ts` (~line 98) — All recipients are placed in a single `to:` field. Each recipient can see every other recipient's email. Fix: send individually per recipient or use `bcc:`.
- `features/blocking/actions.ts` (`createBeatComment` mention notifications) — Notifications fire after the filtered mention list is stored, but the notification dispatch reads from the stored `mentionedUserIds` — now already filtered. No additional change needed here; this was resolved by the batch-2 fix.

---

## Proscene Studio (designer-seat) billing — follow-ups (added 2026-06-29)

- **Per-write-action tool gating for Single Tool — RESOLVED 2026-06-30.** `assertCanMutate` gained an optional `tool` param; every write in `features/blocking/actions.ts` passes `"blocking"` and every write in `features/scripts/actions.ts` + `features/scripts/ocr-actions.ts` passes `"script"`, so for designer-only users the guard delegates to `assertDesignerCanUseTool` (tier must include that tool) instead of just the active-seat check. Shared surfaces (documents, scenes) stay on the seat check by design. Closes the hand-crafted-server-action bypass confirmed in the 2026-06-30 billing security review.
- **Referral incentive deferred.** The designer→org referral engine (3 free months per referred org, lockstep in-arrears vesting, clawback on refund) from this spec is not built. It needs real Stripe coupon/credit infrastructure (the same infra the 15%-off org nudge wants).
- **Designer plan upgrade — consent step added 2026-07-02 (interval issue resolved).** The locked-tool modal is now two-step: `previewDesignerPlanChange` prices the change (exact prorated amount via `stripe.invoices.createPreview`) and only an explicit confirm click charges via `changeDesignerPlan`, which now preserves the subscriber's billing interval (annual stays annual). Verified live in sandbox pre-consent-step (single_tool → studio_pro, in-place price swap on the same subscription); the confirm-step version still needs one sandbox pass.
- **`cancel_at_period_end` isn't synced — pending cancellations are invisible in-app (added 2026-07-02).** A portal cancel-at-period-end leaves our status `active`, so settings can't show "cancels on <date>" until the deleted event fires at period end. Access behavior is correct; it's a display gap. Fix options: sync the flag to a new `designer_cancel_at_period_end` column (webhook already receives it) or read the sub live on the settings page. Same gap exists org-side.
- **Designer → full-app ("level up") conversion — v1 BUILT 2026-07-02 (owner ask; no cancel-and-re-signup).** In-app splash page `/focus/full-app` (feature grid, company tiers, trial promise) + one-click `upgradeToFullApp()` (`features/designer/actions.ts`): winds the Studio seat down via `cancel_at_period_end` (keeps paid time; aborts if Stripe errors), grants the org the standard **60-day trial from conversion day** (re-stamps the anchor — safe, the flip is one-way per account; skipped if grandfathered/subscribed or billing paused), flips `accessMode` to `full`, hard-nav to `/dashboard`. Linked from the tool-lock modal footer, Focus settings billing, and the seatless `/focus` paywall. Org tiers deliberately NOT in the lock modal. **Still open:** plan pre-selection at conversion (today they pick a plan later in Settings → Billing, where subscribe-during-trial already defers the charge to trial end); a convert coupon; whether a converted account can go back to designer-only. Deeper entitlement questions stay with the **Accounts & entitlements model** scoping (above).
- **Change card at the upgrade moment (added 2026-07-02, owner ask).** The in-app upgrade charges the subscription's default payment method with no way to switch cards mid-flow. Card management EXISTS today via the portal ("Manage billing" in both the lock modal and settings). Improvement: a "pay with a different card" link on the confirm panel that opens a portal `payment_method_update` flow (`billingPortal.sessions.create` with `flow_data`) returning to the locked tool. Small, contained. **Update 2026-07-02:** the dunning half of this is RESOLVED — `changeDesignerPlan` now uses `payment_behavior:"error_if_incomplete"`, so a declined upgrade charge aborts with no tier grant (no more "granted during dunning"). Remaining: the different-card affordance, and note the fail-closed tradeoff that a 3-D Secure card is refused rather than prompted (revisit if it bites real users — a Checkout-based upgrade would handle SCA).
- **Solo designer cast for Blocking.** A single-player Studio designer has no team to draw cast from, but the Blocking canvas needs actors to place. We never built a "designer adds their own cast" path (spec 21 framed the workspace as single-player Script + Blocking but didn't resolve this). Real gap, separate from billing — revisit when building out the designer Blocking experience.

---

## RESOLVED 2026-07-03: billing axis by workspace (Canva/Monday model) — server side DONE; toggle UI remains

- **Was:** the billing guards chose the axis from the caller's global `accessMode`, so a designer-mode member of a company org was gated on their personal seat, not that org's billing (could write into a lapsed company; locked out of a paid one).
- **Owner's model:** a designer can be a working member of a paid org and use ALL of that org's tools (gated by the ORG's billing); separately they can pay for their own Studio seat, and that personal work lives in a SEPARATE personal workspace (gated by the SEAT); they toggle between the two. Hard line: a designer must never use a paid org's entitlement to do their own / another non-paying company's work.
- **Resolved in PR #66 (replaces the interim footprint heuristic):**
  - New `organizations.is_personal_workspace` flag (migration `add_is_personal_workspace_to_organizations`), true ONLY for a designer's seat-gated workspace (set at designer signup; NOT for "individual" full accounts, which stay org-billing gated + run a normal trial). Flipped to false by `upgradeToFullApp`.
  - `seatGoverns(user, org) = isDesignerOnly(user) && org.isPersonalWorkspace` picks the axis: seat in the designer's own workspace, org billing everywhere else.
  - `assertCanCreateProduction` **structurally blocks** a designer from creating productions inside a company org (their own productions go in their personal workspace on their seat) — the owner's "easy fix" that prevents freeloading a paid org's suite for outside shows.
  - `startTrialIfFirstProduction` skips `is_personal_workspace` orgs (personal workspaces never run the org trial clock; companies start it on first production regardless of creator — closes the brand-new-company leak the heuristic had). The earlier 3 call-site `isDesignerOnly` gates are reverted.
- **Remaining (UI only, not entitlement/security):** the designer-facing **workspace toggle** (personal Studio ⇄ company orgs). Server-side gating already enforces the right axis for each; `is_personal_workspace` is now a real column the toggle can surface.
- **Related, ALREADY FIXED (PR #66):** `upgradeToFullApp` trial-farming (admin check + set-once guard).

## Replace mock UI with accurate representations (added 2026-06-30)

- **Owner goal:** swap stylized/mock product imagery for faithful representations of the *real* UI everywhere — the marketing site's product mockups/screenshots and in-app placeholders alike, so what people see matches the actual app.
- **Known instance:** the Focus locked-tool teaser (`features/designer/tool-lock.tsx`) is currently a stylized approximation (a generic stage with actor tokens for Blocking, character cues + dialogue for Script). The **Blocking** teaser especially should be brought closer to the actual blocking-canvas UI (ground plan, real piece/marker styling). Cross-cutting design polish — deferred, address as a batch.
- **No designer trial; storage cap advisory.** v1 designer seats have no free trial (charge on subscribe), and the 25 GB designer storage cap (`DESIGNER_STORAGE_GB`) is not enforced (parity with the org `STORAGE_LIMIT_GB`, also advisory). Revisit if abused.
- **Studio billing — security-reviewed 2026-06-30; still needs a typecheck/build.** A focused billing review (identification + three adversarial verification passes) found **no presently-exploitable HIGH/MEDIUM** issue. Only confirmed finding: the Single Tool per-tool bypass (LOW, now fixed above). Two webhook trust-boundary candidates verified as **not exploitable** (event signature-verified; `profileId`/`organizationId` are server-set to the authenticated user at checkout; the two axes mint separate Stripe customers and designer subs are always tagged `kind="designer"`) but were hardened regardless: `syncSubscription`/`syncDesignerSubscription` now require the resolved row's stored Stripe customer id to be null-or-equal to the event's `customer`, so any mismatch is a 0-row no-op. Built in a deps-less clone → **still not typechecked**; run `npm run type-check && npm run build` (CI on PR #66) before going live.

---

## Accounts & entitlements model — paid orgs vs free personal users (added 2026-06-30)

- Owner wants the **Canva/Monday.com model**: a personal user account is **free**
  (view/basic only); an **organization** is the **paid** entity carrying the full
  feature set; an org invite grants an existing user paid features **while in that
  org's context**; switching back to a personal workspace drops to free.
- Motivating concern: **creating a new org is currently frictionless** and isn't
  treated as the significant, billable action it is (it effectively provisions a
  new paid/trial account).
- **Status: deferred to its own scoping pass** (after the QA batches). It's a
  billing + entitlement architecture change — gate features on "active paid org
  context" not role alone, define what the free tier unlocks, add org-creation
  guardrails, and reconcile with the existing trial logic (`assertCanMutate`,
  trial anchoring at first-production creation). Full context in `qa-backlog.md`.
  Do NOT fold into a QA batch.

## Multi-character casting tracks — pursue at all? (added 2026-07-07)

- Decision 1 (2026-06-29) approved letting one person be cast in multiple
  characters (an actor covering several supporting roles). It was deliberately
  left out of Batch 3 (report inputs) and is now **on hold**: the owner is
  **reconsidering whether to build it at all** and wants time to think before
  it's scoped.
- **Open question:** is this worth the casting-model change? Today the model is
  strictly one-person-one-role (`assignRoleToMember` swaps rather than stacks).
  Supporting multi-character means rethinking the character-slot model, the
  cast/crew board UI, and anything that assumes a person maps to one role.
- **Status: do not start.** Revisit only when the owner decides. If yes, it's
  its own schema-batch effort, not a QA item. See `decision-log.md` (2026-07-07)
  and `qa-backlog.md` (Decision 1, marked on-hold).

## Two batch-1 bugs not reproducible on desktop Chrome (added 2026-06-30)

- **PDF viewer fails on first click / recovers after a tab switch**, and **script
  PDF download navigates away instead of opening a new tab** — owner could not
  reproduce either on desktop Chrome (PC + Mac); the code paths look correct
  (signed URL with attachment disposition; "View" opens a new tab; in-viewer
  exports are blobs). Left OPEN for cross-browser/device testing (Safari /
  Firefox / mobile are the likely variance). No code change made.

## "Set pieces should start empty" — interpretation to confirm (added 2026-06-30)

- Implemented as a **collapsed "Basic shapes" disclosure** in the blocking
  set-piece panel: a fresh palette leads with custom uploads + the upload button,
  and the built-in generic shapes stay one click away rather than being deleted.
  If the reviewer meant removing the built-ins entirely, that's a small
  follow-up.

## Marketing-truth pass (M2) — features desired but not yet built (added 2026-07-14)

The M2 copy pass (Batch 6) removed claims the app doesn't back. The owner confirmed several of these are **wanted later** — they are future features/specs, not shipped, and marketing must not re-assert them until built:

- **Per-show conflict / clash detection.** Flag people double-booked or unavailable when casting / generating calls, company-wide. (Today only the *generate calls* form has a "skip clashes" toggle — the closest existing thing.) Owner: "want to eventually add a conflict system for each show when people are cast."
- **Automated email reminders before events/rehearsals.** Owner: email reminders "would be nice as an automated reminder before events/rehearsals." Note the current reality: **calls send no notifications at all** (`features/calls/` has no push/email path); push exists only for announcements + @mentions. An email-reminder feature would be the first proactive call alert — needs a scheduler + opt-out.
- **Drag-to-reschedule calendar.** A possible future UX affordance; today calls are edited via the form.
- **iCal / .ics subscribe** from Google/Apple/Outlook. Security-sensitive: signed per-user feed URLs, an unauthenticated data-exposure surface — needs its own spec (flagged in `ux-backlog.md` M2 security note).
- **Report PDF export.** Reports distribute by email only today; script & blocking already export to PDF.
- **Native iOS/Android apps.** Proscene is a PWA (installable to home screen) today; native apps are roadmap.

## Discovered during M2: calls send no notifications (added 2026-07-14)

`features/calls/` has no notification/push code — creating or moving a call does **not** alert anyone; cast see the change only when they next open the app (call *confirmations* do exist). This may be intended, but it undercuts the "instant notice when a time moves" story and is the natural home for the email-reminder feature above. Worth confirming whether call-change push is desired.
