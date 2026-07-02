"use client";

import { useMemo, type CSSProperties } from "react";
import type { Session } from "@/lib/api";
import {
  buildTrailing12MonthSummaries,
  formatShortMonthLabel,
  type MonthlySummary,
} from "@/lib/historyMonthlyAggregation";
import { formatTotalTime } from "@/lib/historyMonthGrid";

type HistoryYearInReviewProps = {
  sessions: Session[];
  todayDate: string;
  isMobile: boolean;
  onBack: () => void;
};

function activityIntensity(summary: MonthlySummary): number {
  if (summary.daysInMonth === 0) return 0;
  return summary.daysActive / summary.daysInMonth;
}

export function HistoryYearInReview({
  sessions,
  todayDate,
  isMobile,
  onBack,
}: HistoryYearInReviewProps) {
  const months = useMemo(
    () => buildTrailing12MonthSummaries(sessions, todayDate),
    [sessions, todayDate],
  );

  const totals = useMemo(() => {
    const daysActive = months.reduce((sum, m) => sum + m.daysActive, 0);
    const totalTimeSeconds = months.reduce((sum, m) => sum + m.totalTimeSeconds, 0);
    return { daysActive, totalTimeSeconds };
  }, [months]);

  const mono: CSSProperties = {
    fontFamily: "var(--font-mono)",
  };

  const columns = isMobile ? 2 : 3;

  return (
    <div style={{ width: "100%", maxWidth: "480px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "16px",
      }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            ...mono, fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "6px 12px", borderRadius: "4px",
            border: "1px solid var(--border-1)", background: "transparent",
            color: "var(--fg-3)", cursor: "pointer",
          }}
        >
          &larr; Calendar
        </button>
        <div style={{
          fontFamily: "var(--font-serif)",
          fontSize: "14px", color: "var(--fg-2)",
          letterSpacing: "0.07em", textTransform: "uppercase",
        }}>
          Year in review
        </div>
        <div style={{ width: "88px" }} aria-hidden="true" />
      </div>

      <div style={{
        display: "flex", gap: isMobile ? "12px" : "20px", justifyContent: "center",
        marginBottom: "20px", flexWrap: "wrap", ...mono,
      }}>
        {[
          { label: "days active", value: String(totals.daysActive) },
          { label: "total time", value: formatTotalTime(totals.totalTimeSeconds) },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center", minWidth: isMobile ? "72px" : "88px" }}>
            <div style={{ fontSize: "24px", fontWeight: 200, color: "var(--fg)" }}>{s.value}</div>
            <div style={{
              fontSize: "10px", color: "var(--fg-3)", letterSpacing: "0.12em",
              textTransform: "uppercase", marginTop: "4px",
            }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "8px",
      }}>
        {months.map(month => {
          const hasActivity = month.daysActive > 0;
          const bg = hasActivity ? "var(--accent-green-bg)" : "var(--surface-1)";
          const border = hasActivity
            ? "1px solid var(--accent-green-border)"
            : "1px solid var(--border-1)";
          const opacity = hasActivity ? 0.45 + activityIntensity(month) * 0.55 : 0.65;

          return (
            <div
              key={month.yearMonth}
              style={{
                padding: isMobile ? "10px 8px" : "12px 10px",
                borderRadius: "4px",
                background: bg,
                border,
                opacity,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                minHeight: isMobile ? "72px" : "80px",
              }}
            >
              <div style={{
                ...mono, fontSize: isMobile ? "10px" : "11px",
                color: hasActivity ? "var(--accent-green-dim)" : "var(--fg-3)",
                letterSpacing: "0.04em",
              }}>
                {formatShortMonthLabel(month.yearMonth)}
              </div>
              <div style={{
                ...mono, fontSize: isMobile ? "13px" : "15px",
                fontWeight: 200, color: "var(--fg)",
              }}>
                {month.daysActive}/{month.daysInMonth}
              </div>
              <div style={{
                ...mono, fontSize: "10px", color: "var(--fg-4)",
              }}>
                {formatTotalTime(month.totalTimeSeconds)}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{
        ...mono, fontSize: "10px", color: "var(--fg-4)",
        textAlign: "center", marginTop: "16px",
      }}>
        trailing 12 months &middot; days active / days in month
      </p>
    </div>
  );
}
