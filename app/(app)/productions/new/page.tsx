import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOrgUsersForWizard } from "@/features/productions/queries";
import NewProductionWizard from "./new-production-wizard";

// Attaching the wizard script may render a readable copy of a scan in the
// background (about a minute for a full book).
export const maxDuration = 300;

export default async function NewProductionPage() {
  const user = await requireCurrentUser();

  if (!can(user.role, "productions:manage")) {
    redirect("/productions");
  }

  const orgUsers = await getOrgUsersForWizard(user.organizationId);

  // Render full-screen (covering the app frame's own rail) so the setup flow
  // gets focused, single-rail chrome whether it's reached by link or refresh.
  return (
    <div className="np-overlay">
      <NewProductionWizard mode="page" orgUsers={orgUsers} />
    </div>
  );
}
