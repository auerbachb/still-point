"use client";

import { useState } from "react";
import { BLOCK_DURATION, durationForDay, type SessionType } from "@/lib/constants";

type CompletionScreenProps = {
  dayNumber: number;
  sessionType?: SessionType;
  duration: number;
  bonusSeconds?: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
  onReturn: () => void;
  onSaveNote?: (text: string) => Promise<void>;
  /** Tighten vertical spacing for narrow-viewport mobile layouts (#473). */
  compact?: boolean;
};

export function CompletionScreen({
  dayNumber,
  sessionType = "standard",
  duration: plannedDuration,
  bonusSeconds = 0,
  clearPercent,
  thoughtCount,
  thoughts,
  onReturn,
  onSaveNote,
  compact = false,
}: CompletionScreenProps) {
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const isQuick = sessionType === "quick";
  const nextDuration = durationForDay(dayNumber + 1);
  const nextBlocks = Math.ceil(nextDuration / BLOCK_DURATION);
  const distractionPercentDisplayed = Math.max(0, 100 - clearPercent);
  const totalDurationSeconds = plannedDuration + bonusSeconds;
  const sustainedAttentionLabel =
    bonusSeconds > 0
      ? `${plannedDuration} planned · ${bonusSeconds}s bonus (${totalDurationSeconds}s timer)`
      : `${totalDurationSeconds} seconds of sustained attention`;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: compact ? "16px" : "32px", animation: "fadeIn 0.8s ease",
    }}>
      <div style={{ fontSize: "64px", opacity: 0.8 }}>&#x25C9;</div>

      <div style={{ textAlign: "center" }}>
        <h2 style={{
          fontSize: "32px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          color: "var(--fg)",
        }}>
          {isQuick ? "Quick Minute Complete" : `Day ${dayNumber} Complete`}
        </h2>
        <p style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "13px", color: "var(--accent-green-text)",
          marginTop: "var(--s2)", letterSpacing: "0.07em",
        }}>
          {sustainedAttentionLabel}
        </p>

        <div style={{
          display: "flex", gap: "var(--s5)", justifyContent: "center",
          marginTop: "var(--s4)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 200, color: "var(--accent-green)" }}>{clearPercent}%</div>
            <div style={{
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
            }}>
              awareness
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 200, color: "var(--accent-amber)" }}>{distractionPercentDisplayed}%</div>
            <div style={{
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
            }}>
              distraction
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 200, color: "var(--accent-amber)" }}>{thoughtCount}</div>
            <div style={{
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.12em", textTransform: "uppercase", marginTop: "4px",
            }}>
              captured notes
            </div>
          </div>
        </div>

        {thoughts.length > 0 && (
          <div style={{
            marginTop: "24px", padding: "14px 18px",
            background: "var(--surface-1)", borderRadius: "8px",
            borderLeft: "2px solid var(--accent-amber-bg)",
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
          {isQuick ? (
            <>day {dayNumber} unchanged &middot; return when you&rsquo;re ready</>
          ) : (
            <>tomorrow: {nextDuration}s &middot; {nextBlocks} blocks</>
          )}
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
              fontSize: "11px", color: "var(--accent-green-dim)",
              letterSpacing: "0.09em",
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
                maxLength={1000}
                style={{
                  width: "100%",
                  background: "var(--surface-1)",
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
              {saveError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  style={{
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", color: "var(--accent-danger)",
                    letterSpacing: "0.09em",
                  }}
                >
                  failed to save — tap to retry
                </div>
              )}
              {note.trim() && (
                <button
                  type="button"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      setSaveError(false);
                      await onSaveNote(note.trim());
                      setNoteSaved(true);
                    } catch (err) {
                      console.error("Failed to save note:", err);
                      setSaveError(true);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  style={{
                    background: "none",
                    border: saveError
                      ? "1px solid var(--accent-danger-border)"
                      : "1px solid var(--accent-green-border)",
                    color: saveError
                      ? "var(--accent-danger)"
                      : "var(--accent-green-text)",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                    padding: "8px 24px", borderRadius: "20px",
                    cursor: saving ? "default" : "pointer",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? "saving..." : saveError ? "retry" : "save note"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onReturn}
        style={{
          background: "none",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "14px", fontStyle: "italic",
          padding: "12px 36px", borderRadius: "30px",
          minHeight: "44px",
          cursor: "pointer", marginTop: "8px",
        }}
      >
        Return
      </button>
    </div>
  );
}
