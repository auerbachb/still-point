"use client";

import type { CSSProperties } from "react";
import type { MindStateTrendStats } from "@/lib/historyMindStateTrends";
import { formatTotalTime } from "@/lib/historyMonthGrid";

type HistoryMindStateTrendsProps = {
  trends: MindStateTrendStats;
  isMobile: boolean;
};

const SEGMENTS = [
  { key: "clearPercent" as const, label: "aware", color: "var(--accent-green)" },
  { key: "lightDistractionPercent" as const, label: "light distraction", color: "var(--accent-amber)" },
  { key: "heavyDistractionPercent" as const, label: "heavy distraction", color: "var(--accent-danger-muted)" },
  { key: "hyperfocusPercent" as const, label: "hyperfocus", color: "rgba(96, 165, 250, 0.95)" },
];

function formatDayLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

export function HistoryMindStateTrends({ trends, isMobile }: HistoryMindStateTrendsProps) {
  const mono: CSSProperties = { fontFamily: "var(--font-mono)" };
  const statCardStyle: CSSProperties = {
    textAlign: "center",
    minWidth: isMobile ? "72px" : "88px",
  };

  const activeDays = trends.dailyTrend.filter(day => day.totalSitSeconds > 0);
  const summaryCards = [
    {
      label: "light distraction",
      value: `${trends.trailing4Week.lightDistractionPercent}%`,
      color: "var(--accent-amber)",
    },
    {
      label: "heavy distraction",
      value: `${trends.trailing4Week.heavyDistractionPercent}%`,
      color: "var(--accent-danger-muted)",
    },
    {
      label: "hyperfocus",
      value: `${trends.trailing4Week.hyperfocusPercent}%`,
      color: "rgba(96, 165, 250, 0.95)",
    },
    {
      label: "sit time",
      value: formatTotalTime(trends.trailing4Week.totalSitSeconds),
      color: "var(--fg)",
    },
  ];

  return (
    <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        fontFamily: "var(--font-serif)",
        fontSize: "14px",
        color: "var(--fg-2)",
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        textAlign: "center",
      }}>
        Sit-time composition
      </div>

      <div style={{
        display: "flex",
        gap: isMobile ? "12px" : "20px",
        flexWrap: "wrap",
        justifyContent: "center",
        ...mono,
      }}>
        {summaryCards.map(card => (
          <div key={card.label} style={statCardStyle}>
            <div style={{ fontSize: "22px", fontWeight: 200, color: card.color }}>{card.value}</div>
            <div style={{
              fontSize: "10px",
              color: "var(--fg-3)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginTop: "4px",
            }}>
              {card.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        ...mono,
        fontSize: "10px",
        color: "var(--fg-4)",
        textAlign: "center",
        letterSpacing: "0.05em",
      }}>
        Trailing 4 weeks · all time {trends.allTime.lightDistractionPercent}% light ·
        {" "}{trends.allTime.heavyDistractionPercent}% heavy ·
        {" "}{trends.allTime.hyperfocusPercent}% hyperfocus
      </div>

      {activeDays.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {activeDays.map(day => (
            <div
              key={day.date}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "72px 1fr 44px" : "96px 1fr 52px",
                gap: "8px",
                alignItems: "center",
                ...mono,
                fontSize: "10px",
                color: "var(--fg-3)",
              }}
            >
              <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatDayLabel(day.date)}</span>
              <div style={{
                height: "10px",
                borderRadius: "3px",
                overflow: "hidden",
                display: "flex",
                background: "var(--surface-1)",
              }}>
                {SEGMENTS.map(segment => {
                  const width = day.composition[segment.key];
                  if (width <= 0) return null;
                  return (
                    <div
                      key={segment.key}
                      title={`${segment.label}: ${width}%`}
                      style={{
                        width: `${width}%`,
                        height: "100%",
                        background: segment.color,
                        opacity: segment.key === "clearPercent" ? 0.75 : 0.85,
                      }}
                    />
                  );
                })}
              </div>
              <span style={{ color: "var(--fg-4)" }}>{formatTotalTime(day.totalSitSeconds)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...mono, fontSize: "11px", color: "var(--fg-4)", textAlign: "center" }}>
          No sits in the trailing 4 weeks yet.
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
        {SEGMENTS.map(segment => (
          <div
            key={segment.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              ...mono,
              fontSize: "10px",
              color: "var(--fg-3)",
            }}
          >
            <div style={{
              width: "10px",
              height: "10px",
              borderRadius: "2px",
              background: segment.color,
              opacity: 0.8,
            }} />
            {segment.label}
          </div>
        ))}
      </div>
    </div>
  );
}
