"use client";

import { useIsPhone } from "@/lib/use-is-phone";
import { ScriptViewer } from "./script-viewer";
import { MobileScriptReader } from "./mobile-script-reader";
import type { DefaultScript, ScriptDocumentOption } from "@/features/scripts/queries";
import type {
  Annotation,
  Bookmark,
  PageOverrides,
} from "@/features/scripts/constants";

type Props = {
  script: DefaultScript;
  productionId: string;
  pdfUrl: string;
  initialAnnotations: Annotation[];
  initialBookmarks: Bookmark[];
  initialPageOverrides: PageOverrides;
  initialHasStalePages: boolean;
  slug: string;
  canManage: boolean;
  /** All of the production's scripts, for the switcher (shown when > 1). */
  scripts?: ScriptDocumentOption[];
  activeScriptId?: string;
};

/**
 * Picks the desktop annotation viewer or the immersive mobile reader.
 * `useIsPhone` is backed by useSyncExternalStore, so this swaps safely after
 * hydration (same pattern as the calendar's phone views).
 */
export function ScriptScreen(props: Props) {
  const isPhone = useIsPhone();

  if (isPhone) {
    return (
      <MobileScriptReader
        scriptId={props.script.id}
        productionId={props.productionId}
        pdfUrl={props.pdfUrl}
        title={props.script.title}
        scripts={props.scripts}
        activeScriptId={props.activeScriptId}
        initialAnnotations={props.initialAnnotations}
        initialBookmarks={props.initialBookmarks}
        initialPageOverrides={props.initialPageOverrides}
      />
    );
  }

  return <ScriptViewer {...props} />;
}
