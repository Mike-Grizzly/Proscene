# Pre-launch security & architecture review — 2026-07-22

**Scope:** (1) the merged UX-design series — PRs #71–#85 (UX Batches 1–11, 3-theme
brand adoption, M11 hydration fix; diff range `8a23ba9..fd9bdee`); (2) a
full-project pass over the security-load-bearing surfaces; (3) a consolidated
launch checklist + open-backlog inventory. Verified against the **live** Supabase
project (CallBoard) where noted.

**Headline verdict: clear to launch from a code-security standpoint.** The UX
series introduced no vulnerability; one low-severity latent gap found in the
full pass (`createDefaultFolders`, fixed in this branch); the remaining launch
work is owner-side configuration, not code.

---

## 1 · UX-design series (PRs #71–#85) — invariant-by-invariant

| Ground rule (ux-backlog.md) | Verdict | Evidence |
|---|---|---|
| Storage stays deny-all | ✅ PASS | No storage/RLS/policy change anywhere in the range; live check confirms zero policies (see §3) |
| Authorization lives in server actions | ✅ PASS | Only server-side diffs in the range: `getUnreadNotificationCountsByType` (`features/notifications/actions.ts` — `requireCurrentUser`, scoped to `recipientId = user.id`, count-only), Sanity fetch timeout (`lib/sanity/queries.ts` — no token exposure, preview/published split intact), Sanity `post` schema fields, blog-seed script/workflow. No permission check touched |
| Draft-report visibility | ✅ PASS | No report read-path change; R1 preview is client-side over data the author (a `reports:create` holder) already has |
| Rich text only through `sanitizeHtml` | ✅ PASS | Repo-wide `dangerouslySetInnerHTML` audit: app-side user content renders via `RichTextDisplay` (sanitizes inline), notes panel (`sanitizeHtml` at `notes-panel.tsx:567`), announcements (sanitized at the query layer, `features/announcements/queries.ts:524`). Marketing/help/JSON-LD sites are authored static TS content (documented pattern). `SanityHero.emphasize()` HTML-escapes before inserting `<em>` |
| `proxy.ts` remains the auth layer | ✅ PASS | Untouched in the range |
| Rate limiting fail-closed | ✅ PASS | Untouched; re-verified fail-closed on real production (`lib/rate-limit.ts:74`, VERCEL_ENV-keyed) |
| No constants from `"use server"` files | ✅ PASS | New constants went to `drawer.constants.ts` |
| No new secrets client-side | ✅ PASS | Blog-seed workflow (`.github/workflows/seed-blog.yml`) is `workflow_dispatch`-only (write-access users only, so not fork-triggerable), token via repo secret, dry-run mode gates on it |
| Recipient hardening (R3) | ✅ PASS | `sendReport` still filters to production members server-side (`features/reports/send-report.ts:68`) regardless of picker state; requires `reports:create` + production access |
| Nav gating (N3/N4) | ✅ PASS | `nav-items.test.ts` asserts per-role rail/More output byte-identical to pre-refactor for all 8 roles; Cast & Crew tab keeps its `productions:manage` gate (`productions/[slug]/layout.tsx:126`) |
| New primitives clean | ✅ PASS | `<Drawer>` (portal/Escape/focus-trap/scroll-lock), toast, ConfirmDialog, EmptyState, `useFocusTrap`, `<ProductionSwitcher>` (reuses `getVisibleProductions`), `<ProductionCrumbTail>` (pathname-derived labels, no injection) — no HTML/URL handling of user content |
| Brand/CSS commits (#82–#85) | ✅ PASS | CSS/tokens/docs only; the one JSX change (wizard `type="time"` inputs + `fmt12h` review formatting) is client-side and validated server-side as before |

**Conclusion:** the UX series was executed to its own security ground rules.
Nothing to remediate.

## 2 · Full-project pass — findings

### F1 · `createDefaultFolders` was an unauthenticated server-action endpoint — LOW · **FIXED here**
Every export of a `"use server"` file is a client-invocable endpoint.
`createDefaultFolders(productionId)` lived in `features/documents/actions.ts`
with **no** auth/tenancy check (it was written as an internal helper for the
production-creation actions, which authorize before calling it). Worst case: a
caller who obtains the action ID inserts duplicate "default folder" rows into an
arbitrary production — cross-tenant *write spam*, no read or destructive path.
**Fix:** moved to `features/documents/folders.ts` (plain server module, not
`"use server"`), callers in `features/productions/actions.ts` re-pointed. It is
no longer an endpoint. Full sweep of all other `"use server"` exports (22 action
files + `send-report.ts`, `attachments.ts`, `ocr-actions.ts`) found **no other
export missing auth** — every one calls `requireCurrentUser`/`getCurrentUser`
directly or via a gate helper (`resolveAccessibleDocument`,
`resolveAccessibleVideo`, `gateStoragePath`, …), and production-scoped ones
verify tenancy (`userCanAccessProduction`) + child-resource ownership per the
2026-06-29 audit pattern.

### F2 · Dependency advisories — MEDIUM (operational) · owner/code follow-up
`npm audit --omit=dev`: 25 vulns (1 critical, 11 high). Notables:
- `next@16.2.9` — HIGH via bundled `postcss`/`sharp` (image pipeline CVEs).
  Bump to the patched 16.2.x when available; check the Next security advisory.
- `tar` — CRITICAL (crash/DoS via crafted archive) — transitive; not reachable
  from user input in this app's request path, but bump.
- `undici`, `js-yaml`, `sharp`, `fast-uri`, `adm-zip` — HIGH, all transitive
  (mostly via Sanity CLI/tooling chains; several are dev-adjacent).
None is a known *remotely exploitable in this app's usage* issue, so not
launch-blocking — but run `npm audit fix`, take the Next patch, and re-audit
before launch. (Also note `open-questions.md`'s lint-baseline item: local
`npm install` resolves newer plugins than CI's lockfile — same hygiene bucket.)

### F3 · Verified-good (no action)
- **API routes (all 5):** Stripe webhook — signature-verified +
  customer-mismatch 0-row guard; billing cron — `CRON_SECRET` bearer, 503 when
  unconfigured; script parse run — auth + production/ownership gate + status
  guard; Sanity draft-mode enable — signature-validated by
  `defineEnableDraftMode`; disable — cookie-clear only.
- **`proxy.ts`:** PUBLIC_ROUTES are exactly the marketing/SEO/auth/webhook
  surfaces; API routes excluded from the matcher *and* individually authed.
- **Headers:** HSTS, nosniff, SAMEORIGIN/frame-ancestors, Referrer-Policy,
  Permissions-Policy, scoped CSP (documented trade-off; nonce-based script-src
  is a reasonable post-launch hardening).
- **Uploads:** magic-byte validation for every allowed MIME
  (`lib/upload-security.ts`), no SVG in image allowlists, storage-path
  sanitization; signed URLs only via admin client behind
  `resolveAccessible*` gates (1 h expiry).
- **Secrets:** no hardcoded keys in the repo; all `NEXT_PUBLIC_*` vars are
  legitimately public (Supabase URL/anon key, VAPID public key, Sanity project
  id, site URL, GTM); grep for `sk_live/sk_test/whsec_/service_role` clean.
- **Auth core:** `userCanAccessProduction` enforces org tenancy +
  soft-delete + manage-override/membership (`lib/auth.ts:347`); rate limiting
  fail-closed on real production deployments.

## 3 · Live database verification (Supabase project "CallBoard")

Checked live on 2026-07-22 via read-only SQL:

- **`storage.objects`: RLS enabled, ZERO policies; `attachments` bucket
  `public=false`.** The launch-cutover storage lockdown flagged as *pending* in
  `open-questions.md` (2026-06-05) **is in fact done** — deny-all is live.
  Docs updated to close this.
- **Every public table: RLS enabled, no policies** (deny-all for the
  anon/authenticated PostgREST path) — intentional: all app access goes through
  the server with its own authorization layer. The advisor flags these as INFO;
  they are the design, not a gap.
- **Leaked-password protection: still disabled** (advisor WARN). Known item —
  requires the Supabase Pro plan. On the launch checklist.

## 4 · Launch checklist (owner-side; consolidated from docs + this review)

Code is ready; these are configuration/verification steps:

1. **Stripe go-live** (`current-status.md` §go-live, unchanged): swap test→live
   keys + price IDs in Vercel Production; create the live webhook at
   `https://www.proscene.app/api/stripe/webhook` (4 events) + its `whsec_` ;
   enable plan-switching in the LIVE Customer Portal; wire the founding/15%
   coupons; redeploy; one real-card smoke test (charge → refund). Remember
   `BILLING_ENABLED=true` is already live — the moment live keys land, trials
   and the daily cron are real.
2. **Supabase:** enable leaked-password protection (needs Pro); consider Pro
   before launch anyway (backups/support).
3. **Deps:** `npm audit fix` + Next 16.2.x security patch; re-audit (F2).
4. **Deliverability:** verify Supabase Auth invite emails (SMTP/Resend domain)
   actually arrive — a silent failure looks like "sign-in is broken"
   (`open-questions.md` 2026-06-15).
5. **Browser-verify on prod/preview** (accumulated list): designer→full-app
   conversion, priced-consent upgrade step, canceled-in-grace resubscribe,
   annual-interval checkout (the one untested checkout path), per-workspace
   designer gating; UX-batch surfaces on a real phone (report form at 390px,
   iOS auth zoom, More badges).
6. **SEO/owner ops:** Search Console + Bing verification, sitemap submission;
   mirror M1/M6 copy edits into Sanity; run the blog-seed workflow if the four
   posts should be Studio-editable.
7. **Test data hygiene:** remove the `cast` test login (2026-06-30) and note
   the sandbox subscription on `mgrigsby.beazleyrealtors@gmail.com` before real
   billing.

## 5 · Open backlog (post-launch work, nothing blocking)

- **UX backlog: complete.** Only the ongoing ratchet rules remain (S6 button
  unification, S7 globals.css decomposition, S8 giant-component decomposition).
- **QA backlog:** Batch 4 — attendance model (richer states, union status,
  Decision 3); Batch 5 — blocking enhancements (zoom, presets, ground-plan
  upload from picker, Decision 2 list membership); Batch 6 — setup/config
  presets. Multi-character tracks **on hold** (owner reconsidering). Two
  unreproduced bugs left open (PDF first-click, script download nav).
- **Architecture (deliberately deferred):** committed-migration workflow +
  belt-and-suspenders DB uniqueness constraints (`open-questions.md`
  2026-06-29); 30-day hard purge for soft-deleted orgs/productions + storage
  reclamation (delete copy currently aspirational); accounts/entitlements
  model (Canva/Monday pattern — needs its own scoping); org-level AI quota
  (per-production cap only today); orphan wizard-script temp-file sweep.
- **Product decisions pending:** deleting a paid workspace doesn't touch the
  Stripe subscription; `deletePerson` multi-org semantics; email change
  (intentionally not built).

---

*Method: diff audit of `8a23ba9..fd9bdee`; scripted sweep of every `"use
server"` export for auth-helper presence with manual verification of all 16
flagged functions; manual read of auth core, all API routes, headers, upload
validation; live SQL checks of storage/table RLS; `npm audit`; Supabase
security advisors; `tsc` + `eslint` (0 errors) + 185 tests + `next build` green
before and after the F1 fix.*
