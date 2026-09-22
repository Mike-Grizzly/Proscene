# Current Status

**Last updated:** 2026-07-22

**Session 2026-07-22 (pre-launch security & architecture review, branch `claude/security-architecture-review-lyd0ud`):** full security sweep ahead of launch — (1) audited the merged UX-design series (PRs #71–#85, range `8a23ba9..fd9bdee`) against the ux-backlog security ground rules: **all invariants held**, the series' only server-side surface being the gated self-scoped `getUnreadNotificationCountsByType`, the Sanity fetch timeout, and the `workflow_dispatch`-only blog-seed workflow (secret via repo secrets). (2) Full-project pass: scripted sweep of every `"use server"` export for auth presence (manual verification of all flagged functions), auth core, all 5 API routes, headers/CSP, upload validation, secrets grep, `npm audit`, Supabase security advisors, and **live SQL verification** of the CallBoard project. **One fix: `createDefaultFolders` was an exported `"use server"` endpoint with no auth check** (internal helper for production creation; worst case cross-tenant folder-spam, LOW) — moved to non-action module `features/documents/folders.ts`, callers re-pointed. **Live DB confirmations:** `storage.objects` RLS enabled with zero policies + `attachments` bucket private (the "pending at launch cutover" flip in `open-questions.md` was in fact already done — entry updated); every public table deny-all as designed; leaked-password protection still disabled (needs Pro — on the launch checklist). **Dependency note:** 25 prod-path advisories (`next@16.2.9` HIGH via postcss/sharp among them) — `npm audit fix` + Next patch recommended before launch, none known-exploitable in this app's usage. Full report incl. the consolidated **owner launch checklist** and open-backlog inventory: **`docs/security-review-2026-07-22.md`**. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` green before and after the fix.

**Last updated (prev):** 2026-07-21

**Session 2026-07-21 (M11 hydration fix + M13 decision, branch `claude/m11-hydration`):** closed the last two open backlog items. **M11 (home hydration warnings):** reproduced the dev-only React hydration failure on `/` by running `next dev` with a dead proxy (marketing renders without a DB; Sanity falls back to static) and reading the console in headless Chromium. Root cause was **not** the Sanity hero swap as originally guessed — `HOME_HTML` in `app/(marketing)/home-content.ts` had **one stray `</div>`** in the hero block (98 opens / 99 closes). The extra tag closed the `dangerouslySetInnerHTML` wrapper early on the server, so the document parser spilled the following `<section>`s out as siblings — a DOM the client's `innerHTML` parse didn't reproduce → mismatch (React even hinted "Invalid HTML tag nesting"). Removing the one tag balanced the markup; re-verified **zero hydration/script console errors**, homepage renders unchanged (screenshot). One-line fix. **M13 (marketing dark mode):** owner decision — **keep the marketing site always-light** (deliberate brand choice); no code, logged in decision-log. Files: `app/(marketing)/home-content.ts` (−1 line), docs (`ux-backlog.md` M11 ✅ + M13 ✅, `decision-log.md`, this file). With these, the **entire UX backlog is complete** — only the ongoing ratchet rules (S6/S7/S8) remain, which aren't standalone tasks. `tsc` + `eslint` + **185 tests** + `next build` green. See `decision-log.md` (2026-07-21).

**Session 2026-07-21 (Brand: three-theme handoff adopted, branch `claude/brand-color-update`):** the owner uploaded a three-theme brand handoff to `handoff/handoff 2/proscene-brand-tokens/` (Brand Color Explorer). Implemented it app-wide, mapped onto the existing theme slots: **light = Proscene** (warm paper `#ECE6DA` + **dark ink side rail**), **dusk = Proscene Medium** (a **split** theme — ink canvas `#20252F` with paper `.card` tiles), **dark = Proscene Dark** (full ink `#16191F`). All three share **one amber accent `#E0A23A`**, and filled-button text is **dark ink in every theme** (amber is light → dark-on-amber clears AA even on dark UI). This supersedes the 2026-07-20 interim (light amber / dusk+dark crimson): **dusk + dark are amber now** — the "reshared dark palette." Architecture: accent single-sourced in `app/brand-tokens.css` (amber + light/dark soft/ink tint pairs + `--brand-accent-on`); per-theme surfaces/ink/borders/rail in `app/globals.css` theme blocks (values verbatim from the handoff). The dark rail is a **scoped token remap** on `.rail` (general tokens → `--rail-*`, no per-rule rewrite); the split Medium theme uses `body[data-theme="dusk"] .card { … }` to flip tiles to paper. Marketing kept its own always-light neutrals (`#F8F5EF`) but reads the shared amber accent. Expected split-mode behaviour: only `.card` surfaces flip to paper in dusk (non-card drawers/menus/inputs stay ink by design). Files: `app/brand-tokens.css`, `app/globals.css`, `app/(marketing)/marketing.css`, docs (`branding.md` rewritten, `decision-log.md`, this file), handoff README marked Implemented. No server-action/permission/storage/proxy change — CSS only. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` green; all three themes harness-rendered (ink rail, paper/ink split, amber dark-ink buttons legible everywhere). See `decision-log.md` (2026-07-21) + `docs/branding.md`.

**Last updated (prev):** 2026-07-20

**Session 2026-07-20 (UX Backlog Batch 11 — R8 + brand colour system, branch `claude/ux-backlog-batch-11`):** two things. **R8 (wizard rehearsal times):** the new-production wizard collected typical rehearsal start/end as free-text ("7:00 PM") while every other time field uses `<input type="time">` — unified on the real time picker (defaults now 24-hour "19:00"/"22:30", matching the format the call form stores/reads; review step formats back to 12-hour via a small `fmt12h`, shows "—" when unset). The stored values aren't yet read for call-time prefill, so 24-hour is forward-compatible, not breaking. **Brand colour → single source of truth (resolves M12):** owner confirmed the marketing **"paper & spotlight"** palette — off-white paper `#F8F5EF`, dark-blue ink `#15181F`, spotlight-amber accent `#E0A23A` — is the product brand, and it now applies to the **app** (light mode), retiring the old curtain crimson there. New **`app/brand-tokens.css`** holds all `--brand-*` seeds; both `globals.css` (app, all themes) and `marketing.css` (`.ps-site`) read from it, so app + marketing can't drift and a rebrand is a one-file edit. Key correctness points: the app had **zero hardcoded brand hexes** so light became amber via a clean token cascade; ~28 accent-filled surfaces switched `color:white`→`var(--on-accent)` (dark ink on amber — white-on-amber fails WCAG AA); **dusk/dark left unchanged (old crimson)** per owner pending a reshared dark palette, reading placeholder `*-dusk`/`*-dark` seeds so the real values drop in with one edit; marketing is **byte-identical** and stays always-light (reads the canonical, never-themed `--brand-accent`, so dark-theme app users don't recolour it). The old M12 "crimson signup split" healed automatically — signup already used `var(--accent)` + the amber `brand-*.svg` logos. Files: new `app/brand-tokens.css`; `app/globals.css`, `app/(marketing)/marketing.css`, `app/(app)/productions/new/new-production-wizard.tsx`; docs (`dev-rules.md` new "Brand colour — single source of truth" rule, `decision-log.md`, `ux-backlog.md` M12 ✅/M13 deferred). No server-action/permission/storage/proxy change — CSS + one client form. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` green; compiled-CSS confirmed the wiring (`:root`/dusk/dark/`.ps-site` all resolve to the right seeds) and a static harness verified light mode (amber buttons, **dark ink** legible) and dark mode (unchanged crimson, white text). Remaining backlog: **M11** (home hydration warnings — needs a live dev overlay), **M13** (marketing dark mode — owner tracking), ongoing S6/S7/S8; dusk/dark amber values pending owner reshare. See `decision-log.md` (2026-07-20).

**Session 2026-07-14 (UX Backlog Batch 10 — finish S1: migrate the last 3 drawers, branch `claude/ux-backlog-batch-10`):** completed the S1 series — the remaining three drawers now render through the shared `<Drawer>` primitive, so **all five drawers** are migrated and S1 is ✅ DONE. **announcement-detail-drawer** (`ann-`) and **event-drawer** (`cal-`) dropped their bespoke wrap/scrim + Escape + slide and gained focus trap + mobile bottom-sheet; their namespace CSS collapsed to content scroll regions (deleted `.ann-drawer-wrap` + its mobile-sheet block + `ann-sheet-up` keyframe; deleted `.cal-scrim` + `cal-drawer-in` keyframe + the mobile `.cal-drawer` re-positioning). **document-drawer** is the outlier — migrated but keeps its fullscreen overlay (bumped to z-index 260 to clear the drawer root at 240) and routes Escape/backdrop through a fullscreen-aware dismiss handler; `mobileSheet={false}` keeps the viewer a wide right panel (92vw) on phones instead of a sheet. The `pp-fade`/`pp-slide` keyframes stay (still referenced by other overlays). Files: `components/announcements/announcement-detail-drawer.tsx`, `app/(app)/calendar/event-drawer.tsx`, `app/(app)/productions/[slug]/documents/document-drawer.tsx`, `app/globals.css`. No server-action/permission/storage/proxy change — pure client UI. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` (86 pages) green; all three harness-verified at 1440px (460/420/1325px right panels) and ≤720px (ann/cal bottom sheets, doc stays 92vw right panel). With S1 done, the only backlog items left are M11 (home hydration warnings) and the decision-only M12/M13. See `ux-backlog.md` (S1 ✅, S4 updated) + `decision-log.md` (2026-07-14 Batch 10).

**Session 2026-07-14 (UX Backlog Batch 9 — S1 series, migrate person-drawer, branch `claude/ux-backlog-batch-9`):** second drawer onto the shared `<Drawer>` primitive. `people/person-drawer.tsx` now renders through `<Drawer>` — dropped its `.pp-drawer-wrap` backdrop + own Escape handler + `pp-slide` panel, gaining the focus trap it lacked and a mobile bottom-sheet. CSS: deleted the now-unused `.pp-drawer-wrap` rule and collapsed `.pp-drawer` to a content scroll region (`flex:1; overflow-y:auto`); the `pp-fade`/`pp-slide` keyframes stay because document-drawer and other overlays still reference them. Both callers (people-directory, cast-crew-board) conditionally mount the drawer so it opens already-true — the enter slide plays; the ConfirmDialog for the three destructive actions is unchanged (now a sibling of `<Drawer>`). Files: `app/(app)/(default)/people/person-drawer.tsx`, `app/globals.css`. No server-action/permission/storage/proxy change — pure client UI. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` (86 pages) green; harness-verified (480px right panel at 1440px, full-width bottom sheet at ≤720px). Remaining S1 drawers: announcement (`ann-`), event (`cal-`), document (outlier, last). See `ux-backlog.md` (S1 🟡 2/5, S4 updated) + `decision-log.md` (2026-07-14 Batch 9).

**Session 2026-07-14 (UX Backlog Batch 8 — shared Drawer primitive + first migration, branch `claude/ux-backlog-batch-8`):** started the **S1** shared-`<Drawer>` series (the last real piece of the backlog). Built `components/ui/drawer/` — a `<Drawer>` primitive that owns every cross-cutting drawer behaviour (portal, backdrop, Escape, body-scroll lock, focus trap + focus return via S4's `useFocusTrap`, the enter/exit slide, and a ≤720px bottom-sheet mode), so drawers supply only content. **Motion is deliberately single-source** (answering the owner's ask that behaviour changes propagate to all drawers): the open/close duration lives in `drawer.constants.ts` (`DRAWER_DURATION_MS`) and is injected as the `--drawer-dur` CSS var so the JS unmount delay and the CSS transition stay locked together; the easing/snap, backdrop tint, slide distance, width, and sheet height are CSS variables in `drawer.css`. Retune any one of those in a single place and every drawer updates. **First migration:** `trash-drawer.tsx` now renders through `<Drawer>` — it dropped its bespoke portal/backdrop/Escape/`anim-in` shell and *gained* the focus trap it previously lacked (an S4 win) plus the mobile bottom-sheet. Per the backlog's "one drawer per PR" rule, the other four drawers (person `pp-`, announcement `ann-`, event `cal-`, and the document-drawer outlier with its 1400px width + fullscreen mode) follow in their own PRs. Files: new `components/ui/drawer/{drawer.tsx,drawer.css,drawer.constants.ts}`, `app/(app)/productions/[slug]/trash-drawer.tsx`. No server-action/permission/storage/proxy change — pure client UI. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` (86 pages) green; the drawer is `(app)`-only (no DB render in the sandbox) so verified via the compiled-CSS harness — 480px right panel at 1440px, full-width bottom sheet at ≤720px. See `ux-backlog.md` (S1 🟡, S4 updated) + `decision-log.md` (2026-07-14 Batch 8).

**Session 2026-07-14 (UX Backlog Batch 7 — settings hub + deep-route breadcrumbs, branch `claude/ux-backlog-batch-1-ig6614`):** shipped the two IA tasks held back from Batch 5/6. **N5 (settings hub cleanup):** `/settings` was a flat identity card + junk-drawer link list with a workspace switcher that duplicated the desktop rail badge. Rebuilt as labelled sections — **Account** (profile & password + the theme control), **Notifications** (preferences), **Workspace** (settings/members/billing, managers only), **Help** (feedback) — each with a one-line description and stacked label+hint rows (`.more-item-main`/`.more-item-sub`), plus a cross-link from the Workspace section to per-show settings. The duplicate org switcher is now **mobile-only** (`.settings-ws-switch`, `display:none` above 720px): the rail badge is the single desktop switcher, but the rail is hidden on phones so the settings switcher stays the mobile switch path. **N6 (deep-route breadcrumbs):** new client component `<ProductionCrumbTail>` mounted in the production layout crumb bar derives tab + sub-segment crumbs from the pathname (e.g. `Productions › {show} › Rehearsal Schedule › Templates › Edit`), leaf as `aria-current` text, earlier segments as links — so one click from any depth returns to the parent list; dynamic id segments are skipped as crumbs but still thread the cumulative href; `.crumbs` gained `flex-wrap: wrap` for phones. Files: `app/(app)/(default)/settings/page.tsx`, `app/(app)/productions/[slug]/layout.tsx`, `components/app-shell/production-crumb-tail.tsx` (new), `app/globals.css`. No server-action/permission/storage/proxy change — the `settings:manage` gate on the Workspace section is unchanged, and the switcher still calls the same already-gated `switchOrganization`. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` (all 86 pages) green; both surfaces are `(app)`-only (no DB render in the sandbox) so verified via the compiled-CSS static harness at 1440px (switcher hidden) and ≤720px (switcher visible, crumb wraps). Remaining from the backlog: **S1** shared-Drawer series (incremental, carries S4's drawer focus-trap coverage), **M11** (home hydration warnings), and the decision-only **M12/M13**. See `ux-backlog.md` (N5/N6 rows ✅) + `decision-log.md` (2026-07-14 Batch 7).

**Session 2026-07-14 (UX Backlog Batch 6 — M2 marketing truth pass, branch `claude/ux-backlog-batch-6`):** shipped the P0 marketing-truth pass (M2) — the last unbatched P0 — as its own copy-only PR. Every unbacked feature claim was softened/removed per the owner's per-claim ruling: **conflict detection** (removed; real per-show version is a future feature), **drag-to-reschedule** (removed), **works offline** (removed → PWA install story), **native app store** (reworded to "installable web app" / PWA "Add to Home Screen," native apps noted as roadmap; footer "Mobile app" link retired), **SMS reminders** (removed — push is announcements/@mentions only), **iCal subscribe** (removed), **report PDF export** (reports are email-only; *script/blocking PDF export is real and untouched*), **cross-company script cache** ("free for the next company" removed; the real within-company per-user script sharing described accurately). Two truth issues found while editing were also softened: marketing implied **calls send notifications** (they don't — `features/calls/` has no push path; only call *confirmations* exist) and a **schedule export** that doesn't exist. Files: `home-content.ts`, `features/content.ts`, `faq/content.ts`, `pricing/content.ts`, `_components/footer.tsx` — copy only, no app/server/schema change. `tsc` + `eslint` + **185 tests** + `next build` green; home/features/pricing/FAQ **screenshot-verified on the dev server** (marketing renders without a DB). Owner-desired future features (per-show conflict detection, automated **email reminders before events**, drag-reschedule, iCal, report PDF, native apps) logged in `open-questions.md` + `decision-log.md`. **N5 (settings hub) and N6 (deep-route breadcrumbs) were held for a later batch** so this copy diff reviews cleanly. Next candidate: Batch 7 = N5 + N6 (+ the S1 shared-Drawer series). See `ux-backlog.md` (M2 row ✅) + `decision-log.md` / `open-questions.md` (2026-07-14 M2).

**Session 2026-07-14 (UX Backlog Batch 5 — design-system + polish, branch `claude/ux-backlog-batch-5`):** landed the system/polish batch from `docs/ux-backlog.md`. Nine tasks shipped; four deferred to keep the PR reviewable. **Shipped:** **S9** — TipTap list markers: the `.prose` path already restored them; the gap was the announcements *center* (`.ac-item-body`, no `.prose`) — added matching `list-style` restore (CSS-only, sanitize untouched). **N9** — deleted the unreachable `[data-theme="cool"]` token block + `[data-density=compact/comfy]` blocks (regular defaults live in `:root`). **M9** — the static FAQ is generated from a `FAQ_CATEGORIES` data array so sidebar counts derive from `items.length` (no more hardcoded 4/4/4/4/3); `SanityFaq` already renders the identical layout with derived counts. **M10** — `loadQuery` now passes `AbortSignal.timeout(3000)` to the Sanity fetches so an unreachable CMS aborts fast and every marketing page falls back to its static content (each wrapper already try/catches). **S3** — new `<EmptyState>` (`components/ui/empty-state.tsx`, `card`/`bare` variants) adopted in documents, script, notes, member-list, and the people-directory reference (context-aware copy preserved by passing resolved title/hint). **S5** — shared `<RouteLoading>` + `loading.tsx` for every production tab that lacked one (announcements, calls, documents, members, notes, videos, reports list); existing script/blocking/report-detail loaders refactored onto it. **S4 (partial)** — reusable `useFocusTrap` hook applied to `ConfirmDialog` (backs every destructive-action confirm); drawers deferred with S1, editor modals deferred (Tab-trap fights TipTap). **S10** — a11y on the three thin surfaces: announcements center (filter `aria-pressed` in a labelled group, feed `role=list`/`listitem`, `aria-live` count), notification bell (`aria-haspopup`/`aria-expanded` + unread in label, panel region, rows `role=list`), members board (contextual `aria-label`s on icon buttons, mobile tabs `aria-pressed`). **N7** — the production breadcrumb is now `<ProductionSwitcher>`, a dropdown of the user's visible productions (reuses `getVisibleProductions`), falling back to the plain label with one production. **Deferred (documented in the backlog rows):** **S1** (shared Drawer — the backlog itself says migrate one drawer per PR, so it's its own incremental series; S4's drawer coverage rides along), **N5** (settings hub cleanup — M), **N6** (breadcrumbs for deep routes — M), **M11** (home hydration warnings — needs a running dev overlay the sandbox can't exercise). Client-side UX + one new gated read query (announcement fetch timeout is server-only). No server-action/permission/storage/proxy changes. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` green; new visual pieces (EmptyState card/bare, breadcrumb switcher) screenshot-verified via static harness. **Verification note:** `(app)` surfaces don't render in the DATABASE_URL-less sandbox — owner should click through a preview deploy (empty states, route spinners on slow nav, production switcher, keyboard focus-return on a ConfirmDialog, screenreader pass on announcements/bell). See `ux-backlog.md` (Batch 5 rows ✅/🟡) + `decision-log.md` (2026-07-14 Batch 5).

**Session 2026-07-14 (UX Backlog Batch 4 — mobile, branch `claude/ux-backlog-batch-4`):** landed the mobile batch from `docs/ux-backlog.md` (B1, B2, B4; B3 shipped in Batch 3). Branched from `main` after Batch 3 (#74) merged, per the one-batch-at-a-time process. **B1 (the centerpiece)** — the rehearsal-report *form* now has a real phone layout: the day's-work section card renders as the horizontal tab strip on desktop and a **stacked accordion at ≤720px** (`report-form.tsx`; the six sections interleave head+panel in one `.rf-sections` flex container, and a CSS `order` shuffle puts the visible panel below the tab row on desktop vs. right under its header on mobile — **all panels stay mounted**, inactive ones `display:none`, so the whole form still submits regardless of which section is open). **Department notes are edited inline** in the accordion on mobile (a `RichTextEditor` per dept, one open at a time via the existing `editingDept` state) instead of the desktop `DeptNoteModal`, which is now desktop-only. The report header title/actions stack full-width and Next-rehearsal collapses to one column at phone widths. Discovery worth recording: the summary editors' `grid grid-3`/`grid-2` classes are **`.np-root`-scoped only**, so they already render single-column app-wide — the form was never actually a 3-column desktop grid, so no desktop layout changed. **B2** — iOS auth auto-zoom: `.auth-screen .field`/`.auth-split .field` floored at **16px** (scoped to the two auth layouts) so WebKit never triggers the layout zoom; tester guide updated to ask for on-device confirmation; `ZoomReset` kept as a safety net pending that. **B4** — More-page/tab badges: announcements already fan out an in-app notification (`type: "announcement"`), so new `getUnreadNotificationCountsByType()` groups the user's unread notifications by type — the More page badges the **Announcements** row with the unread-announcement count, and the bottom **More** tab carries the aggregate unread count threaded `AppLayout → AppFrame → MobileTabBar`. Activity stays unbadged (placeholder surface); the Notes→Announcements 5-tab swap is deferred pending real usage. Client-side UX + one new gated read query; no server-action/permission/storage/proxy changes. `tsc` + `eslint` (0 errors) + **185 tests** + `next build` green. **Verification note:** `(app)` surfaces are auth-gated and don't render in the DATABASE_URL-less sandbox, so B1 was **screenshot-verified via a static harness** (compiled `globals.css` + the new rules) at desktop and phone widths — desktop tab strip unchanged, mobile accordion shows all six sections reachable with no horizontal scroll, header actions stacked, dept cards inline; note that headless Chromium clamps to a ~500px min viewport here, so "390px" shots are a crop of a 500px render (no real overflow — DOM measurement confirmed equal-width flex buttons). Owner should still click through a preview deploy on a real phone (report create/dept-note/attach/distribute at 390; More/tab badges; iOS auth zoom). Next: Batch 5 (system: S1 S4 S3 S5 S9 S10, N5–N7 N9, M9–M11). See `ux-backlog.md` (Batch 4 rows ✅) + `decision-log.md` (2026-07-14 Batch 4).

**Session 2026-07-13 (UX Backlog Batch 3 — IA, branch `claude/ux-backlog-batch-3`):** landed the information-architecture batch from `docs/ux-backlog.md` (N1, N3, N4, N8, B3). Branched from `main` independently of Batch 2, then merged after Batch 2 (#73) landed. **N4** — one source of truth for workspace nav: `components/app-shell/nav-items.ts` now holds `NAV_ITEMS` (each with `surfaces: ("rail"|"more")[]`) + `navItemsFor(surface, role)`; the desktop rail and mobile More page both derive their gated lists from it (dead "Productions" rail entry removed). Mobile bottom tab bar stays separate on purpose (curated, context-aware, ungated). New `nav-items.test.ts` asserts the helper reproduces the exact pre-refactor rail/more output for all 8 roles. **N1** — the orphaned `NotificationBell` is mounted at last: rail foot (`placement="up"`) + mobile More header, unread count fetched server-side in both. **N3** — Cast & Crew promoted from a topbar button to a **tab** (after Overview, same `productions:manage` gate); Blocking icon Layout → Move; duplicate topbar button dropped. **N8** — onboarding notification prompt no longer interrupts established users: **modal only on first-run empty-workspace dashboard**, **dismissible card on populated dashboard** (both persist prefs, so "Not now" never re-prompts). **B3** — mobile production tab strip gets a right-edge `mask-image` fade + peek padding. IA/nav only — no server action, permission, storage, or proxy changes; the gating-sensitive spot (N4) is guarded by the per-role test. `tsc` + `eslint` (0 errors) + **185 tests** (+17 nav) + `next build` green. **Verification note:** auth-gated `(app)` surfaces don't render in the DATABASE_URL-less sandbox — verification is code/type/build/test level per the backlog gotcha; owner should click through a preview deploy (bell, Cast & Crew tab, onboarding card, mobile tab fade at 390px). Next: Batch 4 (mobile: B1 B2 B4). See `ux-backlog.md` (Batch 3 rows ✅) + `decision-log.md` (2026-07-13 Batch 3).

**Session 2026-07-13 (UX Backlog Batch 2 — action safety, branch `claude/ux-backlog-batch-2`):** landed the destructive-action-friction batch from `docs/ux-backlog.md` (S2, R1–R6; R7 done in Batch 1). **S2** — global toast: `components/ui/toast.tsx` (`ToastProvider` + `useToast()`), extracted from the cast-crew board's hand-rolled `.ax-toast` (same styling/timings), mounted in the **root layout** so the focus view is covered too; board migrated. **R5** — `ConfirmDialog` (danger, naming the person/thing) on the four unguarded destructive flows: video delete (+ its timestamp notes), remove-from-production (board + person drawer), remove-from-organization (member list + drawer), and note-tag delete. **R4** — zero native `confirm()`/`alert()` left in `app/` + `components/` (grep-verified): delete-call/document/announcement buttons, document row menu, trash-drawer permanent delete, AI-analysis discard, workspace logo remove, ownership transfer, person account delete all use `ConfirmDialog`; alert-style errors now `toast.error`. **R6** — `archive-buttons.tsx` refactored onto the branded dialog + inline-error pattern from `production-card-menu.tsx` (one confirm implementation for archive/delete/restore). **R2** — the existing gated `deleteReport` got UI: trash button on the report detail page (`delete-report-button.tsx`, `reports:create`-gated in UI, server re-checks), 30-day-trash copy, routes back to the list; restore already works via the trash drawer. List-row menu deferred (rows are bare links — IA batch). **R1** — "Distribute" no longer fires blind: it opens a preview of the report as recipients will see it (client state + live FormData snapshot; all rich text through the sanitized `RichTextDisplay` path), with an explicit "Distribute to N people" confirm; the real submit fires only from the confirm; save-draft stays one click. **R3** — owner chose option (b): the email picker pre-selects the production **team** (non-cast) instead of everyone, "Entire production" stays one click. All client-side UX on existing gated actions — no server action, permission, storage, or proxy changes. `tsc` + `eslint` (0 errors) + 168 tests + `next build` green. **Verification note:** these surfaces are auth-gated and the sandbox has no DATABASE_URL/hydration, so verification is code/type/build-level per the backlog's known-gotcha — owner should click through a preview deploy (video delete, member remove, report distribute preview, picker default). Next: Batch 3 (IA: N1 N3 N4 N8, B3). See `ux-backlog.md` (Batch 2 rows ✅) + `decision-log.md` (2026-07-13).

**Session 2026-07-07 (UX Backlog Batch 1 — marketing truth + dead-affordance sweep, branch `claude/ux-backlog-batch-1-ig6614`):** landed the zero-risk copy/one-liner batch from `docs/ux-backlog.md` (M1, M3–M8, R7, N2). **M1** — Contact page rewritten from "free for schools" to **discounted school-year pricing** (owner decision: "discounted, not free"), so Contact/Pricing/FAQ now agree. **M3** — pricing page defaults to the **companies** panel (SSR `data-aud="companies"` + the static segmented-control default + the client `start` default all flipped together). **M4** — a **Sign in** link now lives in the mobile marketing hamburger menu (`.nav-link-signin-m`, shown only in the ≤760px menu). **M5** — the home hero's "Book a demo" now uses the purpose-built `btn on-night` dark-surface variant (static hero + `SanityHero`) instead of the illegible ghost/heavy-white button. **M6** — home + pricing **JSON-LD** offers corrected from "Free during open beta / price 0" to a real `AggregateOffer` ($25–$79, 60-day trial); the two marketing help "free in beta" strings updated to the trial story. **M7** — removed the three placeholder footer social icons (+ their orphaned CSS) and wired the pricing "How invites work" link to `/help/get-started/invite-your-company`. **M8** — trimmed the static blog index to the one real post (removed the five fake grid cards incl. the fake "conflict detection" changelog, plus the decorative category tabs), and renamed the footer "What's new" → "Blog"; the four SEO drafts still need publishing via Sanity to repopulate the grid. **R7** — the new-production wizard no longer marks "Opening night" required (only title is validated); banner reworded to "these dates are all optional." **N2** — removed the no-op Search button from the production topbar. `tsc` + `eslint` (0 errors) + 168 tests + `next build` all green. **Verification note:** static/SSR surfaces screenshot-verified at 1440 + 390 (home hero, pricing companies-first, contact, blog, mobile-menu DOM); JS-dependent interactions (pricing toggle click, mobile menu open) could not be exercised because client hydration doesn't run in the network-restricted dev sandbox (HMR-websocket blocked by the dead-proxy workaround) — a documented sandbox limitation, not a regression. **Sanity follow-up for the owner:** mirror the M1/M6 copy edits (school pricing, trial story) into any matching Sanity documents. Batch 2 (action safety: R1–R5, S2, R4, R6) is next. See `ux-backlog.md` (Batch 1 rows marked ✅) + `decision-log.md` (2026-07-07 Batch 1 entry). **Owner follow-up (same branch):** (1) the pricing educator-discount path was a small arrow link → upgraded to a prominent "Get school pricing" button. (2) The four Phase-1 SEO drafts (`docs/seo/blog-drafts/`) were ported live as **static posts** — new `app/(marketing)/blog/posts.ts` registry drives the index + each article (setup walkthrough + 4 SM-craft guides), `blog/[slug]/page.tsx` routes static slugs through it, and `blogpost.css` gained list/checklist/table/code styles; the drafts' stale "free in beta" CTAs were fixed to the trial story. Static is the Sanity fallback — publishing the same slugs in Studio supersedes them per-slug. (3) Contact/demo forms both post through `submitContactForm` (Resend → `CONTACT_EMAIL`/`feedback@proscene.app`, replyTo = submitter); notifications in production require `RESEND_API_KEY` set and that alias forwarding to a real inbox (owner-side env/config).

**Session 2026-07-07 (QA Batch 3 — report inputs wired to real data, branch `claude/qa-batch3-report-inputs`, locally browser-verified for the theme fix):** wired the rehearsal-report free-text inputs to the show's real data as *autofill only* — no schema change, the report still stores plain strings/JSON and free text is always allowed (guests, understudies, ensemble). (1) **Reusable `ComboField`** (`components/ui/combo-field.tsx`) — a "pick or type" text field with a visible chevron and an app-styled suggestion menu **portaled to `<body>`** so cards/overflow can't clip it. (2) **Scenes-worked** autofills from the production's scenes (`Act n, Sc. n — Title`) and, when a scene is picked, **auto-fills the Pages box** from that scene's script page — sourced from the AI parse's scene bookmarks (matched by title, since `production_scenes` has no page column), never overwriting a typed value (`features/reports/input-options.ts`). (3) **Line-note character** and **incident person** fields suggest the show's characters / production people. (4) **Department notes are drag-and-drop reorderable** (native HTML5 DnD + grip handle) in the report form, persisted to `production_departments.sortOrder` via a report-manager-scoped `reorderProductionDepartments` (reorders only; labels re-derived server-side); the order sticks across reports and drives the distributed report's section order. Options load in the new + edit report pages. **Owner test round (same day), fixed directly:** the scene picker read as static guide text (borderless field → reworked to a bordered box with a chevron on its own line); the native `<datalist>` looked foreign (→ the portaled app-styled menu); scenes-worked page auto-populate added. **Also fixed an unrelated app-shell bug found while testing — theme flash on refresh:** "System"-theme users saw a light→dark flash because SSR rendered `data-theme` from the pref cookie alone (the server can't see the OS). Now the client-resolved effective theme is mirrored into a cookie the server reads (`THEME_EFFECTIVE_COOKIE` in `lib/theme.ts`, written by `applyThemePref` **and** the pre-paint init script in `app/layout.tsx`), so SSR paints the right theme directly; **verified in a dark-OS Chromium — raw SSR HTML returns `data-theme="dark"`, no flash.** `tsc` + `eslint` (0 errors) + 168 tests green throughout. **Deferred:** multi-character casting tracks (Decision 1) — deliberately left out of this batch and now **on hold** (owner reconsidering whether to pursue it; see `qa-backlog.md` + `open-questions.md`); accounts/entitlements model still deferred. Catalogue: `docs/qa-backlog.md` (Batch 3 progress); decisions: `decision-log.md` (2026-07-07).

**▶ RESUME HERE — Billing MERGED to `main`; staying in Stripe SANDBOX (test keys) for now.** PR #66 merged 2026-07-03: Studio + org billing, the designer→full conversion, the `is_personal_workspace` per-workspace model, and all security fixes are on `main`. `BILLING_ENABLED=true` shipped, so production shows active pricing/checkout — **but production still uses Stripe TEST keys, so no real card can be charged.** This is deliberate: the owner wants to keep testing the whole flow on `main` in sandbox before going live. **No Stripe keys were changed to live; going live is a separate, owner-guided step (below).**

**⚠️ GO-LIVE CHECKLIST — do NOT do these until the owner is ready to accept real money (all owner-side Stripe/Vercel config, plus one deliberate flip; ask for guidance):**
1. **Swap Stripe keys test → live** in Vercel **Production** scope: `STRIPE_SECRET_KEY` (`sk_live_…`) and the six `STRIPE_PRICE_*` + designer price ids (live-mode price ids differ from test).
2. **Create a live-mode webhook** (event destination) at `https://www.proscene.app/api/stripe/webhook` with the 4 events (checkout.session.completed, customer.subscription.created/updated/deleted); put its `whsec_…` in the Production-scoped `STRIPE_WEBHOOK_SECRET`. (The test-mode preview webhook stays as-is for sandbox.)
3. **Enable plan-switching in the LIVE Customer Portal** config (Studio/Studio Pro holders' only up/downgrade path is the portal; org plans too).
4. **Wire the discounts** — founding + 15%-off coupons in the live dashboard (`allow_promotion_codes` is already on at checkout).
5. **Redeploy production**, then a **live smoke test** with one real card (small charge → refund) to confirm live keys + live webhook sync end-to-end. Optional: the declining-card fail-closed check (`4000 0000 0000 0341`).
6. Note: `BILLING_ENABLED=true` is already live, so the moment live keys are in, real orgs' 60-day trial clock + the daily lifecycle cron are operating for real — flip keys deliberately.

**Still to browser-verify in sandbox on `main` (owner testing):** the designer→full-app conversion (`/focus/full-app`), the priced-consent upgrade confirm step, the canceled-in-grace resubscribe card, and — new — the per-workspace model (a designer in a paid company gated by that company; blocked from creating productions there; personal work on their seat). An annual-interval purchase is the one untested checkout path.

**Test-account note:** `mgrigsby.beazleyrealtors@gmail.com` now carries a **real sandbox subscription** (Studio Pro after the upgrade test; personal Stripe customer + sub on the profile). Don't hand-reset the designer columns while that sub is live in the Stripe sandbox — cancel it in Stripe first, then reset. Open follow-ups (referral engine, solo-designer cast for Blocking, accurate-UI teasers, `cancel_at_period_end` display): see `open-questions.md`.

**Session 2026-07-03 (full-surface UI/UX review → actionable backlog, branch `claude/ui-ux-review-glv7ln`, docs-only):** expert UI/UX review of the marketing site and the app — four code-inspection passes (marketing claims/conversion, app shell & IA, key-flow friction, cross-surface consistency) plus live browser verification of all nine public pages at 1440px/390px (dev server + Playwright screenshots; app surfaces reviewed by code inspection, no DB in sandbox). **No product code changed.** Output: **`docs/ux-backlog.md`** — ~45 tasks in five phases (M marketing truth & conversion, R report/destructive-action safety, N navigation & IA, B mobile, S design-system consolidation) with priorities, sizes, acceptance criteria, per-task security notes, a security-invariants preamble + per-PR checklist (written to preserve the 2026-06 pentest/hardening posture), and a suggested PR batching. Headline findings: 8 marketing claims unbacked by the app (conflict detection, offline, SMS, native app, iCal subscribe, report PDF export, drag-to-reschedule, cross-company script cache) + a school-pricing free-vs-discounted contradiction; pricing page defaults to the coming-soon Individuals panel; mobile marketing nav has no Sign in; home-hero ghost CTA illegible on the night background; one-click report Distribute with no preview and `deleteReport` having no UI caller; several unconfirmed destructive actions; built-but-unmounted NotificationBell; dead topbar search button; ConfirmDialog/Button/drawer/empty-state/toast primitives exist but are under-adopted (five drawer implementations, native `confirm()` in ~10 sites); no focus trapping on any overlay; dead `cool` theme + density CSS. Review screenshots retained in the session workspace only (not committed).

**Session 2026-07-02 later (designer → full-app conversion v1, branch `claude/lucid-fermat-fwbyxx`, PR #66):** owner rejected the concierge/cancel-and-re-signup answer — built the real thing. New in-app splash `/focus/full-app` (what the full suite adds — 8-feature grid, the three company tiers with prices, "everything carries over" + trial promises) with a one-click `upgradeToFullApp()` server action: (1) winds the Studio seat down with `cancel_at_period_end` (they keep the paid period; the full app includes both tools — aborts cleanly if the Stripe call fails), (2) grants the org the standard **60-day trial from conversion day** (re-stamps `trialStartedAt`/`trialEndsAt`; safe to re-stamp because conversion is one-way per account — needed because a designer's own production create may have already started the org clock via `startTrialIfFirstProduction`; skipped when grandfathered/subscribed/billing-paused), (3) flips `profiles.accessMode` to `full` and hard-navigates to the dashboard — same org, so every production/script/parse/blocking diagram simply appears there (designers are admins of their personal org). Entry links: tool-lock modal footer, Focus settings billing card, seatless `/focus` paywall ("Running a company? Get the full app — free for 60 days"). Plan selection stays in Settings → Billing where subscribe-during-trial already defers the first charge to trial end. Untested in browser/sandbox as of writing; added to the go-live checklist. Decisions: `decision-log.md` (2026-07-02, conversion entry).

**Session 2026-07-02 (sandbox cycle verified + upgrade consent step, branch `claude/lucid-fermat-fwbyxx`, PR #66):** wired the Stripe TEST webhook to the preview (second event destination → the branch-alias URL; its signing secret in the Preview-scoped `STRIPE_WEBHOOK_SECRET`) and live-verified the Studio money loop against the real DB: Studio checkout → full `designer_*` sync; both tools unlocked; immediate cancel → `canceled` synced; lapsed seat → Single Tool/Script resubscribe (existing Stripe customer reused, new sub); per-tool gate held; lock-modal upgrade → in-place price swap to `studio_pro` on the SAME subscription with instant unlock. Merged `origin/main` (PR #67) in — only doc conflicts; verified the `"script"` tool-gates survived on `features/scripts/actions.ts`. **Two findings from testing, both fixed:** (1) the one-click upgrade charged the card with zero consent — the lock modal is now **two-step**: picking a tier calls new `previewDesignerPlanChange` (`stripe.invoices.createPreview` → exact prorated amount due today + the new recurring price) and only an explicit "Confirm upgrade — pay $X" click runs `changeDesignerPlan`, which now also **preserves the subscriber's billing interval** (annual stays annual — closes the upgrade-interval follow-up; the shared `resolveDesignerPlanChange` keeps preview and execution on identical inputs). (2) a canceled-in-grace seat dead-ended (grace access but only a "Manage billing" button, and the portal has no live sub after an immediate cancel): webhook syncs (BOTH org + designer) now prefer `sub.ended_at` as the effective period end — an immediate cancel ends access now (Stripe semantics; that path is refund-adjacent), a period-end cancel is unchanged — and `DesignerBillingButtons` shows plan cards + a "canceled — access through <date> — resubscribe" note for any remaining grace state (`DesignerSeat` gained `periodEnd`). Not typechecked locally (deps-less clone) — CI on PR #66 gates it. Decisions: `decision-log.md` (2026-07-02).

**Session 2026-07-02 (SEO plan integration: /docs manual + technical SEO + blog SEO plumbing, branch `claude/seo-plan-integration-eoemc4`, build-verified + locally browser-verified):** implemented the owner's SEO strategy (now committed at `docs/seo/seo-strategy.md`). (1) **Public product manual at `/help`** (shipped at `/docs`, renamed same-day; `/docs/*` 308-redirects to `/help/*` via `next.config.ts`) — new marketing section (hub → section overview → article) with 8 sections / 27 pages: get-started, productions, people, scheduling, reports, script, blocking, troubleshooting. Content is static typed TS in `app/(marketing)/help/content/` (deliberately NOT Sanity — see decision-log 2026-07-02); every page was written against the feature specs and actual UI code (real labels, real flows; several spec inaccuracies corrected in the process, e.g. calls send no notifications, cue placement is per-user not manager-only, custom set pieces are PNG/JPEG only). Article pages render numbered steps, tip callouts, troubleshooting FAQs (`<details>`), next-steps, related-articles, and a signup CTA strip; `generateStaticParams` + `dynamicParams=false` so unknown slugs 404. (2) **Technical SEO** — `app/robots.ts` (allows marketing/blog/docs, disallows the app), `app/sitemap.ts` (marketing + all docs pages + Sanity posts, CMS-failure-safe), `metadataBase` from new `lib/site.ts` (`NEXT_PUBLIC_SITE_URL`, www canonical), canonicals on all marketing pages, and JSON-LD structured data via `_components/json-ld.tsx`: Organization+SoftwareApplication (home), SoftwareApplication (pricing), FAQPage (FAQ Sanity path + docs troubleshooting), BreadcrumbList+HowTo (docs), Article (blog posts). (3) **proxy.ts** — `/help`, `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` added to PUBLIC_ROUTES (the endpoints were being auth-redirected; manifest was a pre-existing bug fixed in passing). (4) **Blog SEO plumbing** — Sanity `post` schema gains optional `seoTitle`/`metaDescription`/`tags` (with Studio length warnings); post pages prefer them in metadata, add openGraph + cover image, and emit Article schema (values `stegaClean`ed). (5) **Nav/footer** — "Help" added to the marketing nav; footer Resources column now leads with Help center → `/docs`. (6) **Editorial assets (repo-only, not shipped)** — `docs/seo/blog-editorial-calendar.md` (13-post roadmap with keywords/meta/outlines/internal links) and four publish-ready Phase 1 drafts in `docs/seo/blog-drafts/` (rehearsal report + template, blocking notation guide, tech week checklist, rehearsal schedule guide) formatted for pasting into Sanity Studio. **Verification:** `tsc` + `eslint` (0 errors) + 168 tests + `next build` green; production server exercised locally — /help routes 200 logged-out, bogus slugs 404, robots/sitemap correct (43 URLs), JSON-LD types confirmed via curl, and hub/article/troubleshooting pages screenshot-verified in headless Chromium (one CSS fix from that pass: tip-callout `strong` scoping). **Owner tasks:** set up Google Search Console + Bing, submit the sitemap, paste the Phase 1 drafts into Sanity, and later add real screenshots to docs pages. Spec: `feature-specs/22-marketing-seo-docs-hub.md`; decisions: `decision-log.md` (2026-07-02); risks/follow-ups: `open-questions.md`.

**Session 2026-06-30 → 07-01 (QA & product-workflow batches 1–2 + review follow-ups, branch `claude/qa-workflow-fixes`, PR #67 → MERGED to main):** QA pass over the portal from the external review's product/workflow notes plus several rounds of owner testing. Bugs fixed directly; polish/feature items written up + owner-approved before coding. Full catalogue in `docs/qa-backlog.md`. **Bugs:** report list/detail staleness (revalidate); date entry (typeable/pasteable `<DateField>` with digit masking, realistic-year guards, calendar opens on today not the far-past min); upload-row alignment + a `flex-shrink:0` fix (rows were collapsing to slivers in the scrollable list); "Save draft" → reports list; blocking black-on-black button (Tailwind v4 cascade-layer); the org **"set up your organization"** screen shown on every login incl. cast (`login()` → `/dashboard`, and `/setup` gated to `settings:manage`); document-drawer folder control now read-only for non-editors; non-cast filtered from character-slot casting. **Polish/features:** reusable `<FileDropzone>` + **Documents upload v2** (checkbox multi-select + bulk folder/type, image/PDF thumbnails, scroll affordance, remove animation) + matching doc-list delete animation; **script auto-parse opt-out toggle** (+ `attachWizardScriptByPath` for the un-parsed attach); monochrome setup-wizard department icons; **blocking "more room" rework** — persisted + animated global rail collapse (`body[data-rail-collapsed]`, pre-paint inline script, `useSyncExternalStore`) + Focus mode as the full-screen path, removing the per-tool fullscreen/expand buttons; document-drawer side-drawer slide/fade animation; AI-parse capitalization; report placeholders + clearer line-note guidance; **set pieces start empty** (built-in generic shapes behind a collapsed "Basic shapes" disclosure). **Confirmed correct, no change:** draft reports hidden from cast, read-only doc controls, cast personal bookmarks, cues are per-user/private. **Data:** created a `cast`-role **test account** (Default Organization, cast on The Color Purple) for gating verification via the Supabase MCP — GoTrue login required the auth token columns set to `''` (not NULL). **Decisions (see `decision-log.md` 2026-06-30):** choreographer team spot is department-driven; "set pieces empty" kept the built-ins behind a disclosure rather than deleting them. **Deferred (see `open-questions.md`):** accounts/entitlements model (Canva/Monday paid-org vs free-personal user) + two unreproduced batch-1 bugs (PDF first-click, script-download nav). `tsc` + `eslint` (0 errors) + 168 tests + `next build` green throughout. Not fully browser-verified — owner tested most surfaces (light mode) across rounds.

**Session 2026-06-30 (Studio per-tool lock → upgrade modal, branch `claude/lucid-fermat-fwbyxx`, PR #66):** the per-tool gate (confirmed working in a live preview test — a `single_tool`/`script` seat is correctly kept out of Blocking) now has a real UX instead of a silent redirect. When a Single Tool designer opens the tool their seat lacks, Focus stays on the requested mode (toggle reflects it) and renders that tool **blurred + inert behind an upgrade modal** (`features/designer/tool-lock.tsx`): a blank ground-plan placeholder for Blocking / blank script lines for Script, with Studio + Studio Pro options and an "Upgrade my plan" CTA (opens the Stripe customer portal). No-seat designers still get the read-only "choose a plan" prompt; full users are unaffected. The upgrade CTA via the portal needs plan-switching enabled in the portal config — see `open-questions.md` for the one-click in-app upgrade follow-up.

**Session 2026-06-30 (billing security review + hardening, branch `claude/lucid-fermat-fwbyxx`, PR #66):** ran a focused security review of the Studio/Stripe money path (identification + three adversarial verification passes). **No presently-exploitable HIGH/MEDIUM finding.** Fixed the one confirmed issue — the **Single Tool per-tool bypass** (LOW): `assertCanMutate` now takes an optional `tool`; every write in `features/blocking/actions.ts` passes `"blocking"` and every write in `features/scripts/{actions,ocr-actions}.ts` passes `"script"`, so a Single Tool seat can no longer reach the other tool's write server-actions (previously gated only at the Focus route). Also **hardened the webhook** (defense-in-depth; both webhook candidates verified *not* exploitable): `syncSubscription`/`syncDesignerSubscription` now only write a row whose stored Stripe customer id is null-or-matching the event's `customer`, so a metadata/customer mismatch is a 0-row no-op. Opened **PR #66 (draft)** to run CI (typecheck/lint/build/tests) — the branch is still not locally typechecked. Details: `decision-log.md` + `open-questions.md` (2026-06-30).

**Session 2026-06-29 (Proscene Studio designer-seat billing, branch `claude/lucid-fermat-fwbyxx`):** built the per-user **Studio** subscription (feature 21) — the entitlement axis separate from org plans — in four reviewable commits. (1) **Data model** (`features/designer/constants.ts`, `lib/stripe.ts`, six `designer_*` columns on `profiles` via migration `add_designer_seat_columns_to_profiles`): tiers `single_tool`/`studio`/`studio_pro`, six `STRIPE_PRICE_{SINGLE_TOOL,STUDIO,STUDIO_PRO}_{MONTHLY,ANNUAL}` env vars + reverse map. (2) **Money path** (`features/designer/actions.ts`, `app/api/stripe/webhook/route.ts`): `createDesignerCheckoutSession`/`createDesignerPortalSession` bill the *person* (personal Stripe customer on the profile; subscription metadata `kind:"designer"`/`profileId`/`designerPlan`/`tool`); the shared webhook's new `routeSubscription()` syncs designer subs to the profile entitlement, org subs unchanged. No designer trial in v1. (3) **Entitlement gate** (`features/designer/entitlement.ts`): `getDesignerSeat` + the org guards (`assertCanMutate`/`assertCanOperate`/`assertCanCreateProduction`) delegate to the seat for `accessMode="designer"` users, so the seat (not the free personal-org plan) governs every write; the Focus page gates tool access per tier. (4) **Surfaces**: in-Focus subscribe/manage UI (`features/designer/billing-buttons.tsx`, wired into the `/focus` index for seatless designers + the per-production Focus settings); a `designer` signup type stamps `accessMode="designer"` (`app/actions/auth.ts`, `lib/auth.ts`); marketing Studio CTAs now link to `/signup?account=designer&plan=…`. **Deferred:** the designer→org referral incentive; per-write-action tool gating for Single Tool (route-gated only — flagged in `open-questions.md`); storage-cap enforcement (advisory, parity with orgs). **Not typechecked** (no deps in the build clone) — this is the slice for the planned Stripe-workflow security audit. Decisions: `decision-log.md` (2026-06-29).

**Session 2026-06-29 (billing re-enabled for sandbox testing, branch `claude/lucid-fermat-fwbyxx`):** flipped the single kill switch **`BILLING_ENABLED` in `features/billing/constants.ts` back to `true`**, restoring the full trial + subscription system exactly as it was before the open-beta pause (decision-log 2026-06-18). With it on: all billing gates enforce again, the 60-day trial clock starts on each org's next first-production create, the trial pill/banner and the daily lifecycle cron are live, Checkout/portal work, and the marketing pricing page drops its open-beta banner. **No other code change** — the system was kept warm behind the flag for exactly this. Stripe stays in **sandbox/test mode** for now pending a security audit of the billing workflow; set the eight `STRIPE_*` env vars (now documented in `.env.example`) with TEST keys to exercise Checkout. **Company plans (Season/Repertory/Company x monthly/annual) are fully wired; the Proscene Studio individual tiers are NOT** — the Focus/designer *tooling* exists and is merged, but there is no `studio` plan in `PLANS`/`PaidPlanId`, no `STRIPE_PRICE_STUDIO_*` slots in `lib/stripe.ts`, no checkout/entitlement/limit path, and the marketing Studio CTAs are still `data-noop`. Building Studio billing is a code task, not a Stripe-only one (see decision-log 2026-06-29). Not browser-verified (fresh clone, deps not installed; change is a symmetric boolean flip from a previously `tsc`-clean state).

**Session 2026-06-29 (concurrency & transaction safety — code-only, branch `claude/bold-goldberg-vd7nng`, pushed):** the code-only half of the remaining Fix-soon items, no schema change. (1) **Report numbering is concurrency-safe** — `createReport` (`features/reports/actions.ts`) now wraps the `MAX(report_number)+1` read and the insert in one transaction guarded by a per-production advisory lock (`pg_advisory_xact_lock`), so two near-simultaneous creates can't claim the same number. (2) **Production creation is transactional** — all three paths (`createProduction`, `createProductionFull`, `quickCreateProduction` in `features/productions/actions.ts`) wrap their local scaffold writes (production + departments + roles + default folders) in one `db.transaction`, so a mid-setup failure can't leave a half-built production; external side effects (trial start, and the wizard's team apply, which makes Supabase Admin calls) run after commit. `createDefaultFolders` gained an optional transaction-handle parameter. `tsc` + `eslint` (0 errors) + 168 tests + `next build` all green. **Still deferred (these touch the live DB):** the belt-and-suspenders uniqueness constraints (incl. `(production_id, report_number)`) and the committed-migration workflow — pending an owner decision. Decision: `decision-log.md` (2026-06-29, concurrency/transaction entry).

**Session 2026-06-29 (authorization audit + cross-tenant resource-ownership fixes, branch `claude/bold-goldberg-vd7nng`, pushed):** started the structural "make production-scoped access mandatory" follow-up from the same review. Audited all ~70 production-scoped server actions: nearly all already verify **both** production access (`userCanAccessProduction`) **and** that the child resource (report / document / folder / call / scene / beat / video / membership) belongs to that production. Closed the three that didn't: `saveAnnotations` and `ensureMemberBookmarks` (`features/scripts/actions.ts` — verify the script document belongs to the production before writing annotation/bookmark rows) and `finalizeDocumentUpload` (`features/documents/actions.ts` — verify a supplied folder belongs to the production before filing a document under it). All mirror existing validated patterns (`startScriptParse`, `moveDocument`). `tsc` + `eslint` (0 errors) + 168 tests pass. **The remaining Fix-soon items touch the live database** — report-numbering concurrency safety + uniqueness constraints, and transactional production creation — and are pending a decision on the migration workflow (the repo has no committed migrations directory and uses `db:push`). Decision: `decision-log.md` (2026-06-29, authorization audit entry).

**Session 2026-06-29 (report-authorization & rate-limit hardening, branch `claude/bold-goldberg-vd7nng`, pushed — checks green locally):** targeted fixes for the highest-priority ("fix now") set from an external security review; `tsc` + `eslint` (0 errors) + 168 unit tests + `next build` all pass locally. (1) **Draft report visibility enforced server-side** — draft rehearsal reports are visible only to report managers (`reports:create` holders); cast/crew see a report only once it is distributed. New single-source helper `canViewDraftReports(role)` (`features/reports/visibility.ts`) is applied at every read path: the reports list (`reports/page.tsx` pins viewers to distributed and hides draft counts/chips), the detail page (`[reportId]/page.tsx` returns `notFound()` on a draft for non-managers), report-attachment signed-URL issuance (`features/reports/attachments.ts` via a new `userCanReadReport` gate on `getAttachmentUrl`/`getReportAttachments`), and the production overview **activity feed** (`[slug]/page.tsx` drops drafts for viewers). (2) **Report send requires production access** — `sendReport` (`features/reports/send-report.ts`) now calls `userCanAccessProduction`, so org-level `reports:create` alone is not enough; the sender must have access to that specific production. (3) **Auth rate limiter fails closed in production** — `lib/rate-limit.ts` rewritten so a missing or erroring Upstash limiter blocks auth attempts (with a logged alert) in real production instead of silently allowing them; dev/CI/preview still fail open so they stay usable. Decision logic is factored into a pure, unit-tested `decideRateLimit`. (4) **Tests + CI** — added `features/reports/visibility.test.ts` and `lib/rate-limit.test.ts`, and wired `npm test` into `.github/workflows/ci.yml` so these gate `main` (CI was typecheck/lint/build only). (5) **CLAUDE.md refreshed** to current reality (~36 tables, 8 roles / 18 capabilities, full feature scope) with two security patterns added (mandatory `userCanAccessProduction` for production-scoped access; `canViewDraftReports` at every report read path). Decision: `decision-log.md` (2026-06-29). Broader authorization-architecture hardening from the same review is tracked **outside the repo** by request (not enumerated here). **Not browser-verified** — changes are server-side authorization gates and a rate-limit policy that don't affect visual rendering.

**Session 2026-06-19 (security hardening batch 2, branch `security-hardening`, merged to main):** Second full-codebase security audit (10 independent review angles + Phase 2 verification + gap sweep) followed by targeted fixes. All changes are additive guards — nothing existing was removed or rearchitected. `tsc` clean; 152 permission tests pass (+8 new tests for the `reports:delete` capability). Not browser-verified — changes are server-action guards and permission checks that don't affect visual rendering. **Privilege:** new `reports:delete` capability (admin + producer only); `permanentlyDeleteReport` now requires it instead of `reports:create`; `deleteReport`/`restoreReport` gained `assertCanOperate` billing guard. **Session revocation:** `changePassword` now calls `signOut({ scope: "others" })` so other-device sessions are revoked immediately; `updatePassword` (forgot-password flow) does a full `signOut({ scope: "global" })` and lands on `/login`. **Rate limiting:** `resendVerification` now calls `checkAuthRateLimit` (was the only unguarded auth action). **Storage paths:** `finalizeReportAttachmentUpload` + `finalizeDocumentUpload` now reject any `storagePath` containing `..`/`//`/`%2e`/`%2f` before the `startsWith` prefix check. **Report email:** `sendReport` filters `recipientEmails` against the production's actual member list; non-members are silently dropped. **Billing guards:** `removeBlockingPosition` → `assertCanMutate`; `deleteCall` + `createTemplate` → `assertCanOperate`. **Plan limit:** `countProductions` now excludes `deletedAt IS NOT NULL` rows. **Sanitizer:** `lib/sanitize.ts` enforces `rel="noopener noreferrer"` on any `target="_blank"` anchor. **Beat mentions:** `createBeatComment` filters `mentionedUserIds` to production members only. Remaining open issues documented in `open-questions.md` (2026-06-19 security section). Decisions: `decision-log.md` (2026-06-19).

**Session 2026-06-18 (Sanity Visual Editing / Presentation, branch `claude/pensive-thompson-uzjbkp`, build-verified):** turned on click-to-edit preview for the marketing CMS so editors can open the site inside the Studio and edit on the page instead of via raw forms. (1) **Studio** — added `presentationTool()` to `sanity.config.ts` (alongside the existing structure + vision tools), with `previewUrl.previewMode.enable` → `/api/draft-mode/enable`. The new "Presentation" item loads the live site in a side pane with click-to-edit overlays. (2) **Draft Mode plumbing** — `app/api/draft-mode/enable/route.ts` (`defineEnableDraftMode` from `next-sanity/draft-mode`, validates the Studio's signed preview URL against the read token before setting the cookie) and `app/api/draft-mode/disable/route.ts` (clears it, redirects home). Both live under `/api/`, which `proxy.ts` already excludes from auth. (3) **Read path** — `lib/sanity/client.ts` gained `getSanityPreviewClient()` (drafts perspective + stega encoding, `useCdn:false`) and a `stega.studioUrl` on the base client (encoding stays OFF for normal traffic). `lib/sanity/queries.ts` now routes every fetch through a `loadQuery()` helper that reads `draftMode()` (guarded by try/catch for static-gen): published+ISR for visitors, preview client in Draft Mode. (4) **Overlays** — `<VisualEditing>` + a fixed "Preview mode / Exit" banner (`_components/preview-banner.tsx`) mount in the marketing layout only when Draft Mode is on. (5) **stega hygiene** — `stegaClean` (from `@sanity/client/stega`) applied to every value used as a URL/slug/image-source/numeric data-attribute in the Sanity consumers (hero CTA hrefs, pricing `ctaHref` + the billing-toggle price/note data-attrs, blog slugs + cover images, blog portable-text links + inline images, FAQ category keys/anchors). Display text stays encoded so it remains click-to-edit. (6) **Requires `SANITY_API_READ_TOKEN`** (Viewer role) to show drafts — documented in `.env.example`; without it, published content still previews. No marketing-page render-mode change (the whole app is already dynamic because the root layout reads the theme `cookies()`). `tsc` + `eslint` clean; `next build` compiles, typechecks, and collects all routes (placeholder env). Decisions: `decision-log.md` (2026-06-18). **Not browser-verified** — needs an eyeball on the Presentation pane + overlays against a deploy with a read token set.

**Session 2026-06-18 (second security audit + hardening, branch `claude/pensive-thompson-7bbxwf`, build-verified):** full-repo security audit and fixes. **Authorization/IDOR:** restricted-folder docs now enforce `canViewFolder` in the signed-URL path (`resolveAccessibleDocument`); `fetchDocumentComments` and `fetchDeletedDocumentsByProduction` now access-checked; report-attachment upload/finalize added a `userCanAccessReport` ownership check (was cross-tenant write); `pinItem` validates type + item access; `completeOnboarding` gated on `settings:manage`. **Injection/XSS/exposure:** document mentions scoped to the org (was global); `image/svg+xml` removed from logo + set-piece uploads and the document-viewer PDF/text iframes now `sandbox`ed (SVG/HTML-disguised-as-text can't execute — **behavior change: vector logos/set-pieces no longer accepted, raster only**); push endpoint validated as public HTTPS (SSRF); Sanity blog link href scheme validated; invite/resend errors genericized (account-enumeration); `server-only` guards added to the four secret-bearing `lib/` modules. **Config/infra:** security headers added in `next.config.ts` (HSTS, nosniff, X-Frame-Options, Referrer/Permissions-Policy, minimal CSP); `attachments` bucket `file_size_limit` set to 64MB (was unlimited). **Deps:** `next` → 16.2.9 (proxy-bypass advisories), `drizzle-orm` → 0.45.2, pinned `form-data`/`ws`/`shell-quote` via overrides — `npm audit` 24 → 20 vulns, critical 1 → 0, high 5 → 1 (the remaining high `undici` + most moderates are dev-only `@sanity/cli`→jsdom tooling). **Manual follow-ups:** enable Supabase "leaked password protection"; CAPTCHA/rate-limit the contact form; revisit Sanity-tooling CVEs on next upgrade. `tsc` + `eslint` (no new errors) clean; `next build` green. Decisions: `decision-log.md` (2026-06-18). Not browser-verified.

**Session 2026-06-18 (payments paused for open beta, branch `claude/magical-ptolemy-ntimdb`, build-verified):** added a single reversible kill switch, **`BILLING_ENABLED` in `features/billing/constants.ts`** (now `false`), that disables every paywall site-wide while we're in beta. With it off: all billing gates (`assertCanMutate`/`assertCanOperate`/`assertCanCreateProduction`) are no-ops (full access, unlimited productions, never read-only); `billingState()`/`trialPhase()` short-circuit to full-access/no-trial so the trial countdown pill and trial/upgrade banner hide; the trial clock never starts (`startTrialIfFirstProduction` no-ops and leaves `trialStartedAt` unstamped, so re-enabling later gives a fresh trial, not an expired one); `firstProductionTrialNotice` returns null; `createCheckoutSession`/`createPortalSession` refuse with a "free during beta" message; the lifecycle cron's `candidateOrgs()` returns `[]` (no nudge/lock/purge emails or file purges). UI: `/settings/billing` shows a "Proscene is free while we're in beta" notice instead of plan/checkout buttons, the Focus settings billing section is hidden, and the marketing pricing page keeps its plans visible with a prominent open-beta disclosure banner (`pricing/page.tsx` + `.beta-notice` in `pricing.css`, both gated on the flag). **To restore payments: flip `BILLING_ENABLED` to `true`** — no other code change. `tsc` + `eslint` clean; `next build` green. Decision: `decision-log.md` (2026-06-18). Not browser-verified.

**Session 2026-06-18 (marketing site redesign + amber rebrand, branch `claude/magical-ptolemy-ntimdb`, build-verified):** recreated the full `handoff/design_handoff_marketing_site` design into `app/(marketing)/` — a repositioning from the stage-manager-only "Callboard" framing to **"the one place your show lives," syncing cast, crew, and creative teams**. (1) **Brand tokens** — adopted the handoff's "paper & spotlight" palette in `marketing.css` (spotlight-amber `--accent #E0A23A`, warm-paper light surfaces, dark "night" islands, italic `<em>` emphasis, uppercase hero treatment, white nav / dark logo, dark CTA button), still **scoped under `.ps-site`** so the in-app theme is untouched. Per the owner, **kept Geist** (not the handoff's Inter); `--font-mono` still inherits the app's Geist Mono. (2) **Shared chrome** — replaced the `<img>` logos with an inline proscenium-arch mark (`_components/brand-mark.tsx`) that recolors to ink in the nav and amber in the footer; nav drops the **Reviews** link; footer reblurbed to the cast/crew/creative line. (3) **Home** — dark hero "The one place your show lives," "stop scattering the production" value cards (cast/crew/creative), calendar + reports splits, how-it-works, mobile + belief night islands, amber CTA; Sanity hero override split preserved; no placeholder stats/logos shipped. (4) **Features** — sticky **audience segment toggle** (For Cast & Crew / For Creative Teams) driving `[data-page="features"][data-segment]`, default Cast & Crew, with a **Stage Management** section that shows only in the Cast & Crew segment; each tool section has per-segment copy variants sharing one animated demo panel; added the **AI Script Setup** marquee section (scan icon, quota pill, Upload/Review/Apply); persisted in `localStorage`, tablist with arrow-key support, reduced-motion respected. (5) **Pricing** — split into **Individuals (Proscene Studio, coming soon)** vs **Companies (Season/Repertory/Company)** via an audience toggle + a monthly/annual billing toggle (deep-linkable, persisted), comparison table, and discounted hand-verified school pricing; Sanity tiers wiring updated. (6) **FAQ** — billing answers reflect the org-subscribes / 60-day-trial / Studio / school model; live search + category scrollspy retained. (7) **Blog index + post** — new card grid, featured post, newsletter; all bylines "The Proscene team" (no fabricated authors). (8) **Removed the Reviews route** (`app/(marketing)/reviews/`) and its `proxy.ts` public-route entry; the unused `getTestimonials`/`getLogos` Sanity queries are left in place (harmless). (9) **Copy convention** — no em-dashes in user-facing marketing copy (normalized metadata titles to `·` and cleaned the Contact page strings); brand "Proscene" throughout, never "ProScene". `tsc` + `eslint` clean; `next build` compiles, typechecks, and prerenders all six marketing routes (validated with placeholder env; `/reviews` is gone). Page-local CSS/JS for FAQ and dash-hero needed no change (already matched the handoff structure); the visible change there comes from the shared amber tokens. Decisions in `decision-log.md` (2026-06-18). **Not browser-verified** (no display in sandbox) — needs an eyeball on the new amber theme, the Features segment toggle, and the Pricing audience/billing toggles on a deploy.

**Session 2026-06-17 (Org onboarding overhaul + welcome state, branch `claude/gallant-mayer-a189pa`, MERGED via PR #55):** closed the trial-farming exploit and redesigned how new orgs are born. (1) **Trial farming removed** — `createWorkspace` no longer blocks on existing trial orgs; multi-org *creation* is removed entirely (one user = one org they own). Being a *member* of multiple orgs via invite is unchanged. The "Create workspace" button is removed from the settings org switcher. (2) **First-time onboarding setup page** — new signups land at `/setup` (server component checks `onboardedAt`; already-onboarded users redirect to dashboard). `app/(app)/setup/setup-form.tsx` is a full-screen wizard with: logo upload (browser preview, signed upload on submit), company survey chips (avg audience size, annual shows/year, team size, production types — all optional), and multi-row team invites (name/email/role, fires `inviteMembers` on finish). "Skip for now" stamps `onboardedAt` without saving survey data. Both paths hard-navigate to `/dashboard` via `window.location.href` to bust the router cache. (3) **Welcome state on the dashboard** — `app/(app)/(default)/dashboard/welcome-state.tsx` (server component) replaces the empty production list when a workspace has no productions yet. Personalized headline, "Create your first production" CTA (admin-only; non-admins see a message), and five feature tiles. Theatrical `.ws-curtain` / `.ws-spotlight` decorative chrome. (4) **Signup redirects wired** — `app/actions/auth.ts` (email signup) and `app/auth/callback/route.ts` (OAuth) redirect to `/setup` instead of `/dashboard` for new users. (5) **Logo editable from settings** — workspace settings already had `WorkspaceLogoUploader`; ensured it's the only logo entry point (setup also wires to the same signed-upload actions). (6) **Brand color feature scrapped** — implemented then removed in the same session. The DB columns (`brand_color`, `brand_color_secondary`, `brand_color_highlight`) were migrated and remain on the schema (nullable, unused) for a possible future revival; `lib/brand-colors.ts`, `brand-colors-form.tsx`, `saveBrandColors` action, and all CSS injection code deleted. Decision noted in `decision-log.md`. Schema change: `organizations` gained `avg_audience_size text`, `onboarded_at timestamptz` (added via Supabase MCP `apply_migration` in a prior session, now consumed). No new libraries.

**Session 2026-06-16 (Cast & Crew drag-to-assign board, branch `claude/stoic-ride-brb2ke`, NOT browser-verified):** rebuilt `/productions/[slug]/members` from the `handoff/cast-crew-drag-assign` design. Replaced the old stacked layout (`cast-list.tsx` + `production-member-manager.tsx`, both **deleted**) with a single **two-zone casting board** (`cast-crew-board.tsx`, `"use client"`). Left = **Company roster** (`getPeopleDirectory`, searchable + chip-filtered All/Unassigned/Cast/Creative/Crew, native HTML5 drag source). Right top = **Characters**, one single-occupant slot per `production_roles` row (drop → `assignRoleToMember`, which already swaps/moves + grants access; `×` → `unassignRole`). Right bottom = **Production team**, one multi-occupant bucket per production **role** (`producer/director/choreographer/stage_manager/crew` — the enum minus admin+cast; drop → `assignProductionMember`, chip `×` → `removeProductionMember`). **Reuses the People `PersonDrawer` verbatim** (no second drawer, per the handoff). **Touch/≤859px:** drag is replaced by tap-to-assign — a board⇄company toggle, a `+` per person opening a role bottom-sheet, and tapping an empty slot/bucket opening a people sheet (new `.cc-sheet` surface); the admin-only inline "Invite & cast" (`inviteAndAssignRole`) is preserved in the cast-a-character sheet. Live `Cast n/total · Team n` readout + toast on each mutation. **No new libraries, no schema change**; all mutations go through existing server actions + `router.refresh()` (no divergent optimistic state). Added `GripVertical` (as `Grip`) to `components/ui/icon.tsx`; ported the `.ax-*`/`.cc-sheet*` CSS into `globals.css` (demo `.avatar` swapped for the app's `.pp-av` tokens; demo's fixed-height app-shell behavior dropped so the board flows in the normal scrolling page). **Deliberate deviation:** team buckets are the real role enum, not the prototype's invented departments (Wardrobe/Deck Crew/Music Director) — see `decision-log.md` + `open-questions.md` (2026-06-16). `tsc` + `eslint` clean; `next build` compiles + typechecks (page-data step needs live `DATABASE_URL`, unrelated). **Not browser-verified** (no display in sandbox) — needs an eyeball on the desktop drag feel, the ≤859px sheets, and the four themes. Spec + manual test steps: `feature-specs/04-productions.md`. The `handoff/cast-crew-drag-assign` folder is left in place pending the user's decision on whether to delete handoff files post-merge.

**Session 2026-06-16 (Cast & Crew board — feedback round 1, same branch, NOT browser-verified):** four requested changes. (1) **Lighting Designer + Sound Designer** buckets added to Production team, and a **large Ensemble bucket** added under the character slots. Modeled as `(role, position)` pairs — designers = role `crew` + a position label in `characterName`, Ensemble = role `cast` + position `"Ensemble"` — via a new `assignTeamMember` action (no schema change). Buckets are `TEAM_BUCKETS`/`ENSEMBLE_BUCKET` in `cast-crew-board.tsx`. (2) **Drag-to-move:** filled character slots and team/ensemble chips are now drag sources too, so a person can be dragged role→role without going back to the roster; `assignTeamMember` clears any character slot on a team drop (move, not add). (3) **Consistent avatar color:** all avatars now use the person's stable org-role color via `colorOf(userId)` (previously team chips used the bucket's role color, so a person changed color when placed in a new role). (4) Progress/labels updated. `assignProductionMember` left untouched (still used by the People assign-modal). `tsc` + `eslint` clean; `next build` compiles + typechecks (page-data needs live `DATABASE_URL`). Decision + tradeoff (positions overloaded onto `characterName`) logged in `decision-log.md` (2026-06-16 follow-up) + `open-questions.md`. Still **not browser-verified**.

**Session 2026-06-16 (Cast & Crew board — department-driven buckets, same branch, NOT browser-verified):** wired the board's production-team buckets to the **setup wizard's department selections**. Investigation first: the wizard writes `production_departments`, but those rows were **write-only — nothing read them**, and the rehearsal report's department sections are a *separate* hard-coded list (`features/reports/constants.ts#DEPARTMENTS`) shown on every report, so the wizard's department choice was NOT actually linked to reports (contrary to the schema comment). Change: new `getProductionDepartments(productionId)` query + `buildTeamBuckets(deptKeys)` in `wizard-constants.ts` map each enabled department to a bucket (director/stage/casting/choreo → distinct roles; music/costumes/props/set/lighting/sound/intimacy/dramaturgy → `crew` + a short position label; generic Crew catch-all always appended; quick-add productions with no departments fall back to Director/Stage/Casting + Crew). `page.tsx` loads departments and passes `teamBuckets` to the board, which now renders them instead of a hard-coded list. This gives `production_departments` its first real consumer. **Reports remain unlinked to `production_departments`** — logged as a real follow-up gap in `open-questions.md` (the user expected reports to use the wizard departments; they don't yet). `tsc` + `eslint` clean; `next build` compiles + typechecks. Decision: `decision-log.md` (2026-06-16 follow-up 2).

**Session 2026-06-16 (production departments: dynamic report sections + Settings tab, same branch, NOT browser-verified):** made the wizard's department selection finally *do something* and added a place to manage it. (1) **Unified department model** — new `features/productions/departments.ts` is the single source of truth (catalog of 12 standard departments aligned 1:1 with the report's existing columns, each with a board-bucket mapping; `resolveDepartments` resolves a production's stored rows — incl. legacy wizard keys — into ordered display departments, falling back to the full catalog when none are set; `buildTeamBuckets` now = always-on leadership + one bucket per department). (2) **Schema (additive only, applied live to `avqgfzrcwegebtbvmcwo` via `apply_migration` `add_department_labels_and_report_dept_notes`)** — `production_departments` gains `label` + `sort_order`; `rehearsal_reports` gains `dept_notes jsonb`. **No data migration:** the 12 standard departments keep their existing columns; only CUSTOM departments use `dept_notes`; reports read via `reportDeptHtml` (column for standard, jsonb for custom). (3) **Reports are now dynamic** — the form, both detail views (desktop + mobile), and BOTH email renderers iterate the production's departments instead of the fixed 12. The form submits standard depts via their existing `dept_*` fields and custom depts via `deptnote_<key>`; `validateReportForm` collects them; `updateReport` MERGES custom notes so removing a department never wipes a past report's notes. (4) **Settings tab** — new `/productions/[slug]/settings` (manage-only, added to the production tab strip) with `DepartmentSettings` (toggle standard depts, add custom names, rename, reorder, remove) → `saveProductionDepartments`. (5) **Wizard write** maps selections onto canonical keys with labels/order (`wizardDeptRows`). (6) **Board** now derives buckets from the resolved departments. **Finding recorded:** `production_departments` was previously write-only and reports were NOT linked to it (separate hard-coded list) — now they are. `tsc` + `eslint` clean; `next build` compiles + typechecks; migration columns verified present. Decisions: `decision-log.md` (2026-06-16 follow-up 3); risks/remaining items: `open-questions.md`.

**Session 2026-06-15 (split-screen signup, branch `claude/split-screen-signup`, NOT browser-verified):** website to-do "create the split-screen view sign up." Rebuilt `/signup` as a two-column layout: a **fixed dark-crimson brand panel** on the left (Proscene wordmark, "Run your whole production from one place." headline, four honest value points — reports/calls, calendar, script/cues/blocking, cast/announcements — each mapping to a real feature, plus a "first production free / 60-day trial, no card" line) and the **existing signup form** (account-type choice, name, workspace, email/password, Google OAuth) on the right. New CSS (`app/globals.css`, `.auth-split`/`.auth-aside*`/`.auth-main`): the brand panel is intentionally fixed-dark (doesn't flip with theme — it's a splash) with light text; at **≤880px the aside hides and the form's own brand header returns**, collapsing to the prior centered signup so mobile is unchanged. Only `/signup` changed — login/forgot/reset keep the centered card. `tsc` clean; eslint zero net problems (the one inline-SVG `<img>` warning is suppressed to match the codebase pattern). **Not browser-verified** — needs an eyeball on the desktop two-column balance + the ≤880px collapse, across light/dark themes.

**Session 2026-06-15 (account settings — best-practice additions, branch `claude/practical-davinci-7n58wy`, NOT browser-verified):** filled best-practice gaps on Settings → Account. (1) **Change email** — was hard-coded read-only; new `changeEmail` action (`features/account/actions.ts`) calls `supabase.auth.updateUser({email}, {emailRedirectTo:/auth/callback?next=/settings/account})`, which emails a confirmation; the auth email flips only on confirm. `lib/auth.ts#getCurrentUser` now **reconciles `profiles.email` from the verified auth email** on the next request (keyed on auth UID, never an email lookup — safe), so the profile/display email updates post-confirmation with no webhook. New `change-email-form.tsx`. (2) **Sign out everywhere** — `signOutEverywhere` action calls `signOut({scope:"global"})` (revokes all sessions incl. current) → `/login?signed_out=1`. (3) **Delete my own account** — `deleteOwnAccount` (type-your-email confirm, re-checked server-side): removes the user's production + org memberships across every org, soft-deletes any org left memberless, deletes the `profiles` row (cascades authored content, matching `deletePerson`) and the Supabase auth user, then signs out → `/login?deleted=1`. **Guard:** blocked if the user is the sole admin of an org that still has other members (must hand off admin or delete that workspace first). New `account-danger-zone.tsx` (both live here). Login page shows friendly `signed_out`/`deleted` notices. (4) **Time zone — deliberately NOT built (see decision-log).** Investigation showed call/rehearsal times are stored timezone-**naive** (`calls.callTime`/`endTime` are plain text like "19:00", rendered as-is with no UTC conversion) — which is correct for theatre ("7 PM at the theatre" shouldn't shift when a cast member travels). A per-user tz override would misrepresent those wall-clock times, so it was flagged back to the user instead of shipped. No schema change (the three built features need none). `tsc` clean; eslint zero net problems. **Not browser-verified** — needs a live check of the email-confirm round-trip, global sign-out, and (carefully) the account-deletion guard + cascade.

**Session 2026-06-15 (button contrast audit, branch `claude/practical-davinci-7n58wy`, NOT browser-verified):** beta item "some buttons appear fully black with black text / check all light+dark modes incl. hover." **Audit finding:** the app's button/toggle/tab system is actually theme-safe — every dark-background control (`.btn`, `.btn.ghost`, the `.seg`/`.tab` selected states, the `var(--ink)` toggle pills, the inline `var(--ink)` AI-review buttons) correctly pairs a light text token (`var(--bg)`/`var(--bg-elev)`), and the previously-reported "near-black box" cases (weekday chips, production-card menu) were already fixed in earlier sessions. No black-on-black or white-on-white pairing exists in the current code. **One genuine, systemic contrast weakness fixed:** the filled **primary/accent CTA buttons** use white label text on `--accent`, but `--accent` is *lightened* in the **dark (L0.70)** and **dusk (L0.68)** themes (it doubles as a text/icon colour on dark surfaces), dropping white-on-accent button contrast to ~3:1 — sub-AA for normal text, the most likely "hard to read" complaint. Fix: new **`--accent-strong`** token = `var(--accent)` in light/cool (so **light mode is byte-for-byte unchanged**) but a deeper red in dark (`oklch(0.585 0.17 25)`) and dusk (`oklch(0.575 0.17 28)`), both ≈4.8:1 white-on-accent (clears AA). Repointed every filled accent **action** button + its hover to `--accent-strong`: `.btn.primary`, `.btn-hero.primary`, `.np-root .btn.primary`/`.accent`, `.dd-btn-primary`, `.md-root .mbtn.primary`, `.ac-btn.primary`, `.ac-pcard-ackbtn .b1`, `.rd-edit-btn`, the mobile FAB. **Left as-is (decorative, not buttons):** small `--accent` count-badges, calendar "today" markers, avatars, progress-bar fills, the billing "popular" tag. CSS-only (`app/globals.css`); `tsc`/`eslint` unaffected. **Not browser-verified** (no display in sandbox) — needs an eyeball across all four themes (light/dark/dusk/cool) + hover on a deploy; the dark/dusk red is a tuned value that may want a nudge. Decision recorded in `decision-log.md`.

**Session 2026-06-15 (desktop-width overflow pass, branch `claude/practical-davinci-7n58wy`, NOT browser-verified — best-guess by code inspection, no screenshot available):** beta item "right side of the window goes off screen on squarer (4:3 / 16:10) MacBooks." Root cause: the 2026-05-24 responsive audit was explicitly **mobile-only** (≤720px renders/collapses; "desktop layouts are untouched"), and the only horizontal-overflow backstop (`.page { overflow-x: hidden }` + `min-width:0` defenses) lived **inside `@media (max-width: 720px)`**. A 13" MacBook (~1280–1440px, narrower than the 16:9 monitors the app was built on) sits **above** that guard, so an intrinsically-wide child could push the page sideways. Fix (CSS-only, `app/globals.css`): (1) **promoted the overflow backstop to all widths** on `.page` — added `min-width:0`, `overflow-wrap:break-word`, `max-width:100%`, and `overflow-x:hidden` (the proven mobile pattern; intentional scrollers — tables, the script/blocking tools — live in their own internal-scroll containers, so nothing legitimate is clipped). (2) **Converted the bare-`1fr` two-column app layouts to `minmax(0, 1fr)`** so the content track can shrink instead of forcing the grid wide: `.cal` (calendar), `.day` (day view), `.np-root .body` (new-production wizard). (3) **People directory table** (`.pp-table-wrap`) now scrolls horizontally inside its card on desktop (`overflow-x:auto`) instead of being clipped. **Most grids already used `minmax(0,1fr)` and were safe.** **Risk/caveat:** `overflow-x:hidden` on `.page` will clip (not scroll) any *inline* popover that extends past the right edge — uncommon (major dialogs portal to body; menus open downward), but if a desktop dropdown gets cut off on the right, that component should portal or reposition. **Needs verification at ~1280px on a deploy** (no browser in sandbox); if a specific screen still overflows we target that component with a real screenshot. `tsc`/`eslint` unaffected (CSS-only).

**Session 2026-06-15 (invite / sign-in clarity, branch `claude/practical-davinci-7n58wy`, NOT browser-verified):** addressed the beta-feedback "some users have reported issues signing in" item — specifically invited users who get stranded. Two root gaps fixed. (1) **Existing-account invites were silent.** When an admin invites someone who *already* has a Proscene account, `inviteMembers` adds them to the org via the `"added"` branch but sent no notification (unlike brand-new invitees, who get Supabase's set-password invite email). New `sendOrgInviteNotification()` in `features/notifications/announce.ts` now fires an **in-app notification** (type `org_invite`, scoped to the new org so it shows in that workspace's cross-org switcher bubble) **+ a best-effort email** ("{inviter} added you to {org}", with an Open-Proscene CTA), both respecting the user's notification prefs; wired into the `"added"` branch of `inviteMembers`. No schema change (`notifications.type` is free text; `organization_id` already exists). (2) **Signup dead-end for invited users.** A brand-new invitee who ignores the invite email and instead self-signs-up hit Supabase's "account already exists" with only a flat sentence. `AuthResult` gained an optional `code: "account_exists"`; `signup` sets it, and `signup-form.tsx` now renders actionable next steps — "Were you invited? Check your email for the invite link to set your password" + **Sign in** / **Set / reset password** links. (3) **Forgot-password confirm** screen gained a reassuring line that the reset link doubles as a first-password setup for invited users. `tsc` clean; `eslint` adds **zero** new problems (repo baseline unchanged at 44 with/without these edits — see open-questions re: that pre-existing baseline). **Not browser-verified** (no live env in sandbox); needs a real invite→email→notification round-trip check on a deploy. The deeper "reset screen can't say 'accept the invite instead' without leaking account existence" point in open-questions is intentionally left as-is — these changes improve discoverability without changing Supabase's anti-enumeration behavior. **Invite hardening (same session, follow-on commit):** closed the invitee-side "can't join" dead-ends. (a) **Expired/used links recover instead of dead-ending** — `app/auth/callback/route.ts` + `app/auth/confirm/page.tsx` routed *every* verification failure to `/login?error=auth_callback` (useless for a no-password invitee); now invite/recovery-link failures (detected via the `next` param: `/invite/accept` or `/reset-password`) go to **`/forgot-password?expired=1`**, OAuth/other stay on login. (b) **`/forgot-password?expired=1`** shows a "Get a new link" banner; the forgot-password flow reuses `requestPasswordReset` (Supabase recovery works on unconfirmed invited accounts) as a universal self-service recovery that doesn't depend on the original invite link still being alive. (c) **Login failure** now shows a "Were you invited, or never set a password? Set / reset it here" recovery link (generic — no enumeration change). The admin side was already solid (invite-pending tags, pending-invite count, per-person + bulk `resendInvite`). **User-owned config (not code):** bump Supabase email-link (OTP) expiry so invites don't lapse before people read mail (the new recovery makes exact TTL non-critical), and verify Resend SMTP deliverability. **Deferred:** a passwordless `signInWithOtp` "email me a sign-in link" on /login (would make joining ~failure-proof; the recovery path already covers passwordless entry). `tsc` clean; eslint zero net problems. Test steps in `feature-specs/02-auth.md`.

**Session 2026-06-15 (org-creation wizard, branch `claude/relaxed-davinci-rwk788`, NOT browser-verified):** replaced the bare single-field "Create workspace" inline form in the settings workspace switcher with a guided, full-screen setup wizard at **`/workspaces/new`**, reusing the New Production wizard's `.np-root`/`.np-overlay` chrome. Four steps: (1) **Workspace** — name (required) + optional logo (held in the browser and uploaded only after the org exists, since the signed-upload path is org-scoped); (2) **About your company** — optional survey (shows/year, team size, production types) via chip selectors, every question skippable; (3) **Invite your team** — optional multi-row name/email/role invites; (4) **Review** + create. On submit: `createWorkspace` (now accepts the survey fields), then best-effort logo upload + `inviteMembers` (failures become non-fatal warnings on a success screen, since the org already exists and the user is its admin). Success screen offers "Go to your workspace" and "Create your first production". **Schema:** added three nullable columns to `organizations` — `annual_shows`, `team_size`, `production_types` (text[]) — populated by `createOrganization(name, profile?)`. New `features/workspace/constants.ts` holds the survey option lists. Any user can create a workspace (no role gate) — this doubles as the path a view-only user takes to stand up their own company as admin. `tsc`/`eslint` clean. **Schema applied live (2026-06-15)** — the three columns were added directly to the `CallBoard` Supabase project via `apply_migration` (`add_onboarding_survey_columns_to_organizations`), not `npm run db:push`; no further DB step needed. Survey data is stored but not yet consumed anywhere (see open-questions).

**Session 2026-06-11 (rehearsal templates — UX follow-up):** from PR feedback. (1) **Generation moved into the "Schedule a call" slide-in tray** behind an animated `One call` / `Repeating` segmented toggle (`.seg`) at the top; removed the now-redundant calendar toolbar "Generate" button. `getCallTrayData` now also returns the production's templates; `GenerateForm` gained `mode="tray"` (success closes + refreshes like the single-call form). The standalone `/calls/generate` page stays for the templates list's per-template Generate deep-link. (2) **Fixed weekday-chip colours** — selected state was `--primary` (a near-black box in light mode, unclear in dark); now the theme-aware accent tint (`--accent-soft`/`--accent-ink`/`--accent`). New `.call-tray-modes` style. `tsc`/`eslint` clean; not browser-verified.

**Session 2026-06-11 (rehearsal templates + schedule generation, branch `claude/relaxed-davinci-rwk788`, NOT browser-verified):** built the "calendar rehearsal-template generation" feature in full ("Both" shape per user). (1) **Saved templates** — new `call_templates` table (production-scoped, mirrors `calls` default fields; live-migrated `create_call_templates`, RLS-on/no-policies like `call_confirmations`). CRUD at `/productions/[slug]/calls/templates` (+`/new`, +`/[templateId]/edit`) gated on `reports:create` (no new capability); `features/call-templates/{queries,actions}.ts`; on-brand `ConfirmDialog` for delete. (2) **Schedule generation** — `/productions/[slug]/calls/generate` (+`?template=ID` prefill): pick a template (seeds the form client-side), a date range, weekdays (Sun–Sat chips), and "skip days that already have a call" (default on) → `generateCalls` bulk-inserts one `calls` row per matching date (UTC date iteration; end≥start / ≥1 weekday / billing guards; **max 200/run**), revalidates calendar + dashboard, shows an inline success banner and stays mounted to generate more. Each generated call is an ordinary editable `calls` row; templates are a seed, not a live link. (3) **Entry point** — a **Generate** button in the calendar toolbar, shown only on the production-scoped calendar (`scopedSlug`) for `canEdit`. Forms reuse the existing `cform` styles. Closes the calls-calendar "No recurring call support" limitation. `tsc`/`eslint` clean. Full design + manual test steps: `feature-specs/12-rehearsal-templates.md`. Follow-ups: no template picker on the single-call tray yet; one weekly pattern per run; production-scoped only.

**Session 2026-06-12 (marketing site + brand identity refresh, branch `claude/epic-cray-rkjry0`, NOT browser-verified — this container's `node_modules` is incomplete so no local build/typecheck was possible; a CI / Vercel preview is the check):** a cosmetic/marketing pass, no app logic touched. (1) **Main font → Geist** (`next/font/google`) in both the root and marketing layouts, replacing Inter; CSS fallback stacks + the marketing `--font-geist` variable updated. Geist Mono unchanged. (2) **Dropped italics ("keep crimson, drop slant")** — flipped every chrome `font-style: italic`→`normal` across `globals.css` + marketing CSS + inline styles (the `Pro·scene` wordmark, marketing headline accents, show titles, greetings, empty states, calendar labels keep their crimson accent colour, just no slant). Intentionally left italic: `.prose` rich-text content and the editor's Italic formatting button (user content, not chrome). (3) **Brand identity / icons** — adopted the new amber→then→ink/paper→then→**transparent** Proscene call-board mark. Final state: a `transparent-icons/` folder holds the canonical transparent marks (`paper.svg` cream, `ink.svg` dark); in-page wordmark marks (marketing nav + footer, app rail, all six auth pages — retiring the old crimson "P" — and the new-production wizard, where a stray "CallBoard" wordmark was also fixed to "Proscene") use them, picking the variant by **contrast** (dark/ink mark on light surfaces, cream/paper on dark; theme-adaptive pairs via `body[data-theme]` for app surfaces). The favicon/installed-app-icon pack (`public/favicon.*`, `apple-touch-icon.png`, `icon-192/512*.png`, `manifest.ts`) was left on the prior dark badge set per the user ("keep the current favicon"); `favicon.svg` is OS-light/dark adaptive. (4) **Open-beta section** added to the homepage (`home-content.ts`) just below the fold (both static + Sanity-hero render paths) — an honest "we're in open beta" band inviting feedback for a lifetime founding discount; the % lives in one `BETA_DISCOUNT_PCT` constant (currently 30, a recommendation — **no Stripe coupon built yet**). (5) **Per-plan storage allowances** — `STORAGE_LIMIT_GB` (free 5 / season 100 / repertory 250 / company 500 GB) in `features/billing/constants.ts` as the single source of truth (**advertised ceilings only, no enforcement wired up**); surfaced on the pricing tier cards, comparison table, and a new storage FAQ. No price change. See `decision-log.md`. (6) **Features-page Script demo rebuilt** to match the real tool — the old demo showed blocking notes on highlighted prose; the new one shows numbered LX/sound/fly cues being placed on the page (pipe markers) with a "Export cue sheet · CSV" footer, copy/checklist rewritten to match. The other product demos (dashboard, calls, calendar, blocking, reports, people) were audited against their real components and found faithful, so left intact. **Deferred:** the 30% lifetime founding discount (no coupon/enforcement), storage quota enforcement, and a visual verification pass on the marketing demos via a preview deploy.

**Session 2026-06-12 (Rehearsal Video tab — link-only embeds + timestamp notes, branch `claude/focused-lamport-9u4hxf`, NOT browser-verified):** new production tab for sharing rehearsal footage by **linking** YouTube/Vimeo videos (no native hosting — the platforms host/transcode/stream, so this adds no storage or egress cost; native hosting via Mux/Cloudflare Stream is a deliberate future phase). (1) **Schema** — two new tables (`db/schema/rehearsal-videos.ts`): `rehearsal_videos` (production-scoped link metadata — `provider`/`videoId`/`embedHash`, optional `recordedDate` + `durationSeconds`, soft-delete) and `video_timestamp_notes` (notes pinned to a playback second, with author). **Migration applied directly to the Supabase `CallBoard` project** (`add_rehearsal_videos_and_timestamp_notes`, RLS enabled / no policies per app convention) — no `db:push` needed. (2) **Permissions** — two new capabilities `videos:view` (all roles) + `videos:create` (admin/producer/director/choreographer/stage_manager — leadership + SMs; cast/crew are view-only). (3) **Feature module** `features/videos/` — `constants.ts` (pure: provider labels, `formatTimecode`, deterministic card gradient), `validation.ts` (`parseVideoUrl` extracts provider+id from all common YouTube/Vimeo URL shapes and rejects anything else; `buildEmbedUrl`/`buildShareUrl` constructed from the validated id — **never raw embed HTML**, sidestepping the RichTextDisplay sanitization risk), `queries.ts`, `actions.ts` (`createVideo`/`deleteVideo` gated on `videos:create`+billing; `addTimestampNote`/`deleteTimestampNote` open to any member, author-or-manager delete; `setVideoDuration` idempotent from the player). (4) **UI** `app/(app)/productions/[slug]/videos/` — server `page.tsx` + `videos-client.tsx` (library grid w/ note counts, now-playing header, 16:9 player, speed cycle, share-timestamped-link, add-video modal) + `video-player.tsx` (loads the YouTube IFrame API / Vimeo Player SDK via injected `<script>` — no new npm dep — and exposes a `seekTo`/`getCurrentTime`/`setPlaybackRate` imperative handle; notes seek the player on click). Tab registered in `layout.tsx` (icon `Clapperboard`, count badge) for anyone with `videos:view`. **Download deliberately omitted** (impossible for hosted links). `tsc`/`eslint` clean; `next build` compiles + typechecks (page-data step needs live `DATABASE_URL`, unrelated). Spec: `feature-specs/20-rehearsal-video.md`. **Also (same session) enabled RLS on `announcement_productions`** (migration `enable_rls_announcement_productions`) — the Supabase advisor had flagged it as the one table with RLS *disabled* (anon-key exposed). Verified it's read only via Drizzle (pooler connection, bypasses RLS) with no Supabase anon-client access, so enabling RLS with no policies closes the exposure and matches every other table's convention; the critical `rls_disabled` advisory is now clear. (Remaining `rls_enabled_no_policy` notices are INFO-level and intentional. The advisor also WARNs that Auth "leaked password protection" is off — a dashboard toggle, left to the user.) **Follow-up fix (testing feedback): YouTube showed a black screen / no controls.** Root cause: the player let the YouTube IFrame API *generate and replace* a `<div>` (flaky path — the API iframe didn't inherit 100% sizing and init could silently no-op). Rewrote `video-player.tsx` to **render the `<iframe>` itself** (full-size, `src` = `buildEmbedUrl` with `enablejsapi=1`) so playback works straight from the embed regardless of the SDK, then *attaches* the YouTube/Vimeo JS API to that existing iframe purely for seek/rate/duration control. `tsc`/`eslint` clean; not browser-verified. **Also added Google Drive as a third provider (graceful degrade):** `parseVideoUrl` recognises Drive `/file/d/{id}/`, `open?id=`, `uc?id=` links → `gdrive` provider rendered via the `/file/d/{id}/preview` iframe (no JS API attach). Since Drive exposes no player API, the UI degrades for it — `supportsTimestampNotes(provider)` gates the timestamp panel (replaced by a "use YouTube/Vimeo" notice), the speed control and the live timecode; the add-video modal notes it works best with YouTube/Vimeo. Parse verified against the common Drive URL shapes. `tsc`/`eslint` clean.

**Session 2026-06-12 (pipe-cue polish, branch `claude/cue-spacing`):** the pipe marker now renders as a clean vertical line (serifs removed — no more uppercase-"I" look) inset 15% from the text-line band so it's a touch shorter; applied on screen, in the in-progress preview, and the PDF export. The pipe tool's cursor is now a vertical-line cursor (white-haloed, `PIPE_CURSOR`) instead of a crosshair, so it's clear where the pipe will drop. `tsc`/`eslint` clean.

**Session 2026-06-12 (draggable cue labels, branch `claude/cue-spacing`):** after several rounds tuning the auto cue-label layout, added manual control as the real fix — auto-stacking stays the default, but a manager can **drag any cue's number to place it exactly**, and the orthogonal leader follows. New optional `labelPos` (normalized) on `CueAnnotation` (no DB migration — annotations are per-user JSONB); when set the label renders there and is excluded from `stackCueLabels` auto-packing. Drag is wired in the SVG overlay (`AnnotationShape` label sub-group is a drag handle → `startLabelDrag` → window mousemove/up → `updateAnnotation`), with a move-threshold so a plain click still selects; the PDF export honors `labelPos` too. "Reset label position" in the cue's edit panel returns it to auto. Desktop-only (matches the other annotation tools). `tsc`/`eslint` clean (no new warnings). Not browser-verified.

**Session 2026-06-11 (cue overlay scales with zoom/monitor, branch `claude/cue-spacing`):** the cue overlay (label font, leader/pipe strokes, end dots, margin/lane offsets, and the stack gaps in `stackCueLabels`) was sized in fixed screen pixels, so on a page rendered small (Fit on a 1080p) the cues were huge and the number stacks piled down the page, while zooming in normalized them. Introduced `cueScale = renderScale / BASE_RENDER_SCALE` and multiplied every cue-overlay dimension by it, so the overlay is a fixed size in PDF-point space — consistent relative to the script text at any zoom or monitor (=1 at the default 100%, unchanged there). Threaded into `stackCueLabels`, the SVG `AnnotationShape`, and the PDF export (`drawAnnotationOnCanvas`, using `PRINT_SCALE/BASE`). `tsc`/`eslint` clean. Not browser-verified.

**Session 2026-06-11 (cue labels read in cue-number order, branch `claude/cue-spacing`):** two reported cue-label problems, both rooted in the auto two-lane stacking (#38) ordering by anchor position: (a) two cues on one line rendered side-by-side (higher number could land first) instead of dropping the second below; (b) cues read out of numeric sequence down the margin (e.g. 10, 13, 12). Rewrote `stackCueLabels` to lay a margin out **by cue number** (numeric-aware, "2" < "10") with a greedy, order-preserving pack: keep each label at its line in the first column; stack up to `MAX_STACK` (2) labels vertically in a pile; the next label that can't seat there **overflows into the second column** (at its own line, below). Earlier labels are never moved and a label is never placed above the previous (lower) number, so adding a cue only positions the new one and out-of-order/real-time additions resolve cleanly (e.g. adding `8` below `6/6.5` overflows `8` to column 2 instead of shuffling `6.5`). Screen + PDF export share the helper. `tsc`/`eslint` clean (no new warnings). Not browser-verified; `MAX_STACK` is tunable.

**Session 2026-06-11 (role-restricted private folders, branch `claude/private-folders`, NOT browser-verified):** backlog item "per-role private folders". Document folders can now be restricted to chosen production roles. (1) **Schema** — `document_folders` gains `visibility` ('everyone' default | 'restricted') + `allowed_roles text[]` (live migration `add_folder_visibility`, additive; existing folders stay public). (2) **Access** — pure `canViewFolder(folder, viewerRole, canManage)` in `features/documents/constants.ts`: managers (admin/producer) see all; otherwise a restricted folder is visible only to roles in `allowed_roles`, keyed off the viewer's **production** role. Enforced server-side in the documents page (folder rail + doc list filtered) and the document viewer page (`notFound()` on direct access); folder pickers receive the filtered list. (3) **Actions** — `createFolder` takes visibility + roles; new `updateFolder` (rename + visibility). Gated on `documents:upload` (no new capability). (4) **UI** — new `FolderEditor` portal modal (create + edit) with a Restrict toggle + role checkboxes; lock icon + hover-edit pencil on the folder rail; "visible to <roles>" subtitle. `tsc`/`eslint` clean. Spec: `feature-specs/13-document-folder-privacy.md`. Known gaps: tab badge count still counts hidden docs (number only); default-script path not folder-gated. Shipping as its own PR off `main`.

**Session 2026-06-11 (social sign-in — Google, MERGED to `main` via PR #41, VERIFIED working in production):** added one-click Google OAuth on `/login` and `/signup`. **Status: live and confirmed working on `www.proscene.app`.** New `signInWithOAuth()` server action (`app/actions/auth.ts`) requests the provider's authorization URL via `supabase.auth.signInWithOAuth` (PKCE) and redirects to it; the existing `/auth/callback` route already exchanges the code for a session, so it was unchanged. New shared client component `components/auth/oauth-buttons.tsx` ("Continue with Google" button, per-button `useFormStatus` pending, "or continue with" divider) rendered on both pages — Supabase resolves an existing user to sign-in and a new one to signup, so the same button serves both. OAuth users carry no `first_name`/`last_name` metadata, so `lib/auth.ts` gained `deriveName()` which falls back to Google's `given_name`/`family_name` or splits a `full_name`/`name`; profile + org auto-creation is otherwise identical to email/password signup. Login page now surfaces `?error=oauth|auth_callback`. New `.auth-divider`/`.auth-oauth*` styles. **Apple held off** (needs paid Apple Developer membership) — provider-agnostic wiring, re-add via `OAUTH_PROVIDERS` + a second button. **Dashboard setup (done by user):** Google provider enabled in Supabase (client ID/secret), `https://avqgfzrcwegebtbvmcwo.supabase.co/auth/v1/callback` as Google's authorized redirect URI, `/auth/callback` entries in Supabase Redirect URLs, `NEXT_PUBLIC_SITE_URL=https://www.proscene.app` (canonical = www, matches Supabase Site URL). **Rollout debugging lessons** (logged in `feature-specs/02-auth.md` → "OAuth troubleshooting"): the success signature in Supabase auth logs is `/authorize → /callback → POST /token (200)` — a `login` event with no `POST /token` means the redirect fell back to the Site URL (homepage); the PKCE cookie is domain-scoped so test on the canonical prod domain (not a preview, not the apex); and the feature only works once `main` is deployed to production. `tsc` + `eslint` clean. Detail: `feature-specs/02-auth.md`.

**Session 2026-06-11 (rehearsal templates + schedule generation, branch `claude/rehearsal-scheduler`, NOT browser-verified):** the "calendar rehearsal-template generation" backlog item, built in full and extracted onto a clean branch off `main` (the two scheduler commits only — no script/cue files touched). (1) **Saved templates** — new `call_templates` table (production-scoped, mirrors `calls` default fields; live-migrated `create_call_templates`, RLS-on/no-policies like `call_confirmations`). CRUD at `/productions/[slug]/calls/templates` (+`/new`, +`/[templateId]/edit`) gated on `reports:create` (no new capability); `features/call-templates/{queries,actions}.ts`; on-brand `ConfirmDialog` for delete. (2) **Schedule generation** — `/productions/[slug]/calls/generate` (+`?template=ID` prefill) and, primarily, an animated `One call` / `Repeating` toggle inside the "Schedule a call" slide-in tray: pick a template (seeds the form), a date range, weekdays (Sun–Sat chips, accent-tinted selected state), and "skip days that already have a call" (default on) → `generateCalls` bulk-inserts one `calls` row per matching date (UTC iteration; end≥start / ≥1 weekday / billing guards; **max 200/run**), then closes + refreshes the calendar. Each generated call is an ordinary editable `calls` row; templates are a seed, not a live link. `getCallTrayData` now also returns templates. Closes the calls-calendar "No recurring call support" limitation. `tsc`/`eslint` clean. Design + manual test steps: `feature-specs/12-rehearsal-templates.md`. Follow-ups: repeat mode uses plain-text fields (no rich cast picker); one weekly pattern per run; production-scoped only.

**Session 2026-06-11 (beta round 11 — smaller labels + auto two-lane cues, branch `claude/cue-two-lane`, EXPERIMENTAL / not merged):** trial of a denser cue layout. (1) **Smaller labels** — cue number 15→13px, description 11→9px (both SVG + export). (2) **Auto two-lane stacking** — `stackCueLabels` now returns `{y, lane}` and packs each margin into two lanes: a cue takes the inner lane at its natural height when free, overflows to a second lane (offset `CUE_LANE_GAP=34px` toward the text) only when the inner is occupied, and only pushes down if both lanes are full. Sparse pages stay single-column; dense clusters stagger between two lanes at their natural heights (verified: 5 cues 16px apart alternate 0/1/0/1/0 with no push-down). Stacking constants eased slightly (20/18/12). Renderers (`AnnotationShape`, `drawAnnotationOnCanvas`) take `cueLabel?: {y,lane}` and derive lane X from canvasW. Known risk to evaluate in-browser: the 2nd lane sits toward the text so on tight-margin scripts it may crowd the page, and long descriptions in two lanes can overlap. `tsc`/`eslint`/`next build` clean. **To be tested on deployment; scrap if it doesn't read well.**


**Session 2026-06-11 (beta round 10 — note text contrast, branch `claude/note-text-contrast`):** the on-page note text box used `color: var(--ink)`, which is white in dark mode — unreadable since the note sits on the white script page. Hardcoded the note text to a dark colour (`#1a1a1a`, +`fontWeight 500`) so it reads in any theme, matching the PDF export (`#1c1c1c`); nudged the box tint slightly lighter (`26`→`22`). `next build` clean. Not browser-verified.


**Session 2026-06-11 (beta round 9 — wider cue-label spacing, branch `claude/cue-label-spacing`):** in two-column scripts a cue whose leader passed between two right-margin cues cut through their labels — the stacking gap (~23px) was barely over one script line, so cues ~one line apart were nudged only a pixel. Bumped the `stackCueLabels` constants (`CUE_LABEL_NUMBER_UP` 18→22, `CUE_LABEL_DESC_DOWN` 18→20, `CUE_LABEL_PAD` 5→14) so stacked labels keep ~15px clear whitespace and a sandwiched leader has room to pass cleanly. `next build` clean. Not browser-verified.

**Session 2026-06-11 (beta round 3 — cue stacking + cue sheet, branch `claude/cue-stacking-csv`, NOT merged / not device-verified):** beta-feedback item "cue stacking redesign + CSV export". (1) **Cue label stacking** — when multiple cues land in the same margin at similar heights, labels used to overlap. `stackCueLabels()` now offsets the lower ones downward (accounting for the note line), and the leader is **orthogonal**: horizontal out to the margin, then a right-angle drop to the label — never a diagonal across the script. Applied in both the on-screen SVG (`AnnotationShape`) and the PDF export (`drawAnnotationOnCanvas`), each computed in its own pixel space. (2) **Cue-sheet CSV export** — `buildCueSheetSections()` groups every cue by the scene it falls under (section anchors = non-song bookmarks, matched by page; pre-first-marker cues → "Top of show"), ordered by page then vertical position; `cueSheetToCsv()` emits scene-divider rows + `Cue,Note,Page`. (3) **Editable cue-sheet view** — a "Cue sheet" toggle in the script toolbar swaps the workspace for `CueSheetView`, a spreadsheet of all cues grouped by scene with inline-editable Cue # and Note that write straight back to the annotation (`updateAnnotation` → save), a colour dot, a per-row "p.N" jump (back to the script at that cue, selected), delete, and an Export CSV button. Read-only on phones. New `.sv-cuesheet*` styles. All in `script-viewer.tsx` + `globals.css`; cues are per-user annotations so the sheet is the viewer's own. (4) **Viewer bounded to the viewport** — the script used to grow past the monitor; the shell now measures its own top offset at runtime (`shellHeight`, handles any header/banner height) and caps to `innerHeight - top`, with `.sv-workspace` flexing + scrolling internally and the right panel scrolling on its own. Desktop only (untouched on phones). (5) **Fit-whole-page default** — "Fit" now contains the whole page in the workspace (limited by width OR height) and is the default zoom, so a page presents complete with no scroll until you zoom in (then it scrolls); zoom-out snaps back to fit. Phones keep the fixed high render scale for sharpness. (6) **Cue stack ordering** — within a line, stacked labels now order by cue number (natural compare, bucketed by ~14px line tolerance) instead of draw order, so cue 2 sits above cue 4 on the same line. (7) **Cue sheet includes songs** — `buildCueSheetSections` now anchors on scenes AND songs in document reading order (so "#3 Our Prayer" is its own section), with a scene/song icon per section header. Limitation: bookmarks store only a page (unpdf gives per-page text, no positions), so when a scene and song share a page every cue on it files under whichever was detected later — precise "between" ordering needs positional data we don't capture. (8) **Bookmarks panel Scenes/Songs toggle** — segmented tabs filter the list (untagged manual bookmarks group with Scenes); counts per tab. `tsc`/`eslint`/`next build` clean. Not browser-verified.

**Session 2026-06-11 (beta round 8 — cues sort by script position, branch `claude/cue-stacking-csv`):** superseded round 7's numeric cue sort. Numeric/prefix sorting was wrong for theatre: a late "SFX4" (occurring near light cue 180) would sort up next to "L4". Cues now order by **document position** — page, then top-to-bottom (with a ~one-line vertical tolerance so same-line cues go left-to-right), via `compareCuePosition`. This is true show order and rides on the scene-bookmark sectioning already in place, so SFX4 lands among the light cues in its actual scene. Replaced the cue-number comparator in the cue sheet (`buildCueSheetSections` now keeps position order, no per-section re-sort), the side AnnotationsPanel (back to `byY`), and the same-line stack tiebreak (now left-to-right by x). `compareCueNumbers`/`cueSortParts` removed. `tsc`/`eslint`/`next build` clean. Not browser-verified.

**Session 2026-06-11 (beta round 7 — pipe capture + prefix-aware cue sort, branch `claude/cue-stacking-csv`):** two follow-ups. (1) **Pipe line capture was duplicating** — a text-layer span often holds a whole line, so the old span-boundary logic always appended "*" at the line end and every pipe on a line captured the same text. Rewrote `capturePipeLine` to work at the word level (`lineWordsAt` splits each span into words, interpolating x by character offset) and capture a **window** of ~5 words on each side of the pipe with "…" when there's more — so each pipe on a line gets its own surrounding words with "*" correctly placed. (2) **Cue sort ignored letter prefixes** — `compareCueNumbers` now sorts by the **numeric part first** (so "L2" < "L4" < "SFX4", interleaving departments by number and keeping each sequence ordered) then by the letter prefix, instead of a plain string sort that clumped all "L" then all "SFX". Applied to the cue sheet rows, the side AnnotationsPanel, and the same-line stack ordering. `tsc`/`eslint`/`next build` clean. Not browser-verified.

**Session 2026-06-11 (beta round 6 — pipe cue marker, branch `claude/cue-stacking-csv`):** the cue tool gains a second anchor style. A **Style** toggle in the cue options switches between **Box** (the existing drag-a-box-around-words/lines) and **Pipe** (`cueMarker` state). In pipe mode a single click drops a vertical caret-style line, snapped to the height of the text line under the click (`pipeBandAt` finds the line band from the text-layer spans); stored as `CueAnnotation.marker:"pipe"` with a zero-width `rect` at the pipe's x over its line. The cue's **line capture** is pipe-aware: `capturePipeLine` reads the words on that line and inserts `*` at the pipe's x position (between words, or appended at a line end), so the cue sheet's Line column reads e.g. `world * how`. Box cues keep `captureLineText`. Rendering branches in both the SVG overlay (vertical line + serifs + wide invisible hit target) and the PDF/canvas export; the in-progress preview shows a dashed vertical line in pipe mode. `tsc`/`eslint`/`next build` clean. Not browser-verified.

**Session 2026-06-11 (beta round 5 — note + text-highlight tool fixes, branch `claude/cue-stacking-csv`):** two script-tool bugs from testing. (1) **Note tool** now renders as a real sticky-note text box — the note's text is drawn inside the box (SVG `foreignObject` with wrapped HTML on screen; `wrapCanvasText` word-wrap clipped to the box in the PDF export), where before it was just a tinted rect + dot with the text only in the side panel. Notes also get a minimum box size (0.2×0.06 of the page, never shrinking a larger drawn box) so a quick drag still yields a readable box. (2) **Text-highlight ("T") tool** no longer collapses a multi-line selection into one giant full-width block: `handleTextLayerMouseUp` now merges `getClientRects()` fragments per line and stores them as `HighlightAnnotation.rects[]` (plus the bounding `rect` for hit/back-compat); the SVG and canvas-export render each per-line box so the highlight hugs the selected text. `tsc`/`eslint`/`next build` clean. Not browser-verified.

**Session 2026-06-11 (beta round 4 — cue sheet polish, branch `claude/cue-stacking-csv`):** follow-ups on the above. (1) **View-toggle bug** — leaving/returning the cue-sheet view left a blank page (only the cue layer) and a stuck zoom. Cause: the workspace was *unmounted* in cue-sheet mode, so the new canvas never re-rendered and the ResizeObserver was orphaned (workspaceW→0, fitScale→null, zoom stuck). Fix: keep the workspace mounted and hide it with `display:none`, and ignore zero-size measurements — so the rendered canvas and the measured fit scale both survive the toggle. (2) **"Line" column** — cues now capture the script text under their box at draw time (`captureLineText` reads the positioned PDF/OCR text-layer spans overlapping the rect) into `CueAnnotation.line`; shown as an editable "Line" column in the cue sheet and a column in the CSV. (3) **Cue ordering** — cue sheet rows (within each section) and the side AnnotationsPanel cue list now sort by cue number (natural compare, "2" < "10") instead of page position. `tsc`/`eslint`/`next build` clean. Not browser-verified.

**Session 2026-06-11 (beta testing round 2 — branch `claude/relaxed-davinci-rwk788`, NOT merged / not device-verified):** fixes from a casting/script testing pass. (1) **Re-parse no longer stacks duplicate characters/scenes.** Added `source` (`ai`|`manual`) to `production_roles` + `production_scenes` (live migration `add_source_to_roles_and_scenes`, additive, existing rows default `manual` so nothing already placed is ever auto-removed). `applyScriptParse` now runs in a transaction and treats the rows it created (`source='ai'`) as owned: on a new parse it deletes them and re-creates from the new breakdown, while preserving (a) hand-added/wizard rows (`source='manual'`) and (b) **casting assignments** — outgoing AI roles' `assigned_user_id`/`actor` are captured and re-linked by character name onto the fresh rows, so re-parsing never un-casts actors. **Scenes are protected from blocking loss:** only AI scenes with NO `scene_beats` are replaced; an AI scene that's been blocked is kept even if the new parse drops it (the cascade would otherwise wipe its beats/positions/arrows/comments). NOTE: pre-existing duplicate rows from before this change are `manual` and won't be auto-removed — they need a one-time manual cleanup. (2) **Per-cue colour.** New `color?` on `CueAnnotation` + a `CUE_COLORS` palette (constants); the cue tool gets a colour swatch row that sticks (persisted in `localStorage` `sv-cue-color`) and applies to new cues until changed; existing cues can be recoloured from the panel edit form. Canvas + SVG + panel renders use the cue's own colour (fallback `CUE_STROKE`). Cue number bumped 13→15px (canvas + SVG). (3) **Production-card UX:** replaced the two hover icons (which overlapped the card text) with a single persistent **⋮ kebab menu** (`production-card-menu.tsx`) housing Archive/Delete; dropped the colliding "Open hub" hover CTA. (4) **On-brand confirm dialog** (`components/ui/confirm-dialog.tsx`, portal + `.confirm-*` styles) replaces `window.confirm` for archive/delete. (5) **AI parse counter** pill now subtly tinted (accent → amber at 1 left → clay at 0) so the limit reads as a limited resource. `tsc`/`eslint`/`next build` clean (build's page-data step needs live env, unrelated). Not browser-verified.


**Session 2026-06-11 (cont.³ — wider scan coverage):** main now has the searchable-scan rebuild (PR #32, squash-merged). Two follow-ups to widen the umbrella: (1) **Image uploads** — a script uploaded as a bare JPEG/PNG/WebP (not just a PDF) is now scan-detected and rebuilt into a one-page searchable PDF (`rebuildImageAsSearchablePdf` decodes via `createImageBitmap` honouring EXIF rotation, OCRs, assembles). Shared per-page assembly extracted into `appendOcrPage`; `installSearchableScript` now takes a `File` and dispatches image-vs-PDF; detection helper `needsScriptOcr` (image type OR no-text-layer PDF). (2) **Higher OCR DPI** — PDFium render scale 2.0→3.0 (144→216 dpi); empirically +11% words recovered and higher mean confidence on the real test file, at modest memory/size cost. `tsc`/`eslint`/`next build` clean. On branch `claude/wonderful-newton-vo7sog` (re-based onto merged main); not yet device-verified.

**Session 2026-06-11 (cont.² — detect+prompt at UPLOAD, fix viewer gating):** end-to-end-verified the rebuild on the real file in Node (PDFium render → tesseract → jsPDF → re-extracted real text: "FRANK ABAGNALE… DreamWorks… 421 West 54th Street"), confirming the engine produces a genuinely searchable PDF. Then fixed two things from tester feedback: (1) **viewer offer was gated on `renderBlank`** (pdfjs draws *nothing*), but these MRC scans draw a faint background so it never fired and the tester fell through to the old broken in-browser OCR — re-gated the "Make searchable" offer on **`isScanned`** (no text layer, the Adobe-style signal); `renderBlank` now only drives the native-view fallback. Removed the old in-browser tesseract OCR banners (superseded by the rebuild). (2) **Moved detection + prompt to upload** (as agreed): `lib/pdf-scan-detect.ts#isScannedPdf` runs in the Documents upload form after a `script`-type PDF uploads; if it's a scan, an inline "Make searchable" prompt rebuilds it and installs it as the default script. Shared orchestration in `lib/install-searchable-script.ts` (used by both the upload prompt and the viewer hook). **Note on deployment:** the tester was on the branch's Vercel **preview**, not main — but the preview only has what's pushed to the branch; nothing is on `main` yet. New: `lib/pdf-scan-detect.ts`, `lib/install-searchable-script.ts`; edited `document-upload-form.tsx`, `script-viewer.tsx`, `use-script-rebuild.ts`. `tsc`/`eslint`/`next build` clean.

**Session 2026-06-11 (cont. — searchable-PDF rebuild for unrenderable scans, branch `claude/wonderful-newton-vo7sog`, NOT yet live-verified):** root-caused why a tester's scanned script showed blank in the Script tool even after the in-browser OCR: the file is **MRC-compressed** — each page is a `DCTDecode` background plus **thousands of tiny `CCITTFax` 1-bit `/ImageMask` glyph stencils** that hold the text, and **pdfjs silently drops those masks** (renders the background/logo only). pdfjs is our viewer's engine *and* the in-browser OCR's raster source, so both display and tesseract OCR came up blank. (PR #32's font fix is irrelevant here — the file has no fonts.) Confirmed by recovering the file from git history and dissecting it; **verified `@hyzyla/pdfium` (PDFium-WASM) renders all 126 pages at 16–27% ink** where pdfjs is blank. **Two fixes shipped:** (1) **Native-engine fallback** — the viewer probes a representative page's ink coverage (`isRenderBlank`) and, for a scan pdfjs can't rasterize, drops into the browser's native PDF viewer (an `<iframe>`, like the Documents tab) so it's at least readable; the futile in-browser OCR offer is suppressed for these. (2) **In-browser searchable-PDF rebuild** — `lib/pdf-ocr-rebuild.ts` renders each page with **PDFium-WASM** (base64-inlined build, no asset hosting/CDN), OCRs it with `tesseract.js` (reusing `lib/ocr.ts`), and assembles a new PDF (image + **invisible jsPDF text layer**) that pdfjs renders + searches natively. Managers get a **Make searchable** button on the blank-render banner (progress + cancel); the result is uploaded direct-to-storage (signed URL) and **installed as the new default script** (version-bumped, original kept; `finalizeRebuiltScript`/`createRebuiltScriptUploadUrl` in `features/scripts/ocr-actions.ts`), then the page refreshes. **New dep `@hyzyla/pdfium` (BSD/MIT, WASM).** New files: `lib/pdf-ocr-rebuild.ts`, `app/(app)/productions/[slug]/script/use-script-rebuild.ts`; extended `script-viewer.tsx` (blank detect + native fallback + rebuild UI), `features/scripts/ocr-actions.ts`. `tsc`/`eslint` clean; `next build` compiles + type-checks. **Decisions confirmed with user:** replace-as-default (keep original), offer-at-upload (currently triggered in the viewer on first open where blank-render detection is reliable; relocating the prompt into the upload flow is the remaining follow-up). Detail: `decision-log.md` + `feature-specs/19`.

**Session 2026-06-11 (Scanned-script OCR for text tools — branch `claude/wonderful-newton-vo7sog`, NOT yet merged / not live-verified):** the Script tool can now turn a **scanned/image-only PDF** into a text-bearing script *in the browser*, so the select / copy / find / (future) line-highlighting tools work on scans instead of being dead. Flow: on open the viewer samples the first few pages' extractable text (`< 100` chars over up to 5 pages = scan, same heuristic as the AI parser); if it's a scan with no OCR yet, managers see a banner — **Run OCR** (warns it processes each page and can take a few minutes) or **Not now** (remembered per file in `localStorage`; falls back to image-only viewing exactly as before). Running OCR renders each page to a canvas and feeds it to **tesseract.js** (in-browser WASM, **zero token/server cost**), collecting per-word boxes; progress is shown page-by-page and is **cancellable**. The result is a property of the **file**, not the user — stored once (keyed by `storage_path` + `script_version`) and **shared across the production**, so it OCRs once not per viewer. The viewer paints the stored word boxes as the existing transparent **text layer** (same element the pdfjs text layer uses), so selection/copy/find "just work"; boxes are stored **normalized (0..1)** so they map to any zoom. **New:** `db/schema/script-ocr.ts` (`script_ocr`, server-only RLS-on/no-policies — **table must be created in the live Supabase project before this works**, SQL in decision-log), `lib/ocr.ts` (tesseract.js worker singleton + `ocrCanvas`), `scripts/copy-tesseract-assets.mjs` (self-hosts the worker + WASM core into `public/tesseract/`, gitignored; **language data fetched from the tessdata CDN by default**, override with `NEXT_PUBLIC_TESSERACT_LANG_PATH`), `features/scripts/ocr-actions.ts` (`getScriptOcr`/`startScriptOcr`/`saveScriptOcrPages`/`failScriptOcr`), `app/(app)/productions/[slug]/script/use-script-ocr.ts` (orchestration hook); extended `features/scripts/constants.ts` (`OcrWord`/`OcrPage`/`ScriptOcrStatus`), `script-viewer.tsx` (detection + banner + OCR text-layer), `globals.css` (`.sv-ocr-*`). New dep **`tesseract.js`** (+ `tesseract.js-core`). **v1 = desktop `ScriptViewer`**; the mobile reader inherits the *stored* result for display but its own detect/run UI is a fast-follow. **Setup the user owns:** create the `script_ocr` table in Supabase (SQL in decision-log). `tsc` + `eslint` clean (no new errors); `next build` compiles + type-checks (page-data step needs live env, unrelated). Not yet exercised against a real scan. Full design: `feature-specs/19-ai-script-analysis.md` → "Scanned-script OCR (in-browser text tools)".

**Session 2026-06-10 (cont. — Phase 2 line highlighting SCOPED, not built):** scoped the AI per-role **line-highlighting** feature (output #4) as an explicit **Beta**. Decided (with the user) on the leanest, safest shape: a **render-only, client-side, opt-in** overlay — the viewer detects a chosen character's speeches from its existing `pdfjs` text layer (cue-based) and boxes them; **nothing is written to `script_annotations`**, so it's reversible by construction (the user's bookmarks/notations are never touched, and "off" is the fallback the user asked for). No schema, no server actions, no tokens. Beta v1 = desktop `ScriptViewer` + a new pure util `features/scripts/line-highlights.ts`; mobile reader is a fast-follow; persistence (for PDF export), auto-select via `character_name`, and a server AI-assisted engine for irregular scripts are later iterations. Full design: `feature-specs/19-ai-script-analysis.md` → "Phase 2 — per-role line highlighting (Beta)". Not yet implemented.

**Session 2026-06-10 (cont. — AI script-parse reliability, branch `claude/wonderful-newton-vo7sog`):** three contained reliability fixes in `features/scripts/actions.ts`. (1) **Stalled-parse watchdog** — a parse whose async worker dies (Vercel reclaim, or > `maxDuration=300s`) no longer spins the review page forever or blocks new parses. Rows `processing` past `STALE_PARSE_MS` (8 min) are treated as dead: the poll paths (`fetchLatestScriptParse`/`fetchScriptParseById`) flip them to `failed` (`failIfStale`), and the concurrency locks (`startScriptParse`/`reparseWithNotes`/`startWizardScriptParse`) skip them (`hasLiveProcessing`). Lazy detection (the poll runs every 3s), no cron. (2) **Idempotent apply** — `applyScriptParse` was re-inserting roles/scenes on a re-apply/double-click; now re-applying an already-`applied` parse is a no-op (status guard) and roles/scenes are inserted additively-but-de-duplicated (roles by name, scenes by act/scene number). No schema change. Apply never deletes (scenes are shared with the blocking tool), so a re-parse that drops a role/scene leaves the old row for manual removal. (3) **Late-joiner bookmark seeding** — members who join after the breakdown is applied are now seeded lazily on first Script-tab open (`ensureMemberBookmarks` reads the applied parse's bookmarks; gated on `documents.processingStatus === "applied"`, so no extra query otherwise). Detail: `decision-log.md` (2026-06-10) + `open-questions.md`.

**Session 2026-06-10 (AI script analysis — OCR for scanned scripts, branch `claude/wonderful-newton-vo7sog`, not yet merged / not live-verified):** scanned/image-only PDFs are no longer rejected. `runScriptParse` (`features/scripts/parse.ts`) detects a missing text layer (extracted text < 200 chars) and switches to a **vision path** — it hands the PDF to Claude's native PDF/vision pipeline (which OCRs each page) by passing the existing Supabase **signed URL** as a `{type:"url"}` `document` block (no base64 inflation, no Files API). A separate `VISION_SYSTEM_PROMPT` returns the same cast/scenes but bookmarks as a **`page` integer** (no text to anchor against on a scan); `resolveVisionBookmarks` validates the page is in-range — bookmarks on scans are best-effort, cast/scenes unaffected. **Page cap** `MAX_SCANNED_PAGES = 250` (image+text tokens per page would otherwise overflow context). **Cache** is fingerprinted on raw file bytes for scans (empty text would collide across different scans and poison the cross-org `script_cache`); text PDFs keep the text fingerprint. The wizard auto-fill path inherits this (same `runScriptParse`). Caveat copy on the AI-setup page updated. Cost on scans is higher (~$1–2/script) but bounded by the existing caps. Full detail: `feature-specs/19-ai-script-analysis.md` + `decision-log.md` (2026-06-10). **Also pinned (awaiting file):** a tester's valid PDF renders blank in the Script tool's pdfjs canvas but fine in the Documents iframe — diagnosis logged in `open-questions.md`, holding for the file.

**Session 2026-06-10 (Cast assignment from parsed roles — branch `claude/relaxed-davinci-rwk788`, NOT yet merged / not device-verified):** closed the gap where `production_roles` (the AI-parsed / wizard character list) was written but never read. **Schema (applied live to `avqgfzrcwegebtbvmcwo` via MCP, additive nullable, verified):** `production_roles.assigned_user_id` (FK → `profiles`, `ON DELETE SET NULL`) bridges a character to a real org member. **Query:** `getProductionRoles(productionId)` (`features/productions/queries.ts`) returns the cast list with the assigned person joined in. **Actions (`features/members/actions.ts`):** `assignRoleToMember(roleId,userId)` — casts an existing member and grants production access (new member → `cast` + `characterName`; existing member keeps their role, gains the character; one actor↔one character per show, re-assign frees the prior role); `unassignRole(roleId)` — clears the link + matching character name, leaves membership intact; `inviteAndAssignRole({roleId,firstName,lastName,email})` — invites a brand-new person and casts them in one step, reusing `inviteMembers`. **Permissions:** cast existing = `productions:manage`; invite-new inline = `settings:manage`. **UI:** new `cast-list.tsx` ("Cast list · N/M cast" with per-character Assign/Change/Unassign + an inline invite sub-form for admins) rendered above the team manager on `/productions/[slug]/members`; lights up everything keyed on `role="cast"` (dashboard avatar stacks, character column). Empty state links to the Script AI tab. `tsc`+`eslint` clean. Not browser-verified. Decision in `decision-log.md` (2026-06-10 — cast assignment); spec note in `feature-specs/19-ai-script-analysis.md`.

**Session 2026-06-10 (Production + organization delete — branch `claude/relaxed-davinci-rwk788`, NOT yet merged / not device-verified):** added admin soft-delete for both productions and organizations, distinct from the existing production archive. **Schema (applied live to Supabase project `avqgfzrcwegebtbvmcwo` via MCP `apply_migration`, additive nullable, verified):** `productions.deleted_at` + `organizations.deleted_at` (`timestamptz`). **Productions** — `deleteProduction`/`restoreDeletedProduction` (admin-only, `settings:manage`); `deleted_at` filters added across `features/productions/queries.ts` (active/archived/by-slug/user lists) + new `getDeletedProductionsByOrganization`; `userCanAccessProduction` + `getProductionBySlug` now exclude deleted (so links 404); UI = a trash icon on each production card (confirm dialog spelling out 30-day recovery) + a self-serve **"Recently deleted"** section on `/productions` with Restore. **Organizations** — `deleteWorkspace(confirmName)` (admin-only, **type-the-name** confirm re-checked server-side; soft-deletes + moves the caller to another membership, or none → auth makes a fresh personal workspace); deleted orgs excluded from `lib/auth.ts` `resolveActiveMembership` and the `getUserMemberships` switcher; UI = a **Danger zone** card on Settings → Workspace with type-to-confirm, telling the user it's **recoverable via support for 30 days** (operator restores by clearing `deleted_at` — SQL in `admin-playbook.md`). **Deferred:** the destructive 30-day hard purge is NOT built — soft-deleted rows stay hidden but recoverable indefinitely until a careful purge step lands (tracked in `open-questions.md`). `tsc` + `eslint` clean. Not yet exercised in a browser. Decision recorded in `decision-log.md` (2026-06-10 — soft-delete model).

**Session 2026-06-10 (Beta-feedback quick fixes — branch `claude/relaxed-davinci-rwk788`, NOT yet merged / not device-verified):** a first batch of small, self-contained fixes from beta testing. (1) **Cue label legibility** — cue numbers/descriptions on the script editor are now larger (number 11→13px, desc 10→11px) with more breathing room from the page edge (margin offset 6→14px), applied consistently in both the interactive SVG overlay and the canvas/export render paths in `script-viewer.tsx`. (2) **Production colour picker** — the New Production wizard's Basics step now has a swatch picker (`StepBasics` in `new-production-wizard.tsx`); the palette grew from 6 to 12 tokens (added teal/rose/indigo/moss/ocean/berry in `globals.css` + `features/productions/constants.ts`), `color` now threads through `WizardData` → `FullProductionInput` (`wizard-constants.ts`) → `createProductionFull` insert (validated via `isValidProductionColor`). Quick-create still uses the deterministic hash fallback. (3) **AI parse counter** — the existing 5-per-30-day production cap is now surfaced as a "N of 5 analyses left" pill on the AI Script Setup page. The limit constants moved from `scripts/actions.ts` into `scripts/constants.ts` (now exported), a `getProductionParseUsage()` query was added (`scripts/queries.ts`), and `ai/page.tsx` passes usage to `AiReviewClient`. **Confirmed already-done from the list (no change needed):** trial-banner close button (persists 24h per phase via localStorage), trial countdown no longer overlaps the announcement banner (ResizeObserver `--app-banner-h` offset), and the "first production free / 60-day trial + grace period" marketing copy (pricing + home). `tsc` + `eslint` clean. Not yet exercised in a browser. Deferred/larger items from the same feedback list (org/production delete UX, cast-from-parsed-roles assignment, cue stacking redesign + CSV export, calendar rehearsal-template generation, per-role private folders, etc.) remain open and need design decisions.

**Session 2026-06-10 (Announcements broadcast redesign — branch `claude/eager-fermat-758wao`, NOT yet merged / not device-verified):** reworked announcements from a single-scope (org-wide OR one production) notice board into a **multi-audience broadcast tool** matching the design prototype.
- **Schema (applied to the prod Supabase project `CallBoard` via MCP `apply_migration`, additive + backfill, non-destructive):** `announcements` gained `priority` (`normal|important|urgent`, CHECK), `require_ack` (bool), `org_wide` (bool); new join table **`announcement_productions`** `(announcement_id, production_id)` unique. Backfill set `org_wide = (production_id IS NULL)` and mirrored each scoped row into the join. Legacy `production_id` **kept** (still written for single-target posts, null for org-wide/multi) but is **no longer the source of truth** — audience = `org_wide` + the join table. Drizzle schema synced (`db/schema/announcement-productions.ts`, index export, new columns); migration applied via MCP, not `db:push`.
- **Audience model:** one announcement targets the whole org **or any set of productions**; reach/ack totals use the **deduped union** of the targeted productions' members (`countDistinct`).
- **Data layer rewritten** (`features/announcements/queries.ts`): visibility, ack rollups, unacked-banner, detail roster, plus new `getComposerAudience` (active shows + member counts + org count) and `getFanoutAudience` (deduped union for notifications). `createAnnouncement` now takes org-wide flag + production ids + priority + require-ack + pin; fan-out unchanged (links to `/announcements` for org/multi, to the show for single).
- **UI:** new shared client surface `components/announcements/announcements-center.tsx` (header, permission banner, filter pills All/Company-wide/Needs-ack, redesigned cards with priority rail + ack progress) and `announcement-composer.tsx` (modal: audience picker org-wide/multi-select, priority segmented, require-ack + pin toggles, **live preview + reach counts**). Both `/announcements` and `/productions/[slug]/announcements` render the Center (the production page locks the composer to that show). Old inline create forms + production-folder pin/delete buttons removed. Styles ported into `app/globals.css` (`ac-*`), responsive (preview collapses ≤840px). `features/announcements/format.ts` holds shared presentation helpers.
- **Behavior changes:** (1) the acknowledge **banner now only surfaces announcements with `require_ack = true`** (informational posts no longer nag); existing rows defaulted to false. (2) **Company-wide broadcasts now require `productions:manage`** (admins/producers); directors/SMs can still post to productions they belong to — enforced in `createAnnouncement`.
- **Verified:** migration applied + backfill counts checked against live DB; deduped-union audience SQL sanity-checked; `tsc` + `eslint` clean; `next build` compiles (both routes dynamic). Not yet exercised in a running browser session.

**Session 2026-06-09 (AI Script Analysis — Phase 1, branch `claude/serene-cray-kmpjry`, NOT yet merged / not device-verified):** the first AI feature. A director can upload a PDF script and have Claude propose a production template, reviewed by a human before anything is written to the real tables. **Three outputs (Phase 1):** (1) cast/character list with a Principal/Supporting/Ensemble classification → `production_roles`; (2) Act/Scene breakdown → `production_scenes`; (3) page-accurate bookmarks for scenes + musical numbers, seeded onto every production member's per-user `script_annotations`. Per-role script highlighting is **Phase 2 (not built)**. **Architecture:** new `@anthropic-ai/sdk` dependency (model `claude-opus-4-8`, adaptive thinking, JSON-only prompt + parse — `output_config` structured outputs is beta-only in SDK 0.103, so not used); new server-only `script_parses` staging table (RLS-on/no-policies, created live via Supabase MCP `create_script_parses`); async run via `POST /api/scripts/[parseId]/run` (`runtime=nodejs`, `maxDuration=300`, work deferred with `after()` so it survives client navigation); per-page text extracted server-side with `unpdf` (a serverless-safe pdfjs build — the original `pdfjs-dist/legacy` attempt threw `DOMMatrix is not defined` on Vercel's Node runtime; verified working in a Node smoke test). **Flow:** Documents row menu → "Analyze with AI" (`startScriptParse` stages a row + sets `documents.processingStatus='processing'`, client kicks the run route) → review page `/productions/[slug]/script/ai` polls `fetchLatestScriptParse` while processing → on ready, an editable cast/scene/bookmark form → **Apply** (`applyScriptParse`) writes roles/scenes + seeds bookmarks, or **Discard**. A notification + push fires to the requester when the parse is ready (`sendScriptParseReady`). **New files:** `lib/anthropic.ts`, `db/schema/script-parses.ts`, `features/scripts/parse.ts`, `app/api/scripts/[parseId]/run/route.ts`, `app/(app)/productions/[slug]/script/ai/{page,ai-review-client}.tsx`; extended `features/scripts/{actions,queries,constants}.ts`, `features/notifications/announce.ts`, `documents/document-row-menu.tsx`. **Setup the user owns:** set `ANTHROPIC_API_KEY` in Vercel + local (`.env.example` documents it). **Not yet verified:** no live parse run against a real script (needs the key); very long scripts may need Vercel Fluid compute to exceed 300s; scanned/image-only PDFs are rejected (no OCR). **Cost guardrails (added same session):** each parse is a real per-token Anthropic charge (~$0.30–$0.50/script), so `startScriptParse` enforces a concurrency lock + a rolling cap (5 parses / 30 days per production), and `runScriptParse` logs `input_tokens`/`output_tokens` onto the row (shown on the review page). No pricing-tier change — a per-tier monthly quota is the deferred future lever. **Wizard auto-fill (added same session):** the new-production wizard's Roles step can upload a script and AI pre-fills the cast (parse pipeline generalized for pre-production parses via nullable `production_id`/`document_id` + `storage_path`; per-user cap 5/30 days; `attachWizardScript` carries the PDF over as the production's default script on launch). **Plan gating** for all AI = the existing `assertCanMutate` gate (paid OR active trial), so no new plan logic. **Accuracy + refinement pass (after first real-script test):** (1) bookmarks now resolve by **verbatim anchor** matched in the extracted text (no more page-number drift; unfindable bookmarks dropped); (2) **corrective re-parse** — a "Not quite right?" box re-runs with the director's notes + previous result (`reparseWithNotes`, new `script_parses.notes`); (3) **global script-recognition cache** (`script_cache`, fingerprint-keyed, cross-org) reuses a human-verified breakdown of the identical file with no model call — stores ONLY `{title,roles,scenes,bookmarks}`, never annotations/casting/production data/script text. Full spec: `docs/feature-specs/19-ai-script-analysis.md`.

**Session 2026-06-09 (Billing & monetization + multi-workspace polish — merged to `main`):** the full paid-product layer landed.
- **Plans & trial:** `organizations.plan` (`free`|`season`|`repertory`|`company`, limits 1/1/3/∞) + write-once `trial_started_at`. The 60-day trial is anchored to the org's **first production** (not signup) and is ungameable (deleting/archiving the show or editing dates can't reset it). Concurrency gate blocks starting a show over the plan limit; grandfathered orgs (all pre-existing) bypass every gate.
- **Graduated lock:** day 0–60 full → **60–90 "finish your run" grace** (reports/announcements/schedules/notes stay editable; scripts/blocking/scenes/uploads lock) → **90+ read-only**. Enforced via `features/billing/guard.ts` (`assertCanMutate` full-writes, `assertCanOperate` operational) wired across the mutating actions; `lib/billing.ts` `trialPhase()`/`mutationLevel()`.
- **Stripe (org-level):** 3 products × monthly/annual via six `STRIPE_PRICE_<PLAN>_<INTERVAL>` env vars; `createCheckoutSession(plan, interval)`; signature-verified webhook maps price→plan. **Subscribing during the trial collects the card now but defers the first charge to day 60** (`subscription_data.trial_end`). Stripe `trialing` treated as subscribed. Customer Portal for manage/upgrade (needs "switch plans" enabled in Stripe).
- **Lifecycle cron:** `vercel.json` daily `/api/cron/billing-lifecycle` (CRON_SECRET-gated) → milestone emails to **all org admins** (day 30 nudge, 55 warning, 90 read-only, 120/150/173 purge warnings) and the **day-180 file purge** (90 days after lock; removes storage objects only, scoped to the org's productions, never DB rows / other orgs / workspace logos). Idempotent via `organizations.billing_lifecycle_stage`.
- **UI:** in-app trial banners (nudge/grace/read-only, dismissible), upper-right **trial countdown pill**, website-style **plan cards** on Settings → Billing, and a trial-start announcement on first-production launch.
- **Signup individual-vs-org split:** "I run productions" (names a workspace) vs "I'm a participant" (personal "{First}'s workspace", no company to name). Participants never trigger billing — only orgs that create productions do.
- **Marketing:** pricing page + homepage teaser + FAQ rewritten to the subscription tiers, "participants always free," and an Education section (manual verification via the contact form). Annual/monthly toggle; comparison checkmarks centered.
- **Multi-workspace correctness:** fixed a cross-org leak — rail/dashboard/calendar listed productions across **all** orgs; now scoped to the active workspace via `getVisibleProductions(user)` (managers see all org shows, participants see only theirs — the Canva/Monday model). New **cross-org alert bubbles** on the org switcher (mentions + notifications since last switch-in; clears on switch, items stay unread within the org) — added `notifications.organization_id` + `organization_memberships.last_viewed_at`.
- **Docs:** new `docs/admin-playbook.md` (comp/grandfather an org, recover an admin, extend a trial, lifetime deals, Stripe coupon durations) with confirmed-correct SQL.
- **Live setup still owned by the user:** add `CRON_SECRET` in Vercel; enable "Customers can switch plans" + add products in the Stripe portal; confirm `RESEND_FROM_EMAIL` domain is verified for the lifecycle emails; (optional) create a Stripe coupon to automate the 15% nudge.

**Last updated (prior):** 2026-06-05

**Shipping to `main` 2026-06-05 (branch `claude/magical-ride-usNEW`):** the ProScene marketing site (root `/`, plus /features /pricing /reviews /blog /faq) and a multi-tenant authorization hardening pass (see the Marketing website port + decision-log/​open-questions entries below). Known follow-ups carried into the next session: wire the marketing CTAs to /signup, reconcile "ProScene"/`app.proscene.live` casing, and the live `attachments` Storage policy flip (code-ready). `main` was merged into the branch and the tree compiles (`next build`), tsc + eslint clean.

**App name:** **Proscene** (renamed from "CallBoard" on 2026-05-27 — the `callboard` domain could not be secured). The product is **live at [https://proscene.app](https://proscene.app)** with a verified email sending domain. The rebrand updates the rail wordmark (`Pro<em>scene</em>`), the rail/icon mark glyph (`C` → `P`), the four auth-screen brand headers (login, signup, forgot-password, reset-password), the PWA manifest, root metadata (`title` / `applicationName` / `appleWebApp.title`), `apple-icon.tsx`, `public/icon.svg` + `public/icon-maskable.svg`, the rehearsal-report email footer ("Sent via Proscene"), and `package.json` / `package-lock.json` `name`. The Supabase project is still literally named `CallBoard` in the Supabase dashboard — backticked `CallBoard` references in these docs point to that project identifier and are intentionally unchanged. Colors and design tokens are unchanged. PR [#10](https://github.com/Mike-Grizzly/CallBoard/pull/10) merged to `main` 2026-05-27.

**Email + domain infrastructure (2026-05-27):** the email pipeline that gated most of P3 is now wired end-to-end. `proscene.app` is registered at Namecheap; DNS for both Resend (SPF + DKIM + MX on `send.proscene.app`) and Vercel (apex A record on `@`, CNAME on `www`) is live and verified. Resend SMTP is plugged into **Supabase → Auth → SMTP Settings** as a custom SMTP provider (host `smtp.resend.com`, port `465`, sender `noreply@proscene.app`). Supabase **Site URL** = `https://proscene.app`; the redirect-URL allowlist covers `localhost:3000`, `call-board.vercel.app` (Vercel auto URL, kept as fallback), and `proscene.app` (all with `/**` glob). Vercel env: `NEXT_PUBLIC_SITE_URL=https://proscene.app`, `RESEND_FROM_EMAIL=noreply@proscene.app`. Smoke test passed — Supabase Dashboard → Send Magic Link delivered an email from `noreply@proscene.app` with a link resolving to `https://proscene.app/...`. **Still to verify end-to-end against the live deploy:** the app's own `/forgot-password` flow, the member-invite flow, and a rehearsal-report email (D2 in `launch-roadmap.md` is now fully resolved as infrastructure; the P3 checklist items that depended on it are unblocked). See `decision-log.md` (2026-05-27 — email + domain wiring).

**Session 2026-06-04 (Web Push notifications — branch `claude/modest-cerf-WFWuE`, not yet merged):** the previously-inert `push` channel now has a real transport. Added a `public/sw.js` service worker, a `push_subscriptions` table (server-only, RLS-on/no-policies), `features/push/send.ts` (`sendPushToUsers` — VAPID send, best-effort, prunes dead subs), `features/push/actions.ts` (per-device subscribe/unsubscribe that also drives the `notification_preferences.push` flag), and a per-device "Enable on this device" card on `/settings/notifications` (the old disabled push toggle was removed from the channel form; `updateNotificationPreferences` no longer writes `push`). Announcement fan-out now delivers push to opted-in recipients. **Setup before this works:** add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` env vars (Vercel + local), create `push_subscriptions` via the Supabase SQL editor/MCP with RLS enabled (NOT `db:push`), and `npm install` (new dep: `web-push`). Not yet device-verified. New dependency and full steps in `feature-specs/17-push-notifications.md` and `decision-log.md` (2026-06-04 — Web Push).

**Session 2026-06-04 (cont. — @mentions push + notification onboarding, branch `claude/modest-cerf-WFWuE`):** (1) **@mentions now send phone push** (gated on `prefs.push`) from all mention sites — announcements, notes, rehearsal reports, and blocking beat comments — via a shared best-effort helper `features/mentions/notify.ts`. Multiple mentions in a single write (e.g. across a rehearsal report's sections) are batched into one "N new mentions" push. Email was deliberately not added for mentions. (2) **Signup notification onboarding** — a first-dashboard `OnboardingDialog` (shown when the user has no `notification_preferences` row) asks how they want alerts: email (toggle) + phone push (per-device enable, reusing the new `usePushSubscription` hook). (3) **In-app is now always on** — removed the in-app toggle from Settings (static "Always on" row); `updateNotificationPreferences` forces it true. No schema changes, no new env vars. Rehearsal reports left untouched (manual send). "Upcoming-rehearsal reminders" logged as a future feature (needs a scheduled trigger). See `decision-log.md` (2026-06-04 — Push for @mentions…) and `feature-specs/17-push-notifications.md`.

**Session 2026-06-04 (cont. — New Production wizard people entry, branch `claude/modest-cerf-WFWuE`):** the wizard's cast and crew steps now both use **name autocomplete over org members** (shared `PersonAutocomplete`, capturing the picked member's email). The crew step dropped its manual Email column. At **Launch**, everyone named (cast actors + crew) is resolved to an org email (picked or exact name match); anyone not in the org triggers a **skippable `InvitePrompt`** modal to enter emails and send invites (or skip). Cast actors who are org members are now added as production members (`Cast — Principal/Ensemble`), in addition to staying as the character's actor label. Client-only — reuses the existing `createProductionFull`/`applyWizardTeam` assign-or-invite-by-email server path; no DB/env/server changes. See `decision-log.md` (2026-06-04 — New Production wizard).

**Current milestone:** Steps 1-13 complete + Script Editor (Step 14) + Personal Calendar (Step 15) + People Directory (Step 16) + full mobile/PWA pass (P2) + Proscene rebrand and email/domain wiring (P3 prep). All work through 2026-05-27 is merged to `main` (mobile/PWA via PR #9, rebrand via PR #10, docs catch-up via PR #11) and live at `proscene.app`.

**Session 2026-05-29 (merged to `main`):** a feature/UX pass landed four bodies of work (details in the per-feature sections below). (1) **New Production builder** — a Full-setup wizard + Quick-add replacing the single-form `/productions/new` (new schema applied live). (2) **Rehearsal scheduler** — Outlook-style grouped-card call form, a responsive swipeable week view (3 days phone / 5 tablet / 7 desktop), an in-calendar create affordance with a slide-in call tray, and smarter time defaults (next-hour start, +2h end). (3) **Script reader** — a dedicated immersive mobile reader (continuous scroll, page scrubber, page-grid with search + bookmarks) plus desktop tweaks (keyboard nav, jump-to-page, instant flips, fit-width, Read mode, bookmark search) and Phase 2 freehand ink (highlighter/pen/eraser, private per user). Deferred/optional follow-ups from this session are tracked in `docs/open-questions.md`.

**Launch planning:** the path from feature-complete MVP to a soft launch (testing site + invited testers) and on to public launch is tracked in `docs/launch-roadmap.md`. Phases P0 (security hardening), P1 (Vercel deployment), and the email-deliverability + custom-domain unlocks for P3 are shipped. **P2 (mobile/PWA) is functionally complete**: bottom-tab mobile nav, PWA manifest, all 8 slices of the per-screen responsive audit, view-only mode for the blocking canvas and script editor, and a landscape-phone rule for blocking. Remaining P2 items before P3: real touch-editing support (currently view-only on phones), live device verification including "Add to Home Screen", and the deferred polish items below. **P3 (beta) is now unblocked**: with email + custom domain live, the remaining P3 work is end-to-end flow verification (invite, password reset, report email), beta org-model confirmation (D5), tester onboarding docs, and a feedback channel. See `decision-log.md` (2026-05-21 / 05-22 / 05-27).

**Session 2026-06-03 (PR #25, squash-merged to `main` as commit 693a3ca — live in production):** (1) **Dashboard stat-chip alignment fix** — the header chips (new mentions / announcements / active shows) centered the icon against the two-line text block, floating the number above the icon; aligned the number's line-box to the icon. (2) **Real notifications for announcements (Phase 1)** — announcements now actively notify their audience (scope-based fan-out: org members for org-wide, production members for scoped, author excluded) across user-chosen channels. New `notification_preferences` table (`in_app`/`email`/`push`), `features/notifications/announce.ts` (fan-out + Resend email), `/settings/notifications` preference page, and the notification bell promoted to a **global** rail control (was production-only). `push` is modeled but inert (no transport yet; Web Push is Phase 2). The `notification_preferences` table was created directly in the production Supabase project (verified live). See `decision-log.md` (2026-06-03) and the Notifications section of `feature-specs/08-announcements.md`. **Update (same day):** after preview testing, the in-app surface was changed from a rail bell to a **top-of-content acknowledge banner** (appears for unacknowledged announcements, clears on acknowledge, works on mobile); the rail bell was removed (the `notifications` table is still written but no longer surfaced — see open-questions). Also: invite hardening for login-less profiles + a "Pending invite" badge, a production data cleanup (orphan profiles deleted), and a security guardrail comment against email-based profile adoption. **All merged to `main` (PR #25) and deployed to production `proscene.app` on 2026-06-03.** A follow-up (**PR #26**) adds the **announcement detail drawer** — clicking an announcement title opens a right-side drawer (desktop) / bottom sheet (mobile) showing the full announcement and an acknowledgement roster (who has/hasn't acknowledged, acked-first with timestamps), wired into the global + production announcements pages. Not yet wired from the dashboard list or the banner (follow-up).

**Session 2026-06-04 (PR #27 + PR #28, merged to `main`):** a mentions pass that took @mentions from "general notes only" to working everywhere they're offered. **PR #27** fixed the blocking-tool @mention so beat-comment mentions actually notify. **PR #28** (this session) — (1) **Report mentions across all note fields**: the unified `writeContextMentions()` now scans every mention-bearing section of a report — General Notes + all 12 department notes (rich-text `data-id`) and the structured note groups (schedule changes, attendance, line notes, injuries — plain `@{Name}` tokens resolved to ids against org members). (2) **Per-section notifications**: a person tagged in several sections of one report gets one notification *per section* (labeled `Report <date> · <section>`), not a single merged row. (3) **Blocking mentions deep-link to the beat**: `getMentionsForUser` resolves the beat from the comment, the dashboard links to `/blocking?beat=<id>`, and the blocking page reads `?beat=` (validated) to open that beat + its scene. (4) **Dashboard mention list fixes**: unread mentions now sort first (they were hidden behind the 4-/5-item caps), a **View all** toggle reveals the rest, and each card has a **dismiss (×)** (`dismissMention` action). (5) **Inline mention chips while editing**: the structured note fields and the blocking beat-comment composer now use `components/ui/mention-input.tsx` — a contenteditable field that renders `@{Name}` tokens as chips as you type (with the @ picker) and serializes back to the same `@{Name}` string, so storage/display/extraction are unchanged. Plain-text display of those tokens uses `components/ui/mention-text.tsx`. See `decision-log.md` (2026-06-04) and the Mentions sub-section of Step 13 below.

## Feature status

### Step 1: Foundation & App Shell — IMPLEMENTED
- App shell with topbar, sidebar, and main content area
- Route structure with placeholder pages for all planned features
- Tailwind v4 theme with CSS variables
- Local UI primitives (Button, Card, Separator)
- Root redirect to /dashboard
- Sidebar nav items with icons and capability-based filtering
- **Mobile navigation (2026-05-22, P2):** at phone widths (≤720px) primary
  nav is a 5-tab bottom bar (Today / Calendar / Reports / Notes / More) —
  context-aware: inside a production the tabs scope to that production's
  sub-routes (`mobile-tab-bar.tsx`). A new `/more` page hosts the
  workspace destinations that fall off the tab bar. The 64px icon-rail is
  kept for tablet widths (721–1100px). The earlier slide-in drawer
  (same day) was superseded after reviewing the mobile demo files. See
  `docs/launch-roadmap.md` P2.
- **Not fully verified:** mobile drawer behavior on real devices (built and
  type-checked only); broader responsive layout of inner pages

### Step 2: Auth — IMPLEMENTED
- Supabase email/password auth (signup, login, logout)
- Signup form with first name, last name, position/role picker
- Email verification flow with confirmation page and resend
- Forgot password / reset password flow
- `proxy.ts` route protection (Next.js 16 replacement for middleware)
- Auth callback handler (PKCE + implicit flows)
- Auto-profile creation on first login
- First user in org becomes admin, subsequent users get "cast" role
- **UI port (2026-05-20):** all auth screens (login, signup, signup-confirm, forgot/reset password) restyled to the warm design on a new `.auth-*` CSS block; the stale "Show Portal" brand corrected to "CallBoard". See `docs/ui-port-roadmap.md`.
- **Not fully verified:** Password reset flow was deferred due to Supabase email rate limits during testing

### Step 3: Roles & Permissions — IMPLEMENTED
- 6 roles: admin, producer, director, stage_manager, cast, crew
- 10 capabilities with `can(role, capability)` function
- Permission checks in all server actions
- Role-based sidebar nav filtering
- Org member management UI (admin-only settings page)
- Role dropdown with change/remove capabilities
- Requested role hint visible to admins in member list
- Admin cannot change own role or remove self
- **UI port (2026-05-20):** the org member page (`/settings/members`) and production member page (`/productions/[slug]/members`) restyled to the warm `people.jsx` table look — `.pp-table` rows, role-tinted avatars, role pills — on a new `.pp-*` CSS block. See `docs/ui-port-roadmap.md`.
- **Not fully verified:** All role/capability edge cases across every page and action

### Step 4: Productions — IMPLEMENTED
- Production CRUD (create with title, dates, status)
- Slug-based routing
- Production list with organization scope
- Production detail page with overview, tabs, team roster
- Production membership system (assign users to productions with roles)
- Bulk member assignment with checkbox multi-select
- Access gating: non-assigned users see dimmed/locked production cards
- Non-assigned users without `productions:manage` are redirected from production detail
- Personalized dashboard with stats (admin) and assigned productions list
- **UI port (2026-05-20):** `/productions` list restyled to the warm `.prod-card` design (status dot, display-font title, Opens/Closes footer, "Open hub" hover CTA); locked non-assigned cards retained. See `docs/ui-port-roadmap.md`.
- **New-production builder (2026-05-29):** the old single-form `/productions/new` was replaced by a two-path creation flow. The "+" on `/productions` now opens a menu with **Full setup** and **Quick add**:
  - *Full setup* is a 6-step wizard (Basics → Calendar → Departments → Roles → Team → Review) ported from the design's `new-production.jsx` into a typed client component (`new/new-production-wizard.tsx`, styled under `.np-root` in `globals.css`). Opens as a full-screen **overlay** in-app (lazy-loaded via `next/dynamic`) and also renders as a linkable, refresh-safe **page** at `/productions/new`. The actor autocomplete reads real org members; team members are assigned (existing org users) or invited via the existing `inviteMembers`/Supabase-admin path (new emails require `settings:manage`, skips reported on the launch screen). Persists via `createProductionFull`.
  - *Quick add* is a small modal (show name + optional opening date) → `quickCreateProduction` creates a `draft` and routes to the hub.
  - **Schema (applied 2026-05-29):** `productions` gained `venue`, `season`, `first_rehearsal_date`, `tech_start_date`, `rehearsal_days` (jsonb), `rehearsal_start`, `rehearsal_end`; new tables `production_departments` and `production_roles` (RLS enabled to match the rest of the schema). Applied additively to the `CallBoard` Supabase project; equivalent to `npm run db:push` from the updated Drizzle schema.

### Step 5: Reports — IMPLEMENTED (overhauled 2026-05-06; daily log removed 2026-05-15)
- Structured rehearsal report: header (date, scheduled call, actual start, end), TipTap general notes, 12 fixed department text fields, next-rehearsal block
- Per-production auto-incremented `report_number` (MAX+1 in server action)
- **Email Report** button: recipient picker (entire production or individual checkboxes), sends HTML email via Resend (`resend` package, `RESEND_API_KEY` + `RESEND_FROM_EMAIL` env vars)
- Reports list shows `#N — {date}`; legacy `scheduleNotes` still renders if populated
- Report file attachments via Supabase Storage (10MB limit), signed URL downloads (1-hour expiry)
- **Removed:** Daily log feature and "Import from daily log" button (redundant with report general notes)
- **Known issue:** TipTap bullet points not working due to Tailwind prose CSS reset

### Step 6: Documents — IMPLEMENTED
- Document center per production
- Upload form with title, document type (6 categories), file picker
- Document list with type badges, file size, uploader info
- Delete with confirmation dialog
- In-app document viewer (PDF iframe, image display, text iframe, fallback download)
- Download via signed URLs (1-hour expiry)
- Comments sidebar placeholder in viewer (no data model yet)
- Schema includes `processingStatus` field for future AI script analysis

### Step 7: File Uploads — IMPLEMENTED
- Supabase Storage integration using `attachments` bucket
- Used by both report attachments (Step 5) and document center (Step 6)
- Server action body size limit increased to 64MB in next.config.ts
- Storage RLS: deny-all (RLS enabled, no policies) — all object access uses the service-role admin client (bypasses RLS) or signed upload/download tokens; access control is enforced in the server actions (updated 2026-06-18)
- Signed URLs generated server-side with 1-hour expiry
- File size validation: 64MB for documents, 10MB for report attachments

### Step 8: Announcements — IMPLEMENTED
- `announcements` table: org-scoped with optional `production_id` (null = org-wide)
- Production-scoped announcements page at `/productions/[slug]/announcements`
- Global announcements page at `/announcements` showing all announcements the user can see
- Rich text body via TipTap (optional)
- Pinning: admin/producer only
- Delete: author or admin/producer
- Org-wide badge on all announcement cards
- Announcements tab and overview card added to production detail page
- **UI port (2026-05-20):** production + global announcement pages restyled to the warm `.ann-card` design (colored scope rail, author avatar, scope pill, display-font title); the create form moved to a warm `.card`. See `docs/ui-port-roadmap.md`.
- **Not fully verified:** Live testing in browser pending

### Step 9: Rehearsal Report Overhaul — IMPLEMENTED
- Structured department-by-department format replacing free-form TipTap
- Header block: report number, scheduled/actual times, next rehearsal info
- 12 fixed department note fields
- **Email Report** button — sends HTML email via Resend with recipient picker (entire production or individual members)
- Schema applied via Supabase MCP `apply_migration`; `resend` package added

### Step 10: Blocking Tool (Phase 1 + Phase 2 + Phase 3 UI + Phase 4 arrows/layers/notes) — IMPLEMENTED

- **New role:** `choreographer` (7th role, has `blocking:edit` + standard director-level caps)
- **New capabilities:** `blocking:view` (all roles), `blocking:edit` (admin, producer, director, choreographer, stage_manager)
- **New DB tables:** `production_scenes`, `scene_beats`, `stage_configurations`, `blocking_positions`, `custom_set_pieces`, `beat_arrows`; `scene_beats.notes` (text column)
- **Schema changes:** `production_memberships.character_name` (nullable); `stage_configurations.ground_plan_page` (int, default 1)
- **New feature modules:** `features/scenes/` (queries, actions, validation), `features/blocking/` (queries, actions, constants)
- **Set piece library:** 15 built-in SVG shapes (chair, armchair, couch, loveseat, beds, tables, desk, stairs, door, window, grand piano, podium, platform) + user-uploaded custom pieces
- **Routes:** `/productions/[slug]/blocking` (canvas), `/productions/[slug]/blocking/setup` (wizard)
- **Blocking canvas:** PDF background (rendered via pdfjs-dist v5), number line ruler overlay with toggleable SL/SR and US/DS grids, drag-and-drop actor tokens + set pieces (@dnd-kit/core), autosave per beat, in-session undo (50 states)
- **Actor tokens:** Initials from firstName[0]+lastName[0]; only character name shown under circle; auto color-coded
- **Set piece rotation:** Free-angle corner drag handle (pointer capture, delta-based angle tracking); rotation stored and restored per beat
- **Cross-scene beat copy:** First beat of a new scene automatically inherits positions from the last beat of the previous scene
- **Multi-page ground plans:** Page selector in setup wizard; prev/next page controls on canvas; `ground_plan_page` stored in stage config
- **Export PNG:** "Export" button composites PDF canvas + tokens into a downloadable PNG via browser Canvas API
- **Recalibrate shortcut:** "Recalibrate Only" button skips directly to calibration when an existing config exists
- **Character name assignment:** Inline editable character name on cast member rows in the production members page
- **Scene/Beat manager:** Left panel — Act/Scene/Beat hierarchy, add/delete; "Capture Beat" auto-labels and advances
- **Stage setup wizard:** 2-step — select ground plan PDF + enter proscenium width/depth, then 2-point click calibration
- **Number line ruler:** Proscenium baseline with ticks every 2', labels every 5' on the SL/SR axis; US/DS horizontal grid lines show spacing only (no depth labels); toggleable independently
- **Thin semi-transparent grid:** SL/SR and US/DS grid lines rendered at `rgba(80,80,80,0.15)`, z-layered above floorplan, below all tokens; square grid when both axes enabled (US/DS spacing matches SL/SR 2ft spacing)
- **Immersive canvas layout:** Canvas fills full available viewport via negative margin bleed (no wasted whitespace); fullscreen mode via `position:fixed; inset:0; z-index:9999`; Escape key exits fullscreen
- **Accurate drag placement:** Off-stage tokens land at cursor position using `activatorEvent.clientX + delta.x` (not tile rect)
- **Custom set piece uploads:** Users with `blocking:edit` can upload SVG, PNG, or JPG (max 5 MB) to use as set pieces. Stored in Supabase Storage `attachments` bucket under `set-pieces/{productionId}/`. DB table `custom_set_pieces` tracks metadata. Signed URLs (1hr) generated server-side; custom pieces render centered in their canvas tokens
- **PDF flash fix:** Ground plan PDF is rendered once to an offscreen canvas and cached as an `ImageBitmap` in module-level memory, keyed by stable file path. Subsequent beat switches and `router.refresh()` calls reuse the bitmap — no canvas clear/redraw flicker
- **Movement arrows (auto):** Togglable overlay showing straight-line arrows from current beat to next beat positions for each actor; edge-to-edge (not center-to-center); colored per actor; hidden for stationary actors
- **Draw-your-own arrows:** "Draw Arrow" mode (pencil tool) — click to set start, click to finish; snaps color to nearest actor token; arrows stored in `beat_arrows` DB table; delete via hover button; persists across beat navigation
- **Layer toggle:** Toolbar segmented control switches between "Actors" and "Set Pieces" layers; non-active layer tokens get `pointerEvents: none` so they cannot be accidentally moved
- **Per-beat notes:** Collapsible TipTap rich-text notes section in right panel (between Set Pieces and Beat Comments); 1-second debounce autosave to `scene_beats.notes`; resets on beat navigation via `key={beatId}`
- **Permissions:** SM/Director/Choreographer/Admin/Producer can edit; Cast/Crew view only
- **Known future work:** Full beat-breakdown export (multi-page PDF or print view with scene/beat snapshots)

### Step 11: Notes ("My Notes") — IMPLEMENTED + UI PORTED

- Tab labelled **"My Notes"**, 3rd position in production tab strip (after Rehearsal Reports)
- Two-column grid layout (360px list + 1fr editor) matching the warm theatre design system
- Notes are **always private** — visibility toggle removed from UI; stored as "private" in DB
- Filter tabs: All, To-do, Pinned, Notes (Done filter removed; completed to-dos sort to bottom of To-do view)
- To-do rows have a **clickable circle** in the list — checks off without opening the note
- **Animated strikethrough:** line draws across title over 350ms + colour fade; item holds list position during animation before sinking (~420ms)
- **Auto-date:** new notes pre-fill due date with today
- Pinned notes grouped at top; tag picker dropdown in editor header
- Org-level tag library seeded with 6 defaults: Follow-up, Blocking, Props, Costumes, Technical, Safety
- Tag manager modal uses **React portal** (escapes CSS transform stacking context), **backdrop blur**, click-outside-to-close
- TipTap rich text editor with auto-save (600ms debounce)
- **Known limitation:** Privacy not enforced at query level — all production members can technically read all notes in DB

### Step 12: Call Schedule Calendar — IMPLEMENTED

- `end_time text` column added to `calls` table (Supabase migration applied 2026-05-08)
- `/productions/[slug]/calls` — month calendar grid: all calls shown as chips per day, colour-coded by status (upcoming/live/past), prev/next month navigation via `?month=YYYY-MM` search param
- Hover any future day → `+` icon to create a call with that date pre-filled (`?date=YYYY-MM-DD`)
- Upcoming calls list view below the calendar for linear at-a-glance scheduling
- `getNextCall` is now time-aware: skips calls whose `end_time` has passed today; returns `isLive` flag when current time is within `callTime–endTime` window
- Production dashboard header shows three states: **"Live · In Rehearsal"** (orange pulse) when inside window, **"Today's Call"** (amber) when today but not yet started, **"Upcoming Call"** (muted) otherwise
- End time displayed under call start time on dashboard header card
- "Schedule call" header button replaced with **"Calls"** → opens calendar
- **Calls** tab added to production tabs (visible to all members; create/edit gated to `reports:create`)
- After create/edit/delete, users land back on the calendar
- Delete button extracted to a client component (`DeleteCallButton`) — fixes pre-existing server-component error (`onClick` on server-rendered form)
- `features/calls/` has `queries.ts`, `actions.ts` (no new libs introduced)
- **Not verified:** Real-time live-status flipping without page reload (status is computed server-side at render time)

### Step 13: @Mentions + Dashboard Improvements — IMPLEMENTED (2026-05-15)

**@Mention autocomplete (write path)**
- `@tiptap/extension-mention` + `@tiptap/suggestion` added (pinned to exact `3.22.5` to match existing TipTap packages)
- `components/ui/mention-suggestion.ts` — shared TipTap suggestion config: filters members by name, renders a floating `ReactRenderer` popup, keyboard navigable
- Mention nodes render as inline chips (`<span class="mention-inline">`) in all rich-text editors
- Editors with mention support: report general notes, all 12 department note modals, announcement body, My Notes editor
- `features/mentions/write.ts` — idempotent `writeMentions(html, ctx)`: deletes all existing mentions for `contextType+contextId`, then re-inserts by extracting `data-id` from mention HTML. Called after announcement create and note autosave
- `db/schema/mentions.ts` table: `organizationId`, `productionId`, `mentionedUserId`, `mentionedById`, `contextType` (report/announcement/note/blocking), `contextId`, `contextTitle`, `snippet` (first 200 chars stripped of HTML), `readAt`

**Report-wide + plain-text mentions (2026-06-04, PR #28)**
- `writeContextMentions(params)` in `features/mentions/write.ts` — the report path now uses this instead of `writeMentions`. It accepts an array of `sources`, each a mention-bearing section with either `html` (rich-text, `data-id`) or `text` (plain `@{Name}` tokens resolved to ids against `members`), plus an optional `label`. Writes **one notification per (user, section)** — de-duped within a section, separate across sections — and excludes the author. Idempotent per context (delete-then-insert).
- `reportMentionSources(data)` in `features/reports/actions.ts` builds the sources: General Notes + each of the 12 department notes (html), and the structured groups schedule changes / attendance / line notes / injuries (text). `contextTitle` per row = `Report <date> · <section>`.
- **Plain-text mention format:** structured note fields store `@{Full Name}` tokens (not `data-id`). Resolution to a user id matches the token against org members' full name or email (`getOrganizationMembers`).
- `components/ui/mention-input.tsx` — contenteditable inline editor that renders `@{Name}` tokens as `.mention-inline` chips while typing, with the @ picker; serializes back to the `@{Name}` string. Supports `singleLine`, `onSubmit` (Enter-to-send), `disabled`. Used by the four structured report fields (`subtab-editors.tsx`, `summary-editors.tsx`) and the blocking beat-comment composer (`components/blocking/beat-comment-section.tsx`). Replaced the plain `MentionTextarea` in those places (`MentionTextarea` remains as the source of `MentionMember`/`memberFullName`).
- `components/ui/mention-text.tsx` — display helper that renders `@{Name}` tokens as chips in the read-only report views (`[reportId]/page.tsx`, `mobile-report-detail.tsx`). Beat-comment display uses the pre-existing `MentionBody`.
- **Blocking mentions:** beat-comment mentions (`contextType: "blocking"`, `contextId` = beat-comment id) now deep-link. `getMentionsForUser` left-joins `beat_comments` to expose `beatId`; the dashboard builds `/productions/<slug>/blocking?beat=<beatId>`; `blocking/page.tsx` reads `?beat=` (validated against the production's beats) and opens that beat, deriving its scene.

**Dashboard mention cards**
- Mention cards are clickable: clicking navigates to the source context (`/productions/[slug]/reports/[id]`, etc.) and marks the mention as read
- Fade-not-remove UX: clicking a card fades the blue unread highlight immediately (optimistic) but the card stays visible in the Unread tab until navigation completes — prevents jarring disappearance
- Mark-as-unread: read cards show a circle button on hover to restore unread state (optimistic via `unfadedIds` set)
- Mark all as read: ghost button in the mentions section header, only shown when there are unread items
- Cards use `<div role="button">` rather than `<button>` to allow nested interactive elements (mark-as-unread button)
- **(2026-06-04, PR #28)** Both dashboard mention surfaces (`bento-mentions.tsx` desktop, `MdMentions` in `mobile-dashboard.tsx`) cap the list (4 desktop / 5 mobile); unread mentions are now **sorted first** in `dashboard/page.tsx` so they're never hidden behind the cap, a **View all** toggle expands the rest, and each card has a **dismiss (×)** calling `dismissMention(id)` (`features/mentions/actions.ts`) which deletes the recipient's row.

**Dashboard pinning**
- Pin cards on the dashboard now show an unpin button on hover (absolutely positioned, `opacity:0` by default, revealed on hover)
- Unpin is optimistic: card removed from local state immediately, server action fires in background
- `PinnedSection` converted from server to client component to hold local pin state

**Navigation rename**
- "Calls" tab renamed to "Rehearsal Schedule" in the production tab strip

### Step 14: Script Editor ("Your Script" tab) — IMPLEMENTED

- "Your Script" tab added to every production (gated to production members)
- Per-user PDF annotation editor; annotations are private per user
- **Annotation tools:** highlight (draw box), highlight (text selection), sticky note (with text), cue marker (box + leader line to margin with cue number + description)
- Left/right leader side toggle for cue tool; leader line connects at bottom edge of box
- **Annotations panel** (right column): grouped into "Cues" and "Notes" sections with section headers and count badges; sorted top-to-bottom by position
- **Inline editing:** pencil button on note/cue panel items opens in-place text fields; Enter or blur to confirm, Escape to cancel
- **Bookmarks panel** (above annotations panel): add titled bookmark for any page, click to navigate, sorted by page, accent highlight on current page
- **Page thumbnails sidebar:** collapsible (toggle via LayoutList icon in toolbar); all pages rendered progressively at 0.25× scale; cached in module-level map; sticky positioning; auto-scrolls active page into view
- **Zoom controls:** 5 steps (75–200%) in nav bar; each zoom level cached separately in bitmap cache
- **Breathing room:** PDF page floats on `--bg-sunken` workspace background with enhanced drop shadow
- **Download annotated PDF:** renders every page at 2× quality with annotations composited via Canvas 2D API; assembled with jsPDF; shows per-page progress
- **Auto-save:** 1.5s debounce after any annotation/bookmark change; saves to `script_annotations` DB table (per-user, per-script)
- **Stale script banner:** shown when the default script is replaced; dismissible
- **DB:** `script_annotations` table with `annotations`, `bookmarks`, `pageOverrides`, `hasStalePages` JSONB/boolean columns; `documents.isDefaultScript` + `documents.scriptVersion` fields; "Set as default script" action in document row menu
- **Known scaffold:** `pageOverrides` data model exists (stored/loaded) but no UI to set overrides yet
- **Mobile reader — Phase 1 (2026-05-29):** phones now get a dedicated immersive reader (`mobile-script-reader.tsx`) instead of the view-only desktop viewer. `page.tsx` renders `ScriptScreen`, which routes phones → reader, desktop → `ScriptViewer` (via `useIsPhone`). The reader is a full-screen dark surface with **continuous vertical scrolling** (windowed: only current ± 2 pages painted to `<canvas>`, far pages cleared to cap memory), a floating **page scrubber** (current/total, ▲▼, drag-to-scrub), and a full-screen **page-grid** overlay with search (page # or bookmark title), an All-pages/Bookmarks filter, lazy thumbnails, and per-page bookmark ribbons. Bookmarks tapped here persist via the existing `saveAnnotations` action; existing highlight annotations render read-only over pages. CSS under `.msr-*` in `globals.css`. The old `.sv-*` phone overrides are now unused on phones.
- **Mobile reader — Phase 2 freehand ink (2026-05-29):** the reader now has a bottom **drawing palette** (highlighter / pen / eraser + the 5-color row). New `InkAnnotation` type (`type:"ink"`, normalized `points`, `tool`, `size` as a fraction of page width) added to the annotation union in `constants.ts` with `INK_SIZES`/`INK_OPACITY`/`inkPathD` helpers. Drawing is **private per user** and persists via `saveAnnotations` alongside bookmarks. The palette is **toggled** by a pencil FAB (hidden by default; a Close button in the palette deselects + hides it). While a tool is active the page scroll is **locked** (`.msr[data-drawing] .msr-scroll { overflow:hidden; touch-action:none }`) so a finger draws cleanly instead of scrolling — navigate via the scrubber, or deselect/close to scroll. Implementation notes: the active stroke is tracked in a ref and drawn imperatively into one fixed overlay `<path>` (no per-move React renders), committed to state once on pointer-up; the eraser is a **point/segment eraser** (drops points within a ~3%-of-width radius and keeps surviving runs as separate strokes, so only the touched part disappears); each page's ink layer is an `<svg>` that captures touch only while a tool is active. The **desktop viewer renders ink read-only** (`AnnotationShape` + the PDF-export compositor handle `"ink"`; the annotations side-panel ignores it) and the **desktop Read-mode overlay passes `allowDrawing={false}`** (reading only). Palette/ink CSS under `.msr-palette` / `.msr-ink` / `.msr-draft`.
- **Reader cohesion polish (2026-05-29):** the reader/Read-mode overlay now **slides up** into place (`msr-in`, matching the call tray / day sheet; the page grid uses `msr-grid-in`) so it reads as a reader opening rather than a navigation to another site, and it's brand-styled — a "P" brand mark + Newsreader display-font title in the header, crimson `--msr-accent` on the active bookmark/scrubber number/grid filter/page ribbons, a branded spinner for the initial load, and a warm shimmer behind each page until its canvas paints. Off-screen pages use `content-visibility: auto` so the shimmer/paint stays cheap across 200+ pages; a `prefers-reduced-motion` guard disables the entrance + shimmer.
- **Desktop tweaks (2026-05-29):** additive, no change to the annotation model. (1) **Keyboard nav** — ←/→ and PgUp/PgDn flip pages, Home/End jump to first/last, `+`/`-` zoom (ignored while typing in a field). (2) **Jump-to-page** — the "n / total" indicator is now a click-to-type page field. (3) **Instant flips** — an effect pre-renders the current page ±1 into the bitmap cache so next/prev is immediate. (4) **Fit-width zoom** — a `Maximize2` toggle adds a continuous "Fit" scale (re-renders at `workspaceWidth / pageWidth` so canvas, text layer, and annotations stay aligned); the zoom in/out buttons switch back to the fixed steps. (5) **Read mode** — a `BookOpen` button opens the same `MobileScriptReader` as a full-screen overlay (`onExit`/`onBookmarksChange`/`startPage` props added) so the immersive view is previewable on desktop with zero changes to the annotation viewer; bookmarks made there sync back into the desktop panel. (6) **Bookmark search** — the bookmarks panel gains a filter (title or page #) once there are more than 3.

### Step 15: Personal Calendar — IMPLEMENTED

- Top-level `/calendar` route — restyled to match `design-reference/jsx/tab-calendar.jsx` 1:1
- Two-column layout: 248px sidebar (mini-month + production filter + upcoming) + main canvas
- Four views: **month**, **week**, **day**, **agenda** — swappable via segmented `.seg` control; client-side switching (no page reloads)
- Week + day views render an hourly grid (8 AM–11 PM) with events absolutely positioned by `(callTime, durMin)`; live "now" line in `--accent`
- Month view: 6×7 grid with `.month-chip` rows; up to 4 per cell, "+N more" jumps to day view
- Agenda view: 21-day window grouped by date, display-font day numbers, "Today" pill
- Event drawer slides in from the right with type chip, display-font title, production link, when/where, Edit + Open schedule actions
- Each event chip/block uses its production's color via `--evt-color` CSS variable, mixed into background + border via `color-mix`
- Production filter (sidebar) toggles which shows are included; admins/producers see all org productions, members see only their own
- Mini-month picker shows event pips and respects today / cursor highlights
- Data window: `-45d / +120d` from page load — generous enough to cover typical month/week/day/agenda navigation without refetch
- New `productions.color` column (nullable text storing a palette token); deterministic hash fallback via `fallbackColorTokenForId`; legacy `var(--c-...)` strings normalized at read time
- Color picker swatches on the new-production form; same color reused in the sidebar rail's production dot and the productions list card
- New query: `getCallsForUserInRange({ userId, organizationId, startDate, endDate, manageAll })` in `features/calls/queries.ts`
- All calendar styles live in `app/globals.css` under `.cal-*`, `.week-*`, `.month-*`, `.day-*`, `.agenda-*`, `.mini-*`, plus utility helpers `.seg`, `.row`, `.gap-sm`, `.mono`, `.truncate`, `.anim-in`
- **DB migration** was applied directly via Supabase MCP (`add_production_color`) — no `pnpm db:push` needed
- **Scheduler UX pass (2026-05-29):**
  - *Swipeable week view.* `week-view.tsx` was rebuilt as a single scroll container with a frozen time-gutter (`position: sticky; left`) and frozen day headers (`sticky; top`). The day strip shows **3 days on phone (≤720px), 5 on tablet (≤1100px), full 7 on desktop**. Column width is measured in JS (`--week-day-w` set to an exact px from the scroll-port width via `ResizeObserver`) because percentage grid tracks resolve unreliably inside a horizontally-overflowing scroller — that was making columns too wide and breaking snap. `scroll-snap-type: x mandatory` gives clean day-to-day snapping. On mount / week change it auto-scrolls so **today is the first visible column** (falls back to the navigated day). The old ≤720px rule that squeezed 7 columns into a 38px gutter was removed.
  - *Create affordance.* The calendar/scheduler exposes call creation directly: a "Schedule call" button in the toolbar (desktop/tablet) and a circular **FAB** bottom-right on phones. Gated on `reports:create`.
  - *Slide-in builder tray.* Creating a call now opens the form as a **slide-in tray overlaid on the calendar** (`call-tray.tsx`) — a right-side drawer on desktop, a bottom sheet on phones (matching the event drawer / day sheet). It uses dedicated full-slide keyframes (`call-tray-in-right` / `call-tray-in-up`) and a stable height (88vh on mobile) so it doesn't pop/resize while the cast lazy-loads (via the `getCallTrayData` server action). On mobile a **grab bar** at the top dismisses it (tap or drag-down). On save the tray closes and the calendar refreshes in place (`router.refresh()`), no navigation. Scoped/single-production calendars open it directly; the multi-production workspace picks a production first. Full-page `/calls/new` + `/calls/[id]/edit` routes still exist (deep links, edit); `createCall`/`updateCall` return `{ success }` instead of redirecting so both the tray and the pages decide their own follow-up.
  - *Week-scroll fix.* `.cal-main` was missing `min-width: 0`, so the fixed-px day columns blew the `1fr` track out to full content width — the week showed ~2 columns and wouldn't scroll sideways. Added `min-width: 0` down the `.cal-main → .week → .week-scroll` chain so the overflow happens inside the scroller (3/5/7 columns swipe correctly). The grid box is also sized `width: max-content` (set in JS alongside the column widths) so the sticky time-gutter's containing block spans the whole strip and stays pinned to the last day instead of detaching at the far right.
  - *Grab-bar drag.* The tray's entrance keyframes use `fill: both`, which keeps overriding inline `transform`, so the drag couldn't move the panel — the touch-start handler now clears `animation`/`transition` so the sheet tracks the thumb and snaps back / animates out on release.
  - *Smarter time defaults.* A new call defaults its start to the **top of the next hour**, and the **end auto-fills to start + 2h** (and re-estimates whenever the start changes). Times are now controlled inputs in `call-form.tsx`.
  - *Outlook-style call form.* The rehearsal call create/edit form (`calls/new/call-form.tsx`) was restyled from stacked sections into grouped "cards" with icon · label · control rows (date/time/location inline, focus/scenes/cast/schedule/notes stacked). New `.cform-*` CSS block in `globals.css`. Server action and fields unchanged. (Pattern is a candidate to extend to other forms once validated.)

## Performance pass (2026-05-20)

Branch `claude/improve-page-performance-YXRgv` — page-load optimizations, no behavior change except reports pagination:

- **Production layout no longer over-fetches.** `app/(app)/productions/[slug]/layout.tsx` runs on every production sub-page and fetched full reports/documents/announcements/deleted-items rows only to read `.length` for tab badges. Replaced with `COUNT(*)` queries: `getReportCountByProduction`, `getReportStatusCounts`, `getDeletedReportCountByProduction` (reports), `getDocumentCountByProduction`, `getDeletedDocumentCountByProduction` (documents), `getAnnouncementCountByProduction` (announcements).
- **Blocking page N+1 fixed.** `getScenesWithBeats` in `features/scenes/queries.ts` issued one beats query per scene; now a single `inArray` query grouped in memory.
- **TipTap is lazy-loaded.** `RichTextDisplay` moved to its own server-safe file `components/ui/rich-text-display.tsx` (no TipTap import); the editor loads on demand via `components/ui/rich-text-editor-lazy.tsx` (`next/dynamic`, `ssr: false`). Display-only pages no longer ship the ~300KB editor bundle.
- **Reports list is paginated.** `/productions/[slug]/reports` pages 25 rows at a time via `?page=` (preserves the `?status=` filter). `getReportsByProduction` takes optional `{ status, limit, offset }`; calling it with no options is unchanged.
- **Request-level dedup with `React.cache()`.** The layout and the page of a single request each ran the full auth chain — `getCurrentUser` (a Supabase `auth.getUser()` network call plus DB queries), `getOrCreateDefaultOrganization`, `getProductionBySlug` — independently. These three are now wrapped in `cache()`, so each runs once per request. `getCurrentUser` also parallelizes its org + profile lookups. This was the main cause of multi-second tab loads.

## Script & blocking PDF performance (2026-05-20)

- **Parsed PDFs are cached.** New `lib/pdf.ts` exposes `loadPdfDocument(url)`, which caches the parsed `PDFDocumentProxy` per URL. Previously both the script viewer and the blocking canvas re-downloaded and re-parsed the whole PDF on every page turn / zoom change (and the script thumbnail panel loaded it a third time). Now the document loads once and navigation only renders a page.
- **Loading states.** A `.pdf-spinner` (new `@keyframes spin` in `globals.css`) shows while a PDF page renders in both viewers. New route-level `loading.tsx` files for the `script/` and `blocking/` segments give an immediate response on tab switch instead of a frozen-feeling gap.

## People directory & mass upload (2026-05-20)

Branch `claude/people-mass-upload-feature-PkU2l` — new Step 16. Full spec in
`docs/feature-specs/16-people-directory.md`.

- **New `/people` page** (admin-only, in the Workspace rail section) — org-wide
  directory with stat-card filters, search, category/production/status filters,
  table and card views, and a person detail/edit drawer.
- **Mass upload** via an Add People modal with three paths: a manual
  single-person form, a CSV importer (auto-detect delimiter, column mapping,
  validated preview), and a bulk paste wizard.
- **Invite model** — uploaded people become Supabase auth users in an
  `invited` state via the Admin API; `profiles` stays 1:1 with auth users so
  org and production memberships need no FK changes. `lib/auth.ts` promotes
  `invited` → `active` on first sign-in. Requires a new env var
  `SUPABASE_SERVICE_ROLE_KEY` (server-only) — already listed in `.env.example`.
- **Multi-production assignment** — multi-select people and assign them to a
  production in bulk, or assign from the drawer; reuses `assignProductionMember`.
- **Schema:** `profiles` gained `phone`, `pronouns`, `status`, `last_active_at`
  (all additive) — applied to the `CallBoard` project via Supabase MCP migration
  `add_people_directory_profile_columns`.
- New feature module files: `features/members/{constants,validation}.ts`,
  `inviteMembers` / `updatePersonProfile` / `setMemberStatus` / `resendInvite`
  in `features/members/actions.ts`, `getPeopleDirectory` in `queries.ts`, and
  `lib/supabase/admin.ts` (service-role client).
- **Not yet done:** live verification of the invite email flow against the
  Supabase project — needs `SUPABASE_SERVICE_ROLE_KEY` set, the callback URL in
  the Auth "Redirect URLs" allowlist, and (for bulk invites) custom SMTP.

## Mobile navigation & PWA (2026-05-22)

Branch `claude/bold-einstein-hHMHD` — first slice of launch-roadmap **P2**.

- **Mobile drawer navigation.** New client shell
  `components/app-shell/app-frame.tsx` wraps the `(app)` layout. On desktop
  it is a passive wrapper (the rail stays in the CSS grid). At ≤720px it
  renders a sticky top bar (hamburger + brand) and turns the rail into an
  off-canvas slide-in drawer: dimmed backdrop, close (X) button,
  Escape-to-close, background scroll lock, focus moved into the drawer, and
  auto-close on navigation (drawer state is derived from the route, so no
  state-syncing effect). `globals.css` gained a mobile-navigation block; the
  existing icon-collapse media query was rescoped to
  `min-width: 721px and max-width: 1100px` so phones get the drawer and
  tablets keep the 64px icon rail. `Rail`'s `<aside>` got `id="app-rail"`
  for `aria-controls`.
- **Installable PWA.** `app/manifest.ts` (`MetadataRoute.Manifest`:
  standalone display, `/dashboard` start URL, `#fbf8f3` theme/background).
  Icons: `public/icon.svg` + `public/icon-maskable.svg` (the Proscene "P"
  mark), and `app/apple-icon.tsx` which generates a 180×180 PNG
  `apple-touch-icon` via `next/og` `ImageResponse` (iOS does not accept SVG
  touch icons). Root layout gained `icons` / `appleWebApp` metadata and a
  `viewport` export with `themeColor`. No new dependency.
- **Production tab strip.** The production header has up to 8 tabs in a
  flex row with no overflow handling, so on a phone it forced a sideways
  scroll of the whole page. At ≤720px `.tabs` is now a contained
  horizontal scroller (edge-to-edge, snap, hidden scrollbar);
  `production-tabs.tsx` scrolls the active tab into view on route change.
- **View-only phone mode for mouse-built tools.** The blocking canvas and
  the script editor are drag-and-drop / draw-built and unusable by touch.
  New `lib/use-is-phone.ts` hook (`useSyncExternalStore` over a
  `matchMedia` query). At ≤720px the blocking canvas derives
  `canEdit = canEditProp && !isPhone` (its single edit gate, so all edit
  affordances drop out); the script editor locks the tool to `pointer`,
  hides the drawing tools, and hides the annotation panel's edit/delete
  controls. Script bookmarks stay usable (navigation aid). Touch *editing*
  remains future P2 work — the goal is at least tablet parity for blocking.
- **Bottom-tab nav replaces the drawer (slice 1 of demo port, 2026-05-24).**
  Following review of the new Claude-design mobile demo, the slide-in drawer
  was retired in favour of a 5-tab bottom bar (Today / Calendar / Reports /
  Notes / More). `components/app-shell/mobile-tab-bar.tsx` is the new client
  shell; tabs are context-aware — inside `/productions/[slug]/*` they scope
  to that production, otherwise they fall back to workspace routes. The
  `app/(app)/layout.tsx` `AppFrame` is now a passive wrapper that just
  renders the rail + main + `<MobileTabBar />`; the desktop rail is hidden
  at ≤720px via `.rail { display: none }` in the mobile block. `.main` gains
  bottom padding for the fixed bar plus the iOS home-indicator safe area.
- **Mobile Today / Dashboard (slice 2, 2026-05-24).** New server component
  `app/(app)/(default)/dashboard/mobile-today-hero.tsx` renders inside the
  existing `/dashboard` page and is CSS-gated to phone widths. Layout
  mirrors the demo's "Promptbook" variant: greeting + next-call hero card
  (production, time range, focus, location pill, "Open production" footer)
  + 2×2 stat grid (Productions / Mentions / Pinned / Next call). The
  desktop `.home-hero` and the "Upcoming rehearsals & calls" grid (now
  marked `.dashboard-desktop-only`) are hidden at ≤720px so they don't
  double up. Existing announcements / productions browser / mentions /
  pinned sections still render below — they'll get mobile passes in later
  slices.
- **Calendar week-view overflow fix (2026-05-24).** The week and day grids
  used `repeat(N, 1fr)` (= `minmax(auto, 1fr)`) so event titles forced
  columns wider than the viewport, pushing the page sideways on phones.
  Switched to `minmax(0, 1fr)` so columns can shrink below content and
  events truncate inside them. `.cal-canvas` also gained `min-width: 0`.
- **Week-view header on phones (2026-05-24).** The day-of-week header
  was still bleeding into adjacent columns at ≤720px (weekday + date in
  a flex row, too wide for ~43px columns). At phone widths `.week-day-h`
  now stacks vertically (column, centered) with smaller fonts and the
  hour gutter shrinks from 60px → 38px to give days more room.
- **Mobile notes list ↔ editor swap (slice 5, 2026-05-24).** The two-column
  notes panel (360px list + editor) collapses to a single column at
  ≤720px and CSS-swaps between views based on selection: with no note
  selected the list fills the screen; tapping a note swaps to the
  editor with a "← Notes" back button at the top to return. The outer
  wrapper now has class `.notes-panel` and `data-editor-open` attribute;
  `.notes-list-col` / `.notes-editor-col` mark the two columns. No
  state-management changes — the existing `selectedId` drives the toggle.
- **Workspace notes feed at `/notes` (2026-05-24).** The bottom-tab
  "Notes" used to fall back to `/dashboard` when not in a production
  (because notes were per-production), so tapping it from anywhere
  outside a show did nothing visible. New `app/(app)/(default)/notes/`
  route lists *every* note the caller has authored across every
  production they belong to (admin/producer sees the org), newest-first
  by `createdAt`. Cards match the mobile demo: colored production rail,
  todo circle / pencil icon, title (strikethrough when complete), 2-line
  excerpt, tag pill + due-date + relative-time footer. New query
  `getAllNotesForUser` joins `production_notes` to `productions` for
  title/slug/color. Tapping a card deep-links into the production-scoped
  editor via `?id=` — `NotesPanel` accepts an `initialSelectedId` prop
  and pre-selects when the id matches. Mobile tab bar now points Notes
  at `/notes` unconditionally; production-scoped notes are still reached
  via the production tab strip.
- **Script viewer mobile chrome (slice 6, 2026-05-24).** At ≤720px the
  layout collapses to a single column, the 52px tool sidebar is hidden
  (view-only mode disables editing anyway), and the 248px right panel
  stacks beneath the PDF.
- **Documents + People mobile layout (slice 8, 2026-05-24).** Documents
  used a 220px folder rail + 1fr docs grid that didn't fit on a phone.
  Outer + folder rail + main got marker classes (`.docs-shell`,
  `.docs-folders`, `.docs-main`); at ≤720px the grid collapses to a
  single column and the folder rail becomes a horizontally-scrollable
  pill strip at the top of the page. People uses a real `<table>` with
  many columns; the wrapper (`.pp-table-wrap`) now scrolls horizontally
  on phone and the table keeps a `min-width: 600px` so columns stay
  legible. Notifications: the existing notification bell in the
  production topbar and the dashboard mentions section already cover
  the in-app cases — a formal `/notifications` inbox is deferred.
- **Blocking mobile layout (slice 7, 2026-05-24).** The blocking canvas
  uses a 3-column editor layout (220px scenes/beats · canvas · 240px
  set-pieces/comments). On a phone that left no room for the canvas.
  Outer wrapper, left panel, center canvas, and right panel got marker
  classes (`.bk-shell`, `.bk-side-left`, `.bk-center`, `.bk-side-right`).
  At ≤720px the grid collapses to a single column and stacks: canvas
  first (full width, ≥56vh tall — actor tokens stay aligned because
  positions are stored as canvas percentages), then the scenes/beats
  panel below (max 50vh, scrollable), then the comments/notes panel
  (max 50vh, scrollable). The fullscreen edge case still uses the
  desktop grid — mobile users don't hit it. Editing remains disabled
  on phone (existing view-only mode).
- **Script viewer compact PDF + quick bookmarks (2026-05-24).** Slice 6
  still required panning to read the PDF on a phone — the canvas
  rendered at its high-DPI scale (~1300px wide) overflowed the
  viewport. The PDF canvas is now CSS-scaled to fit the viewport
  width on phone (`canvas { width: 100% !important; height: auto }`);
  the SVG annotation overlay already uses `viewBox` so it scales
  correctly with the canvas. Workspace padding and page shadow are
  zeroed on phone so the script fills edge-to-edge. A new floating
  bookmarks button (`.sv-mobile-bookmarks-btn`, fixed above the tab
  bar) opens a bottom sheet that reuses the existing `BookmarksPanel`
  — users no longer have to scroll past the entire PDF to reach
  bookmarks. The right-panel bookmarks below the canvas are still
  available as a second route.
- **Today tab always returns to workspace dashboard (2026-05-24).** The
  bottom-tab "Today" used to scope itself to the current production when
  inside a show (per the demo's single-production mental model), which
  felt confusing — "Today" implied "home". It now always routes to
  `/dashboard` and `isActive` only on `/dashboard`.
- **Deferred polish** (noted 2026-05-24, fix later): the production-view
  visuals feel a little forced once we drop into a show — a follow-up
  pass should clean up the per-production mobile chrome (production
  header, tab strip density, etc.) together. The broader review of
  production-context mobile navigation also remains open.
- **Calendar mobile polish (slice 4, 2026-05-24).** Four demo-pattern
  changes to the calendar at phone widths: (a) the `EventDrawer` slides
  up from the bottom as a sheet instead of from the right as a side
  drawer (CSS-only at ≤720px, reuses the existing animation primitives);
  (b) the month view renders each cell as a single tap-target `<button>`
  with the date in the top-right and up to 5 colored pip dots — chips
  with titles only appear on desktop (branched in `month-view.tsx` via
  `useIsPhone`); (c) tapping a day in the month view opens a new
  `DaySheet` bottom sheet listing that day's events instead of jumping
  the whole view to "day" — selecting an event there dismisses the day
  sheet and opens the full `EventDrawer`; (d) the toolbar (prev/next,
  period label, view switcher) is compacted on phone — smaller period
  label, tighter view-switcher buttons.
- **Mobile reports list + detail (slice 3, 2026-05-24).** Two new server
  components — `mobile-reports-list.tsx` and `mobile-report-detail.tsx` —
  render alongside the existing desktop layouts in `/productions/[slug]/reports`
  and `/.../reports/[reportId]`. At ≤720px the desktop table / multi-card
  layout is hidden (`.reports-desktop`, `.report-detail-desktop`) and the
  mobile views appear (`.reports-mobile`, `.report-detail-mobile`). List
  cards match the demo: date strip + report number + status pill + summary
  + chevron. Detail stacks date + status + Pin/Email/Edit actions, a hero
  card with call/start/end times and Present/Absent/Late stat tiles, then
  General notes, Scenes worked, Next rehearsal, all 12 Department notes
  as small cards, Schedule changes / Line notes / Injuries, and
  Attachments — no tabbed panels on phone, everything stacks. PinButton /
  EmailReportButton / AttachmentUpload client components are reused as-is.
- **Production calendar unified with workspace `/calendar` (2026-05-24).**
  Per user direction, the per-production calls page (`/productions/[slug]/calls`)
  now renders the same `<CalendarClient />` as the workspace `/calendar`,
  filtered to just that production. Same 4 views, same sidebar, same
  event drawer — no UX divergence. The old standalone month grid is
  gone. `CalendarClient` dropped `.page` from its outer div so the
  component is portable; `.cal-page` is now self-sufficient (own padding,
  `flex: 1; min-height: 0`). `.page` itself became a flex column to
  allow children to flex-fill. A `.page:has(> .cal-page)` rule strips
  outer padding when the calendar is nested inside the production
  layout's `.page` wrapper, so padding doesn't double up. Trade-off: the
  old page's inline "Schedule call" button is gone (matches the
  dashboard, which never had one); editing existing calls still works
  via the calendar drawer's "Edit" link.
- **Verified:** `next build` compiles, `tsc --noEmit` passes. No new
  `eslint` errors (two pre-existing `set-state-in-effect` errors in
  `blocking-canvas.tsx` are unrelated and untouched).
  **Not verified:** live device behavior — there is no `.env.local` in this
  environment so the build cannot collect page data (`DATABASE_URL` unset).
  "Add to Home Screen" on real iOS/Android still needs checking.

## Blocking tool mobile polish + ground-plan rasterization (2026-05-27)

Branch `claude/vibrant-tesla-5kjsA` — follow-up P2 work after the
2026-05-24 responsive audit, driven by on-device testing on iPhone.

- **Ground plan rasterized at setup time.** Replaces live pdf.js
  rendering on every blocking-page load with a one-time client-side
  JPEG capture during the stage setup wizard. New
  `ground_plan_image_path` column on `stage_configurations` (migration
  applied via Supabase MCP). The setup wizard's calibration canvas
  is captured with `canvas.toBlob` (q=0.85) and uploaded to
  `attachments/ground-plans/<productionId>/<ts>.jpg`; the blocking
  page prefers this `<img>` background and only falls back to pdf.js
  for legacy stage configs without an image. Fixes iOS Safari OOM
  ("Can't open this page") on vector-heavy architectural ground plans
  — the OOM was upstream of rasterization in pdf.js's parser, so
  lowering render scale couldn't fix it. Side effect: faster blocking
  loads on every device (no PDF parsing per visit).
- **Auto-seed first scene + beat.** A new editor opening blocking on
  a fresh production no longer hits an empty canvas that silently
  swallows drag/drops. `ensureFirstSceneAndBeat` (idempotent) creates
  Scene 1 / Beat 1 in `page.tsx` whenever the editor has edit
  permission and the production has no beats yet. Also fixed
  `firstBeatId` selection to flatMap across scenes so an empty first
  scene doesn't strand `currentBeatId` at null when later scenes have
  beats.
- **Mobile view-only beat navigator.** On phone (≤720px) the editor
  sidebars (off-stage cast picker, set-pieces picker), the layer
  toggle, and the desktop edit toolbar are hidden. A new compact
  `bk-beat-nav` bar above the canvas shows the current scene + beat
  label + `N / M` counter with prev/next chevron buttons; horizontal
  pointer swipes across the canvas (touch-only, >50px, predominantly
  horizontal, <600ms) advance/retreat one beat. Scenes/beats list,
  beat comments, and beat notes are still visible.
- **Mobile token sizes.** Actor circles drop 38→26px, labels
  10.5→9.5px, set-piece tokens 64×48→44×33 via `.bk-actor-circle`,
  `.bk-actor-label`, `.bk-set-piece-token` class hooks overridden in
  the ≤720px media query. Desktop sizing is unchanged.
- **Toolbar shift fix.** Undo button always renders (disabled +
  dimmed when history is empty) so the first drag no longer pops it
  into existence and shifts the row. `.btn > svg { flex-shrink: 0 }`
  added globally so toolbar icons don't compress against their labels
  when the row tightens. Subtitle pinned to a single line via
  `.truncate` + `min-width: 0` on the title block + `flex-shrink: 0`
  on the button row so a longer subtitle can't grow the title block
  vertically and re-center the buttons. Capture Beat padding bumped
  to `0 14px` with `gap: 8` so the icon + label have breathing room.
- **iOS auto-zoom after sign-in — PARKED.** Two fix attempts in
  `components/app-shell/zoom-reset.tsx` did not resolve the
  zoomed-in-after-auth behavior. Tracked in
  `docs/open-questions.md → Mobile / iOS questions` with next steps
  to try. Component stays in the tree; it's harmless.

**Other fixes in this branch:**
- Mobile horizontal-overflow guard via `overflow-wrap: anywhere` on
  body and `overflow-x: hidden` on `.page` at ≤720px (without
  breaking the fixed bottom tab bar, which was the failure mode of
  earlier `overflow-x: clip` attempts on `body`).
- Form inputs floored to `font-size: max(16px, 1em)` at ≤720px to
  prevent iOS input auto-zoom on most app forms (sign-in's `.field`
  class overrides this with higher specificity — intentional, the
  user prefers zoom-in there).

## Beta-prep session (2026-05-27)

The work that takes P3 from "infrastructure-only" to a real soft-launch
state. All merged to `main` via PRs
[#13](https://github.com/Mike-Grizzly/CallBoard/pull/13),
[#14](https://github.com/Mike-Grizzly/CallBoard/pull/14),
[#15](https://github.com/Mike-Grizzly/CallBoard/pull/15),
[#16](https://github.com/Mike-Grizzly/CallBoard/pull/16), and
[#17](https://github.com/Mike-Grizzly/CallBoard/pull/17). Each item
verified end-to-end against the live `proscene.app` deploy unless
flagged otherwise.

**Invite flow** — works end-to-end.
- `/invite/accept` welcome page shows inviter + organization name
  (PR #13). `inviteMembers` + `resendInvite` pass `invited_by_name`
  and `organization_name` in the Supabase invite metadata; the email
  template (custom HTML in Supabase Auth → Emails → Templates → "Invite
  user") reads `{{ .Data.invited_by_name }}` / `{{ .Data.organization_name }}`.
- `/auth/confirm` two-step OTP page fixes Gmail's link-scanner burning
  the single-use invite OTP before the human could click (PR #14). The
  page renders a "Continue" button on GET (safe for scanners to
  pre-fetch — token untouched); only the form POST calls `verifyOtp`
  and redirects to `?next=`. Handles all four OTP types: `invite`,
  `recovery`, `signup`, `email`.

**Password reset flow** — verified end-to-end (2026-05-27). The
"Reset Password" template in Supabase Auth was rewritten to match
the Proscene-branded invite design and to route through `/auth/confirm`
(`type=recovery&next=/reset-password`) rather than the default
`{{ .ConfirmationURL }}` magic link, so the scanner-burn fix
applies there too. The earlier "if the button doesn't work, paste
this URL" fallback row was removed at user direction — felt
phishy / sketchy in the email body.

**Delete person on `/people`** — `removeMember` (the existing
"Remove from org" action) was only deleting org membership and only
revalidating `/settings/members`, so dashboard-deleted users still
appeared on the People page. New `deletePerson(userId)` action
(PR #13) deletes the `profiles` row (cascades to memberships,
mentions, reports, documents, announcements, notes, notifications,
pins) and then the Supabase auth user via the admin API. "Not
found" errors from the admin API are swallowed so a half-cleaned
user (already removed from the dashboard) still gets the profile
side cleared. New "Delete account" button in the person drawer with
a `window.confirm` warning that the cascade also deletes content
the person authored. Also added `/people` to `removeMember`'s
revalidation set.

**Rehearsal report email overhaul** (PRs #15 + #16) — five fixes
surfaced when sending a real report through Gmail:
- Attachments now actually attach. `send-report.ts` fetches each
  attachment from Supabase Storage as a Buffer and passes them to
  Resend's `attachments: [{ filename, content }]` field. Capped at
  35 MB total payload (Resend hard limit is 40 MB); anything over
  the budget is skipped with a soft warning so the email still
  sends.
- Email body now includes Attendance (Present/Absent/Late stat
  tiles + per-person attendance notes), Scenes Worked, Breaks,
  Schedule Changes, Line Notes, Injuries / Incidents, and an
  Attachments list. Each section is hidden when its underlying
  JSONB array is empty so short reports stay compact.
- Department notes layout switched from a fixed-width 2-column
  table to stacked label-above-value cards with a 3px left accent
  bar, light slate background, and uppercase eyebrow label —
  long values no longer squash inside a narrow column. Email-safe,
  no media queries.
- "Distribute" button was silently no-oping if General Notes was
  empty (validation required it). Validation rule dropped — many
  reports legitimately only have department notes. Distribute now
  saves status as `distributed`, redirects to `?email=1`, and the
  `EmailReportButton` auto-opens the recipient picker so the user
  can send in one flow. `useEffect` strips the `?email=1` flag so
  refreshes don't keep popping the modal.
- Inline attachments — replaces the "save draft first to attach"
  tip card with a real `AttachmentStaging` section in the report
  form. Files are picked client-side, held as `File` objects with
  a "pending" pill, and uploaded after the server action returns a
  `reportId`. Works on both `/new` and `/edit`; edit mode also
  lists existing attachments with remove buttons backed by a new
  `deleteReportAttachment` server action. `createReport` /
  `updateReport` now return `{ reportId, slug, justDistributed }`
  instead of redirecting; the form orchestrates uploads + navigation
  client-side.
- Bonus: every user-supplied string in the email is now
  HTML-escaped before injection.

**Settings landing page + Send feedback link** (PR #17). `/settings`
was a redirect to `/settings/members`; converted into a real
landing page with an account header card and a list of
destinations. **Send feedback** (mailto to `feedback@proscene.app`)
is visible to every role; **Organization members** only renders for
`settings:manage`. Dropped the capability gate on the Settings
entry in the rail and the mobile More page so cast/crew can reach
it.

**Tester onboarding guide** at `docs/tester-guide.md`. Single page
covering: getting in (invite flow + Add-to-Home-Screen), what
features to try (workspace + per-production), known rough edges,
how to give feedback, and a tiered post-beta roadmap. Multi-org is
flagged as **week-1 of beta** work, not long-term, per the D5
direction below.

**Feedback channel** — `feedback@proscene.app` set up as an
ImprovMX free alias forwarding to `mikegrigsby2010@gmail.com`.
Apex-domain SPF record (`v=spf1 include:spf.improvmx.com ~all` on
`@`) coexists fine with the Resend SPF on `send.proscene.app`
(different host name). Verified end-to-end (2026-05-27).

**P0 password requirements** — set in Supabase Auth →
Sign In/Providers → Email on 2026-05-27. Closes the last P0 item.
Leaked-password protection still deferred to P6 (Pro-plan feature).

**Add-to-Home-Screen** — verified on iPhone 2026-05-27. Manifest
+ apple-touch-icon + Proscene branding all render correctly.

**Decision locked — D5 (org model).** Single-org launch with one
non-profit theatre company for week 0; multi-org refactor opens
that up within week 1 of beta so additional companies can join in
walled-off workspaces. Multi-org therefore moves out of long-term
into the during-beta Tier 1 roadmap. See `decision-log.md`
(2026-05-27 — multi-org during beta week 1).

## Multi-org refactor (2026-05-28)

**Multi-organization support** — closing the D5 week-1 deliverable.
`getCurrentUser` no longer routes everyone through
`getOrCreateDefaultOrganization`; instead it reads the caller's
actual `organization_memberships` row and returns that org. Two
runtime paths:

- **Self-signup.** A new auth user with no profile lands in
  `lib/auth.ts`, which calls `createOrganization()` (in
  `lib/organization.ts`) with the name they typed on the signup
  form and inserts a membership with role `admin`. They are the
  sole member of a fresh, walled-off workspace.
- **Invited user.** `features/members/actions.ts` already created
  their `profiles` row and `organization_memberships` row at invite
  time, scoped to `currentUser.organizationId`. First login finds
  both rows, promotes profile status `invited → active`, and
  returns the inviter's org. No code change needed there — it was
  already multi-org correct, only the runtime helper was wrong.

**Signup form** now has a required **Organization name** field
(autocomplete `organization`). The value rides on
`auth.signUp()` user_metadata as `organization_name`; the auth
helper pulls it back out on first login and falls back to
"{First Last}'s organization" if blank.

**Org slug.** `createOrganization` slugifies the name and retries
with a 2-byte hex suffix on collision (`uniqueSlugFor`). Slugs are
not user-facing today — they exist because the schema marks
`organizations.slug` `unique` — but the deterministic-first-try
behavior keeps them human-readable when we eventually surface them.

**Callsite sweep.** All ~25 pages and feature actions that did
`const org = await getOrCreateDefaultOrganization()` now read
`user.organizationId` directly. The helper is deleted from
`lib/organization.ts`. Verified callers were only ever reading
`org.id`, never `org.name` or `org.slug` — the refactor is a pure
substitution.

**Existing data.** The "Default Organization" row in production is
left as-is per the 2026-05-28 product decision; existing testers
keep their workspace and can rename it later (Settings UI for org
rename is not yet built). New self-signups create their own orgs
immediately.

**Explicitly not in this round** — Settings UI to rename the
current org, org switcher (deferred from D5 week 1; ships when a
user actually ends up in multiple orgs). Org-membership status
flow (pending/approved) is unchanged.

## Settings overhaul (2026-05-29)

Closes the deferred items from the 2026-05-28 multi-org entry and
fills in real account/workspace management.

**Schema:** added `profiles.selected_organization_id` (uuid,
nullable, FK to `organizations.id` on delete set null). Powers the
org switcher; `getCurrentUser` reads it with self-healing fallback to
the user's first membership when stale.

**`CurrentUser` type** now carries `organizationName` so rail/header
surfaces don't need an extra query.

**Account settings — `/settings/account` (every user).**
Edit first/last name, phone, pronouns. Change password (verify
current via `signInWithPassword`, then `updateUser({ password })`).
Profile edits also sync `auth.user_metadata` so signup/invite emails
have the latest name. Email change deferred (needs re-verification
flow).

**Workspace settings — `/settings/workspace` (admin only).**
Rename current workspace (60-char cap; slug stays stable since
slugs aren't user-facing). Shows member + admin counts. Deep-links
to `/settings/members` for role changes.

**Org switcher.** `WorkspaceRailBadge` always shows the current
workspace name just below the rail brand. Click opens a menu with
the user's other orgs, or "No other workspaces yet" when they only
belong to one. Same switcher inline on the settings landing.
`switchOrganization` server action verifies caller membership, writes
`selected_organization_id`, revalidates `/` layout; client calls
`router.refresh()`.

**Members — last-admin safeguard.** Refuses to demote OR remove the
sole remaining admin in an org. Surfaces a clear error so the
operator knows to promote another admin first. Stacks with the
existing "can't change/remove yourself" rules.

**Settings landing reframed** around the workspace: org name + logo
(when set) as the headline, signed-in user + role below, switcher
inline, then a list of destinations (Account, Workspace, Members,
Send feedback).

### Follow-up pass — same day (PR #20, merged 2026-05-29)

Round-two additions that landed on top of the initial settings
overhaul before PR #20 merged:

- **Create new workspace from the switcher.** New `createWorkspace`
  server action — any signed-in user can spin up a fresh workspace,
  becomes its first admin, and gets auto-switched into it. Inline
  "Create workspace" form lives in both the rail badge menu and the
  settings landing switcher.

- **Inline password-match check.** The "Confirm new password" field
  on `/settings/account` warns as the user types, sets
  `aria-invalid` + `aria-describedby`, and disables the submit
  button until both fields match.

- **Archive productions (soft delete only).** New
  `productions.archived_at TIMESTAMPTZ` column + index on
  `(organization_id, archived_at)`. `archiveProduction` /
  `unarchiveProduction` server actions (admin/producer via
  `productions:manage`, org-scoped). Active list and rail hide
  archived rows; managers see a collapsible "Archived productions"
  disclosure at the bottom of `/productions` with restore buttons.
  Hover-revealed archive icon on each card. **Hard delete is
  intentionally not implemented** — too much downstream history
  (reports, calls, blocking) to throw away; archive is the right
  primitive.

- **Transfer workspace ownership.**
  `transferWorkspaceOwnership(targetUserId, newSelfRole)` runs in
  one transaction: promote the target to admin first, then demote
  the caller to a chosen non-admin role. Refuses self-targeting and
  refuses `admin` as the new self-role. Form lives on
  `/settings/workspace`; empty state when the caller is the only
  member.

- **Workspace logo.** New `organizations.logo_url TEXT` column —
  stores a Supabase Storage path inside the existing `attachments`
  bucket. Upload flow: `requestWorkspaceLogoUpload` returns a signed
  upload URL → browser uploads straight to Storage (bypasses the
  25MB action body cap) → `finalizeWorkspaceLogoUpload` writes the
  column and cleans up the previous file. `removeWorkspaceLogo`
  clears + deletes. Server-side: admin-only, MIME allow-list
  (SVG/PNG/JPG), 2MB cap, storage path locked to the caller's
  workspace. Client-side: same MIME allow-list, 2MB cap, square
  shape (5% tolerance; skipped for SVG since it can ship without
  intrinsic dimensions). `getSignedLogoUrl` (per-request `cache()`)
  signs the path for display in the rail badge (replaces the
  building icon when set) and on settings page headers.
- `CurrentUser` now also carries `organizationLogoUrl` so rail +
  settings headers don't need an extra query.

**Explicitly NOT in scope (per product decision, 2026-05-29):**
- **Email change with re-verification.** A user's email is
  permanently read-only on `/settings/account` for now — the field
  renders disabled with a hint. No "verify new email" / magic-link
  rebinding flow exists. (If a fresh session asks "is email linking
  done?" — the answer is no, and it's deferred on purpose, not
  missing.)
- **Delete workspace / delete account.** Out of scope.
- **Transfer workspace to a person who isn't already a member** —
  transfer only works among current members. Add the new owner via
  invite first.
- **Account-level avatar upload.** Out of scope this round.

## Scaffolded only (not implemented)

- **Activity log** — placeholder page exists, capability defined, feature directory has only .gitkeep
- **AI script analysis** — `documentType` and `processingStatus` fields exist in documents schema, no processing logic
- **Document comments/annotations** — placeholder sidebar in document viewer, no data model or functionality

## Not implemented

- Tests (zero test files in repo)
- Dark mode
- Email notifications
- Real-time updates
- PWA offline support / service worker (basic installable PWA shipped 2026-05-22; offline caching deferred — roadmap D7)

## Known limitations

- No composite unique constraints on membership tables (removed because drizzle-kit push hangs with them) — duplicate memberships prevented in app code only
- ~~`getDocumentUrl()` and `getAttachmentUrl()` do not check access~~ — RESOLVED (2026-06-18): both verify `userCanAccessProduction` / `resolveAccessibleDocument` before signing
- ~~Supabase Storage RLS policies are broad~~ — RESOLVED (2026-06-18): bucket RLS is now deny-all (enabled, no policies); all storage goes through the service-role admin client, so app-layer checks are the boundary
- No file type validation on uploads (any file type accepted)
- No duplicate file detection
- `dangerouslySetInnerHTML` in RichTextDisplay/announcements — HTML is sanitized via `lib/sanitize.ts` (inline in RichTextDisplay; at the query layer for announcement `bodyHtml`)
- TipTap bullet points not rendering due to Tailwind prose CSS reset
- `drizzle-kit push` is effectively retired — it crashes introspecting CHECK constraints on this Supabase database (a `drizzle-kit` CLI bug, unrelated to `drizzle-orm`). Schema changes are applied via the Supabase SQL Editor / MCP, with `db/schema/*` kept in sync by hand. See decision-log entries dated 2026-05-20.
- README.md is outdated (still says "Phase 1: Foundation and app shell")

## Risks for future review

- Storage access control needs hardening before production deployment
- Rich text HTML rendering should be sanitized before accepting untrusted content
- Membership uniqueness should be enforced at the database level
- File upload security (type validation, malware scanning) should be addressed before public launch

## Dashboard command center + RSVP + announcement acks (2026-05-29)

Branch `claude/bold-babbage-qxwCO`. Ported the uploaded dashboard draft and
mobile new-production builder into the app, and built the two genuinely-new
features the draft implied (the rest was derivable from existing data).

**New features (schema applied to the `CallBoard` Supabase project, RLS
enabled to match the rest of the schema):**
- **Call confirmations (RSVP).** `call_confirmations` (one row per
  call+user, `status` defaults `confirmed`). `getCallConfirmSummary`
  (features/calls/queries) returns called total (production members),
  confirmed count + avatars, and the caller's status. `confirmCall(callId)`
  (features/calls/actions) is an idempotent member self-confirm toggle. The
  RSVP UI lives on the dashboard focal-call panel (member self-confirm).
- **Announcement acknowledgements.** `announcement_acks` (one row per
  announcement+user). `getAckInfoForAnnouncements` returns acked count,
  audience size (org members for org-wide, production members for scoped),
  and the caller's ack. `acknowledgeAnnouncement(id)` is an idempotent
  toggle. The Acknowledge button + progress shows in the dashboard bento and
  on the global `/announcements` cards.

**Desktop dashboard redesign (>720px).** `app/(app)/(default)/dashboard/page.tsx`
now renders a command center inside `.dd-wrap` (gated by the existing
`.dashboard-desktop-only`): greeting band + status chips, a hero row (focal
next-call panel with a live countdown + RSVP confirm, and a Today timeline
built from today's calls with a NOW marker), show tiles with
week-toward-opening progress + principal avatars + per-show unread badges +
next call, and a 3-up bento (mentions with mark-read preserved /
announcements with Acknowledge / pinned). All `.dd-*` styles were added to
`globals.css`, reusing existing tokens. New client components:
`focal-call.tsx`, `bento-mentions.tsx`, `announcement-ack-button.tsx`.
Derivable queries added with no schema beyond the two tables above:
`getCastForProductions` (members), and `getUserProductions` now also returns
`venue` + `firstRehearsalDate`.

**Phone dashboard unchanged.** The existing phone experience (MobileTodayHero
+ announcements/productions/mentions/pinned) is preserved behind a new
`.dashboard-phone-only` gate; the desktop command center is hidden at ≤720px.

**Mobile new-production wizard.** Added a ≤720px layout to the existing
`.np-root` wizard: the desktop step rail is replaced by a compact step header
+ segmented progress bar (new `.np-mobile-bar` element, hidden on desktop),
the form is one-step-per-screen, and the action bar sticks to the bottom with
a full-width Continue/Launch. Pure layout — steps, fields, and `createProductionFull`
wiring are unchanged.

**Verified:** `tsc --noEmit` passes; `eslint` clean on all changed files.
**Not verified:** live behavior — no `DATABASE_URL` in this environment, so
`next build` can't collect page data and the UI wasn't exercised against real
data. Countdown assumes `calls.callTime` is stored as 24h `HH:MM`.

## Mobile dashboard command center (2026-05-29)

Branch `claude/bold-babbage-qxwCO`. Ported the uploaded `mobile-dashboard.jsx`
/ `mobile-shell.jsx` design into the app, replacing the phone dashboard.

- New client component `app/(app)/(default)/dashboard/mobile-dashboard.tsx`
  renders the phone command center inside the existing `.dashboard-phone-only`
  gate: greeting + status chips, focal next-call card (live countdown + RSVP
  confirm via `confirmCall`), Today timeline (today's calls + NOW marker),
  a horizontal **shows carousel** (week-to-opening progress, principal
  avatars, unread badge, next call), mentions (mark-read on tap), announcements
  (reuses `AnnouncementAckButton`), and pinned. Fed entirely by data the
  dashboard page already fetches — no new queries.
- `dashboard/page.tsx` now builds small serialized arrays (`mdTimeline`,
  `mdShows`, `mdAnnouncements`, `mdPins`) and renders `<MobileDashboard>` for
  phone; the desktop command center is unchanged. The previous phone layout
  (`MobileTodayHero` + the legacy stacked feeds) is no longer rendered.
- The draft's standalone chrome (its own appbar/bottom-tab-bar/toast and the
  `.mob-root` token block) was intentionally omitted — the app already
  provides the bottom tab bar, safe-area pads, and design tokens. All styles
  added to `globals.css` scoped under `.md-root` (renders only on phone), with
  a small subset of the mobile-shell primitives (`.mob-card`, `.sec-h*`,
  `.mbtn`, `.tap`) included under the same scope.

**Verified:** `tsc --noEmit` + `eslint` clean. **Not verified:** live device
rendering (no `DATABASE_URL` here).

### Follow-up (2026-05-29)

The desktop + mobile dashboard command center, RSVP, and announcement acks
were confirmed working by the user. The orphaned `mobile-today-hero.tsx` was
deleted (nothing imported it; `tsc` + `eslint` clean). Branch
`claude/bold-babbage-qxwCO` merged to `main`.

## Notes → Notion-style editor (2026-05-29)

Branch `claude/bold-babbage-qxwCO`. Reworked the production notes editor
(`app/(app)/productions/[slug]/notes/notes-panel.tsx`) to feel like a real
document surface rather than a tacked-on panel.

**Desktop**
- **Slash commands** — `/` opens a block menu (Text, H1/H2/H3, bulleted/
  numbered list, quote, divider, code). New `SlashCommand` TipTap extension
  (`components/ui/slash-command.ts` + `slash-command-list.tsx`) built on the
  existing `@tiptap/suggestion` dep — no new library. `allow` guard fires only
  at block start / after whitespace so it won't hijack `/` mid-word.
- **Selection bubble toolbar** (`@tiptap/react/menus` `BubbleMenu`) with
  bold/italic/underline/strike/highlight + heading/list, replacing the
  always-on fixed toolbar. Shared `FormatButtons` group.
- **Placeholder** ("… press / for blocks") via `@tiptap/extension-placeholder`.
- **Spacious document** — large display-font title, 760px centered column,
  generous margins, larger prose (`.note-doc` / `.note-title-input` /
  `.note-prose`).

**Mobile (≤720px) — immersive, like the script reader**
- The editor column becomes a full-screen overlay (`position:fixed; inset:0;
  z-index:70`, `msr-in` slide-up) in the app's warm light palette.
- Top bar: back · centered **"Private" pill** · spacer (`.note-mobile-topbar`).
- **Keyboard accessory bar** (`.note-accessory`) pins `FormatButtons` to the
  bottom; the editor root height is JS-synced to `window.visualViewport` (ref
  mutation, no state) so the bar rides above the on-screen keyboard. Slash +
  bubble still work. The save-status footer is hidden on phone.

All styles in `globals.css` (`.note-*`, `.slash-*`). Autosave, mentions, tags,
to-do/pin, and the workspace `/notes` feed are unchanged.

**Verified:** `tsc --noEmit` clean; `eslint` clean on all new/changed files
(one pre-existing `set-state-in-effect` warning in the unrelated TagManager
remains). **Not verified:** live behavior — no `DATABASE_URL` here. The
visual-viewport keyboard tracking and the BubbleMenu need real-device checks.

### Notes Notion-pass round 2 (2026-05-29)

Follow-up to the Notion-style editor — the four items the user approved:
- **Checkboxes + links** — to-do checklists via `TaskList`/`TaskItem`
  (`@tiptap/extension-list`, now an explicit dep) with a `/todo` slash item;
  inline links via `@tiptap/extension-link` (explicit dep) with a Link button
  in the bubble menu. Sanitizer extended to keep task lists + styled links in
  the read-only path (display checkboxes forced disabled).
- **Editor chrome cleanup** — removed the bordered top metadata bar; tag, due
  date, and to-do/pin/delete now live in a quiet pill **properties row under
  the title** (`.note-props`). No desktop close 'X'.
- **Sidebar restyle** — `NoteRow` is now a Notion-style page row (`.note-row`:
  page/checkbox icon, hover + inset-ring active, quiet tag-dot + due meta).
- **`/notes` feed** — the workspace feed now tiles cards in a responsive grid
  (`repeat(auto-fill, minmax(320px, 1fr))`) so it fills the width instead of a
  single narrow column.

Plus desktop layout fix (full-width sidebar column + filling editor, no
1180px centering) and editor QoL (autofocus title, Enter→body, click-to-focus).

**Verified:** `tsc` + `eslint` clean (one pre-existing TagManager
set-state-in-effect warning remains). **Not verified:** live device behavior.

## Dark mode (2026-05-29)

Branch `claude/bold-babbage-qxwCO`. App-wide light/dark/system theming, built
on the design-token system (`body[data-theme]`), which already had a dark
token block.

- **Preference model:** Light / Dark / **System** (follows OS, live). Stored in
  a `proscene-theme` cookie (device-level, not the DB). New users default to
  System; existing users stay Light until they choose.
- **No-flash SSR:** the root layout (`app/layout.tsx`, now async) reads the
  cookie and renders `body[data-theme]` server-side; an inline `<script>` at
  body start resolves "system" against `prefers-color-scheme` and corrects the
  attribute + mobile `theme-color` before paint.
- **Switch UI:** `components/app-shell/theme-control.tsx` — a segmented
  Light/Dark/System control in **Settings → Appearance** and the **mobile More
  page**, plus a compact cycle button in the **rail footer**. Applies instantly
  (no reload) and persists via cookie; on "System" it follows live OS changes
  via `matchMedia`. State uses `useSyncExternalStore` (seeded with a
  server-read `initialPref`) so there's no setState-in-effect and no active-
  option flicker. `lib/theme.ts` (client apply/read) + `lib/theme-server.ts`
  (cookie read).
- **Native controls:** `color-scheme` set per theme (`:root` light, dark block
  dark) so scrollbars, date inputs, and form controls render dark.
- **Audit:** the app is token-driven, so the dark block flips nearly
  everything. The few literal whites (toggle knobs, PDF/document page
  backgrounds, the calendar "today" pip) are intentional and left as-is; auth
  screens use `var(--bg)` and go dark automatically.

**Verified:** `next build` compiles + `tsc` + `eslint` clean (build stops only
at page-data collection because this env has no `DATABASE_URL`). **Not
verified:** live visual QA of the dark palette on real screens — the dark
token values are a reasonable starting point and may want tuning.

### Dusk theme (2026-05-29)

Added a third palette, **Dusk** — a soft "dim" theme between light and dark
(warm charcoal `--bg` ~oklch(0.305), lower contrast than dark, gentle for
evening use). New `body[data-theme="dusk"]` token block; the switch is now
**Light · Dusk · Dark · System** everywhere (segmented + rail cycle).
`ThemePref`/`EffectiveTheme`, the no-flash inline script, the cookie
validators, and the status-bar `theme-color` map all updated. `tsc`/`eslint`
clean.

## Marketing website port (2026-06-05) — branch `claude/magical-ride-usNEW`, NOT merged

The standalone ProScene marketing site (hand-built static HTML/CSS/JS,
uploaded by the user) is ported into the app under a new isolated
`app/(marketing)/` route group. See `decision-log.md` (2026-06-05) for the
approach and `open-questions.md` (Marketing website) for follow-ups.

- **Routes:** `/` (landing), `/features`, `/pricing`, `/reviews`,
  `/blog`, `/blog/[slug]`, `/faq`. The root `/` is the marketing homepage (the old `app/page.tsx` `/` →
  `/dashboard` redirect was removed 2026-06-05); users sign in at `/login`
  and land in the app at `/dashboard` after auth.
- **Isolation:** all marketing tokens + base styles are scoped to a
  `.ps-site` wrapper (`app/(marketing)/marketing.css`) so they cannot leak
  into the app and the app's `body[data-theme]` dark/dusk system cannot
  recolor marketing pages. Per-page `<style>` blocks scoped under
  `[data-page="…"]`. `feature-demos.css` + `dash-hero.css` load only on
  `/features`.
- **Approach:** faithful-HTML render — page bodies via
  `dangerouslySetInnerHTML` from authored static content (no user input);
  shared chrome (`Nav`/`Footer`) and interactions (reveal-on-scroll, mobile
  menu, pricing billing toggle, FAQ search + scrollspy, feature scroll-demo
  engine, blog tabs) are real React/client components under
  `app/(marketing)/**`.
- **Fonts:** Inter via `next/font` (`--font-inter`); Geist Mono inherited
  from the app's root layout.
- **Wired:** nav "Sign in" → `/login`, "Start free" → `/signup`. In-page CTAs
  remain `data-noop` placeholders (match the mockups) pending a decision on
  where they route.
- **Assets:** placeholder set-piece SVGs in `public/marketing/setpieces/`.
- **Not built yet:** Payload CMS (planned; needs `next` ≥ 16.2.6), Stripe,
  GTM, brand-casing/domain reconciliation, real blog content, CTA wiring.
- **Verified:** `next build` compiles cleanly (only fails afterward on the
  app's `DATABASE_URL` requirement, unrelated); `tsc --noEmit` and `eslint`
  pass. **Not** browser-verified from this environment (no `.env.local`/DB) —
  smoke-test on a preview deploy or local `npm run dev`.
- **Live app:** untouched. Nothing reaches production until merged.
