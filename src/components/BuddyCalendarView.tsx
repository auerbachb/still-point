"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type BuddyCalendarListResponse,
  type BuddyCalendarSession,
} from "@/lib/api";
import { buddyColorFromUserId } from "@/lib/buddyCalendarColors";
import { useIsMobile } from "@/lib/useIsMobile";

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  color: "var(--fg-4)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const cardStyle: React.CSSProperties = {
  padding: "16px 20px",
  background: "var(--surface-1)",
  borderRadius: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  width: "100%",
};

function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  const mon = d.toLocaleDateString("en-US", { month: "short" });
  const dayOfMonth = d.getDate();
  return `${dow} ${mon} ${dayOfMonth}`;
}

function formatTimeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function stateLabel(state: string): string {
  switch (state) {
    case "completed":
      return "Completed";
    case "active":
      return "In progress";
    case "abandoned":
      return "Abandoned";
    case "waiting":
    case "ready_check":
      return "Scheduled";
    default:
      return state;
  }
}

function buddyLabelForSession(
  session: BuddyCalendarSession,
  viewerUserId: string | undefined,
  focusBuddyId?: string,
): string {
  const others = session.participants.filter((p) => p.userId !== viewerUserId);
  if (focusBuddyId) {
    const focus = others.find((p) => p.userId === focusBuddyId);
    if (focus) return focus.username;
  }
  if (others.length === 0) return "Buddy sit";
  if (others.length === 1) return others[0].username;
  return others.map((p) => p.username).join(", ");
}

function primaryBuddyId(
  session: BuddyCalendarSession,
  viewerUserId: string | undefined,
  focusBuddyId?: string,
): string | null {
  if (focusBuddyId && session.buddyIds.includes(focusBuddyId)) return focusBuddyId;
  const first = session.buddyIds.find((id) => id !== viewerUserId);
  return first ?? session.buddyIds[0] ?? null;
}

type BuddyCalendarViewProps = {
  mode: "unified" | "perBuddy";
  buddyId?: string;
  buddyUsername?: string;
  viewerUserId?: string;
};

