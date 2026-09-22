import { Resend } from "resend";
import { db } from "@/db";
import { notifications, productions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPreferencesForUsers } from "./preferences";
import { sendPushToUsers } from "@/features/push/send";

export type AnnouncementAudienceMember = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type FanoutInput = {
  announcementId: string;
  organizationId: string;
  title: string;
  body: string;
  productionSlug: string | null;
  productionTitle: string | null;
  authorId: string;
  authorName: string;
  audience: AnnouncementAudienceMember[];
};

function snippetFromHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function announcementLink(productionSlug: string | null): string {
  return productionSlug
    ? `/productions/${productionSlug}/announcements`
    : `/announcements`;
}

/**
 * Fan an announcement out to its audience across the user's chosen channels.
 *
 * Audience is resolved by the caller from the announcement's scope (org members
 * for org-wide, production members for scoped). The author is excluded here.
 * Delivery is best-effort: a failure in one channel (e.g. email) must never
 * fail announcement creation, so email is wrapped and swallowed.
 *
 * `push` is delivered via Web Push (features/push/send.ts), keyed on
 * `prefs.push` and the user having at least one registered device. Like email,
 * it is best-effort — sendPushToUsers swallows its own failures.
 */
export async function fanoutAnnouncement(input: FanoutInput): Promise<void> {
  const recipients = input.audience.filter(
    (m) => m.userId !== input.authorId,
  );
  if (recipients.length === 0) return;

  const prefs = await getPreferencesForUsers(recipients.map((r) => r.userId));
  const link = announcementLink(input.productionSlug);
  const scopeLabel = input.productionTitle ?? "your company";

  const inAppRows = recipients
    .filter((r) => prefs[r.userId]?.inApp)
    .map((r) => ({
      recipientId: r.userId,
      organizationId: input.organizationId,
      type: "announcement",
      title: `New announcement: ${input.title}`,
      body: `${input.authorName} posted to ${scopeLabel}`,
      link,
    }));

  if (inAppRows.length > 0) {
    await db.insert(notifications).values(inAppRows);
  }

  const emailRecipients = recipients.filter(
    (r) => prefs[r.userId]?.email && r.email,
  );
  if (emailRecipients.length > 0) {
    await sendAnnouncementEmails(emailRecipients, input, link, scopeLabel);
  }

  const pushUserIds = recipients
    .filter((r) => prefs[r.userId]?.push)
    .map((r) => r.userId);
  if (pushUserIds.length > 0) {
    await sendPushToUsers(pushUserIds, {
      title: `New announcement: ${input.title}`,
      body: `${input.authorName} posted to ${scopeLabel}`,
      url: link,
      tag: `announcement-${input.announcementId}`,
    });
  }
}

/**
 * Tell the requester their AI script analysis is ready to review. Delivered
 * in-app and via push (respecting prefs); no email — this is a setup-time,
 * one-to-self alert, not an announcement. Best-effort throughout, so a parse
 * is never marked failed just because notifying failed.
 */
export async function sendScriptParseReady(input: {
  userId: string;
  productionId: string;
  roleCount: number;
  sceneCount: number;
  /**
   * "ready" (default): the breakdown is ready to review. "split_suggested":
   * the file looks like a libretto + vocal score and needs a boundary decision.
   */
  variant?: "ready" | "split_suggested";
  /** Deep-link the review page to a specific script document. */
  documentId?: string | null;
}): Promise<void> {
  try {
    const [prod] = await db
      .select({ slug: productions.slug, organizationId: productions.organizationId })
      .from(productions)
      .where(eq(productions.id, input.productionId))
      .limit(1);
    if (!prod) return;

    const link = input.documentId
      ? `/productions/${prod.slug}/script/ai?doc=${input.documentId}`
      : `/productions/${prod.slug}/script/ai`;
    const split = input.variant === "split_suggested";
    const title = split ? "Script needs a split decision" : "Script analysis ready";
    const body = split
      ? "This file looks like a libretto plus a vocal score — choose how to split it."
      : `Found ${input.roleCount} characters and ${input.sceneCount} scenes — review and apply.`;
    const prefs = await getPreferencesForUsers([input.userId]);

    if (prefs[input.userId]?.inApp ?? true) {
      await db.insert(notifications).values({
        recipientId: input.userId,
        organizationId: prod.organizationId,
        type: "script_analysis",
        title,
        body,
        link,
      });
    }

    if (prefs[input.userId]?.push) {
      await sendPushToUsers([input.userId], {
        title,
        body,
        url: link,
        tag: `script-parse-${input.productionId}`,
      });
    }
  } catch (err) {
    console.error("Failed to send script-parse-ready notification:", err);
  }
}

