"use client";

import { useState } from "react";
import { BLOCK_DURATION, type SessionType } from "@/lib/constants";
import { RatingSlider } from "@/components/RatingSlider";
import { MoodMatrix, type MoodMatrixValue, isMoodMatrixTouched, buildMoodMatrixPayload } from "@/components/MoodMatrix";

type CompletionScreenProps = {
  dayNumber: number;
  sessionType?: SessionType;
  duration: number;
  bonusSeconds?: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
  /** Planned duration of the next standard sit (#238: recovery-ramp aware — see
   *  `previewNextStandardDuration` / `@/lib/duration`). */
  nextDuration: number;
  onReturn: () => void;
  onSaveNote?: (text: string) => Promise<void>;
  /** #109: post-session self-report; omitted (no sliders rendered) when there is
   *  no persisted session to attach ratings to. Only touched slider values are
   *  included in the payload; untouched ones are omitted for partial-update. */
  onSaveRatings?: (ratings: { focusRating?: number; happinessRating?: number }) => Promise<void>;
  /** #472: before/after mood matrix; omitted when there is no persisted session.
   *  Payload only includes rows the user actually tapped. */
  onSaveMoodMatrix?: (matrix: Record<string, { before: number | null; after: number | null }>) => Promise<void>;
  /** Tighten vertical spacing for narrow-viewport mobile layouts (#473). */
  compact?: boolean;
};

const DEFAULT_RATING = 5;

