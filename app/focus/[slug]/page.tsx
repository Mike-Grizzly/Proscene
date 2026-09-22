import { notFound, redirect } from "next/navigation";
import { requireCurrentUser, isDesignerOnly } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getProductionBySlug,
  getVisibleProductions,
} from "@/features/productions/queries";
import {
  getProductionMembership,
  getProductionMembers,
} from "@/features/members/queries";
import {
  getActiveScript,
  getScriptDocuments,
  getScriptAnnotations,
  getLatestScriptParse,
  getProductionParseUsage,
  getScriptParseTargets,
} from "@/features/scripts/queries";
import { getScriptUrl, ensureMemberBookmarks } from "@/features/scripts/actions";
import {
  getStageConfiguration,
  getCastMembers,
  getBlockingPositionsForBeat,
  getCustomSetPieces,
  getArrowsForBeat,
} from "@/features/blocking/queries";
import { getScenesWithBeats } from "@/features/scenes/queries";
import { ensureFirstSceneAndBeat } from "@/features/scenes/actions";
import {
  getDocumentById,
  getDocumentsByProduction,
} from "@/features/documents/queries";
import { getDocumentUrl } from "@/features/documents/actions";
import {
  getCustomSetPieceUrls,
  getGroundPlanImageUrl,
} from "@/features/blocking/actions";
import type {
  Annotation,
  Bookmark,
  PageOverrides,
} from "@/features/scripts/constants";
import { BlockingCanvas } from "@/app/(app)/productions/[slug]/blocking/blocking-canvas";
import { SetupWizard } from "@/app/(app)/productions/[slug]/blocking/setup/setup-wizard";
import { AiReviewClient } from "@/app/(app)/productions/[slug]/script/ai/ai-review-client";
import { FocusShell } from "./focus-shell";
import { FocusScriptHost } from "./focus-script-host";
import { FocusScriptUpload } from "./focus-script-upload";
import { FocusDocUpload } from "./focus-doc-upload";
import { getDesignerSeat } from "@/features/designer/entitlement";
import type { DesignerTool } from "@/features/designer/constants";
import { DesignerToolLock } from "@/features/designer/tool-lock";

// Splitting a combined book runs as a server action from the embedded AI view.
export const maxDuration = 300;

type CurrentUserLike = {
  firstName: string | null;
  lastName: string | null;
  email: string;
};

