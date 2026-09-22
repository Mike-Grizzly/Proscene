"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  productions,
  productionDepartments,
  productionRoles,
  productionMemberships,
  organizationMemberships,
  organizations,
  profiles,
} from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  validateProductionForm,
  slugify,
  type ProductionFormErrors,
} from "./validation";
import {
  appRoleForTeamLabel,
  DEPT_KEYS,
  type FullProductionInput,
  type QuickProductionInput,
} from "./wizard-constants";
import { isValidProductionColor } from "./constants";
import { wizardDeptRows } from "./departments";
import { createDefaultFolders } from "@/features/documents/folders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/features/members/validation";
import {
  assertCanCreateProduction,
  startTrialIfFirstProduction,
  firstProductionTrialNotice,
} from "@/features/billing/guard";
import { closingDateBeyondCap, MAX_RUN_MONTHS, yearOutOfRange } from "./validation";

export type ProductionMutationResult = {
  error?: string;
  success?: boolean;
};

export type CreateProductionResult = {
  errors?: ProductionFormErrors;
  error?: string;
};

export async function createProduction(
  _prevState: CreateProductionResult | undefined,
  formData: FormData,
): Promise<CreateProductionResult> {
  const user = await requireCurrentUser();

  if (!can(user.role, "productions:manage")) {
    return { error: "You don't have permission to create productions." };
  }

  const { data, errors } = validateProductionForm(formData);

  if (errors) {
    return { errors };
  }

  const gate = await assertCanCreateProduction(user.organizationId);
  if (gate.error) return { error: gate.error };

  // Create the production and its default folders atomically so a folder
  // failure can't leave a production with no folders. The trial clock starts
  // after the transaction commits (it's an org-level side effect).
  await db.transaction(async (tx) => {
    const [newProduction] = await tx
      .insert(productions)
      .values({
        organizationId: user.organizationId,
        title: data!.title,
        slug: data!.slug,
        status: data!.status,
        color: data!.color,
        openingDate: data!.openingDate,
        closingDate: data!.closingDate,
      })
      .returning({ id: productions.id });

    await createDefaultFolders(newProduction.id, tx);
  });

  await startTrialIfFirstProduction(user.organizationId);

  redirect("/productions");
}

/**
 * Produce an org-unique slug from a title. Appends `-2`, `-3`, … on collision
 * so two shows with the same name don't clash. (We disambiguate in app code
 * rather than with a DB unique constraint — see CLAUDE.md known issues.)
 */
