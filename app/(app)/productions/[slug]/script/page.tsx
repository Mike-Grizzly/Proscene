import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProductionBySlug } from "@/features/productions/queries";
import { getProductionMembership } from "@/features/members/queries";
import {
  getActiveScript,
  getScriptDocuments,
  getScriptAnnotations,
} from "@/features/scripts/queries";
import { getScriptUrl, ensureMemberBookmarks } from "@/features/scripts/actions";
import type { Annotation, Bookmark, PageOverrides } from "@/features/scripts/constants";
import { ScriptScreen } from "./script-screen";
import { EmptyState } from "@/components/ui/empty-state";
import { PreparingReadable } from "./preparing-readable";

export default async function ScriptPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireCurrentUser();
  const production = await getProductionBySlug(user.organizationId, slug);

  if (!production) notFound();

  const canManage = can(user.role, "productions:manage");
  if (!canManage) {
    const membership = await getProductionMembership(user.id, production.id);
    if (!membership) redirect("/productions");
  }

  // The member's own choice of script (libretto vs vocal score), else the
  // production default. The list feeds the viewer's switcher.
  const [script, scripts] = await Promise.all([
    getActiveScript(production.id, user.id),
    getScriptDocuments(production.id),
  ]);

  if (!script) {
    return (
      <div className="anim-in" style={{ maxWidth: 520, margin: "40px auto 0" }}>
        <EmptyState
          icon="FileText"
          title="No script uploaded yet"
          hint="A director or stage manager can upload a script in the Documents tab and set it as the default."
        />
      </div>
    );
  }

  // A readable copy of this scan is being rendered server-side; it takes
  // over as the active script once installed.
  if (script.renderStatus === "pending") {
    return <PreparingReadable title={script.title} />;
  }

  const [annotationRow, pdfUrl] = await Promise.all([
    getScriptAnnotations(script.id, user.id),
    getScriptUrl(script.storagePath),
  ]);

  const annotations = (annotationRow?.annotations ?? []) as Annotation[];
  let bookmarks = (annotationRow?.bookmarks ?? []) as Bookmark[];
  // Late-joiner seeding: members who joined after the AI breakdown was applied
  // have no AI bookmarks yet. Seed them on first open (only when a breakdown was
  // actually applied, and only if they don't already have the AI set).
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
    <ScriptScreen
      // Remount on switch: the viewer seeds its annotation state from props
      // once, so a swap without a remount would save to the wrong script.
      key={script.id}
      script={script}
      productionId={production.id}
      pdfUrl={pdfUrl}
      initialAnnotations={annotations}
      initialBookmarks={bookmarks}
      initialPageOverrides={pageOverrides}
      initialHasStalePages={hasStalePages}
      slug={slug}
      canManage={can(user.role, "documents:upload")}
      scripts={scripts}
      activeScriptId={script.id}
    />
  );
}
