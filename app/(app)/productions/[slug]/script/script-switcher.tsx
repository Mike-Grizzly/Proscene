"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setMyActiveScript,
  setProductionDefaultScript,
} from "@/features/scripts/actions";
import { SCRIPT_KIND_LABELS, isScriptKind } from "@/features/scripts/constants";
import type { ScriptDocumentOption } from "@/features/scripts/queries";

/** "Libretto", "Vocal score", or the document's title; disambiguated when needed. */
export function scriptOptionLabel(
  doc: ScriptDocumentOption,
  all: ScriptDocumentOption[],
): string {
  if (!isScriptKind(doc.scriptKind)) return doc.title;
  const base = SCRIPT_KIND_LABELS[doc.scriptKind];
  const sameKind = all.filter((d) => d.scriptKind === doc.scriptKind).length;
  return sameKind > 1 ? `${base} — ${doc.title}` : base;
}

/**
 * Pick which of the production's scripts YOU are viewing (libretto vs vocal
 * score, or an older upload). The choice is per member; managers can also
 * promote the current one to the production default. Switching never bumps
 * the script version or flags anyone's annotations stale — every document
 * keeps its own.
 */
export function ScriptSwitcher({
  productionId,
  scripts,
  activeScriptId,
  canManage,
  compact = false,
}: {
  productionId: string;
  scripts: ScriptDocumentOption[];
  activeScriptId: string;
  canManage: boolean;
  /** Phone header: just the select, inheriting the surrounding text style. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const active = scripts.find((s) => s.id === activeScriptId) ?? null;

  function choose(documentId: string) {
    setError(null);
    const target = scripts.find((s) => s.id === documentId);
    if (!target || target.id === activeScriptId) return;
    startTransition(async () => {
      // Choosing the production default means "follow the default" from now on.
      const res = await setMyActiveScript(productionId, target.isDefaultScript ? null : target.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function makeDefault() {
    if (!active) return;
    setError(null);
    startTransition(async () => {
      const res = await setProductionDefaultScript(productionId, active.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      // We now match the default; drop our own override so we keep following it.
      await setMyActiveScript(productionId, null);
      router.refresh();
    });
  }

  const select = (
    <select
      value={activeScriptId}
      onChange={(e) => choose(e.target.value)}
      disabled={isPending}
      aria-label="Which script to view"
      title="Which script you're viewing (your choice only)"
      style={
        compact
          ? {
              font: "inherit",
              fontWeight: "inherit",
              color: "inherit",
              background: "transparent",
              border: "none",
              padding: 0,
              maxWidth: "100%",
            }
          : {
              fontSize: 12,
              height: 28,
              padding: "0 8px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-s)",
              background: "var(--bg-elev)",
              color: "var(--ink)",
              maxWidth: 220,
            }
      }
    >
      {scripts.map((s) => (
        <option key={s.id} value={s.id}>
          {scriptOptionLabel(s, scripts)}
          {s.isDefaultScript ? " · default" : ""}
        </option>
      ))}
    </select>
  );

  if (compact) return select;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {select}
      {canManage && active && !active.isDefaultScript && (
        <button
          type="button"
          className="btn ghost"
          onClick={makeDefault}
          disabled={isPending}
          style={{ fontSize: 12, height: 28 }}
          title="Everyone who hasn't picked a script of their own opens this one"
        >
          Make default
        </button>
      )}
      {error && (
        <span style={{ fontSize: 12, color: "var(--c-clay)" }}>{error}</span>
      )}
    </div>
  );
}
