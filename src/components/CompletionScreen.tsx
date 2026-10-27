"use client";

import { useEffect, useRef, useState } from "react";
import { BLOCK_DURATION, type SessionType } from "@/lib/constants";
import { RatingSlider } from "@/components/RatingSlider";
import {
  MoodMatrix,
  type MoodEntry,
  type MoodMatrixValue,
  buildMoodMatrixPatch,
  buildMoodMatrixPayload,
} from "@/components/MoodMatrix";
import {
  COMPLETION_AUTOSAVE_MS,
  COMPLETION_RETURN_LABEL,
  noteTextToAutosave,
  ratingsAutosavePayload,
} from "@/lib/completionAutosave";

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
  /** #792: delete the stored note once the field is emptied. Offered under the
   *  same conditions as `onSaveNote`; without it an emptied field is not saved. */
  onClearNote?: () => Promise<void>;
  /** #109: post-session self-report; omitted (no sliders rendered) when there is
   *  no persisted session to attach ratings to. Only touched slider values are
   *  included in the payload; untouched ones are omitted for partial-update. */
  onSaveRatings?: (ratings: { focusRating?: number; happinessRating?: number }) => Promise<void>;
  /** #472: before/after mood matrix; omitted when there is no persisted session.
   *  Payload holds the rows the user tapped, plus an all-null row for each
   *  saved row since emptied (#792), which the server deletes. */
  onSaveMoodMatrix?: (matrix: Record<string, MoodEntry>) => Promise<void>;
  /** #792: delete the stored matrix once every cell is deselected. Offered
   *  under the same conditions as `onSaveMoodMatrix`. */
  onClearMoodMatrix?: () => Promise<void>;
  /** #703: the sit could not be stored on this device — not queued, not synced,
   *  nowhere. Replaces the silent "pending sync" completion this used to show. */
  notStored?: boolean;
  /** #703: retry the local save from the completion screen. Idempotent — it
   *  reuses the same `clientSessionId`, so a retry never duplicates a sit.
   *  Rejects when the sit still could not be stored. */
  onRetrySave?: () => Promise<void>;
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
  onClearNote,
  onSaveRatings,
  onSaveMoodMatrix,
  onClearMoodMatrix,
  notStored = false,
  onRetrySave,
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
  // #703: retrying the local save from the not-stored banner.
  const [retryingSave, setRetryingSave] = useState(false);
  const [retrySaveFailed, setRetrySaveFailed] = useState(false);
  const [returning, setReturning] = useState(false);
  const onSaveNoteRef = useRef(onSaveNote);
  const onClearNoteRef = useRef(onClearNote);
  const onSaveRatingsRef = useRef(onSaveRatings);
  const onSaveMoodMatrixRef = useRef(onSaveMoodMatrix);
  const onClearMoodMatrixRef = useRef(onClearMoodMatrix);
  onSaveNoteRef.current = onSaveNote;
  onClearNoteRef.current = onClearNote;
  onSaveRatingsRef.current = onSaveRatings;
  onSaveMoodMatrixRef.current = onSaveMoodMatrix;
  onClearMoodMatrixRef.current = onClearMoodMatrix;
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ratingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the server holds, as far as this screen knows. `null` and `{}` mean
  // nothing stored, so emptying a field that was saved is a clear (#792).
  const lastSavedNote = useRef<string | null>(null);
  const lastSavedRatings = useRef<string | null>(null);
  const lastSavedMood = useRef<Record<string, MoodEntry>>({});
  // A write that failed may still have landed, so until the next one succeeds
  // the stored value is a guess and every write is sent (#792).
  const noteUnsure = useRef(false);
  const moodUnsure = useRef(false);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const returningRef = useRef(false);
  const flushFailedRef = useRef(false);

  function track(task: () => Promise<void>): Promise<void> {
    const run = inflight.current.then(task, task);
    inflight.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The request that stores `trimmed`; a `null` (emptied) note is a clear. */
  function noteWrite(trimmed: string | null): (() => Promise<void>) | null {
    if (trimmed === null) return onClearNoteRef.current ?? null;
    const save = onSaveNoteRef.current;
    return save ? () => save(trimmed) : null;
  }

  // #792: every write is judged against what is stored when it runs — inside
  // `track`, after any write still in flight. Judging it when it is scheduled
  // would skip a clear made while the save it undoes was still on the wire.
  async function persistNote(trimmed: string | null): Promise<void> {
    if (!noteUnsure.current && trimmed === lastSavedNote.current) {
      // Back to what is stored, so an error from an edit since undone is stale.
      setNoteSaved(trimmed !== null);
      setSaveError(false);
      return;
    }
    const write = noteWrite(trimmed);
    if (!write) return;
    setSaving(true);
    try {
      setSaveError(false);
      await write();
      lastSavedNote.current = trimmed;
      noteUnsure.current = false;
      setNoteSaved(trimmed !== null);
    } catch (err) {
      noteUnsure.current = true;
      console.error(trimmed === null ? "Failed to clear note:" : "Failed to save note:", err);
      setSaveError(true);
      setNoteSaved(false);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function persistRatings(payload: {
    focusRating?: number;
    happinessRating?: number;
  }): Promise<void> {
    const save = onSaveRatingsRef.current;
    const key = JSON.stringify(payload);
    if (!save || key === lastSavedRatings.current) return;
    setSavingRatings(true);
    try {
      setRatingsSaveError(false);
      await save(payload);
      lastSavedRatings.current = key;
      setRatingsSaved(true);
    } catch (err) {
      console.error("Failed to save ratings:", err);
      setRatingsSaveError(true);
      setRatingsSaved(false);
      throw err;
    } finally {
      setSavingRatings(false);
    }
  }

  /** The request that stores `patch`; a `null` patch (nothing selected) is a clear. */
  function moodWrite(patch: Record<string, MoodEntry> | null): (() => Promise<void>) | null {
    if (patch === null) return onClearMoodMatrixRef.current ?? null;
    const save = onSaveMoodMatrixRef.current;
    return save ? () => save(patch) : null;
  }

  async function persistMood(matrix: MoodMatrixValue): Promise<void> {
    const desired = buildMoodMatrixPayload(matrix);
    if (!moodUnsure.current && JSON.stringify(desired) === JSON.stringify(lastSavedMood.current)) {
      setMoodMatrixSaved(Object.keys(desired).length > 0);
      setMoodMatrixSaveError(false);
      return;
    }
    const patch = buildMoodMatrixPatch(matrix, lastSavedMood.current);
    const write = moodWrite(patch);
    if (!write) return;
    setSavingMoodMatrix(true);
    try {
      setMoodMatrixSaveError(false);
      await write();
      lastSavedMood.current = desired;
      moodUnsure.current = false;
      setMoodMatrixSaved(patch !== null);
    } catch (err) {
      // Count the rows it carried as stored, so a later patch still empties them.
      lastSavedMood.current = { ...lastSavedMood.current, ...desired };
      moodUnsure.current = true;
      console.error(patch === null ? "Failed to clear mood matrix:" : "Failed to save mood matrix:", err);
      setMoodMatrixSaveError(true);
      setMoodMatrixSaved(false);
      throw err;
    } finally {
      setSavingMoodMatrix(false);
    }
  }

  useEffect(() => {
    const trimmed = noteTextToAutosave(note);
    if (!onSaveNoteRef.current && !onClearNoteRef.current) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      noteTimer.current = null;
      void track(() => persistNote(trimmed)).catch(() => {});
    }, COMPLETION_AUTOSAVE_MS);
    return () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
      noteTimer.current = null;
    };
  }, [note]);

  useEffect(() => {
    const payload = ratingsAutosavePayload({
      focusRating,
      happinessRating,
      focusTouched,
      happinessTouched,
    });
    if (!onSaveRatingsRef.current || !payload) return;
    if (JSON.stringify(payload) === lastSavedRatings.current) return;
    if (ratingsTimer.current) clearTimeout(ratingsTimer.current);
    ratingsTimer.current = setTimeout(() => {
      ratingsTimer.current = null;
      void track(() => persistRatings(payload)).catch(() => {});
    }, COMPLETION_AUTOSAVE_MS);
    return () => {
      if (ratingsTimer.current) clearTimeout(ratingsTimer.current);
      ratingsTimer.current = null;
    };
  }, [focusRating, happinessRating, focusTouched, happinessTouched]);

  useEffect(() => {
    if (!onSaveMoodMatrixRef.current && !onClearMoodMatrixRef.current) return;
    if (moodTimer.current) clearTimeout(moodTimer.current);
    const matrix = moodMatrix;
    moodTimer.current = setTimeout(() => {
      moodTimer.current = null;
      void track(() => persistMood(matrix)).catch(() => {});
    }, COMPLETION_AUTOSAVE_MS);
    return () => {
      if (moodTimer.current) clearTimeout(moodTimer.current);
      moodTimer.current = null;
    };
  }, [moodMatrix]);

  async function handleReturn() {
    if (returningRef.current) return;
    // A failed flush must not trap the user here. The next tap leaves.
    if (flushFailedRef.current) {
      onReturn();
      return;
    }
    returningRef.current = true;
    if (noteTimer.current) {
      clearTimeout(noteTimer.current);
      noteTimer.current = null;
    }
    if (ratingsTimer.current) {
      clearTimeout(ratingsTimer.current);
      ratingsTimer.current = null;
    }
    if (moodTimer.current) {
      clearTimeout(moodTimer.current);
      moodTimer.current = null;
    }
    setReturning(true);
    const trimmed = noteTextToAutosave(note);
    const ratings = ratingsAutosavePayload({
      focusRating,
      happinessRating,
      focusTouched,
      happinessTouched,
    });
    // Every field is attempted even when an earlier one fails; otherwise the
    // next tap would leave without ever trying the later saves. An emptied
    // note or matrix that was saved flushes as a clear (#792).
    const results = await Promise.allSettled([
      track(() => persistNote(trimmed)),
      ratings ? track(() => persistRatings(ratings)) : Promise.resolve(),
      track(() => persistMood(moodMatrix)),
    ]);
    await inflight.current;
    returningRef.current = false;
    setReturning(false);
    if (results.some((result) => result.status === "rejected")) {
      flushFailedRef.current = true;
      return;
    }
    onReturn();
  }

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
      {/* #703: a refused local write used to render as an ordinary pending-sync
          completion. It is now said plainly, with the one action that can still
          recover the sit, because leaving this screen ends it. */}
      {notStored && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="completion-not-stored"
          style={{
            width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
            display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px",
            padding: "12px 16px", borderRadius: "10px",
            border: "1px solid var(--accent-danger-border)",
            background: "var(--surface-1)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px", lineHeight: 1.6, letterSpacing: "0.06em",
            color: "var(--accent-danger)",
          }}
        >
          <div style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>
            this sit was not saved
          </div>
          <div style={{ color: "var(--fg-2)" }}>
            This device would not store it, so it is not queued and it will not upload
            later. Stay on this screen — leaving loses the sit. Reconnect if you can,
            then retry.
          </div>
          {onRetrySave && (
            <button
              type="button"
              onClick={async () => {
                setRetryingSave(true);
                try {
                  setRetrySaveFailed(false);
                  await onRetrySave();
                } catch (err) {
                  console.error("Failed to retry session save:", err);
                  setRetrySaveFailed(true);
                } finally {
                  setRetryingSave(false);
                }
              }}
              disabled={retryingSave}
              style={{
                background: "none",
                border: "1px solid var(--accent-danger-border)",
                color: "var(--accent-danger)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                padding: "8px 24px", borderRadius: "20px",
                minHeight: "44px",
                cursor: retryingSave ? "default" : "pointer",
                opacity: retryingSave ? 0.5 : 1,
              }}
            >
              {retryingSave ? "retrying..." : retrySaveFailed ? "still not saved — retry" : "retry save"}
            </button>
          )}
        </div>
      )}

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

      {/* Session note — saved as the user types (#753). */}
      {onSaveNote && (
        <div style={{
          width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
        }}>
          <textarea
            value={note}
            onChange={(e) => {
              const next = e.target.value;
              setNote(next);
              if (noteTextToAutosave(next) !== lastSavedNote.current) setNoteSaved(false);
            }}
            placeholder="end-of-session note..."
            rows={3}
            maxLength={1000}
            aria-label="end-of-session note"
            disabled={returning}
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
          {saveError ? (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px", color: "var(--accent-danger)",
                letterSpacing: "0.09em",
              }}
            >
              failed to save
            </div>
          ) : noteSaved ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--accent-green-dim)",
              letterSpacing: "0.09em",
            }}>
              note saved
            </div>
          ) : saving ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.09em",
            }}>
              saving...
            </div>
          ) : null}
        </div>
      )}

      {/* Post-session ratings (#109) */}
      {onSaveRatings && (
        <div style={{
          width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "14px",
        }}>
          <RatingSlider label="Focus" value={focusRating} onChange={(v) => { setFocusRating(v); setFocusTouched(true); setRatingsSaved(false); }} disabled={returning} />
          <RatingSlider label="Happiness" value={happinessRating} onChange={(v) => { setHappinessRating(v); setHappinessTouched(true); setRatingsSaved(false); }} disabled={returning} />
          {ratingsSaveError ? (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px", color: "var(--accent-danger)",
                letterSpacing: "0.09em",
              }}
            >
              failed to save
            </div>
          ) : ratingsSaved ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--accent-green-dim)",
              letterSpacing: "0.09em",
            }}>
              ratings saved
            </div>
          ) : savingRatings ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.09em",
            }}>
              saving...
            </div>
          ) : null}
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

          <MoodMatrix
            value={moodMatrix}
            onChange={(next) => {
              setMoodMatrix(next);
              const key = JSON.stringify(buildMoodMatrixPayload(next));
              if (key !== JSON.stringify(lastSavedMood.current)) setMoodMatrixSaved(false);
            }}
            disabled={returning}
          />
          {moodMatrixSaveError ? (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px", color: "var(--accent-danger)",
                letterSpacing: "0.09em",
              }}
            >
              failed to save
            </div>
          ) : moodMatrixSaved ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--accent-green-dim)",
              letterSpacing: "0.09em",
            }}>
              mood saved
            </div>
          ) : savingMoodMatrix ? (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px", color: "var(--fg-3)",
              letterSpacing: "0.09em",
            }}>
              saving...
            </div>
          ) : null}
        </div>
      )}

      <button
        type="button"
        onClick={() => { void handleReturn(); }}
        disabled={returning}
        style={{
          background: "none",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontFamily: "var(--font-serif)",
          fontSize: "14px", fontStyle: "italic",
          padding: "12px 36px", borderRadius: "30px",
          minHeight: "44px",
          cursor: returning ? "default" : "pointer",
          opacity: returning ? 0.5 : 1,
          marginTop: "8px",
          // scrollMarginBottom ensures scrollIntoViewIfNeeded respects the fixed
          // bottom nav so this button never lands behind it on mobile (#479).
          scrollMarginBottom: compact
            ? "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))"
            : undefined,
        }}
      >
        {COMPLETION_RETURN_LABEL}
      </button>
    </div>
  );
}
