"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sparkles,
  Check,
  Plus,
  Trash2,
  AlertTriangle,
  ArrowLeft,
  Users,
  ListTree,
  Info,
  Bookmark as BookmarkIcon,
} from "lucide-react";
import {
  applyScriptParse,
  discardScriptParse,
  fetchLatestScriptParse,
  reparseWithNotes,
  startScriptParse,
  type SplitScriptResult,
} from "@/features/scripts/actions";
import { ROLE_TYPES } from "@/features/productions/wizard-constants";
import {
  SCRIPT_KIND_LABELS,
  isScriptKind,
  type ScriptParseResult,
  type ParsedRole,
  type ParsedScene,
  type ParsedBookmark,
  type ParseProgress,
} from "@/features/scripts/constants";
import { progressSummary } from "@/features/scripts/parse-utils";
import type { ScriptParseTarget } from "@/features/scripts/queries";
import { SplitProposal } from "./split-proposal";

type ParseRow = {
  id: string;
  documentId: string | null;
  status: string;
  result: unknown;
  error: string | null;
  progress?: unknown;
  pageCount?: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  documentTitle: string;
  documentScriptKind?: string | null;
  /** From the poll: the worker yielded and nothing has re-kicked it. */
  resumable?: boolean;
};

type RoleEdit = ParsedRole & { key: string };
type SceneEdit = ParsedScene & { key: string };
type BookmarkEdit = ParsedBookmark & { key: string };

let keySeq = 0;
const nextKey = () => `k${keySeq++}`;

type ParseUsage = {
  used: number;
  limit: number;
  remaining: number;
  windowDays: number;
};

// Navigation targets that must stay inside /focus when embedded there
// (designer-package users have no dashboard to return to).
function focusHrefs(slug: string, inFocus: boolean) {
  return {
    ai: inFocus ? `/focus/${slug}?mode=script&view=ai` : `/productions/${slug}/script/ai`,
    docs: inFocus ? `/focus/${slug}?mode=script` : `/productions/${slug}/documents`,
    script: inFocus ? `/focus/${slug}?mode=script` : `/productions/${slug}/script`,
    blocking: inFocus
      ? `/focus/${slug}?mode=blocking`
      : `/productions/${slug}/blocking`,
    members: inFocus ? `/focus/${slug}?mode=script` : `/productions/${slug}/members`,
  };
}

