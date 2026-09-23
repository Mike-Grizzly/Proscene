"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shown while the server renders a readable copy of a scan the in-app viewer
 * can't draw (about a minute for a full script). Polls until the copy takes
 * over as the active script, then the page re-renders with it.
 */
export function PreparingReadable({ title }: { title: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <div className="anim-in" style={{ maxWidth: 520, margin: "40px auto 0" }}>
      <EmptyState
        icon="FileText"
        title="Preparing a readable copy of this scan…"
        hint={`"${title}" is a scanned PDF the editor can't draw directly. A readable copy is being made in the background (about a minute for a full script). This page will update on its own.`}
      />
    </div>
  );
}
