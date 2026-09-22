import { notFound, redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProductionBySlug } from "@/features/productions/queries";
import { getProductionMembership } from "@/features/members/queries";
import {
  getLatestScriptParse,
  getProductionParseUsage,
  getScriptParseTargets,
} from "@/features/scripts/queries";
import { AiReviewClient } from "./ai-review-client";

// Splitting a combined book (download + pdf-lib + two uploads) runs as a
// server action on this page and can take a minute on a large scan.
export const maxDuration = 300;

export default async function ScriptAiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { slug } = await params;
  const { doc } = await searchParams;
  const user = await requireCurrentUser();
  const production = await getProductionBySlug(user.organizationId, slug);
  if (!production) notFound();

  // Setting up the cast/scene template is a manage-the-script action.
  if (!can(user.role, "documents:upload")) {
    redirect(`/productions/${slug}/script`);
  }
  if (!can(user.role, "productions:manage")) {
    const membership = await getProductionMembership(user.id, production.id);
    if (!membership) redirect("/productions");
  }

  const [parse, usage, targets] = await Promise.all([
    getLatestScriptParse(production.id, doc || undefined),
    getProductionParseUsage(production.id),
    getScriptParseTargets(production.id),
  ]);
  const activeDocumentId = doc || parse?.documentId || null;

  return (
    <AiReviewClient
      key={activeDocumentId ?? "latest"}
      slug={slug}
      productionId={production.id}
      initialParse={parse}
      usage={usage}
      targets={targets}
      activeDocumentId={activeDocumentId}
    />
  );
}