export function AiReviewClient({
  slug,
  productionId,
  initialParse,
  usage,
  inFocus = false,
  targets = [],
  activeDocumentId = null,
}: {
  slug: string;
  productionId: string;
  initialParse: ParseRow | null;
  usage: ParseUsage;
  /** Rendered inside the Focus View shell: keep all navigation within /focus. */
  inFocus?: boolean;
  /** Every script document with its latest analysis (a split book has two). */
  targets?: ScriptParseTarget[];
  /** Which script document this page is showing the analysis for. */
  activeDocumentId?: string | null;
}) {
  const router = useRouter();
  const { docs: docsHref, ai: aiHref } = focusHrefs(slug, inFocus);
  const [parse, setParse] = useState<ParseRow | null>(initialParse);
  const [splitDone, setSplitDone] = useState<SplitScriptResult | null>(null);
  const docHref = (documentId: string) => `${aiHref}${aiHref.includes("?") ? "&" : "?"}doc=${documentId}`;
  const activeTarget = targets.find((t) => t.documentId === (activeDocumentId ?? parse?.documentId)) ?? null;
  const scriptKind = parse?.documentScriptKind ?? activeTarget?.scriptKind ?? null;

  // Poll while the analysis is still running. A long book is processed across
  // several worker invocations; if one yielded and its self-kick was lost, the
  // poll re-kicks the run route (the row's lease makes a double-kick harmless).
  const pollingRef = useRef(false);
  useEffect(() => {
    if (parse?.status !== "processing") return;
    pollingRef.current = true;
    const documentId = parse?.documentId ?? activeDocumentId ?? null;
    const tick = async () => {
      const latest = (await fetchLatestScriptParse(productionId, documentId)) as ParseRow | null;
      if (!pollingRef.current) return;
      if (latest) {
        setParse(latest);
        if (latest.resumable && latest.status === "processing") {
          fetch(`/api/scripts/${latest.id}/run`, { method: "POST" }).catch(() => {});
        }
      }
    };
    const interval = setInterval(tick, 3000);
    return () => {
      pollingRef.current = false;
      clearInterval(interval);
    };
  }, [parse?.status, parse?.documentId, productionId, activeDocumentId]);

  return (
    <div className="anim-in" style={{ maxWidth: 820, margin: "0 auto", padding: "8px 0 64px" }}>
      <Link
        href={docsHref}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--ink-3)",
          textDecoration: "none",
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} /> Documents
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={20} style={{ color: "var(--accent)" }} />
          <h1
            style={{
              fontFamily: "var(--font-display, Newsreader), serif",
              fontSize: 26,
              margin: 0,
            }}
          >
            AI Script Setup
          </h1>
        </div>
        <ParseQuota usage={usage} />
      </div>
      <p style={{ color: "var(--ink-3)", fontSize: 14, margin: "0 0 12px" }}>
        Claude reads your script and proposes a cast list, scene breakdown, and
        bookmarks. Review and edit below — nothing is saved to the production
        until you apply it.
        {scriptKind === "vocal_score" && (
          <>
            {" "}
            For a vocal score it proposes musical-number bookmarks and any
            singing characters missing from the cast; applying never touches
            the libretto&apos;s scenes.
          </>
        )}
      </p>
      <div
        style={{
          display: "flex",
          gap: 9,
          alignItems: "flex-start",
          padding: "10px 12px",
          margin: "0 0 24px",
          borderRadius: 8,
          background: "var(--c-amber-soft)",
          border: "1px solid color-mix(in oklch, var(--c-amber) 35%, transparent)",
        }}
      >
        <Info size={15} style={{ color: "var(--c-amber)", flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: 0, lineHeight: 1.5 }}>
          Results vary with how a script is formatted. Modern scripts that clearly
          label songs and scene headings read best; older or lightly-formatted PDFs
          may need a tweak or two — songs are usually spot-on, scenes can blend in.
          Scanned or photographed scripts are read too, though their bookmark pages
          are approximate. Always give it a quick review, and use{" "}
          <strong>“Not quite right?”</strong> below to refine without re-uploading.
        </p>
      </div>

      {targets.length > 1 && (
        <ScriptPicker
          targets={targets}
          activeDocumentId={activeDocumentId ?? parse?.documentId ?? null}
          productionId={productionId}
          docHref={docHref}
        />
      )}

      {splitDone && (
        <SplitDone result={splitDone} docHref={docHref} slug={slug} inFocus={inFocus} />
      )}

      {!parse && !splitDone && <EmptyState slug={slug} inFocus={inFocus} />}
      {parse?.status === "processing" && (
        <Processing progress={parse.progress as ParseProgress | null | undefined} />
      )}
      {parse?.status === "split_suggested" && !splitDone && (
        <SplitProposal
          parseId={parse.id}
          documentTitle={parse.documentTitle}
          pageCount={
            parse.pageCount ?? (parse.progress as ParseProgress | null)?.pageCount ?? 0
          }
          proposal={(parse.progress as ParseProgress | null)?.detect?.proposal ?? null}
          sections={(parse.progress as ParseProgress | null)?.detect?.sections ?? []}
          onSplit={(res) => {
            if (res.parseId) {
              fetch(`/api/scripts/${res.parseId}/run`, { method: "POST" }).catch(() => {});
            }
            setSplitDone(res);
            setParse(null);
            router.refresh();
          }}
          onContinue={(id) => {
            fetch(`/api/scripts/${id}/run`, { method: "POST" }).catch(() => {});
            setParse((p) => (p ? { ...p, id, status: "processing", error: null } : p));
          }}
          onDiscarded={() => router.push(docsHref)}
        />
      )}
      {parse?.status === "split" && !splitDone && (
        <Card>
          <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>
            This book was split into a libretto and a vocal score. Pick one above to
            see its analysis.
          </p>
        </Card>
      )}
      {parse?.status === "failed" && (
        <Failed error={parse.error} slug={slug} inFocus={inFocus} />
      )}
      {parse?.status === "applied" && (
        <Applied
          slug={slug}
          inFocus={inFocus}
          parseId={parse.id}
          isScore={scriptKind === "vocal_score"}
          onReanalyze={(newId) =>
            setParse((p) =>
              p
                ? { ...p, id: newId, status: "processing", result: null, error: null }
                : p,
            )
          }
        />
      )}
      {parse?.status === "ready" && (
        <ReviewForm
          parseId={parse.id}
          result={parse.result as ScriptParseResult}
          slug={slug}
          inFocus={inFocus}
          isScore={scriptKind === "vocal_score"}
          onApplied={() => {
            // Designers (in focus) don't manage cast/scenes — once the parse is
            // applied, drop them straight back into the script editor instead of
            // the "assign actors" success screen.
            if (inFocus) {
              router.push(`/focus/${slug}?mode=script`);
            } else {
              setParse((p) => (p ? { ...p, status: "applied" } : p));
            }
          }}
          onDiscarded={() => router.push(docsHref)}
          onReanalyze={(newId) =>
            setParse((p) =>
              p
                ? { ...p, id: newId, status: "processing", result: null, error: null }
                : p,
            )
          }
        />
      )}

      {(parse?.inputTokens != null || parse?.outputTokens != null) && (
        <p
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            marginTop: 20,
            textAlign: "right",
          }}
        >
          {parse.inputTokens === 0 && parse.outputTokens === 0
            ? "Reused a previously verified breakdown of this script — no AI tokens used."
            : `Analysis used ${(parse.inputTokens ?? 0).toLocaleString()} input + ${(parse.outputTokens ?? 0).toLocaleString()} output tokens.`}
        </p>
      )}
    </div>
  );
}

