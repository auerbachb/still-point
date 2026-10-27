"use client";

import { BLOCK_DURATION, type SessionType } from "@/lib/constants";

type CompletionSummaryProps = {
  dayNumber: number;
  sessionType: SessionType;
  plannedDuration: number;
  bonusSeconds: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
  nextDuration: number;
  compact: boolean;
};

/** The recap: the mark, the heading, the sit's stats, its thoughts and what comes next. */
export function CompletionSummary({
  dayNumber,
  sessionType,
  plannedDuration,
  bonusSeconds,
  clearPercent,
  thoughtCount,
  thoughts,
  nextDuration,
  compact,
}: CompletionSummaryProps) {
  const isQuick = sessionType === "quick";
  const nextBlocks = Math.ceil(nextDuration / BLOCK_DURATION);
  const distractionPercentDisplayed = Math.max(0, 100 - clearPercent);
  const totalDurationSeconds = plannedDuration + bonusSeconds;
  const sustainedAttentionLabel =
    bonusSeconds > 0
      ? `${plannedDuration} planned · ${bonusSeconds}s bonus (${totalDurationSeconds}s timer)`
      : `${totalDurationSeconds} seconds of sustained attention`;

  return (
    <>
      <div style={{ fontSize: compact ? "48px" : "64px", opacity: 0.8 }}>&#x25C9;</div>

      <div style={{ textAlign: "center" }}>
        <h2 style={{
          fontSize: "32px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-serif)",
          color: "var(--fg)",
        }}>
          {isQuick ? "Quick Minute Complete" : `Day ${dayNumber} Complete`}
        </h2>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: "13px", color: "var(--accent-green-text)",
          marginTop: "var(--s2)", letterSpacing: "0.07em",
        }}>
          {sustainedAttentionLabel}
        </p>

        <div style={{
          display: "flex", gap: "var(--s5)", justifyContent: "center",
          marginTop: "var(--s4)",
          fontFamily: "var(--font-mono)",
        }}>
          <StatTile value={`${clearPercent}%`} label="awareness" color="var(--accent-green)" />
          <StatTile value={`${distractionPercentDisplayed}%`} label="distraction" color="var(--accent-amber)" />
          <StatTile value={thoughtCount} label="captured notes" color="var(--accent-amber)" />
        </div>

        {thoughts.length > 0 && <CapturedThoughts thoughts={thoughts} />}

        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px", color: "var(--fg-3)", marginTop: "16px",
        }}>
          {isQuick ? (
            <>day {dayNumber} unchanged &middot; return when you&rsquo;re ready</>
          ) : (
            <>tomorrow: {nextDuration}s &middot; {nextBlocks} blocks</>
          )}
        </p>
      </div>
    </>
  );
}

function StatTile({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "28px", fontWeight: 200, color }}>{value}</div>
      <div style={{
        fontSize: "11px", color: "var(--fg-3)",
        letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
      }}>
        {label}
      </div>
    </div>
  );
}

function CapturedThoughts({ thoughts }: { thoughts: Array<{ timeInSession: number; text: string }> }) {
  return (
    <div style={{
      marginTop: "24px", padding: "14px 18px",
      background: "var(--surface-1)", borderRadius: "8px",
      borderLeft: "2px solid var(--accent-amber-bg)",
      textAlign: "left", maxWidth: "min(350px, calc(100vw - 40px))", margin: "24px auto 0",
    }}>
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px", color: "var(--fg-4)",
        letterSpacing: "0.12em", marginBottom: "8px",
      }}>
        CAPTURED THOUGHTS
      </div>
      {thoughts.map((t, i) => (
        <div key={i} style={{
          fontFamily: "var(--font-serif)",
          fontSize: "13px", fontStyle: "italic",
          color: "var(--fg-2)", padding: "3px 0",
        }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
