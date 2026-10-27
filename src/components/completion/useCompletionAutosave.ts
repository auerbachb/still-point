"use client";

import { useEffect, useRef, useState } from "react";
import {
  type MoodEntry,
  type MoodMatrixValue,
  buildMoodMatrixPatch,
  buildMoodMatrixPayload,
} from "@/components/MoodMatrix";
import { COMPLETION_AUTOSAVE_MS, noteTextToAutosave } from "@/lib/completionAutosave";
import type { SaveStatusState } from "./SaveStatus";

export type CompletionAutosaveOptions = {
  onReturn: (writesSettled: Promise<void>) => void;
  onSaveNote?: (text: string) => Promise<void>;
  onClearNote?: () => Promise<void>;
  onSaveMoodMatrix?: (matrix: Record<string, MoodEntry>) => Promise<void>;
  onClearMoodMatrix?: () => Promise<void>;
};

export type CompletionAutosave = {
  note: string;
  changeNote: (next: string) => void;
  noteStatus: SaveStatusState;
  moodMatrix: MoodMatrixValue;
  changeMoodMatrix: (next: MoodMatrixValue) => void;
  moodStatus: SaveStatusState;
  returning: boolean;
  handleReturn: () => Promise<void>;
};

/**
 * The completion screen's note and mood autosave (#753), their clears (#792),
 * and the save-and-return flush (#947). Every write runs through one queue, so
 * each is judged against what is stored when it runs.
 */
export function useCompletionAutosave({
  onReturn,
  onSaveNote,
  onClearNote,
  onSaveMoodMatrix,
  onClearMoodMatrix,
}: CompletionAutosaveOptions): CompletionAutosave {
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // #472: mood matrix state
  const [moodMatrix, setMoodMatrix] = useState<MoodMatrixValue>({});
  const [moodMatrixSaved, setMoodMatrixSaved] = useState(false);
  const [savingMoodMatrix, setSavingMoodMatrix] = useState(false);
  const [moodMatrixSaveError, setMoodMatrixSaveError] = useState(false);
  const [returning, setReturning] = useState(false);
  const onSaveNoteRef = useRef(onSaveNote);
  const onClearNoteRef = useRef(onClearNote);
  const onSaveMoodMatrixRef = useRef(onSaveMoodMatrix);
  const onClearMoodMatrixRef = useRef(onClearMoodMatrix);
  onSaveNoteRef.current = onSaveNote;
  onClearNoteRef.current = onClearNote;
  onSaveMoodMatrixRef.current = onSaveMoodMatrix;
  onClearMoodMatrixRef.current = onClearMoodMatrix;
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the server holds, as far as this screen knows. `null` and `{}` mean
  // nothing stored, so emptying a field that was saved is a clear (#792).
  const lastSavedNote = useRef<string | null>(null);
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

  function changeNote(next: string): void {
    setNote(next);
    if (noteTextToAutosave(next) !== lastSavedNote.current) setNoteSaved(false);
  }

  function changeMoodMatrix(next: MoodMatrixValue): void {
    setMoodMatrix(next);
    const key = JSON.stringify(buildMoodMatrixPayload(next));
    if (key !== JSON.stringify(lastSavedMood.current)) setMoodMatrixSaved(false);
  }

  async function handleReturn() {
    if (returningRef.current) return;
    // A failed flush must not trap the user here. The next tap leaves.
    if (flushFailedRef.current) {
      // #947: an edit made since the failure is sent now rather than lost with
      // its pending autosave timer, unawaited. The screen leaves at once, and
      // whatever runs after it waits for that write and any still on the wire.
      if (noteTimer.current) {
        clearTimeout(noteTimer.current);
        noteTimer.current = null;
        void track(() => persistNote(noteTextToAutosave(note))).catch(() => {});
      }
      if (moodTimer.current) {
        clearTimeout(moodTimer.current);
        moodTimer.current = null;
        void track(() => persistMood(moodMatrix)).catch(() => {});
      }
      onReturn(inflight.current);
      return;
    }
    returningRef.current = true;
    if (noteTimer.current) {
      clearTimeout(noteTimer.current);
      noteTimer.current = null;
    }
    if (moodTimer.current) {
      clearTimeout(moodTimer.current);
      moodTimer.current = null;
    }
    setReturning(true);
    const trimmed = noteTextToAutosave(note);
    // The mood is attempted even when the note fails; otherwise the next tap
    // would leave without ever trying it. An emptied note or matrix that was
    // saved flushes as a clear (#792).
    const results = await Promise.allSettled([
      track(() => persistNote(trimmed)),
      track(() => persistMood(moodMatrix)),
    ]);
    await inflight.current;
    returningRef.current = false;
    setReturning(false);
    if (results.some((result) => result.status === "rejected")) {
      flushFailedRef.current = true;
      return;
    }
    onReturn(inflight.current);
  }

  return {
    note,
    changeNote,
    noteStatus: { error: saveError, saved: noteSaved, saving },
    moodMatrix,
    changeMoodMatrix,
    moodStatus: { error: moodMatrixSaveError, saved: moodMatrixSaved, saving: savingMoodMatrix },
    returning,
    handleReturn,
  };
}
