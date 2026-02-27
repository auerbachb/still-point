"use client";

import { useState, useEffect } from "react";
import { BASE_DURATION, INCREMENT } from "@/lib/constants";
import type { Session, Thought } from "@/lib/api";
import { useIsMobile } from "@/lib/useIsMobile";

type HistoryEntry = {
  day: number | null;
  duration: number;
  actualTime: number;
  completed: boolean;
  date: string;
  clearPercent: number;
  thoughtCount: number;
  missed?: boolean;
};

type HistoryViewProps = {
  currentDay: number;
  username: string;
};

export function HistoryView({ currentDay, username }: HistoryViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [stats, setStats] = useState({ streak: 0, avgClearPercent: 0, avgThoughtsPerSession: 0, avgThoughtsPerMinute: 0 });
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    Promise.all([
      fetch("/api/sessions").then(r => r.json()),
      fetch("/api/thoughts").then(r => r.json()),
    ]).then(([sessData, thoughtData]) => {
      setSessions(sessData.sessions || []);
      setStats(sessData.stats || { streak: 0, avgClearPercent: 0, avgThoughtsPerSession: 0, avgThoughtsPerMinute: 0 });
      setThoughts(thoughtData.thoughts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Build history entries including missed days
  const history: HistoryEntry[] = [];
  const sortedSessions = [...sessions].sort((a, b) => a.dayNumber - b.dayNumber);

  for (let i = 0; i < sortedSessions.length; i++) {
    const s = sortedSessions[i];
    // Check for gaps between sessions (missed days)
    if (i > 0) {
      const prevDate = new Date(sortedSessions[i - 1].sessionDate + "T12:00:00");
      const currDate = new Date(s.sessionDate + "T12:00:00");
      const daysBetween = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      for (let gap = 1; gap < daysBetween; gap++) {
        const missedDate = new Date(prevDate);
        missedDate.setDate(missedDate.getDate() + gap);
        history.push({
          day: null,
          duration: 0,
          actualTime: 0,
          completed: false,
          date: missedDate.toISOString().split("T")[0],
          clearPercent: 0,
          thoughtCount: 0,
          missed: true,
        });
      }
    }
    history.push({
      day: s.dayNumber,
      duration: s.duration,
      actualTime: s.actualTime ?? s.duration,
      completed: s.completed,
      date: s.sessionDate,
      clearPercent: s.clearPercent,
      thoughtCount: s.thoughtCount,
    });
  }

  const maxDuration = Math.max(
    ...history.filter(h => !h.missed).map(h => h.actualTime),
    BASE_DURATION + (currentDay - 1) * INCREMENT,
    60,
  );

  const todayDuration = BASE_DURATION + (currentDay - 1) * INCREMENT;
  const dayThoughts = expandedDay !== null ? thoughts.filter(t => t.dayNumber === expandedDay) : [];

  if (loading) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "32px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(720px, calc(100vw - 24px))",
      }}>
        <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif", color: "var(--fg)" }}>
          Progress
        </h2>
        <div style={{ fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
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
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif", color: "var(--fg)" }}>
        Progress
      </h2>

      {/* Stats */}
      <div style={{
        display: "flex", gap: isMobile ? "16px" : "28px", flexWrap: "wrap", justifyContent: "center",
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
      }}>
        {[
          { label: "streak", value: String(stats.streak) },
          { label: "avg clear mind", value: `${stats.avgClearPercent}%` },
          { label: "\uD83D\uDCAD/session", value: String(stats.avgThoughtsPerSession) },
          { label: "\uD83D\uDCAD/min", value: String(stats.avgThoughtsPerMinute) },
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
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "14px", color: "var(--fg-2)",
          marginBottom: "20px", letterSpacing: "0.07em", textTransform: "uppercase",
        }}>
          Journey
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {history.map((entry, idx) => {
            if (entry.missed) {
              const d = new Date(entry.date + "T12:00:00");
              const dow = d.toLocaleDateString("en-US", { weekday: "short" });
              const mon = d.toLocaleDateString("en-US", { month: "short" });
              const day = d.getDate();
              const y = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(day).padStart(2, "0");
              const dateLabel = `${dow} ${mon} ${day} (${y}.${mm}.${dd})`;
              return (
                <div key={`missed-${idx}`} style={{
                  display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px",
                  padding: "2px 0", opacity: 0.35,
                }}>
                  {!isMobile && (
                    <div style={{
                      fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                      fontSize: "11px", color: "var(--fg-4)",
                      width: "160px", textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {dateLabel}
                    </div>
                  )}
                  <div style={{
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", color: "var(--fg-3)",
                    width: "32px", textAlign: "right",
                  }}>
                    &mdash;
                  </div>
                  <div style={{
                    flex: 1, height: "24px", borderRadius: "3px",
                    border: "1px dashed var(--border-1)",
                    display: "flex", alignItems: "center", paddingLeft: "10px",
                  }}>
                    <span style={{
                      fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                      fontSize: "11px", color: "var(--fg-4)", fontStyle: "italic",
                    }}>
                      missed
                    </span>
                  </div>
                  <div style={{ width: isMobile ? "80px" : "120px" }} />
                </div>
              );
            }

            const d = new Date(entry.date + "T12:00:00");
            const dow = d.toLocaleDateString("en-US", { weekday: "short" });
            const mon = d.toLocaleDateString("en-US", { month: "short" });
            const dayOfMonth = d.getDate();
            const y = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(dayOfMonth).padStart(2, "0");
            const dateLabel = `${dow} ${mon} ${dayOfMonth} (${y}.${mm}.${dd})`;

            return (
              <div key={`${entry.day}-${idx}`}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedDay === entry.day}
                  aria-controls={`day-${entry.day}-thoughts`}
                  onClick={() => setExpandedDay(expandedDay === entry.day ? null : entry.day)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedDay(expandedDay === entry.day ? null : entry.day);
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px",
                    cursor: "pointer", padding: "2px 0", borderRadius: "4px",
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
                      fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                      fontSize: "11px", color: "var(--fg-4)",
                      width: "160px", textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {dateLabel}
                    </div>
                  )}
                  <div style={{
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", color: "var(--fg-3)",
                    width: "32px", textAlign: "right",
                  }}>
                    D{entry.day}
                  </div>
                  <div style={{
                    flex: 1, height: "24px", borderRadius: "3px", overflow: "hidden",
                    background: "var(--surface-1)", position: "relative",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${(entry.actualTime / maxDuration) * 100}%`,
                      borderRadius: "3px", overflow: "hidden", display: "flex",
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
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px",
                    color: entry.completed ? "var(--accent-green-dim)" : "var(--accent-danger-muted)",
                    width: isMobile ? "80px" : "120px", display: "flex", gap: "6px", flexWrap: "wrap",
                  }}>
                    <span style={{ color: "var(--fg-3)" }}>{entry.actualTime}s</span>
                    <span style={{ color: "var(--fg-4)" }}>&middot;</span>
                    <span>{entry.clearPercent}%</span>
                    <span style={{ color: "var(--fg-4)" }}>&middot;</span>
                    <span style={{ color: "var(--accent-amber-border)" }}>{entry.thoughtCount}\uD83D\uDCAD</span>
                  </div>
                </div>

                {expandedDay === entry.day && dayThoughts.length > 0 && (
                  <div
                    id={`day-${entry.day}-thoughts`}
                    role="region"
                    aria-label={`Day ${entry.day} captured thoughts`}
                    style={{
                    marginLeft: isMobile ? "44px" : "216px", marginTop: "4px", marginBottom: "8px",
                    padding: "10px 14px", background: "var(--surface-1)",
                    borderLeft: "2px solid var(--accent-amber-bg)",
                    borderRadius: "0 6px 6px 0", animation: "fadeIn 0.2s ease",
                  }}>
                    {dayThoughts.map((t, i) => (
                      <div key={i} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "3px 0" }}>
                        <span style={{
                          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                          fontSize: "11px", color: "var(--accent-amber-hint)", whiteSpace: "nowrap",
                        }}>
                          @{t.timeInSession}s
                        </span>
                        <span style={{
                          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
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
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px", color: "var(--fg-4)",
                width: "160px", textAlign: "right", whiteSpace: "nowrap",
              }}>
                today
              </div>
            )}
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "var(--fg-4)",
              width: "32px", textAlign: "right",
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
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
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
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
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
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        fontSize: "11px", color: "var(--fg-4)", textAlign: "center",
      }}>
        click any day to see captured thoughts
      </p>
    </div>
  );
}