export function BuddyCalendarView({
  mode,
  buddyId,
  buddyUsername,
  viewerUserId,
}: BuddyCalendarViewProps) {
  const [data, setData] = useState<BuddyCalendarListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenBuddyIds, setHiddenBuddyIds] = useState<Set<string>>(() => new Set());
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: BuddyCalendarListResponse;
      if (mode === "perBuddy") {
        if (!buddyId) {
          throw new Error("Missing buddy id.");
        }
        result = await api.getBuddyCalendarForBuddy(buddyId);
      } else {
        result = await api.getBuddyCalendar();
      }
      setData(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load buddy calendar.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [mode, buddyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allBuddyIds = useMemo(() => {
    if (!data || mode === "perBuddy") return [];
    const ids = new Set<string>();
    for (const s of data.sessions) {
      for (const id of s.buddyIds) ids.add(id);
    }
    return [...ids].sort((a, b) => {
      const nameA =
        data.sessions
          .flatMap((s) => s.participants)
          .find((p) => p.userId === a)?.username ?? "";
      const nameB =
        data.sessions
          .flatMap((s) => s.participants)
          .find((p) => p.userId === b)?.username ?? "";
      return nameA.localeCompare(nameB);
    });
  }, [data, mode]);

  const buddyNames = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    for (const s of data.sessions) {
      for (const p of s.participants) {
        if (p.userId !== viewerUserId) map.set(p.userId, p.username);
      }
    }
    return map;
  }, [data, viewerUserId]);

  const showBuddyFilters = mode === "unified" && allBuddyIds.length >= 3;

  const visibleSessions = useMemo(() => {
    if (!data) return [];
    if (!showBuddyFilters || hiddenBuddyIds.size === 0) return data.sessions;
    return data.sessions.filter(
      (s) => !s.buddyIds.some((id) => hiddenBuddyIds.has(id)),
    );
  }, [data, showBuddyFilters, hiddenBuddyIds]);

  const sessionsByDate = useMemo(() => {
    const groups = new Map<string, BuddyCalendarSession[]>();
    for (const s of visibleSessions) {
      const list = groups.get(s.calendarDate) ?? [];
      list.push(s);
      groups.set(s.calendarDate, list);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visibleSessions]);

  const toggleBuddyVisibility = (id: string) => {
    setHiddenBuddyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dateColWidth = isMobile ? "88px" : "100px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
      {mode === "unified" && (
        <p
          style={{
            margin: 0,
            textAlign: "center",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            color: "var(--fg-3)",
            lineHeight: 1.5,
          }}
        >
          Shared buddy sits from the last 90 days. Solo history is unchanged on Progress.
        </p>
      )}

      {mode === "perBuddy" && buddyUsername && (
        <p
          style={{
            margin: 0,
            textAlign: "center",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            color: "var(--fg-3)",
            lineHeight: 1.5,
          }}
        >
          Shared sits with {buddyUsername} only — not their solo sessions.
        </p>
      )}

      {data && (
        <p
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: "12px",
            color: "var(--fg-4)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          }}
        >
          {data.fromDate} — {data.toDate}
        </p>
      )}

      {showBuddyFilters && (
        <div style={cardStyle}>
          <div style={labelStyle}>Show buddies</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {allBuddyIds.map((id) => {
              const hidden = hiddenBuddyIds.has(id);
              const color = buddyColorFromUserId(id);
              const name = buddyNames.get(id) ?? "Buddy";
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleBuddyVisibility(id)}
                  aria-pressed={!hidden}
                  style={{
                    border: `1px solid ${hidden ? "var(--border-2)" : color}`,
                    background: hidden ? "transparent" : `${color}22`,
                    color: hidden ? "var(--fg-3)" : "var(--fg)",
                    borderRadius: "999px",
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px",
                    letterSpacing: "0.06em",
                    textDecoration: hidden ? "line-through" : "none",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: color,
                      marginRight: "6px",
                      verticalAlign: "middle",
                      opacity: hidden ? 0.35 : 1,
                    }}
                  />
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && (
        <p style={{ textAlign: "center", color: "var(--fg-3)", fontSize: "14px" }}>Loading…</p>
      )}

      {error && (
        <div style={{ ...cardStyle, color: "var(--fg-2)", fontSize: "14px" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && visibleSessions.length === 0 && (
        <div style={{ ...cardStyle, color: "var(--fg-3)", fontSize: "14px", textAlign: "center" }}>
          {mode === "perBuddy"
            ? `No shared sits with ${buddyUsername ?? "this buddy"} in this period.`
            : "No shared buddy sits in this period yet."}
        </div>
      )}

      {!loading && sessionsByDate.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {sessionsByDate.map(([date, sessions]) => (
            <div key={date} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div
                style={{
                  width: dateColWidth,
                  flexShrink: 0,
                  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                  fontSize: isMobile ? "10px" : "11px",
                  color: "var(--fg-3)",
                  lineHeight: 1.35,
                  paddingTop: "10px",
                }}
              >
                {formatDateLabel(date)}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                {sessions.map((session) => {
                  const buddyIdForColor = primaryBuddyId(session, viewerUserId, buddyId);
                  const accent = buddyIdForColor
                    ? buddyColorFromUserId(buddyIdForColor)
                    : "var(--fg-3)";
                  const time =
                    formatTimeLabel(session.startedAt) ??
                    formatTimeLabel(session.scheduledStartAt);
                  const label = buddyLabelForSession(session, viewerUserId, buddyId);
                  const durationMin = Math.round(session.durationSeconds / 60);

                  return (
                    <div
                      key={session.id}
                      style={{
                        ...cardStyle,
                        borderLeft: `3px solid ${accent}`,
                        padding: "12px 16px",
                        gap: "6px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: "8px",
                          justifyContent: "space-between",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "16px",
                            color: "var(--fg)",
                            fontWeight: 400,
                          }}
                        >
                          {label}
                        </span>
                        <span style={{ ...labelStyle, textTransform: "none", letterSpacing: "0.04em" }}>
                          {stateLabel(session.state)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                          fontSize: "11px",
                          color: "var(--fg-3)",
                        }}
                      >
                        {durationMin} min
                        {time ? ` · ${time}` : ""}
                      </div>
                      {mode === "unified" && session.buddyIds.length === 1 && (
                        <Link
                          href={`/app/buddies/${session.buddyIds[0]}/calendar`}
                          style={{
                            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                            fontSize: "10px",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--fg-3)",
                            textDecoration: "underline",
                            alignSelf: "flex-start",
                          }}
                        >
                          View with {buddyNames.get(session.buddyIds[0]) ?? "buddy"}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.hasMore && (
        <p
          style={{
            textAlign: "center",
            fontSize: "12px",
            color: "var(--fg-4)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          }}
        >
          More sessions available — narrow the date range or increase limit via API.
        </p>
      )}
    </div>
  );
}
