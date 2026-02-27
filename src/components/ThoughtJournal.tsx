"use client";

import { useState, useEffect } from "react";
import type { Thought } from "@/lib/api";

type ThoughtJournalProps = {
  username: string;
};

export function ThoughtJournal({ username }: ThoughtJournalProps) {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/thoughts")
      .then(r => r.json())
      .then(data => {
        setThoughts(data.thoughts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const grouped = thoughts.reduce<Record<number, Thought[]>>((acc, t) => {
    if (!acc[t.dayNumber]) acc[t.dayNumber] = [];
    acc[t.dayNumber].push(t);
    return acc;
  }, {});

  const totalCount = thoughts.length;

  if (loading) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "32px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(560px, calc(100vw - 24px))",
      }}>
        <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif", color: "var(--fg)" }}>
          Thought Journal
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
      gap: "32px", animation: "fadeIn 0.6s ease", width: "100%", maxWidth: "min(560px, calc(100vw - 24px))",
    }}>
      <h2 style={{ fontSize: "28px", fontWeight: 300, fontStyle: "italic", margin: 0,
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif", color: "var(--fg)" }}>
        Thought Journal
      </h2>

      <div style={{
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "28px", fontWeight: 200, color: "var(--accent-amber)" }}>{totalCount}</div>
        <div style={{
          fontSize: "11px", color: "var(--fg-3)",
          letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
        }}>
          thoughts captured
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: "min(500px, calc(100vw - 40px))" }}>
        <p style={{
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "14px", fontStyle: "italic", color: "var(--fg-4)",
          marginBottom: "24px", lineHeight: 1.6,
        }}>
          Every thought that felt urgent in the moment. Looking back &mdash; how many actually needed your attention right then?
        </p>

        {Object.entries(grouped).reverse().map(([day, dayThoughts]) => (
          <div key={day} style={{ marginBottom: "20px" }}>
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.12em", marginBottom: "8px",
            }}>
              DAY {day}
            </div>
            {dayThoughts.map((t, i) => (
              <div key={i} style={{
                display: "flex", gap: "12px", alignItems: "baseline",
                padding: "5px 0", borderBottom: "1px solid var(--border-1)",
              }}>
                <span style={{
                  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                  fontSize: "11px",
                  color: t.timeInSession === -1 ? "var(--accent-green-muted)" : "var(--accent-amber-muted)",
                  whiteSpace: "nowrap", minWidth: "32px",
                }}>
                  {t.timeInSession === -1 ? "note" : `@${t.timeInSession}s`}
                </span>
                <span style={{
                  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                  fontSize: "14px", fontStyle: "italic",
                  color: "var(--fg-2)", lineHeight: 1.4,
                }}>
                  {t.text}
                </span>
              </div>
            ))}
          </div>
        ))}

        {totalCount === 0 && (
          <p style={{
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "14px", fontStyle: "italic", color: "var(--fg-4)",
            textAlign: "center", marginTop: "40px",
          }}>
            No thoughts captured yet. Complete a session to begin.
          </p>
        )}
      </div>
    </div>
  );
}