export function CompletionScreen({
  dayNumber,
  sessionType = "standard",
  duration: plannedDuration,
  bonusSeconds = 0,
  clearPercent,
  thoughtCount,
  thoughts,
  nextDuration,
  onReturn,
  onSaveNote,
  onSaveRatings,
  onSaveMoodMatrix,
  compact = false,
}: CompletionScreenProps) {
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [focusRating, setFocusRating] = useState(DEFAULT_RATING);
  const [happinessRating, setHappinessRating] = useState(DEFAULT_RATING);
  const [focusTouched, setFocusTouched] = useState(false);
  const [happinessTouched, setHappinessTouched] = useState(false);
  const [ratingsSaved, setRatingsSaved] = useState(false);
  const [savingRatings, setSavingRatings] = useState(false);
  const [ratingsSaveError, setRatingsSaveError] = useState(false);
  // #472: mood matrix state
  const [moodMatrix, setMoodMatrix] = useState<MoodMatrixValue>({});
  const [moodMatrixSaved, setMoodMatrixSaved] = useState(false);
  const [savingMoodMatrix, setSavingMoodMatrix] = useState(false);
  const [moodMatrixSaveError, setMoodMatrixSaveError] = useState(false);
  const isQuick = sessionType === "quick";
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
      gap: compact ? "12px" : "32px", animation: "fadeIn 0.8s ease",
    }}>
      <div style={{ fontSize: compact ? "48px" : "64px", opacity: 0.8 }}>&#x25C9;</div>

      <div style={{ textAlign: "center" }}>
        <h2 style={{
          fontSize: "32px", fontWeight: 300, fontStyle: "italic", margin: 0,
          fontFamily: "var(--font-serif)",
          color: "var(--fg)",
        }}>
          {isQuick ? "Quick Minute Complete" : `Day ${dayNumber} Complete`}
        </h2>
        <p style={{
          fontFamily: "var(--font-mono)",
          fontSize: "13px", color: "var(--accent-green-text)",
          marginTop: "var(--s2)", letterSpacing: "0.07em",
        }}>
          {sustainedAttentionLabel}
        </p>

        <div style={{
          display: "flex", gap: "var(--s5)", justifyContent: "center",
          marginTop: "var(--s4)",
          fontFamily: "var(--font-mono)",
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
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-4)",
              letterSpacing: "0.12em", marginBottom: "8px",
            }}>
              CAPTURED THOUGHTS
            </div>
            {thoughts.map((t, i) => (
              <div key={i} style={{
                fontFamily: "var(--font-serif)",
                fontSize: "13px", fontStyle: "italic",
                color: "var(--fg-2)", padding: "3px 0",
              }}>
                {t.text}
              </div>
            ))}
          </div>
        )}

        <p style={{
          fontFamily: "var(--font-mono)",
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
              fontFamily: "var(--font-mono)",
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
                  fontFamily: "var(--font-serif)",
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
                    fontFamily: "var(--font-mono)",
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
                    fontFamily: "var(--font-mono)",
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

      {/* Post-session ratings (#109) */}
      {onSaveRatings && (
        <div style={{
          width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "14px",
        }}>
          {ratingsSaved ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--accent-green-dim)",
              letterSpacing: "0.09em",
            }}>
              ratings saved
            </div>
          ) : (
            <>
              <RatingSlider label="Focus" value={focusRating} onChange={(v) => { setFocusRating(v); setFocusTouched(true); }} disabled={savingRatings} />
              <RatingSlider label="Happiness" value={happinessRating} onChange={(v) => { setHappinessRating(v); setHappinessTouched(true); }} disabled={savingRatings} />
              {ratingsSaveError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px", color: "var(--accent-danger)",
                    letterSpacing: "0.09em",
                  }}
                >
                  failed to save — tap to retry
                </div>
              )}
              <button
                type="button"
                onClick={async () => {
                  setSavingRatings(true);
                  try {
                    setRatingsSaveError(false);
                    // Only send ratings the user explicitly touched; untouched
                    // sliders stay at their default and are omitted from the
                    // payload so the server-side partial-update logic is used
                    // correctly and no unintended default-5 overwrites occur.
                    const payload: { focusRating?: number; happinessRating?: number } = {};
                    if (focusTouched) payload.focusRating = focusRating;
                    if (happinessTouched) payload.happinessRating = happinessRating;
                    // If neither was touched, send both (user explicitly clicked
                    // save with the visible defaults — treat as intentional).
                    if (!focusTouched && !happinessTouched) {
                      payload.focusRating = focusRating;
                      payload.happinessRating = happinessRating;
                    }
                    await onSaveRatings(payload);
                    setRatingsSaved(true);
                  } catch (err) {
                    console.error("Failed to save ratings:", err);
                    setRatingsSaveError(true);
                  } finally {
                    setSavingRatings(false);
                  }
                }}
                disabled={savingRatings}
                style={{
                  background: "none",
                  border: ratingsSaveError
                    ? "1px solid var(--accent-danger-border)"
                    : "1px solid var(--accent-green-border)",
                  color: ratingsSaveError
                    ? "var(--accent-danger)"
                    : "var(--accent-green-text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "8px 24px", borderRadius: "20px",
                  cursor: savingRatings ? "default" : "pointer",
                  opacity: savingRatings ? 0.5 : 1,
                }}
              >
                {savingRatings ? "saving..." : ratingsSaveError ? "retry" : "save ratings"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Mood matrix (#472) */}
      {onSaveMoodMatrix && (
        <div style={{
          width: "100%", maxWidth: "min(420px, calc(100vw - 40px))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "14px",
        }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px", color: "var(--fg-3)",
            letterSpacing: "0.12em", textTransform: "uppercase",
            alignSelf: "flex-start",
          }}>
            Mood Shift
          </div>

          {moodMatrixSaved ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--accent-green-dim)",
              letterSpacing: "0.09em",
            }}>
              mood saved
            </div>
          ) : (
            <>
              <MoodMatrix
                value={moodMatrix}
                onChange={setMoodMatrix}
                disabled={savingMoodMatrix}
              />
              {moodMatrixSaveError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px", color: "var(--accent-danger)",
                    letterSpacing: "0.09em",
                  }}
                >
                  failed to save — tap to retry
                </div>
              )}
              {isMoodMatrixTouched(moodMatrix) && (
                <button
                  type="button"
                  onClick={async () => {
                    setSavingMoodMatrix(true);
                    try {
                      setMoodMatrixSaveError(false);
                      await onSaveMoodMatrix(buildMoodMatrixPayload(moodMatrix));
                      setMoodMatrixSaved(true);
                    } catch (err) {
                      console.error("Failed to save mood matrix:", err);
                      setMoodMatrixSaveError(true);
                    } finally {
                      setSavingMoodMatrix(false);
                    }
                  }}
                  disabled={savingMoodMatrix}
                  style={{
                    background: "none",
                    border: moodMatrixSaveError
                      ? "1px solid var(--accent-danger-border)"
                      : "1px solid var(--accent-green-border)",
                    color: moodMatrixSaveError
                      ? "var(--accent-danger)"
                      : "var(--accent-green-text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                    padding: "8px 24px", borderRadius: "20px",
                    cursor: savingMoodMatrix ? "default" : "pointer",
                    opacity: savingMoodMatrix ? 0.5 : 1,
                  }}
                >
                  {savingMoodMatrix ? "saving..." : moodMatrixSaveError ? "retry" : "save mood"}
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
          fontFamily: "var(--font-serif)",
          fontSize: "14px", fontStyle: "italic",
          padding: "12px 36px", borderRadius: "30px",
          minHeight: "44px",
          cursor: "pointer", marginTop: "8px",
          // scrollMarginBottom ensures scrollIntoViewIfNeeded respects the fixed
          // bottom nav so the Return button never lands behind it on mobile (#479).
          scrollMarginBottom: compact
            ? "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))"
            : undefined,
        }}
      >
        Return
      </button>
    </div>
  );
}
