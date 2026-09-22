"use client";

import { useState, useTransition } from "react";
import { Scissors, BookOpen, Music, AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  splitScriptDocument,
  continueParseUnsplit,
  discardScriptParse,
  type SplitScriptResult,
} from "@/features/scripts/actions";
import type { DetectSection, SplitRanges } from "@/features/scripts/constants";
import { validateSplitRanges } from "@/features/scripts/parse-utils";

/**
 * Shown when detection thinks one PDF holds BOTH a libretto and a vocal score.
 * The user checks (and can nudge) the page boundary, then either splits the
 * file into two script documents or carries on analysing it as one book.
 */
export function SplitProposal({
  parseId,
  documentTitle,
  pageCount,
  proposal,
  sections,
  onSplit,
  onContinue,
  onDiscarded,
}: {
  parseId: string;
  documentTitle: string;
  pageCount: number;
  proposal: SplitRanges | null;
  sections: DetectSection[];
  onSplit: (result: SplitScriptResult) => void;
  onContinue: (parseId: string) => void;
  onDiscarded: () => void;
}) {
  const [libStart, setLibStart] = useState(proposal?.libretto.startPage ?? 1);
  const [libEnd, setLibEnd] = useState(proposal?.libretto.endPage ?? 1);
  const [scoreStart, setScoreStart] = useState(proposal?.vocalScore.startPage ?? 2);
  const [scoreEnd, setScoreEnd] = useState(proposal?.vocalScore.endPage ?? pageCount);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [isPending, startTransition] = useTransition();

  const ranges: SplitRanges = {
    libretto: { startPage: libStart, endPage: libEnd },
    vocalScore: { startPage: scoreStart, endPage: scoreEnd },
  };
  const invalid = validateSplitRanges(ranges, pageCount);

  function split() {
    setError(null);
    if (invalid) {
      setError(invalid);
      return;
    }
    startTransition(async () => {
      const res = await splitScriptDocument(parseId, ranges);
      if (res.error) {
        setError(res.error);
        return;
      }
      onSplit(res);
    });
  }

  function continueAsOne() {
    setError(null);
    startTransition(async () => {
      const res = await continueParseUnsplit(parseId);
      if (res.error || !res.parseId) {
        setError(res.error ?? "Could not continue the analysis.");
        return;
      }
      onContinue(res.parseId);
    });
  }

  function discard() {
    setConfirmingDiscard(false);
    startTransition(async () => {
      await discardScriptParse(parseId);
      onDiscarded();
    });
  }

  const libPages = Math.max(0, libEnd - libStart + 1);
  const scorePages = Math.max(0, scoreEnd - scoreStart + 1);

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Scissors size={20} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            This file looks like a libretto <em>and</em> a vocal score
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 0", lineHeight: 1.5 }}>
            <strong>{documentTitle}</strong> is {pageCount} pages. Splitting it gives the
            company two scripts to switch between — the libretto for staging and the
            score for music — each analysed on its own. Check the page ranges (the
            first page of the score is the one to get right) and adjust if needed.
          </p>
        </div>
      </div>

      {sections.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={eyebrow}>What we found</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sections.map((s, i) => (
              <span key={i} style={chip(s.kind)}>
                {s.label} · pp. {s.startPage}–{s.endPage}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 16 }}>
        <RangeCard
          icon={<BookOpen size={15} />}
          title="Libretto"
          pages={libPages}
          start={libStart}
          end={libEnd}
          max={pageCount}
          onStart={setLibStart}
          onEnd={setLibEnd}
        />
        <RangeCard
          icon={<Music size={15} />}
          title="Vocal score"
          pages={scorePages}
          start={scoreStart}
          end={scoreEnd}
          max={pageCount}
          onStart={setScoreStart}
          onEnd={setScoreEnd}
        />
      </div>

      {(invalid || error) && (
        <p style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--c-clay)", fontSize: 13, margin: "12px 0 0" }}>
          <AlertTriangle size={14} /> {error ?? invalid}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
        <button onClick={split} disabled={isPending || !!invalid} style={primaryBtn}>
          <Scissors size={15} /> Split &amp; continue
        </button>
        <button onClick={continueAsOne} disabled={isPending} style={ghostBtn}>
          Analyse as one book
        </button>
        <button onClick={() => setConfirmingDiscard(true)} disabled={isPending} style={ghostBtn}>
          Discard
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "10px 0 0", lineHeight: 1.5 }}>
        The original file stays in Documents. Pages outside both ranges are left
        only in the original. Splitting spends no AI analyses; the libretto
        analysis starts right away and the vocal score can be analysed next.
      </p>

      <ConfirmDialog
        open={confirmingDiscard}
        title="Discard this analysis?"
        message="Nothing has been changed yet. You can run the analysis again later."
        confirmLabel="Discard"
        danger
        busy={isPending}
        onConfirm={discard}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </div>
  );
}

function RangeCard({
  icon,
  title,
  pages,
  start,
  end,
  max,
  onStart,
  onEnd,
}: {
  icon: React.ReactNode;
  title: string;
  pages: number;
  start: number;
  end: number;
  max: number;
  onStart: (v: number) => void;
  onEnd: (v: number) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent)" }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: "auto" }}>
          {pages} page{pages === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <PageField label="From page" value={start} max={max} onChange={onStart} />
        <PageField label="To page" value={end} max={max} onChange={onEnd} />
      </div>
    </div>
  );
}

function PageField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        style={{
          fontSize: 13,
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-elev)",
          color: "var(--ink)",
          width: "100%",
        }}
      />
    </label>
  );
}

const card: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: "var(--ink-3)",
  margin: "0 0 8px",
};

function chip(kind: DetectSection["kind"]): React.CSSProperties {
  const tone =
    kind === "libretto" ? "var(--accent)" : kind === "vocal_score" ? "var(--c-amber)" : "var(--ink-3)";
  return {
    fontSize: 11.5,
    padding: "3px 9px",
    borderRadius: 999,
    border: `1px solid color-mix(in oklch, ${tone} 40%, transparent)`,
    background: `color-mix(in oklch, ${tone} 10%, var(--bg-elev))`,
    color: "var(--ink-2)",
    fontVariantNumeric: "tabular-nums",
  };
}

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
