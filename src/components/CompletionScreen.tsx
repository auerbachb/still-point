"use client";

import { useState } from "react";
import { BASE_DURATION, INCREMENT, BLOCK_DURATION } from "@/lib/constants";

type CompletionScreenProps = {
  dayNumber: number;
  duration: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
  onReturn: () => void;
  onSaveNote?: (text: string) => Promise<void>;
};

export function CompletionScreen({
  dayNumber,
  duration,
  clearPercent,
  thoughtCount,
  thoughts,
  onReturn,
  onSaveNote,
}: CompletionScreenProps) {
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const nextDuration = duration + INCREMENT;
  const nextBlocks = Math.ceil(nextDuration / BLOCK_DURATION);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "32px", animation: "fadeIn 0.8s ease",
    }}>
      <div style={{ fontSize: "64px", opacity: 0.8 }}>&#x25C9;</div>

      <div style={{ textAlign: "center" }}>
        <h2 style={{
          fontSize: "32px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          color: "var(--fg)",
        }}>
          Day {dayNumber} Complete
        </h2>
        <p style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "13px", color: "rgba(74,222,128,0.6)",
          marginTop: "12px", letterSpacing: "1px",
        }}>
          {duration} seconds of sustained attention
        </p>

        <div style={{
          display: "flex", gap: "32px", justifyContent: "center",
          marginTop: "24px",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 200, color: "#4ade80" }}>{clearPercent}%</div>
            <div style={{
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
            }}>
              clear mind
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 200, color: "#fbbf24" }}>{thoughtCount}</div>
            <div style={{
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
            }}>
              interruptions
            </div>
          </div>
        </div>

        {thoughts.length > 0 && (
          <div style={{
            marginTop: "24px", padding: "14px 18px",
            background: "rgba(232,228,222,0.02)", borderRadius: "8px",
            borderLeft: "2px solid rgba(251,191,36,0.15)",
            textAlign: "left", maxWidth: "min(350px, calc(100vw - 40px))", margin: "24px auto 0",
          }}>
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "var(--fg-4)",
              letterSpacing: "0.12em", marginBottom: "8px",
            }}>
              CAPTURED THOUGHTS
            </div>
            {thoughts.map((t, i) => (
              <div key={i} style={{
                fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                fontSize: "13px", fontStyle: "italic",
                color: "var(--fg-2)", padding: "3px 0",
              }}>
                {t.text}
              </div>
            ))}
          </div>
        )}

        <p style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px", color: "var(--fg-3)", marginTop: "16px",
        }}>
          tomorrow: {nextDuration}s &middot; {nextBlocks} blocks
        </p>
      </div>

      {/* Session note */}
      {onSaveNote && (
        <div style={{
          width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
        }}>
          {noteSaved ? (
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px", color: "rgba(74,222,128,0.5)",
              letterSpacing: "1px",
            }}>
              note saved
            </div>
          ) : (
            <>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="end-of-session note..."
                rows={3}
                style={{
                  width: "100%",
                  background: "rgba(232,228,222,0.04)",
                  border: "1px solid var(--border-1)",
                  borderRadius: "10px",
                  color: "var(--fg)",
                  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                  fontSize: "14px", fontStyle: "italic",
                  padding: "12px 16px",
                  resize: "vertical",
                  outline: "none",
                }}
              />
              {note.trim() && (
                <button
                  onClick={async () => {
                    setSaving(true);
                    await onSaveNote(note.trim());
                    setSaving(false);
                    setNoteSaved(true);
                  }}
                  disabled={saving}
                  style={{
                    background: "none",
                    border: "1px solid rgba(74,222,128,0.2)",
                    color: "rgba(74,222,128,0.6)",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                    padding: "8px 24px", borderRadius: "20px",
                    cursor: saving ? "default" : "pointer",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? "saving..." : "save note"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <button
        onClick={onReturn}
        style={{
          background: "none",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "14px", fontStyle: "italic",
          padding: "12px 36px", borderRadius: "30px",
          cursor: "pointer", marginTop: "8px",
        }}
      >
        Return
      </button>
    </div>
  );
}