function userInitials(user: CurrentUserLike): string {
  const a = user.firstName?.trim()?.[0] ?? "";
  const b = user.lastName?.trim()?.[0] ?? "";
  const combined = `${a}${b}`.toUpperCase();
  return combined || user.email.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Full-screen Focus View route. Lives OUTSIDE the `(app)` group on purpose so it
 * escapes the app rail AND the production topbar/tabs — the whole point of focus
 * mode. Auth + production access mirror the script page; data fetching is reused
 * verbatim so the embedded ScriptViewer behaves exactly as on its own tab.
 */
export default async function FocusPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ mode?: string; beat?: string; view?: string; doc?: string }>;
}) {
  const { slug } = await params;
  const {
    mode: modeParam,
    beat: requestedBeatId,
    view,
    doc: requestedDocId,
  } = await searchParams;
  const mode = modeParam === "blocking" ? "blocking" : "script";

  const user = await requireCurrentUser();
  const production = await getProductionBySlug(user.organizationId, slug);
  if (!production) notFound();

  const canManage = can(user.role, "productions:manage");
  if (!canManage) {
    const membership = await getProductionMembership(user.id, production.id);
    if (!membership) redirect("/productions");
  }

  // Projects the user can switch between from inside Focus (their only
  // navigation when they're a designer-only subscriber).
  const visible = await getVisibleProductions(user);
  const shellProps = {
    slug,
    showTitle: production.title,
    orgName: user.organizationName,
    posterInitial: production.title.trim().charAt(0).toUpperCase() || "•",
    userInitials: userInitials(user),
    designerOnly: isDesignerOnly(user),
    userName:
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.email,
    canCreateProjects: can(user.role, "productions:manage"),
    projects: visible.map((p) => ({ slug: p.slug, title: p.title })),
  };

  // Studio (designer-seat) tool gate: a designer-only user can only open a tool
  // their plan includes (Single Tool has just one). If they open the tool their
  // seat lacks, show it LOCKED behind an upgrade modal — staying on the
  // requested mode so the toggle reflects the switch. With no active seat at
  // all, it's a read-only "choose a plan" prompt. Full users (who use Focus as
  // an optional toggle) are governed by org billing and skip this.
  if (isDesignerOnly(user)) {
    const seat = await getDesignerSeat(user.id);
    const wantTool: DesignerTool = mode === "blocking" ? "blocking" : "script";
    if (!seat.tools.includes(wantTool)) {
      if (seat.hasSeat) {
        return (
          <FocusShell {...shellProps} mode={wantTool}>
            <DesignerToolLock tool={wantTool} slug={slug} />
          </FocusShell>
        );
      }
      return (
        <FocusShell {...shellProps} mode="script">
          <div className="fx-soon" style={{ height: "100vh" }}>
            <p>Your Studio workspace is read-only.</p>
            <a href={`/focus/${slug}/settings`}>Choose a plan to start editing →</a>
          </div>
        </FocusShell>
      );
    }
  }

  // Blocking focus: the same Blocking tool, embedded chrome-free in the focus
  // shell. Data fetching mirrors the Blocking page so the canvas behaves
  // identically.
  if (mode === "blocking") {
    if (!can(user.role, "blocking:view")) {
      redirect(`/productions/${slug}`);
    }

    const [
      stageConfig,
      scenesWithBeatsInitial,
      castMembers,
      productionMembers,
      customPieceRows,
    ] = await Promise.all([
      getStageConfiguration(production.id),
      getScenesWithBeats(production.id),
      getCastMembers(production.id),
      getProductionMembers(production.id),
      getCustomSetPieces(production.id),
    ]);

    // No stage config yet, or the user opened Stage Setup to (re)configure:
    // editors set it up right here in focus. Viewers fall through to the canvas.
    if ((view === "setup" || !stageConfig) && can(user.role, "blocking:edit")) {
      const allDocuments = await getDocumentsByProduction(production.id);
      const pdfDocuments = allDocuments.filter(
        (d) => d.contentType === "application/pdf",
      );
      return (
        <FocusShell {...shellProps} mode="blocking">
          <div className="fx-setup">
            <div className="fx-setup-inner">
              <h1>Stage setup</h1>
              <p>
                Upload a ground plan PDF (or pick one you&apos;ve added), then
                define the stage dimensions for {production.title}.
              </p>
              <div className="fx-setup-upload">
                <FocusDocUpload
                  productionId={production.id}
                  documentType="ground_plan"
                  label="Upload ground plan PDF"
                />
              </div>
              <SetupWizard
                productionId={production.id}
                productionSlug={slug}
                pdfDocuments={pdfDocuments}
                existingConfig={stageConfig}
                returnTo={`/focus/${slug}?mode=blocking`}
              />
            </div>
          </div>
        </FocusShell>
      );
    }

    // Seed a default Scene 1 / Beat 1 so editors land on an editable canvas.
    let scenesWithBeats = scenesWithBeatsInitial;
    const noBeats = scenesWithBeats.every((s) => s.beats.length === 0);
    if (noBeats && can(user.role, "blocking:edit")) {
      await ensureFirstSceneAndBeat(production.id);
      scenesWithBeats = await getScenesWithBeats(production.id);
    }

    let groundPlanImageUrl: string | null = null;
    let blockingPdfUrl: string | null = null;
    if (stageConfig?.groundPlanImagePath) {
      groundPlanImageUrl = await getGroundPlanImageUrl(stageConfig.groundPlanImagePath);
    }
    if (stageConfig?.groundPlanDocumentId) {
      const doc = await getDocumentById(stageConfig.groundPlanDocumentId);
      if (doc) blockingPdfUrl = await getDocumentUrl(doc.id);
    }

    const signedUrls = await getCustomSetPieceUrls(production.id);
    const initialCustomSetPieces = customPieceRows.map((p) => ({
      id: p.id,
      name: p.name,
      storagePath: p.storagePath,
      fileType: p.fileType,
      imageUrl: signedUrls[p.storagePath] ?? "",
    }));

    const allBeats = scenesWithBeats.flatMap((s) => s.beats);
    const targetBeatId =
      (requestedBeatId && allBeats.some((b) => b.id === requestedBeatId)
        ? requestedBeatId
        : null) ??
      allBeats[0]?.id ??
      null;
    const [initialPositions, initialArrows] = targetBeatId
      ? await Promise.all([
          getBlockingPositionsForBeat(targetBeatId),
          getArrowsForBeat(targetBeatId),
        ])
      : [[], []];

    return (
      <FocusShell {...shellProps} mode="blocking">
        <BlockingCanvas
          production={{ id: production.id, title: production.title, slug }}
          stageConfig={stageConfig}
          scenesWithBeats={scenesWithBeats}
          castMembers={castMembers}
          productionMembers={productionMembers}
          pdfUrl={blockingPdfUrl}
          groundPlanImageUrl={groundPlanImageUrl}
          canEdit={can(user.role, "blocking:edit")}
          currentUserId={user.id}
          initialBeatId={targetBeatId}
          initialPositions={initialPositions}
          initialArrows={initialArrows}
          initialCustomSetPieces={initialCustomSetPieces}
          embedded
        />
      </FocusShell>
    );
  }

  // AI script setup, embedded in focus so designers never leave for /script/ai.
  if (view === "ai" && can(user.role, "documents:upload")) {
    const [parse, usage, targets] = await Promise.all([
      getLatestScriptParse(production.id, requestedDocId || undefined),
      getProductionParseUsage(production.id),
      getScriptParseTargets(production.id),
    ]);
    const activeDocumentId = requestedDocId || parse?.documentId || null;
    return (
      <FocusShell {...shellProps} mode="script">
        <div className="fx-ai">
          <AiReviewClient
            key={activeDocumentId ?? "latest"}
            slug={slug}
            productionId={production.id}
            initialParse={parse}
            usage={usage}
            inFocus
            targets={targets}
            activeDocumentId={activeDocumentId}
          />
        </div>
      </FocusShell>
    );
  }

  // The member's own choice of script (libretto vs vocal score), else the
  // production default. The list feeds the viewer's switcher.
  const [script, scripts] = await Promise.all([
    getActiveScript(production.id, user.id),
    getScriptDocuments(production.id),
  ]);
  if (!script) {
    return (
      <FocusShell {...shellProps} mode="script">
        {can(user.role, "documents:upload") ? (
          <FocusScriptUpload productionId={production.id} slug={slug} />
        ) : (
          <div className="fx-soon">
            <p>No script uploaded yet.</p>
            <a href={`/productions/${slug}/documents`}>
              Ask an editor to upload one and set it as the default →
            </a>
          </div>
        )}
      </FocusShell>
    );
  }

  const [annotationRow, pdfUrl] = await Promise.all([
    getScriptAnnotations(script.id, user.id),
    getScriptUrl(script.storagePath),
  ]);

  const annotations = (annotationRow?.annotations ?? []) as Annotation[];
  let bookmarks = (annotationRow?.bookmarks ?? []) as Bookmark[];
  if (
    script.processingStatus === "applied" &&
    !bookmarks.some((b) => b.id?.startsWith("ai-"))
  ) {
    const seeded = await ensureMemberBookmarks(script.id, production.id);
    if (seeded) bookmarks = seeded;
  }
  const pageOverrides = (annotationRow?.pageOverrides ?? {}) as PageOverrides;
  const hasStalePages = annotationRow?.hasStalePages ?? false;

  return (
    <FocusScriptHost
      // Remount on switch: the viewer seeds its annotation state from props
      // once, so a swap without a remount would save to the wrong script.
      key={script.id}
      shell={shellProps}
      script={{
        script,
        productionId: production.id,
        pdfUrl,
        initialAnnotations: annotations,
        initialBookmarks: bookmarks,
        initialPageOverrides: pageOverrides,
        initialHasStalePages: hasStalePages,
        slug,
        canManage: can(user.role, "documents:upload"),
        scripts,
        activeScriptId: script.id,
      }}
    />
  );
}