/**
 * Small pill showing how many AI analyses remain for this production in the
 * rolling window, so directors aren't surprised when they hit the cap.
 */
function ParseQuota({ usage }: { usage: ParseUsage }) {
  const out = usage.remaining <= 0;
  const low = !out && usage.remaining <= 1;
  // Subtly tint the pill so it reads as a limited resource (accent normally,
  // escalating to amber when one's left and clay when used up).
  const tone = out ? "var(--c-clay)" : low ? "var(--c-amber)" : "var(--accent)";
  const fg = out ? "var(--c-clay)" : low ? "var(--c-amber)" : "var(--accent-ink)";
  return (
    <span
      title={`${usage.used} of ${usage.limit} AI analyses used in the last ${usage.windowDays} days`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        fontSize: 12,
        fontWeight: 600,
        color: fg,
        background: `color-mix(in oklch, ${tone} 12%, var(--bg-elev))`,
        border: `1px solid color-mix(in oklch, ${tone} 38%, transparent)`,
        borderRadius: 999,
        padding: "4px 11px",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Sparkles size={13} />
      {out
        ? `0 of ${usage.limit} analyses left`
        : `${usage.remaining} of ${usage.limit} analyses left`}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ slug, inFocus }: { slug: string; inFocus: boolean }) {
  const { docs: docsHref } = focusHrefs(slug, inFocus);
  return (
    <Card>
      <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 12px" }}>
        No analysis yet. Open a script in the Documents tab, use its menu, and
        choose <strong>Analyze with AI</strong>.
      </p>
      <Link href={docsHref} style={primaryLink}>
        Go to Documents
      </Link>
    </Card>
  );
}

function Processing({ progress }: { progress: ParseProgress | null | undefined }) {
  const summary = progressSummary(progress);
  let headline = "Analyzing your script…";
  let detail =
    "This usually takes a minute or two for a full script. You can leave this page — we'll send you a notification when it's ready to review.";
  if (summary?.phase === "detect") {
    headline = "Checking what's in this file…";
    detail = `Looking at all ${summary.pageCount} pages to see whether this is a libretto, a vocal score, or both bound together.`;
  } else if (summary && summary.total > 1) {
    headline = summary.currentRange
      ? `Analyzing pages ${summary.currentRange.startPage}–${summary.currentRange.endPage} of ${summary.pageCount}…`
      : "Finishing up…";
    detail = `${summary.done} of ${summary.total} parts done. Long books are read in parts and can take several minutes. You can leave this page — we'll notify you when it's ready.`;
  }
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          className="pdf-spinner"
          style={{ width: 22, height: 22, flexShrink: 0 }}
          aria-hidden
        />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{headline}</p>
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 0" }}>{detail}</p>
          {summary && summary.total > 1 && (
            <div
              aria-hidden
              style={{
                height: 4,
                borderRadius: 999,
                background: "var(--bg-muted)",
                marginTop: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.round((summary.done / summary.total) * 100)}%`,
                  background: "var(--accent)",
                  transition: "width .4s",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Which script's analysis this page shows, with the status of each. */
function ScriptPicker({
  targets,
  activeDocumentId,
  productionId,
  docHref,
}: {
  targets: ScriptParseTarget[];
  activeDocumentId: string | null;
  productionId: string;
  docHref: (documentId: string) => string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const anyLive = targets.some((t) => t.latestParse?.status === "processing");

  function analyse(documentId: string) {
    setError(null);
    const fd = new FormData();
    fd.set("document_id", documentId);
    fd.set("production_id", productionId);
    startTransition(async () => {
      const res = await startScriptParse(fd);
      if (res.error || !res.parseId) {
        setError(res.error ?? "Could not start analysis.");
        return;
      }
      fetch(`/api/scripts/${res.parseId}/run`, { method: "POST" }).catch(() => {});
      router.push(docHref(documentId));
      router.refresh();
    });
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {targets.map((t) => {
          const active = t.documentId === activeDocumentId;
          const label = isScriptKind(t.scriptKind) ? SCRIPT_KIND_LABELS[t.scriptKind] : t.title;
          const status = t.latestParse?.status ?? null;
          const canAnalyse = !status || status === "failed" || status === "split";
          return (
            <div
              key={t.documentId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px 6px 12px",
                borderRadius: 10,
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "color-mix(in oklch, var(--accent) 8%, var(--bg-elev))" : "var(--bg-elev)",
              }}
            >
              <Link
                href={docHref(t.documentId)}
                style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: "var(--ink)", textDecoration: "none" }}
                title={t.title}
              >
                {label}
              </Link>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {status === "applied"
                  ? "applied"
                  : status === "ready"
                    ? "ready to review"
                    : status === "processing"
                      ? "analysing…"
                      : status === "split_suggested"
                        ? "needs a decision"
                        : status === "failed"
                          ? "failed"
                          : "not analysed"}
              </span>
              {canAnalyse && (
                <button
                  type="button"
                  onClick={() => analyse(t.documentId)}
                  disabled={isPending || anyLive}
                  title={anyLive ? "Wait for the running analysis to finish" : "Analyse this script"}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "4px 9px",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    background: "transparent",
                    color: "var(--ink-2)",
                    cursor: anyLive ? "default" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Sparkles size={12} /> Analyse
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p style={{ color: "var(--c-clay)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
      )}
    </div>
  );
}

/** After a split: where the two new scripts went and what happens next. */
function SplitDone({
  result,
  docHref,
  slug,
  inFocus,
}: {
  result: SplitScriptResult;
  docHref: (documentId: string) => string;
  slug: string;
  inFocus: boolean;
}) {
  const { script: scriptHref } = focusHrefs(slug, inFocus);
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "color-mix(in oklch, var(--accent) 16%, transparent)",
            color: "var(--accent)",
          }}
        >
          <Check size={18} />
        </span>
        <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Split into two scripts</p>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 14px", lineHeight: 1.5 }}>
        The libretto is now the production&apos;s default script and the vocal score
        sits beside it — everyone can switch between them from the Script tab.
        {result.parseId
          ? " The libretto analysis has started; the vocal score can be analysed from the picker above once it finishes."
          : result.note
            ? ` No analysis was started: ${result.note}`
            : ""}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {result.librettoDocumentId && (
          <Link href={docHref(result.librettoDocumentId)} style={primaryLink}>
            {result.parseId ? "Follow the libretto analysis" : "Libretto"}
          </Link>
        )}
        <Link href={scriptHref} style={ghostLink}>
          Open script
        </Link>
      </div>
    </Card>
  );
}

function Failed({
  error,
  slug,
  inFocus,
}: {
  error: string | null;
  slug: string;
  inFocus: boolean;
}) {
  const { docs: docsHref } = focusHrefs(slug, inFocus);
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <AlertTriangle size={20} style={{ color: "var(--c-clay)", flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            Analysis didn&apos;t finish
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 14px" }}>
            {error ?? "Something went wrong while reading the script."}
          </p>
          <Link href={docsHref} style={primaryLink}>
            Back to Documents
          </Link>
        </div>
      </div>
    </Card>
  );
}

function Applied({
  slug,
  inFocus,
  parseId,
  isScore = false,
  onReanalyze,
}: {
  slug: string;
  inFocus: boolean;
  parseId: string;
  isScore?: boolean;
  onReanalyze: (newParseId: string) => void;
}) {
  const {
    script: scriptHref,
    blocking: blockingHref,
    members: membersHref,
  } = focusHrefs(slug, inFocus);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "color-mix(in oklch, var(--accent) 16%, transparent)",
              color: "var(--accent)",
            }}
          >
            <Check size={18} />
          </span>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Applied to your production
          </p>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 16px" }}>
          {isScore
            ? "Musical-number bookmarks have been added to the vocal score for everyone on the team, and any characters missing from the cast list were added."
            : "The cast list and scene breakdown are now set up, and bookmarks have been added to the script for everyone on the team."}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={membersHref} style={primaryLink}>
            Assign actors
          </Link>
          <Link href={scriptHref} style={ghostLink}>
            Open script
          </Link>
          <Link href={blockingHref} style={ghostLink}>
            Blocking
          </Link>
        </div>
      </Card>

      <ReanalyzeBox
        parseId={parseId}
        onReanalyze={onReanalyze}
        intro="Re-run the analysis on the same script — no need to re-upload. Applying again refreshes the cast, scenes, and AI bookmarks (your own bookmarks are kept)."
      />
    </div>
  );
}

/**
 * Re-run the analysis on the existing (already-uploaded) script with free-text
 * corrections. Used both while reviewing a fresh parse and after one has been
 * applied, so the AI page is a persistent home for refining the breakdown.
 */
function ReanalyzeBox({
  parseId,
  onReanalyze,
  intro,
}: {
  parseId: string;
  onReanalyze: (newParseId: string) => void;
  intro?: string;
}) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    setError(null);
    if (!notes.trim()) {
      setError("Add a note describing what to fix.");
      return;
    }
    startTransition(async () => {
      const res = await reparseWithNotes(parseId, notes.trim());
      if (res.error || !res.parseId) {
        setError(res.error ?? "Could not re-analyze.");
        return;
      }
      fetch(`/api/scripts/${res.parseId}/run`, { method: "POST" }).catch(() => {});
      onReanalyze(res.parseId);
    });
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles size={16} style={{ color: "var(--accent)" }} />
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Not quite right?</h2>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "6px 0 0" }}>
        {intro ??
          "Tell the AI what was wrong and re-run it — e.g. “songs are misnumbered after page 30, use the printed ‘No. X’ labels” or “page 45 isn’t a new scene.”"}
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What should the AI fix on the next pass?"
        rows={3}
        style={{ ...textInput, width: "100%", marginTop: 12, resize: "vertical", fontFamily: "inherit" }}
      />
      <button onClick={run} disabled={isPending || !notes.trim()} style={{ ...ghostBtn, marginTop: 10 }}>
        <Sparkles size={14} /> Re-analyze with notes
      </button>
      <p style={{ fontSize: 11, color: "var(--ink-3)", margin: "8px 0 0" }}>
        Re-running starts a fresh analysis (counts toward your limit).
      </p>
      {error && (
        <p style={{ color: "var(--c-clay)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
      )}
    </Card>
  );
}

function ReviewForm({
  parseId,
  result,
  slug,
  inFocus,
  isScore = false,
  onApplied,
  onDiscarded,
  onReanalyze,
}: {
  parseId: string;
  result: ScriptParseResult;
  slug: string;
  inFocus: boolean;
  /** Vocal score: add-only apply (bookmarks + missing roles; no scenes). */
  isScore?: boolean;
  onApplied: () => void;
  onDiscarded: () => void;
  onReanalyze: (newParseId: string) => void;
}) {
  const { script: scriptHref } = focusHrefs(slug, inFocus);
  const [roles, setRoles] = useState<RoleEdit[]>(
    (result?.roles ?? []).map((r) => ({ ...r, key: nextKey() })),
  );
  const [scenes, setScenes] = useState<SceneEdit[]>(
    (result?.scenes ?? []).map((s) => ({ ...s, key: nextKey() })),
  );
  const [bookmarks, setBookmarks] = useState<BookmarkEdit[]>(
    (result?.bookmarks ?? []).map((b) => ({ ...b, key: nextKey() })),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [isPending, startTransition] = useTransition();

  function apply() {
    setError(null);
    const payload: ScriptParseResult = {
      title: result?.title ?? "",
      roles: roles
        .map(({ name, type }) => ({ name: name.trim(), type }))
        .filter((r) => r.name.length > 0),
      scenes: isScore
        ? []
        : scenes
            .map(({ actNumber, sceneNumber, title }) => ({
              actNumber,
              sceneNumber,
              title: title.trim(),
            }))
            .filter((s) => s.title.length > 0),
      bookmarks: bookmarks.map(({ page, title, kind }) => ({
        page,
        title: title.trim(),
        kind,
      })),
    };
    startTransition(async () => {
      const res = await applyScriptParse(parseId, payload);
      if (res.error) setError(res.error);
      else onApplied();
    });
  }

  function discard() {
    setConfirmingDiscard(false);
    startTransition(async () => {
      await discardScriptParse(parseId);
      onDiscarded();
    });
  }

  const songs = bookmarks.filter((b) => b.kind === "song");
  const sceneMarks = bookmarks.filter((b) => b.kind === "scene");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Cast */}
      <Card>
        <SectionHeader
          icon={<Users size={16} />}
          title="Cast & characters"
          count={roles.length}
          hint={
            isScore
              ? "Singing characters found in the score. Only names not already in the cast list will be added."
              : "Set each character's prominence. You'll assign actors later."
          }
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {roles.map((r, i) => (
            <div key={r.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={r.name}
                onChange={(e) =>
                  setRoles((rs) =>
                    rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
                placeholder="Character name"
                style={{ ...textInput, flex: 1 }}
              />
              <select
                value={r.type}
                onChange={(e) =>
                  setRoles((rs) =>
                    rs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)),
                  )
                }
                style={{ ...textInput, width: 150 }}
              >
                {ROLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <RowDelete onClick={() => setRoles((rs) => rs.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <AddRow
          label="Add character"
          onClick={() =>
            setRoles((rs) => [...rs, { name: "", type: "Principal", key: nextKey() }])
          }
        />
      </Card>

      {/* Scenes (a vocal score never edits the scene list — the libretto owns it) */}
      {!isScore && (
      <Card>
        <SectionHeader
          icon={<ListTree size={16} />}
          title="Scene breakdown"
          count={scenes.length}
          hint="Acts and scenes for the blocking tool — add beats inside each later."
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {scenes.map((s, i) => (
            <div key={s.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <NumberField
                label="Act"
                value={s.actNumber}
                onChange={(v) =>
                  setScenes((ss) =>
                    ss.map((x, j) => (j === i ? { ...x, actNumber: v } : x)),
                  )
                }
              />
              <NumberField
                label="Sc"
                value={s.sceneNumber}
                onChange={(v) =>
                  setScenes((ss) =>
                    ss.map((x, j) => (j === i ? { ...x, sceneNumber: v } : x)),
                  )
                }
              />
              <input
                value={s.title}
                onChange={(e) =>
                  setScenes((ss) =>
                    ss.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                  )
                }
                placeholder="Scene title"
                style={{ ...textInput, flex: 1 }}
              />
              <RowDelete onClick={() => setScenes((ss) => ss.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <AddRow
          label="Add scene"
          onClick={() =>
            setScenes((ss) => [
              ...ss,
              {
                actNumber: ss.length ? ss[ss.length - 1].actNumber : 1,
                sceneNumber: (ss[ss.length - 1]?.sceneNumber ?? 0) + 1,
                title: "",
                key: nextKey(),
              },
            ])
          }
        />
      </Card>
      )}

      {/* Bookmarks */}
      <Card>
        <SectionHeader
          icon={<BookmarkIcon size={16} />}
          title="Bookmarks"
          count={bookmarks.length}
          hint={
            isScore
              ? "One jump point per musical number, added to everyone's copy of the score."
              : "Jump points added to everyone's script reader."
          }
        />
        {sceneMarks.length === 0 && songs.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 12 }}>
            No bookmarks were detected.
          </p>
        )}
        {sceneMarks.length > 0 && (
          <BookmarkGroup
            label="Scenes"
            items={bookmarks}
            kind="scene"
            setBookmarks={setBookmarks}
          />
        )}
        {songs.length > 0 && (
          <BookmarkGroup
            label="Musical numbers"
            items={bookmarks}
            kind="song"
            setBookmarks={setBookmarks}
          />
        )}
      </Card>

      {/* Re-analyze with corrections — same flow, runs on the existing file */}
      <ReanalyzeBox parseId={parseId} onReanalyze={onReanalyze} />

      {error && (
        <p style={{ color: "var(--c-clay)", fontSize: 13, margin: 0 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={apply} disabled={isPending} style={primaryBtn}>
          <Check size={15} /> {isScore ? "Add to production" : "Apply to production"}
        </button>
        <button
          onClick={() => setConfirmingDiscard(true)}
          disabled={isPending}
          style={ghostBtn}
        >
          Discard
        </button>
        <Link href={scriptHref} style={{ ...ghostBtn, textDecoration: "none" }}>
          Cancel
        </Link>
      </div>

      <ConfirmDialog
        open={confirmingDiscard}
        title="Discard this analysis?"
        message="The parsed roles, scenes, and bookmarks will be thrown away. You can run the analysis again later."
        confirmLabel="Discard"
        danger
        busy={isPending}
        onConfirm={discard}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </div>
  );
}

function BookmarkGroup({
  label,
  items,
  kind,
  setBookmarks,
}: {
  label: string;
  items: BookmarkEdit[];
  kind: "scene" | "song";
  setBookmarks: React.Dispatch<React.SetStateAction<BookmarkEdit[]>>;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <p
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          color: "var(--ink-3)",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items
          .map((b, idx) => ({ b, idx }))
          .filter(({ b }) => b.kind === kind)
          .map(({ b, idx }) => (
            <div key={b.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--ink-3)",
                  background: "var(--bg-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "3px 7px",
                  minWidth: 52,
                  textAlign: "center",
                }}
              >
                p.{b.page}
              </span>
              <input
                value={b.title}
                onChange={(e) =>
                  setBookmarks((bs) =>
                    bs.map((x, j) => (j === idx ? { ...x, title: e.target.value } : x)),
                  )
                }
                style={{ ...textInput, flex: 1 }}
              />
              <RowDelete onClick={() => setBookmarks((bs) => bs.filter((_, j) => j !== idx))} />
            </div>
          ))}
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent)" }}>{icon}</span>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            background: "var(--bg-muted)",
            borderRadius: 999,
            padding: "2px 8px",
          }}
        >
          {count}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "6px 0 0" }}>{hint}</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
        style={{ ...textInput, width: 52, textAlign: "center" }}
      />
    </label>
  );
}

function RowDelete({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Remove"
      style={{
        display: "grid",
        placeItems: "center",
        width: 30,
        height: 30,
        flexShrink: 0,
        border: "none",
        background: "transparent",
        color: "var(--ink-3)",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      <Trash2 size={14} />
    </button>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 12,
        fontSize: 13,
        color: "var(--accent)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <Plus size={14} /> {label}
    </button>
  );
}

const textInput: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--ink)",
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 14,
  fontWeight: 600,
  padding: "10px 18px",
  border: "none",
  borderRadius: 9,
  background: "var(--ink)",
  color: "var(--bg-elev)",
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 14,
  padding: "10px 16px",
  border: "1px solid var(--border)",
  borderRadius: 9,
  background: "transparent",
  color: "var(--ink-2)",
  cursor: "pointer",
};

const primaryLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  padding: "9px 16px",
  borderRadius: 9,
  background: "var(--ink)",
  color: "var(--bg-elev)",
  textDecoration: "none",
};

const ghostLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  padding: "9px 16px",
  borderRadius: 9,
  border: "1px solid var(--border)",
  color: "var(--ink-2)",
  textDecoration: "none",
};
