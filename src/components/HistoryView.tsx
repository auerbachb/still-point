"use client";

import { useState, useEffect, useMemo } from "react";
import type { Session, Thought } from "@/lib/api";
import { sessionDurationForUser, type RecoveryFields } from "@/lib/duration";
import { useIsMobile } from "@/lib/useIsMobile";
import { buildHistoryJourneyRows } from "@/lib/historyJourney";
import { todayLocalIsoDate } from "@/lib/sessionCalendar";

const NO_RECOVERY: RecoveryFields = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

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
  /** Collapsed run of 3+ consecutive missed days (single "N days missed" row). */
  collapsed?: boolean;
  collapsedDayCount?: number;
  /** Inclusive end of the collapsed range (`date` holds the start). */
  collapsedEndDate?: string;
  /** 1-based index among same-type sessions on the same calendar day */
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

/** Month + day only (e.g. "Jun 10") — used for the collapsed-gap date range. */
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

export function HistoryView({ currentDay, recovery = NO_RECOVERY, username }: HistoryViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [stats, setStats] = useState({
    streak: 0,
    avgClearPercent: 0,
    avgThoughtsPerSession: 0,
    avgThoughtsPerMinute: 0,
    bonusMinutesTotal: 0,
  });
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // UTC calendar day for the trailing gap-to-today, refreshed on day rollover so the
  // journey stays correct if the view is left open past midnight (PR #426 review).
  const [todayDate, setTodayDate] = useState<string>(() => todayLocalIsoDate());
  const isMobile = useIsMobile();
  const sessionLabelColWidth = isMobile ? "88px" : "100px";

  useEffect(() => {
    Promise.all([
      fetch("/api/sessions").then(r => r.json()),
      fetch("/api/thoughts").then(r => r.json()),
    ]).then(([sessData, thoughtData]) => {
      setSessions(sessData.sessions || []);
      setStats({
        streak: sessData.stats?.streak ?? 0,
        avgClearPercent: sessData.stats?.avgClearPercent ?? 0,
        avgThoughtsPerSession: sessData.stats?.avgThoughtsPerSession ?? 0,
        avgThoughtsPerMinute: sessData.stats?.avgThoughtsPerMinute ?? 0,
        bonusMinutesTotal: sessData.stats?.bonusMinutesTotal ?? 0,
      });
      setThoughts(thoughtData.thoughts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Re-evaluate "today" once a minute; only re-renders when the UTC day actually
  // changes, keeping the trailing gap fresh across midnight without a refetch.
  useEffect(() => {
    const id = setInterval(() => {
      const d = todayLocalIsoDate();
      setTodayDate(prev => (prev === d ? prev : d));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const journeyRows = useMemo(() => {
    // Include all session types (quick + standard) — quick sits are rendered with
    // visual distinction rather than filtered out (#381). Pass today so the gap
    // between the last session and now is also collapsed.
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

  if (loading) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "32px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(720px, calc(100vw - 24px))",
      }}>
        <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-serif)", color: "var(--fg)" }}>
          Progress
        </h2>
        <div style={{ fontFamily: "var(--font-mono)",
          fontSize: "12px", color: "var(--fg-3)" }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "32px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(720px, calc(100vw - 24px))",
    }}>
      <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
        fontFamily: "var(--font-serif)", color: "var(--fg)" }}>
        Progress
      </h2>

      {/* Stats */}
      <div style={{
        display: "flex", gap: isMobile ? "16px" : "28px", flexWrap: "wrap", justifyContent: "center",
        fontFamily: "var(--font-mono)",
      }}>
        {[
          { label: "streak", value: String(stats.streak) },
          { label: "avg clear mind", value: `${stats.avgClearPercent}%` },
          { label: "\uD83D\uDCAD/session", value: String(stats.avgThoughtsPerSession) },
          { label: "\uD83D\uDCAD/min", value: String(stats.avgThoughtsPerMinute) },
          { label: "bonus min total", value: String(stats.bonusMinutesTotal) },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 200, color: "var(--fg)" }}>{s.value}</div>
            <div style={{ fontSize: "11px", color: "var(--fg-3)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Journey */}
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
                    fontFamily: "var(--font-mono)",
                    fontSize: isMobile ? "10px" : "11px", color: "var(--fg-4)",
                    width: isMobile ? undefined : "160px", minWidth: isMobile ? "72px" : undefined,
                    textAlign: "right", whiteSpace: "nowrap",
                  }}>
                    {rangeLabel}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px", color: "var(--fg-3)",
                    width: sessionLabelColWidth, textAlign: "right",
                  }}>
                    &mdash;
                  </div>
                  <div style={{
                    flex: 1, height: "24px", borderRadius: "3px",
                    border: "1px dashed var(--border-1)",
                    display: "flex", alignItems: "center", paddingLeft: "10px",
                  }}>
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px", color: "var(--fg-4)", fontStyle: "italic",
                    }}>
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
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px", color: "var(--fg-4)",
                      width: "160px", textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {dateLabel}
                    </div>
                  ) : (
                    <div style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px", color: "var(--fg-4)",
                      minWidth: "72px", textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {formatShortDateLabel(entry.date)}
                    </div>
                  )}
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px", color: "var(--fg-3)",
                    width: sessionLabelColWidth, textAlign: "right",
                  }}>
                    &mdash;
                  </div>
                  <div style={{
                    flex: 1, height: "24px", borderRadius: "3px",
                    border: "1px dashed var(--border-1)",
                    display: "flex", alignItems: "center", paddingLeft: "10px",
                  }}>
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px", color: "var(--fg-4)", fontStyle: "italic",
                    }}>
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
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px", color: "var(--fg-4)",
                      width: "160px", textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {showDateColumn ? dateLabelFull : ""}
                    </div>
                  )}
                  {isMobile && (
                    <div style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px", color: "var(--fg-4)",
                      minWidth: "72px", textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {showDateColumn ? dateLabelShort : ""}
                    </div>
                  )}
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px", color: isQuick ? "var(--fg-4)" : "var(--fg-3)",
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
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
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
                  }}>
                    {entryThoughts.map((t) => (
                      <div key={t.id} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "3px 0" }}>
                        <span style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px", color: "var(--accent-amber-hint)", whiteSpace: "nowrap",
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

          {/* Current day preview */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px" }}>
            {!isMobile && (
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px", color: "var(--fg-4)",
                width: "160px", textAlign: "right", whiteSpace: "nowrap",
              }}>
                today
              </div>
            )}
            {isMobile && (
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px", color: "var(--fg-4)",
                minWidth: "72px", textAlign: "right", whiteSpace: "nowrap",
              }} />
            )}
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-4)",
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
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-4)", width: isMobile ? "80px" : "120px",
            }}>
              {todayDuration}s
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "20px", marginTop: "20px", justifyContent: "center" }}>
          {[
            { color: "var(--accent-green)", label: "clear mind" },
            { color: "var(--accent-amber)", label: "thinking" },
            { color: "var(--border-2)", label: "today" },
          ].map(l => (
            <div key={l.label} style={{
              display: "flex", alignItems: "center", gap: "6px",
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-3)",
            }}>
              <div style={{
                width: "10px", height: "10px", borderRadius: "2px",
                background: l.color, opacity: l.label === "today" ? 1 : 0.6,
              }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      <p style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px", color: "var(--fg-4)", textAlign: "center",
      }}>
        click any session row to see captured thoughts
      </p>
    </div>
  );
}
