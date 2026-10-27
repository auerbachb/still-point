"use client";

import type { SessionType } from "@/lib/constants";
import type { MoodEntry } from "@/components/MoodMatrix";
import { COMPLETION_RETURN_LABEL } from "@/lib/completionAutosave";
import { CompletionSummary } from "@/components/completion/CompletionSummary";
import { MoodShiftSection, SessionNoteField } from "@/components/completion/CompletionFields";
import { NotStoredBanner } from "@/components/completion/NotStoredBanner";
import { useCompactScrollPadding } from "@/components/completion/useCompactScrollPadding";
import { useCompletionAutosave } from "@/components/completion/useCompletionAutosave";

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
  /** `writesSettled` resolves once every note and mood write this screen
   *  started has settled (#947), so work that needs them done can wait. */
  onReturn: (writesSettled: Promise<void>) => void;
  onSaveNote?: (text: string) => Promise<void>;
  /** #792: delete the stored note once the field is emptied. Offered under the
   *  same conditions as `onSaveNote`; without it an emptied field is not saved. */
  onClearNote?: () => Promise<void>;
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
  onSaveMoodMatrix,
  onClearMoodMatrix,
  notStored = false,
  onRetrySave,
  compact = false,
}: CompletionScreenProps) {
  const autosave = useCompletionAutosave({
    onReturn,
    onSaveNote,
    onClearNote,
    onSaveMoodMatrix,
    onClearMoodMatrix,
  });
  const { returning } = autosave;
  useCompactScrollPadding(compact);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: compact ? "12px" : "32px", animation: "fadeIn 0.8s ease",
    }}>
      <NotStoredBanner notStored={notStored} onRetrySave={onRetrySave} />

      <CompletionSummary
        dayNumber={dayNumber}
        sessionType={sessionType}
        plannedDuration={plannedDuration}
        bonusSeconds={bonusSeconds}
        clearPercent={clearPercent}
        thoughtCount={thoughtCount}
        thoughts={thoughts}
        nextDuration={nextDuration}
        compact={compact}
      />

      {onSaveNote && (
        <SessionNoteField
          note={autosave.note}
          onChange={autosave.changeNote}
          disabled={returning}
          status={autosave.noteStatus}
        />
      )}

      {onSaveMoodMatrix && (
        <MoodShiftSection
          value={autosave.moodMatrix}
          onChange={autosave.changeMoodMatrix}
          disabled={returning}
          compact={compact}
          status={autosave.moodStatus}
        />
      )}

      <button
        type="button"
        onClick={() => { void autosave.handleReturn(); }}
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
        }}
      >
        {COMPLETION_RETURN_LABEL}
      </button>
    </div>
  );
}
