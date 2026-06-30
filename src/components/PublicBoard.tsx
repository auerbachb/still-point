"use client";

import { useState, useEffect } from "react";
import type { BoardEntry } from "@/lib/api";
import { useIsMobile } from "@/lib/useIsMobile";

type PublicBoardProps = {
  currentUsername: string;
};

export function PublicBoard({ currentUsername }: PublicBoardProps) {
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  const containerStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: "32px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(560px, calc(100vw - 24px))",
  };
  // On narrow phones the 5-column board overflowed and pushed CLEAR off-screen
  // (#473). Tighten the numeric columns + gaps so all five fit at 320px, let the
  // username cell shrink-and-ellipsize, and keep an overflow-x safety net.
  const gridColumns = isMobile ? "18px minmax(0, 1fr) 36px 44px 40px" : "32px 1fr 64px 64px 64px";
  const gridGap = isMobile ? "8px" : "12px";
  const rowPadX = isMobile ? "6px" : "12px";
  const headerFontSize = isMobile ? "10px" : "11px";
  const headerTracking = isMobile ? "0.03em" : "0.12em";

  useEffect(() => {
    fetch("/api/board")
      .then(r => r.json())
      .then(data => {
        setBoard(data.board || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const sorted = [...board].sort((a, b) => b.currentDay - a.currentDay);

  if (loading) {
    return (
      <div style={containerStyle}>
        <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif", color: "var(--fg)" }}>
          Practitioners
        </h2>
        <div style={{ fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "12px", color: "var(--fg-3)" }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif", color: "var(--fg)" }}>
          Practitioners
        </h2>
        <p style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px", color: "var(--fg-4)",
          letterSpacing: "0.09em", marginTop: "8px",
        }}>
          sorted by current day
        </p>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "2px", overflowX: isMobile ? "auto" : undefined }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: gridColumns,
          gap: gridGap, padding: `8px ${rowPadX}`,
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: headerFontSize, color: "var(--fg-4)",
          letterSpacing: headerTracking, textTransform: "uppercase",
        }}>
          <span>#</span>
          <span>user</span>
          <span style={{ textAlign: "right" }}>day</span>
          <span style={{ textAlign: "right" }}>streak</span>
          <span style={{ textAlign: "right" }}>clear</span>
        </div>

        {sorted.map((user, i) => {
          const isMe = user.username === currentUsername;
          return (
            <div
              key={user.username}
              style={{
                display: "grid",
                gridTemplateColumns: gridColumns,
                gap: gridGap, padding: `10px ${rowPadX}`, borderRadius: "6px",
                background: isMe
                  ? "var(--accent-green-bg-faint)"
                  : i % 2 === 0
                    ? "var(--surface-1)"
                    : "transparent",
                border: isMe
                  ? "1px solid var(--accent-green-border-subtle)"
                  : "1px solid transparent",
                alignItems: "center",
              }}
            >
              <span style={{
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "12px",
                color: i < 3 ? "var(--accent-amber-text)" : "var(--fg-4)",
                fontWeight: i < 3 ? 500 : 300,
              }}>
                {i + 1}
              </span>
              <span style={{
                fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                fontSize: isMobile ? "14px" : "15px",
                color: isMe ? "var(--accent-green)" : "var(--fg)",
                fontStyle: isMe ? "italic" : "normal",
                ...(isMobile
                  ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }
                  : {}),
              }}>
                {user.username}{" "}
                {isMe && <span style={{ fontSize: "11px", opacity: 0.5 }}>(you)</span>}
              </span>
              <span style={{
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "14px", color: "var(--fg)",
                textAlign: "right", fontWeight: 300,
              }}>
                {user.currentDay}
              </span>
              <span style={{
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "14px",
                color: user.streak >= 7 ? "var(--accent-green-strong)" : "var(--fg-2)",
                textAlign: "right", fontWeight: 300,
              }}>
                {user.streak}
              </span>
              <span style={{
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "14px",
                color: user.avgClear >= 80 ? "var(--accent-green-strong)" : "var(--fg-2)",
                textAlign: "right", fontWeight: 300,
              }}>
                {user.avgClear}%
              </span>
            </div>
          );
        })}

        {sorted.length === 0 && (
          <p style={{
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "14px", fontStyle: "italic", color: "var(--fg-4)",
            textAlign: "center", padding: "40px 0",
          }}>
            No public practitioners yet. Be the first to opt in via Settings.
          </p>
        )}
      </div>

      <p style={{
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        fontSize: "13px", fontStyle: "italic",
        color: "var(--fg-4)", textAlign: "center", lineHeight: 1.5,
      }}>
        Not a competition &mdash; a community of people training attention together.
        <br />
        Opt in via Settings.
      </p>
    </div>
  );
}
