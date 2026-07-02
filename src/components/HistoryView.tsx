"use client";

import { useState, useEffect, useMemo, type CSSProperties } from "react";
import type { Session, Thought } from "@/lib/api";
import { sessionDurationForUser, type RecoveryFields } from "@/lib/duration";
import { buildCurrentMonthGrid, buildPriorMonthSummaries, formatTotalTime } from "@/lib/historyMonthGrid";
import { buildHistoryJourneyRows } from "@/lib/historyJourney";
import { useIsMobile } from "@/lib/useIsMobile";
import { todayLocalIsoDate } from "@/lib/sessionCalendar";
import type { MindStateTrendStats } from "@/lib/historyMindStateTrends";
import { HistoryMindStateTrends } from "@/components/HistoryMindStateTrends";
import { HistoryYearInReview } from "@/components/HistoryYearInReview";

const NO_RECOVERY: RecoveryFields = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

type HistoryEntry = {
  sessionId?: string;
  day: number | null;
  duration: number;
  bonusSeconds: number;
  actualTime: number;
  completed: boolean;
  date: string;
  clearPercent: number;
  thoughtCount: number;
  sessionType?: Session["sessionType"];
  missed?: boolean;
  collapsed?: boolean;
  collapsedDayCount?: number;
  collapsedEndDate?: string;
  sessionIndexInDay?: number;
};

function formatFullDateLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  const mon = d.toLocaleDateString("en-US", { month: "short" });
  const dayOfMonth = d.getDate();
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${dow} ${mon} ${dayOfMonth} (${y}.${mm}.${dd})`;
}

function formatShortDateLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatCompactDateLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sessionSortKey(s: Session): string {
  return s.createdAt;
}

type HistoryViewProps = {
  currentDay: number;
  recovery?: RecoveryFields;
  username: string;
};

const EMPTY_MIND_STATE_TRENDS: MindStateTrendStats = {
  trailing4Week: {
    totalSitSeconds: 0,
    clearPercent: 0,
    lightDistractionPercent: 0,
    heavyDistractionPercent: 0,
    hyperfocusPercent: 0,
  },
  allTime: {
    totalSitSeconds: 0,
    clearPercent: 0,
    lightDistractionPercent: 0,
    heavyDistractionPercent: 0,
    hyperfocusPercent: 0,
  },
  dailyTrend: [],
};

export function HistoryView({ currentDay, recovery = NO_RECOVERY, username }: HistoryViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState({
    streak: 0,
    avgClearPercent: 0,
    avgThoughtsPerSession: 0,
    avgThoughtsPerMinute: 0,
    bonusMinutesTotal: 0,
    trailing4WeekDays: 0,
    trailing4WeekDayPercent: 0,
    trailing4WeekTotalTime: 0,
    trailing4WeekTimePercent: 0,
    totalTimeAllTime: 0,
    progressTo10kHours: 0,
    mindStateTrends: EMPTY_MIND_STATE_TRENDS,
  });
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [viewMode, setViewMode] = useState<"calendar" | "journey">("calendar");
  const [calendarSubView, setCalendarSubView] = useState<"default" | "yearInReview">("default");
  const [todayDate, setTodayDate] = useState<string>(() => todayLocalIsoDate());
  const isMobile = useIsMobile();
  const sessionLabelColWidth = isMobile ? "88px" : "100px";
  const cellSize = isMobile ? "36px" : "44px";

  useEffect(() => {
    const today = todayLocalIsoDate();
    const readJson = async (response: Response) => {
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      return response.json();
    };
    Promise.all([
      fetch(`/api/sessions?today=${encodeURIComponent(today)}`).then(readJson),
      fetch("/api/thoughts").then(readJson),
    ]).then(([sessData, thoughtData]) => {
      setSessions(sessData.sessions || []);
      setStats({
        streak: sessData.stats?.streak ?? 0,
        avgClearPercent: sessData.stats?.avgClearPercent ?? 0,
        avgThoughtsPerSession: sessData.stats?.avgThoughtsPerSession ?? 0,
        avgThoughtsPerMinute: sessData.stats?.avgThoughtsPerMinute ?? 0,
        bonusMinutesTotal: sessData.stats?.bonusMinutesTotal ?? 0,
        trailing4WeekDays: sessData.stats?.trailing4WeekDays ?? 0,
        trailing4WeekDayPercent: sessData.stats?.trailing4WeekDayPercent ?? 0,
        trailing4WeekTotalTime: sessData.stats?.trailing4WeekTotalTime ?? 0,
        trailing4WeekTimePercent: sessData.stats?.trailing4WeekTimePercent ?? 0,
        totalTimeAllTime: sessData.stats?.totalTimeAllTime ?? 0,
        progressTo10kHours: sessData.stats?.progressTo10kHours ?? 0,
        mindStateTrends: sessData.stats?.mindStateTrends ?? EMPTY_MIND_STATE_TRENDS,
      });
      setThoughts(thoughtData.thoughts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const d = todayLocalIsoDate();
      setTodayDate(prev => (prev === d ? prev : d));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const monthGrid = useMemo(
    () => buildCurrentMonthGrid(sessions, todayDate),
    [sessions, todayDate],
  );

  const priorMonths = useMemo(
    () => buildPriorMonthSummaries(sessions, todayDate),
    [sessions, todayDate],
  );

  const journeyRows = useMemo(() => {
    return buildHistoryJourneyRows(
      sessions.map(s => ({
        sessionDate: s.sessionDate,
        sessionType: s.sessionType,
        sortKey: sessionSortKey(s),
        data: s,
      })),
      todayDate,
    );
  }, [sessions, todayDate]);

  const history: HistoryEntry[] = useMemo(
    () =>
      journeyRows.map(row => {
        if (row.kind === "missed") {
          return {
            day: null,
            duration: 0,
            bonusSeconds: 0,
            actualTime: 0,
            completed: false,
            date: row.date,
            clearPercent: 0,
            thoughtCount: 0,
            missed: true,
          };
        }
        if (row.kind === "missedRange") {
          return {
            day: null,
            duration: 0,
            bonusSeconds: 0,
            actualTime: 0,
            completed: false,
            date: row.startDate,
            clearPercent: 0,
            thoughtCount: 0,
            missed: true,
            collapsed: true,
            collapsedDayCount: row.dayCount,
            collapsedEndDate: row.endDate,
          };
        }
        const s = row.data;
        return {
          sessionId: s.id,
          day: s.dayNumber,
          duration: s.duration,
          bonusSeconds: s.bonusSeconds ?? 0,
          actualTime: s.actualTime ?? s.duration,
          completed: s.completed,
          date: row.date,
          clearPercent: s.clearPercent,
          thoughtCount: s.thoughtCount,
          sessionType: s.sessionType,
          sessionIndexInDay: row.sessionIndexInDay,
        };
      }),
    [journeyRows],
  );

  const maxDuration = Math.max(
    ...history.filter(h => !h.missed).map(h => h.actualTime),
    sessionDurationForUser("standard", currentDay, recovery),
    60,
  );

  const todayDuration = sessionDurationForUser("standard", currentDay, recovery);
  const thoughtsBySession = useMemo(() => {
    const grouped: Record<string, Thought[]> = {};
    for (const t of thoughts) {
      (grouped[t.sessionId] ??= []).push(t);
    }
    return grouped;
  }, [thoughts]);

  const getThoughtsForSession = (sessionId?: string) =>
    sessionId ? (thoughtsBySession[sessionId] ?? []) : [];

  const mono: CSSProperties = {
    fontFamily: "var(--font-mono)",
  };

  const statCardStyle: CSSProperties = {
    textAlign: "center",
    minWidth: isMobile ? "72px" : "88px",
  };

  if (loading) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "var(--s5)", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(720px, calc(100vw - 24px))",
      }}>
        <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-serif)", color: "var(--fg)" }}>
          Progress
        </h2>
        <div style={{ ...mono, fontSize: "12px", color: "var(--fg-3)" }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "var(--s5)", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(720px, calc(100vw - 24px))",
    }}>
      <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
        fontFamily: "var(--font-serif)", color: "var(--fg)" }}>
        Progress
      </h2>

      {/* View toggle */}
      <div style={{ display: "flex", gap: "8px", ...mono, fontSize: "11px" }}>
        {(["calendar", "journey"] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setViewMode(mode);
              if (mode === "journey") setCalendarSubView("default");
            }}
            style={{
              padding: "6px 14px",
              borderRadius: "4px",
              border: viewMode === mode ? "1px solid var(--border-3)" : "1px solid var(--border-1)",
              background: viewMode === mode ? "var(--surface-2)" : "transparent",
              color: viewMode === mode ? "var(--fg)" : "var(--fg-3)",
              cursor: "pointer",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {mode === "calendar" ? "Calendar" : "Session buildup"}
          </button>
        ))}
      </div>

      {viewMode === "calendar" ? (
        calendarSubView === "yearInReview" ? (
          <HistoryYearInReview
            sessions={sessions}
            todayDate={todayDate}
            isMobile={isMobile}
            onBack={() => setCalendarSubView("default")}
          />
        ) : (
        <>
          {/* Trailing 4-week stats */}
          <div style={{
            display: "flex", gap: isMobile ? "12px" : "20px", flexWrap: "wrap", justifyContent: "center", ...mono,
          }}>
            {[
              { label: "days meditated", value: String(stats.trailing4WeekDays) },
              { label: "of days", value: `${stats.trailing4WeekDayPercent}%` },
              { label: "total time", value: formatTotalTime(stats.trailing4WeekTotalTime) },
              { label: "of time", value: `${stats.trailing4WeekTimePercent.toFixed(2)}%` },
            ].map(s => (
              <div key={s.label} style={statCardStyle}>
                <div style={{ fontSize: "24px", fontWeight: 200, color: "var(--fg)" }}>{s.value}</div>
                <div style={{ fontSize: "10px", color: "var(--fg-3)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px" }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <HistoryMindStateTrends trends={stats.mindStateTrends} isMobile={isMobile} />

          {/* All-time progress toward 10,000 hours */}
          <div style={{ width: "100%", maxWidth: "480px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: "8px", ...mono, fontSize: "11px", color: "var(--fg-3)",
            }}>
              <span>{formatTotalTime(stats.totalTimeAllTime)} all time</span>
              <span>{stats.progressTo10kHours.toFixed(2)}% to 10,000 hours</span>
            </div>
            <div style={{
              height: "6px", borderRadius: "3px", background: "var(--surface-1)", overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, stats.progressTo10kHours)}%`,
                background: "var(--accent-green-bg)",
                borderRadius: "3px",
              }} />
            </div>
          </div>

          {/* Legacy aggregate stats */}
          <div style={{
            display: "flex", gap: isMobile ? "16px" : "28px", flexWrap: "wrap", justifyContent: "center", ...mono,
          }}>
            {[
              { label: "streak", value: String(stats.streak) },
              { label: "avg clear mind", value: `${stats.avgClearPercent}%` },
              { label: "\uD83D\uDCAD/session", value: String(stats.avgThoughtsPerSession) },
              { label: "\uD83D\uDCAD/min", value: String(stats.avgThoughtsPerMinute) },
              { label: "bonus min total", value: String(stats.bonusMinutesTotal) },
            ].map(s => (
              <div key={s.label} style={statCardStyle}>
                <div style={{ fontSize: "22px", fontWeight: 200, color: "var(--fg)" }}>{s.value}</div>
                <div style={{ fontSize: "10px", color: "var(--fg-3)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px" }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Prior months — compact summary rows */}
          {priorMonths.length > 0 && (
            <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {priorMonths.map(month => (
                <div
                  key={month.yearMonth}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 12px", borderRadius: "4px",
                    background: "var(--surface-1)", border: "1px solid var(--border-1)",
                    ...mono, fontSize: "11px", color: "var(--fg-3)",
                  }}
                >
                  <span style={{ color: "var(--fg-2)" }}>{month.label}</span>
                  <span>
                    {month.daysActive}/{month.daysInMonth} days
                    <span style={{ color: "var(--fg-4)", margin: "0 6px" }}>&middot;</span>
                    {formatTotalTime(month.totalTimeSeconds)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Current month grid */}
          <div style={{ width: "100%", maxWidth: "480px" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: "12px",
            }}>
              <div style={{
                fontFamily: "var(--font-serif)",
                fontSize: "14px", color: "var(--fg-2)",
                letterSpacing: "0.07em", textTransform: "uppercase",
              }}>
                {monthGrid.monthLabel}
              </div>
              <button
                type="button"
                onClick={() => setCalendarSubView("yearInReview")}
                style={{
                  ...mono, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase",
                  padding: "4px 10px", borderRadius: "4px",
                  border: "1px solid var(--border-1)", background: "transparent",
                  color: "var(--fg-3)", cursor: "pointer",
                }}
              >
                Year in review
              </button>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "4px",
            }}>
              {WEEKDAY_LABELS.map((label, i) => (
                <div
                  key={`${label}-${i}`}
                  style={{
                    ...mono, fontSize: "10px", color: "var(--fg-3)",
                    textAlign: "center", paddingBottom: "4px",
                  }}
                >
                  {label}
                </div>
              ))}

              {monthGrid.cells.map((cell, idx) => {
                if (cell.kind === "blank") {
                  return <div key={`blank-${idx}`} style={{ minHeight: cellSize }} />;
                }

                const { day } = cell;
                const isTodayCell = day.isoDate === todayDate;
                const isMeditated = day.state === "meditated";
                const isMissed = day.state === "missed";
                const isFuture = day.state === "future";

                const bg = isMeditated
                  ? "var(--accent-green-bg)"
                  : isTodayCell
                    ? "var(--surface-3)"
                    : "var(--surface-1)";
                const border = isTodayCell
                  ? "2px solid var(--border-3)"
                  : isMeditated
                    ? "1px solid var(--accent-green-border)"
                    : "1px solid var(--border-1)";

                return (
                  <div
                    key={day.isoDate}
                    title={day.durationLabels.length > 0 ? day.durationLabels.join(", ") : undefined}
                    style={{
                      minHeight: cellSize,
                      borderRadius: "4px",
                      border,
                      background: bg,
                      opacity: isMissed ? 0.45 : isFuture ? 0.35 : 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "2px",
                      padding: "2px",
                    }}
                  >
                    <span style={{
                      ...mono, fontSize: isMobile ? "10px" : "11px",
                      color: isMeditated ? "var(--accent-green-dim)" : "var(--fg-3)",
                      lineHeight: 1,
                    }}>
                      {day.dayOfMonth}
                    </span>
                    {day.durationLabels.length > 0 && (
                      <span style={{
                        ...mono, fontSize: "8px", color: "var(--fg-4)",
                        lineHeight: 1, textAlign: "center",
                        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {day.durationLabels.join(", ")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: "16px", marginTop: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              {[
                { color: "var(--accent-green-bg)", border: "var(--accent-green-border)", label: "meditated" },
                { color: "var(--surface-1)", border: "var(--border-1)", label: "missed" },
                { color: "var(--surface-3)", border: "var(--border-3)", label: "today" },
              ].map(l => (
                <div key={l.label} style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  ...mono, fontSize: "10px", color: "var(--fg-3)",
                }}>
                  <div style={{
                    width: "10px", height: "10px", borderRadius: "2px",
                    background: l.color, border: `1px solid ${l.border}`,
                  }} />
                  {l.label}
                </div>
              ))}
            </div>
          </div>
        </>
        )
      ) : (
        /* Journey — relative session buildup (gap-collapse per #421) */
        <div style={{ width: "100%", maxWidth: "660px" }}>
          <div style={{
            fontFamily: "var(--font-serif)",
            fontSize: "14px", color: "var(--fg-2)",
            marginBottom: "20px", letterSpacing: "0.07em", textTransform: "uppercase",
          }}>
            Journey
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {history.map((entry, idx) => {
              const prev = idx > 0 ? history[idx - 1] : undefined;
              const showDateColumn = entry.missed
                ? true
                : !prev || prev.missed || prev.date !== entry.date;

              if (entry.collapsed) {
                const rangeLabel = `${formatCompactDateLabel(entry.date)} – ${formatCompactDateLabel(entry.collapsedEndDate ?? entry.date)}`;
                return (
                  <div key={`collapsed-${idx}`} style={{
                    display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px",
                    padding: "2px 0", opacity: 0.35,
                  }}>
                    <div style={{
                      ...mono, fontSize: isMobile ? "10px" : "11px", color: "var(--fg-4)",
                      width: isMobile ? undefined : "160px", minWidth: isMobile ? "72px" : undefined,
                      textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {rangeLabel}
                    </div>
                    <div style={{
                      ...mono, fontSize: "11px", color: "var(--fg-3)",
                      width: sessionLabelColWidth, textAlign: "right",
                    }}>
                      &mdash;
                    </div>
                    <div style={{
                      flex: 1, height: "24px", borderRadius: "3px",
                      border: "1px dashed var(--border-1)",
                      display: "flex", alignItems: "center", paddingLeft: "10px",
                    }}>
                      <span style={{ ...mono, fontSize: "11px", color: "var(--fg-4)", fontStyle: "italic" }}>
                        {entry.collapsedDayCount} days missed
                      </span>
                    </div>
                    <div style={{ width: isMobile ? "80px" : "120px" }} />
                  </div>
                );
              }

              if (entry.missed) {
                const dateLabel = formatFullDateLabel(entry.date);
                return (
                  <div key={`missed-${idx}`} style={{
                    display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px",
                    padding: "2px 0", opacity: 0.35,
                  }}>
                    {!isMobile ? (
                      <div style={{
                        ...mono, fontSize: "11px", color: "var(--fg-4)",
                        width: "160px", textAlign: "right", whiteSpace: "nowrap",
                      }}>
                        {dateLabel}
                      </div>
                    ) : (
                      <div style={{
                        ...mono, fontSize: "10px", color: "var(--fg-4)",
                        minWidth: "72px", textAlign: "right", whiteSpace: "nowrap",
                      }}>
                        {formatShortDateLabel(entry.date)}
                      </div>
                    )}
                    <div style={{
                      ...mono, fontSize: "11px", color: "var(--fg-3)",
                      width: sessionLabelColWidth, textAlign: "right",
                    }}>
                      &mdash;
                    </div>
                    <div style={{
                      flex: 1, height: "24px", borderRadius: "3px",
                      border: "1px dashed var(--border-1)",
                      display: "flex", alignItems: "center", paddingLeft: "10px",
                    }}>
                      <span style={{ ...mono, fontSize: "11px", color: "var(--fg-4)", fontStyle: "italic" }}>
                        missed
                      </span>
                    </div>
                    <div style={{ width: isMobile ? "80px" : "120px" }} />
                  </div>
                );
              }

              const dateLabelFull = formatFullDateLabel(entry.date);
              const dateLabelShort = formatShortDateLabel(entry.date);
              const isQuick = entry.sessionType === "quick";
              const isBreath = entry.sessionType === "breath";
              const sessionOrdinal = entry.sessionIndexInDay ?? 1;
              const sessionLabel = isQuick ? "Quick" : isBreath ? "Breath" : `Session ${sessionOrdinal}`;

              const entryId = entry.sessionId ? `sess-${entry.sessionId}` : `day-${entry.day}-${idx}`;
              const isExpanded = expandedEntryId === entryId;
              const entryThoughts = getThoughtsForSession(entry.sessionId);
              const canExpand = entryThoughts.length > 0;

              return (
                <div key={entryId}>
                  <div
                    role={canExpand ? "button" : undefined}
                    tabIndex={canExpand ? 0 : undefined}
                    aria-expanded={canExpand ? isExpanded : undefined}
                    aria-controls={canExpand ? `${entryId}-thoughts` : undefined}
                    onClick={() => {
                      if (canExpand) setExpandedEntryId(isExpanded ? null : entryId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (canExpand) setExpandedEntryId(isExpanded ? null : entryId);
                      }
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px",
                      cursor: canExpand ? "pointer" : "default", padding: "2px 0", borderRadius: "4px",
                      transition: "background 0.2s", outline: "none",
                    }}
                    onFocus={e => {
                      if (e.currentTarget.matches(":focus-visible")) {
                        e.currentTarget.style.background = "var(--surface-1)";
                        e.currentTarget.style.outline = "2px solid var(--border-3)";
                        e.currentTarget.style.outlineOffset = "2px";
                      }
                    }}
                    onBlur={e => {
                      e.currentTarget.style.outline = "none";
                      e.currentTarget.style.background = "none";
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-1)"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    {!isMobile && (
                      <div style={{
                        ...mono, fontSize: "11px", color: "var(--fg-4)",
                        width: "160px", textAlign: "right", whiteSpace: "nowrap",
                      }}>
                        {showDateColumn ? dateLabelFull : ""}
                      </div>
                    )}
                    {isMobile && (
                      <div style={{
                        ...mono, fontSize: "10px", color: "var(--fg-4)",
                        minWidth: "72px", textAlign: "right", whiteSpace: "nowrap",
                      }}>
                        {showDateColumn ? dateLabelShort : ""}
                      </div>
                    )}
                    <div style={{
                      ...mono, fontSize: "11px", color: isQuick ? "var(--fg-4)" : "var(--fg-3)",
                      width: sessionLabelColWidth, textAlign: "right",
                    }}>
                      {sessionLabel}
                    </div>
                    <div style={{
                      flex: 1, height: "24px", borderRadius: "3px", overflow: "hidden",
                      background: "var(--surface-1)", position: "relative",
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${(entry.actualTime / maxDuration) * 100}%`,
                        borderRadius: "3px", overflow: "hidden", display: "flex",
                        opacity: isQuick ? 0.55 : 1,
                      }}>
                        <div style={{
                          width: `${entry.clearPercent}%`, height: "100%",
                          background: "linear-gradient(to right, var(--accent-green), var(--accent-green-end))",
                          opacity: entry.completed ? 0.7 : 0.4,
                        }} />
                        <div style={{
                          width: `${100 - entry.clearPercent}%`, height: "100%",
                          background: "linear-gradient(to right, var(--accent-amber), var(--accent-amber-end))",
                          opacity: entry.completed ? 0.5 : 0.3,
                        }} />
                      </div>
                    </div>
                    <div style={{
                      ...mono, fontSize: "11px",
                      color: entry.completed ? "var(--accent-green-dim)" : "var(--accent-danger-muted)",
                      width: isMobile ? "80px" : "120px", display: "flex", gap: "6px", flexWrap: "wrap",
                    }}>
                      <span style={{ color: "var(--fg-3)" }}>{entry.actualTime}s</span>
                      <span style={{ color: "var(--fg-4)" }}>&middot;</span>
                      <span>{entry.clearPercent}%</span>
                      <span style={{ color: "var(--fg-4)" }}>&middot;</span>
                      <span style={{ color: "var(--accent-amber-border)" }}>{entry.thoughtCount}\uD83D\uDCAD</span>
                      {entry.bonusSeconds > 0 && (
                        <>
                          <span style={{ color: "var(--fg-4)" }}>&middot;</span>
                          <span style={{ color: "var(--fg-2)" }}>+{Math.round(entry.bonusSeconds / 60)}m bonus</span>
                        </>
                      )}
                    </div>
                  </div>

                  {canExpand && isExpanded && (
                    <div
                      id={`${entryId}-thoughts`}
                      role="region"
                      aria-label={`${sessionLabel} on ${dateLabelFull} captured thoughts`}
                      style={{
                        marginLeft: isMobile ? "44px" : "216px", marginTop: "4px", marginBottom: "8px",
                        padding: "10px 14px", background: "var(--surface-1)",
                        borderLeft: "2px solid var(--accent-amber-bg)",
                        borderRadius: "0 6px 6px 0", animation: "fadeIn 0.2s ease",
                      }}
                    >
                      {entryThoughts.map((t) => (
                        <div key={t.id} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "3px 0" }}>
                          <span style={{
                            ...mono, fontSize: "11px", color: "var(--accent-amber-hint)", whiteSpace: "nowrap",
                          }}>
                            @{t.timeInSession}s
                          </span>
                          <span style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: "13px", fontStyle: "italic", color: "var(--fg-2)",
                          }}>
                            {t.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px" }}>
              {!isMobile && (
                <div style={{
                  ...mono, fontSize: "11px", color: "var(--fg-4)",
                  width: "160px", textAlign: "right", whiteSpace: "nowrap",
                }}>
                  today
                </div>
              )}
              {isMobile && (
                <div style={{
                  ...mono, fontSize: "10px", color: "var(--fg-4)",
                  minWidth: "72px", textAlign: "right", whiteSpace: "nowrap",
                }} />
              )}
              <div style={{
                ...mono, fontSize: "11px", color: "var(--fg-4)",
                width: sessionLabelColWidth, textAlign: "right",
              }}>
                D{currentDay}
              </div>
              <div style={{
                flex: 1, height: "24px", borderRadius: "3px", overflow: "hidden",
                background: "var(--surface-1)",
                border: "1px dashed var(--surface-3)",
              }}>
                <div style={{
                  height: "100%",
                  width: `${(todayDuration / maxDuration) * 100}%`,
                  background: "linear-gradient(to right, var(--surface-3), var(--surface-1))",
                  borderRadius: "3px",
                }} />
              </div>
              <div style={{
                ...mono, fontSize: "11px", color: "var(--fg-4)", width: isMobile ? "80px" : "120px",
              }}>
                {todayDuration}s
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "20px", marginTop: "20px", justifyContent: "center" }}>
            {[
              { color: "var(--accent-green)", label: "clear mind" },
              { color: "var(--accent-amber)", label: "thinking" },
              { color: "var(--border-2)", label: "today" },
            ].map(l => (
              <div key={l.label} style={{
                display: "flex", alignItems: "center", gap: "6px",
                ...mono, fontSize: "11px", color: "var(--fg-3)",
              }}>
                <div style={{
                  width: "10px", height: "10px", borderRadius: "2px",
                  background: l.color, opacity: l.label === "today" ? 1 : 0.6,
                }} />
                {l.label}
              </div>
            ))}
          </div>

          <p style={{
            ...mono, fontSize: "11px", color: "var(--fg-4)", textAlign: "center", marginTop: "16px",
          }}>
            click any session row to see captured thoughts
          </p>
        </div>
      )}
    </div>
  );
}