async function generateUniqueSlug(
  organizationId: string,
  title: string,
): Promise<string> {
  const base = slugify(title) || "production";
  let slug = base;
  let n = 2;
  while (true) {
    const [clash] = await db
      .select({ id: productions.id })
      .from(productions)
      .where(
        and(
          eq(productions.organizationId, organizationId),
          eq(productions.slug, slug),
        ),
      )
      .limit(1);
    if (!clash) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

const toDate = (value: string | undefined | null): string | null => {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
};

export type FullProductionResult = {
  error?: string;
  slug?: string;
  // Soft, non-blocking notice shown after launch (e.g. closing date runs past
  // the free trial). The production is still created.
  trialWarning?: string;
  summary?: {
    departments: number;
    roles: number;
    assigned: number;
    invited: number;
    skipped: { email: string; reason: string }[];
  };
};

/**
 * Create a production from the full setup wizard: the production row plus its
 * enabled departments, character/role list, and team. Existing org members are
 * assigned to the production directly; brand-new email addresses are invited
 * into the org (which requires `settings:manage`) and assigned. Anything that
 * can't be actioned is reported back in `summary.skipped` rather than failing
 * the whole launch.
 */
export async function createProductionFull(
  input: FullProductionInput,
): Promise<FullProductionResult> {
  const user = await requireCurrentUser();

  if (!can(user.role, "productions:manage")) {
    return { error: "You don't have permission to create productions." };
  }

  const title = (input.title ?? "").trim();
  if (!title) return { error: "A title is required." };
  if (title.length > 200) {
    return { error: "Title must be under 200 characters." };
  }

  const opening = toDate(input.opening);
  const closing = toDate(input.closing);
  for (const d of [
    opening,
    closing,
    toDate(input.firstRehearsal),
    toDate(input.techStart),
  ]) {
    if (yearOutOfRange(d)) {
      return { error: "Please enter realistic dates (check the year)." };
    }
  }
  if (opening && closing && opening > closing) {
    return { error: "Closing date cannot be before opening date." };
  }
  if (closingDateBeyondCap(opening, closing)) {
    return {
      error: `Closing date can't be more than ${MAX_RUN_MONTHS} months after opening.`,
    };
  }

  const gate = await assertCanCreateProduction(user.organizationId);
  if (gate.error) return { error: gate.error };

  const status = input.status === "draft" ? "draft" : "active";
  const slug = await generateUniqueSlug(user.organizationId, title);

  // Sanitize the rehearsal-day map to the known day keys.
  const rehearsalDays: Record<string, boolean> = {};
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    rehearsalDays[day] = Boolean(input.rehearsalDays?.[day]);
  }

  // Departments — map the wizard's selections onto the canonical catalog
  // (with labels + order) so they drive the board buckets and report sections.
  const enabledDepts = DEPT_KEYS.filter((key) => input.depts?.[key]);
  const deptRows = wizardDeptRows(enabledDepts);

  // Character / role list — only rows with a name.
  const roles = (input.roles ?? [])
    .map((r, i) => ({
      name: (r.name ?? "").trim(),
      actor: (r.actor ?? "").trim() || null,
      type: (r.type ?? "Principal").trim() || "Principal",
      sortOrder: i,
    }))
    .filter((r) => r.name.length > 0);

  // Create the production and its scaffold (departments, roles, default
  // folders) atomically, so a mid-setup failure can't leave a half-built
  // production. External side effects (trial start, team invites) run AFTER
  // the transaction commits — they can't take part in a DB rollback and
  // shouldn't hold the transaction open while making network calls.
  const productionId = await db.transaction(async (tx) => {
    const [newProduction] = await tx
      .insert(productions)
      .values({
        organizationId: user.organizationId,
        title,
        slug,
        status,
        venue: (input.venue ?? "").trim() || null,
        season: (input.season ?? "").trim() || null,
        openingDate: opening,
        closingDate: closing,
        firstRehearsalDate: toDate(input.firstRehearsal),
        techStartDate: toDate(input.techStart),
        rehearsalDays,
        rehearsalStart: (input.rehearsalStart ?? "").trim() || null,
        rehearsalEnd: (input.rehearsalEnd ?? "").trim() || null,
        color: isValidProductionColor(input.color) ? input.color : null,
      })
      .returning({ id: productions.id });

    const pid = newProduction.id;

    if (deptRows.length > 0) {
      await tx
        .insert(productionDepartments)
        .values(deptRows.map((r) => ({ productionId: pid, ...r })));
    }
    if (roles.length > 0) {
      await tx
        .insert(productionRoles)
        .values(roles.map((r) => ({ productionId: pid, ...r })));
    }
    await createDefaultFolders(pid, tx);

    return pid;
  });

  // Post-commit side effects (non-transactional): start the trial clock, then
  // apply the wizard's team (the latter makes external Supabase Admin calls).
  const trialJustStarted = await startTrialIfFirstProduction(
    user.organizationId,
  );
  const trialWarning = trialJustStarted
    ? (await firstProductionTrialNotice(user.organizationId, closing)) ??
      undefined
    : undefined;

  const teamResult = await applyWizardTeam({
    team: input.team ?? [],
    productionId,
    organizationId: user.organizationId,
    canInviteNew: can(user.role, "settings:manage"),
    invitedByName:
      `${user.firstName} ${user.lastName}`.trim() || user.email,
  });

  revalidatePath("/", "layout");
  revalidatePath("/productions");
  revalidatePath("/people");

  return {
    slug,
    trialWarning,
    summary: {
      departments: enabledDepts.length,
      roles: roles.length,
      assigned: teamResult.assigned,
      invited: teamResult.invited,
      skipped: teamResult.skipped,
    },
  };
}

type ApplyTeamArgs = {
  team: FullProductionInput["team"];
  productionId: string;
  organizationId: string;
  canInviteNew: boolean;
  invitedByName: string;
};

async function applyWizardTeam(args: ApplyTeamArgs): Promise<{
  assigned: number;
  invited: number;
  skipped: { email: string; reason: string }[];
}> {
  const { team, productionId, organizationId, canInviteNew, invitedByName } =
    args;

  let assigned = 0;
  let invited = 0;
  const skipped: { email: string; reason: string }[] = [];

  // Dedupe by email; ignore rows without a usable email.
  const seen = new Set<string>();
  const rows = team.filter((m) => {
    const key = (m.email ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (rows.length === 0) return { assigned, invited, skipped };

  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  const getAdmin = () => {
    if (!admin) admin = createSupabaseAdminClient();
    return admin;
  };

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const organizationName = org?.name ?? "your team";

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const redirectTo = siteUrl
    ? `${siteUrl}/auth/callback?next=/invite/accept`
    : undefined;

  // Ensure a single production membership for a user, mapped to a role.
  const ensureProductionMembership = async (userId: string, role: string) => {
    const existing = await db
      .select({ id: productionMemberships.id })
      .from(productionMemberships)
      .where(
        and(
          eq(productionMemberships.userId, userId),
          eq(productionMemberships.productionId, productionId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await db
        .insert(productionMemberships)
        .values({ userId, productionId, role });
    }
  };

  for (const member of rows) {
    const email = (member.email ?? "").trim();
    const name = (member.name ?? "").trim();
    if (!isValidEmail(email)) {
      skipped.push({ email: email || "(blank)", reason: "Invalid email." });
      continue;
    }
    const appRole = appRoleForTeamLabel(member.role);

    try {
      const existingProfile = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`)
        .limit(1);

      if (existingProfile.length > 0) {
        const userId = existingProfile[0].id;
        const orgMembership = await db
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.userId, userId),
              eq(organizationMemberships.organizationId, organizationId),
            ),
          )
          .limit(1);

        if (orgMembership.length === 0) {
          // Known person, but not yet in this org — adding them to the org is
          // a settings-level action.
          if (!canInviteNew) {
            skipped.push({
              email,
              reason: "Not in your organization yet — needs an admin to add.",
            });
            continue;
          }
          await db
            .insert(organizationMemberships)
            .values({ userId, organizationId, role: appRole });
        }

        await ensureProductionMembership(userId, appRole);
        assigned += 1;
        continue;
      }

      // Brand-new person — inviting into the org requires settings:manage.
      if (!canInviteNew) {
        skipped.push({
          email,
          reason: "New person — ask an admin to send the invite.",
        });
        continue;
      }

      const [firstName, ...rest] = name.split(" ");
      const lastName = rest.join(" ");
      const metadata = {
        first_name: firstName || "",
        last_name: lastName || "",
        invited_by_name: invitedByName,
        organization_name: organizationName,
      };

      const { data, error } = await getAdmin().auth.admin.inviteUserByEmail(
        email,
        { data: metadata, redirectTo },
      );

      if (error || !data.user) {
        skipped.push({
          email,
          reason: error?.message ?? "Could not send invite.",
        });
        continue;
      }

      const userId = data.user.id;
      await db.insert(profiles).values({
        id: userId,
        email,
        firstName: firstName || "",
        lastName: lastName || "",
        status: "invited",
      });
      await db
        .insert(organizationMemberships)
        .values({ userId, organizationId, role: appRole });
      await ensureProductionMembership(userId, appRole);
      invited += 1;
    } catch (err) {
      skipped.push({
        email,
        reason: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  return { assigned, invited, skipped };
}

/**
 * Quick add: spin up a draft production from just a title (and an optional
 * opening date). Everything else can be filled in later from the production's
 * own settings. Returns the slug so the caller can navigate to the new hub.
 */
export async function quickCreateProduction(
  input: QuickProductionInput,
): Promise<{ error?: string; slug?: string }> {
  const user = await requireCurrentUser();

  if (!can(user.role, "productions:manage")) {
    return { error: "You don't have permission to create productions." };
  }

  const title = (input.title ?? "").trim();
  if (!title) return { error: "A show name is required." };
  if (title.length > 200) {
    return { error: "Title must be under 200 characters." };
  }

  const gate = await assertCanCreateProduction(user.organizationId);
  if (gate.error) return { error: gate.error };

  const slug = await generateUniqueSlug(user.organizationId, title);

  // Create the production and its default folders atomically; start the trial
  // clock after commit (an org-level side effect, not part of the scaffold).
  await db.transaction(async (tx) => {
    const [newProduction] = await tx
      .insert(productions)
      .values({
        organizationId: user.organizationId,
        title,
        slug,
        status: "draft",
        openingDate: toDate(input.opening),
      })
      .returning({ id: productions.id });

    await createDefaultFolders(newProduction.id, tx);
  });

  await startTrialIfFirstProduction(user.organizationId);

  revalidatePath("/", "layout");
  revalidatePath("/productions");

  return { slug };
}

/**
 * Soft-archive a production. Hides it from the workspace's default
 * lists and from the rail, but preserves all downstream records
 * (reports, calls, blocking, documents) so it can be restored intact.
 *
 * Org-scoped: we only touch productions in the caller's current
 * workspace, so a stale id from a different org is a no-op.
 */
export async function archiveProduction(
  productionId: string,
): Promise<ProductionMutationResult> {
  const user = await requireCurrentUser();

  if (!can(user.role, "productions:manage")) {
    return { error: "You don't have permission to archive productions." };
  }
  if (!productionId) return { error: "Missing production." };

  const result = await db
    .update(productions)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(productions.id, productionId),
        eq(productions.organizationId, user.organizationId),
      ),
    )
    .returning({ id: productions.id });

  if (result.length === 0) {
    return { error: "Production not found in this workspace." };
  }

  revalidatePath("/", "layout");
  return { success: true };
}

export async function unarchiveProduction(
  productionId: string,
): Promise<ProductionMutationResult> {
  const user = await requireCurrentUser();

  if (!can(user.role, "productions:manage")) {
    return { error: "You don't have permission to restore productions." };
  }
  if (!productionId) return { error: "Missing production." };

  const result = await db
    .update(productions)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(productions.id, productionId),
        eq(productions.organizationId, user.organizationId),
      ),
    )
    .returning({ id: productions.id });

  if (result.length === 0) {
    return { error: "Production not found in this workspace." };
  }

  revalidatePath("/", "layout");
  return { success: true };
}

/**
 * Soft-delete ("trash") a production — distinct from archiving. Admin-only
 * (more destructive than archive). Sets `deletedAt`; the row drops out of
 * every list and access check but is restorable from the "Recently deleted"
 * view for 30 days. We never hard-delete here (downstream history is kept);
 * the eventual purge is a deferred, separately-built step.
 */
export async function deleteProduction(
  productionId: string,
): Promise<ProductionMutationResult> {
  const user = await requireCurrentUser();

  if (!can(user.role, "settings:manage")) {
    return { error: "Only workspace admins can delete productions." };
  }
  if (!productionId) return { error: "Missing production." };

  const result = await db
    .update(productions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(productions.id, productionId),
        eq(productions.organizationId, user.organizationId),
        isNull(productions.deletedAt),
      ),
    )
    .returning({ id: productions.id });

  if (result.length === 0) {
    return { error: "Production not found in this workspace." };
  }

  revalidatePath("/", "layout");
  return { success: true };
}

/** Restore a soft-deleted production from the "Recently deleted" view. */
export async function restoreDeletedProduction(
  productionId: string,
): Promise<ProductionMutationResult> {
  const user = await requireCurrentUser();

  if (!can(user.role, "settings:manage")) {
    return { error: "Only workspace admins can restore productions." };
  }
  if (!productionId) return { error: "Missing production." };

  const result = await db
    .update(productions)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(productions.id, productionId),
        eq(productions.organizationId, user.organizationId),
      ),
    )
    .returning({ id: productions.id });

  if (result.length === 0) {
    return { error: "Production not found in this workspace." };
  }

  revalidatePath("/", "layout");
  return { success: true };
}
