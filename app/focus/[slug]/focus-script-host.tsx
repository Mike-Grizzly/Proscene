"use client";

import { useState } from "react";
import { FocusShell } from "./focus-shell";
import { ScriptViewer } from "@/app/(app)/productions/[slug]/script/script-viewer";
import type { DefaultScript, ScriptDocumentOption } from "@/features/scripts/queries";
import type {
  Annotation,
  Bookmark,
  PageOverrides,
} from "@/features/scripts/constants";

type ShellProps = {
  slug: string;
  showTitle: string;
  orgName: string;
  posterInitial: string;
  userInitials: string;
  designerOnly?: boolean;
  userName?: string;
  canCreateProjects?: boolean;
  projects?: { slug: string; title: string }[];
};

type ScriptProps = {
  script: DefaultScript;
  productionId: string;
  pdfUrl: string;
  initialAnnotations: Annotation[];
  initialBookmarks: Bookmark[];
  initialPageOverrides: PageOverrides;
  initialHasStalePages: boolean;
  slug: string;
  canManage: boolean;
  scripts?: ScriptDocumentOption[];
  activeScriptId?: string;
};

/**
 * Client host for Script focus mode: owns the "Margin view" toggle state and
 * threads it to both the top-bar switch (FocusShell) and the embedded
 * ScriptViewer (`focusMargin`). Kept client-side so the toggle is instant; the
 * server page passes the fetched script data straight through.
 */
export function FocusScriptHost({
  shell,
  script,
}: {
  shell: ShellProps;
  script: ScriptProps;
}) {
  const [marginView, setMarginView] = useState(true);

  return (
    <FocusShell
      {...shell}
      mode="script"
      marginView={marginView}
      onToggleMargin={() => setMarginView((v) => !v)}
    >
      <ScriptViewer {...script} focusMargin={marginView} />
    </FocusShell>
  );
}