/**
 * Tell someone who ALREADY has a Proscene account that they've been added to a
 * new organization. Brand-new invitees get a Supabase invite email (with a
 * set-password link) instead, so this only fires for existing accounts — which
 * `inviteMembers` would otherwise add silently. Delivered in-app (scoped to the
 * new org so it surfaces in that workspace's switcher bubble) and via email,
 * both respecting the user's preferences. Best-effort: a failure here must
 * never fail the invite.
 */
export async function sendOrgInviteNotification(input: {
  userId: string;
  email: string;
  organizationId: string;
  organizationName: string;
  invitedByName: string;
}): Promise<void> {
  try {
    const prefs = await getPreferencesForUsers([input.userId]);
    const link = "/dashboard";
    const title = `You've been added to ${input.organizationName}`;
    const body = `${input.invitedByName} added you to ${input.organizationName} on Proscene.`;

    if (prefs[input.userId]?.inApp ?? true) {
      await db.insert(notifications).values({
        recipientId: input.userId,
        organizationId: input.organizationId,
        type: "org_invite",
        title,
        body,
        link,
      });
    }

    if (prefs[input.userId]?.email && input.email) {
      await sendOrgInviteEmail({
        to: input.email,
        title,
        organizationName: input.organizationName,
        invitedByName: input.invitedByName,
        link,
      });
    }

    if (prefs[input.userId]?.push) {
      await sendPushToUsers([input.userId], {
        title,
        body,
        url: link,
        tag: `org-invite-${input.organizationId}`,
      });
    }
  } catch (err) {
    console.error("Failed to send org-invite notification:", err);
  }
}

async function sendOrgInviteEmail(p: {
  to: string;
  title: string;
  organizationName: string;
  invitedByName: string;
  link: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const url = `${siteUrl}${p.link}`;

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    <p style="font-size: 13px; color: #6b7280; margin: 0 0 6px;">Proscene</p>
    <h1 style="font-size: 20px; margin: 0 0 8px;">${escapeHtml(p.title)}</h1>
    <p style="font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(p.invitedByName)} added you to <strong>${escapeHtml(p.organizationName)}</strong>. Sign in with your existing Proscene account to get started — no new account needed.</p>
    <a href="${url}" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 14px;">Open Proscene</a>
    <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0;">You're receiving this because you already have a Proscene account. Manage how you get alerts in Settings → Notifications.</p>
  </div>`;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: [p.to],
      subject: p.title,
      html,
    });
  } catch (err) {
    console.error("Failed to send org-invite email:", err);
  }
}

async function sendAnnouncementEmails(
  recipients: AnnouncementAudienceMember[],
  input: FanoutInput,
  link: string,
  scopeLabel: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const url = `${siteUrl}${link}`;
  const snippet = snippetFromHtml(input.body);
  const html = announcementEmailHtml({
    title: input.title,
    authorName: input.authorName,
    scopeLabel,
    snippet,
    url,
  });
  const subject = `New announcement: ${input.title}`;

  const resend = new Resend(apiKey);

  // Resend caps batch sends at 100 messages; chunk to stay under it. One
  // message per recipient keeps the audience list private.
  const CHUNK = 100;
  try {
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      await resend.batch.send(
        chunk.map((r) => ({
          from,
          to: [r.email],
          subject,
          html,
        })),
      );
    }
  } catch (err) {
    // Best-effort: never fail announcement creation because email failed.
    console.error("Failed to send announcement emails:", err);
  }
}

function announcementEmailHtml(p: {
  title: string;
  authorName: string;
  scopeLabel: string;
  snippet: string;
  url: string;
}): string {
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    <p style="font-size: 13px; color: #6b7280; margin: 0 0 6px;">New announcement · ${escapeHtml(p.scopeLabel)}</p>
    <h1 style="font-size: 20px; margin: 0 0 8px;">${escapeHtml(p.title)}</h1>
    <p style="font-size: 13px; color: #6b7280; margin: 0 0 16px;">Posted by ${escapeHtml(p.authorName)}</p>
    ${p.snippet ? `<p style="font-size: 15px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(p.snippet)}</p>` : ""}
    <a href="${p.url}" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 14px;">View announcement</a>
    <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0;">You're receiving this because you're a member. Manage how you get alerts in Settings → Notifications.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
