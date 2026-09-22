import { randomUUID } from "crypto";
import { after } from "next/server";
import { db } from "@/db";
import { scriptParses } from "@/db/schema";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getCurrentUser, userCanAccessProduction } from "@/lib/auth";
import { runScriptParse } from "@/features/scripts/parse";
import { DEAD_HEARTBEAT_MS, LEASE_MS } from "@/features/scripts/constants";

// PDF parsing + model calls take a while; run on Node with generous headroom.
// The work itself happens in `after()` so the request returns immediately and
// the parse survives the client navigating away. A long book needs more than
// one invocation: each one takes the row's LEASE, processes chunks until its
// time budget is spent, releases the lease, and kicks this route again (the
// review page's poll re-kicks too). The lease is what makes a double-kick safe.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Server self-kick / cron-style caller: `Authorization: Bearer <CRON_SECRET>`. */
function isInternalCall(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Where the worker should POST to kick itself again. Prefer the canonical
 * site URL (the same env the auth/invite flows use) or Vercel's deployment
 * URL over the request's Host header, so a spoofed Host can never point the
 * secret-bearing self-kick at another origin. Request origin is the local-dev
 * fallback only.
 */
function selfOrigin(req: Request): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV !== "production") return new URL(req.url).origin;
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ parseId: string }> },
) {
  const { parseId } = await params;

  const [parse] = await db
    .select({
      productionId: scriptParses.productionId,
      requestedBy: scriptParses.requestedBy,
      status: scriptParses.status,
    })
    .from(scriptParses)
    .where(eq(scriptParses.id, parseId))
    .limit(1);

  if (!parse) return new Response("Not found", { status: 404 });

  if (!isInternalCall(req)) {
    const user = await getCurrentUser();
    if (!user) return new Response("Unauthorized", { status: 401 });
    // Production-scoped parse: gate on production access. Wizard parse (no
    // production yet): gate on ownership.
    const authorized = parse.productionId
      ? await userCanAccessProduction(user, parse.productionId)
      : parse.requestedBy === user.id;
    if (!authorized) return new Response("Forbidden", { status: 403 });
  }

  // Only a staged / resumable parse can be kicked.
  if (parse.status !== "processing") {
    return new Response("Already processed", { status: 409 });
  }

  // Acquire the lease in ONE conditional update: free, expired, or held by an
  // invocation whose heartbeat (updated_at) has gone quiet. Losing the race
  // is not an error — someone else is doing the work.
  const leaseToken = randomUUID();
  const now = new Date();
  const acquired = await db
    .update(scriptParses)
    .set({
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(scriptParses.id, parseId),
        eq(scriptParses.status, "processing"),
        or(
          isNull(scriptParses.leaseExpiresAt),
          lt(scriptParses.leaseExpiresAt, now),
          lt(
            scriptParses.updatedAt,
            sql`now() - make_interval(secs => ${DEAD_HEARTBEAT_MS / 1000})`,
          ),
        ),
      ),
    )
    .returning({ id: scriptParses.id });

  if (acquired.length === 0) {
    return Response.json({ running: true }, { status: 202 });
  }

  after(() => runScriptParse(parseId, leaseToken, selfOrigin(req)));
  return Response.json({ started: true }, { status: 202 });
}
