/**
 * #472: Pure helpers for the before/after mood matrix.
 * Extracted from MoodMatrix.tsx so vitest (node mode, jsx:preserve) can import
 * and test them without a JSX transform.
 */

/** Row order of the grid, and the keys the sessions PATCH route accepts. #885:
 *  `happiness` sits just above `overall`; iOS `MoodKey` lists the same order. */
export const MOOD_KEYS = ["calm", "focus", "energy", "anxiety", "happiness", "overall"] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

export const MOOD_LABELS: Record<MoodKey, string> = {
  calm: "Calm",
  focus: "Focus",
  energy: "Energy",
  anxiety: "Anxiety",
  happiness: "Happiness",
  overall: "Overall",
};

export type MoodEntry = { before: number | null; after: number | null };
export type MoodMatrixValue = Partial<Record<MoodKey, MoodEntry>>;
/** Persisted / API mood-matrix shape — only touched rows are present. */
export type MoodMatrixPayload = Partial<Record<MoodKey, MoodEntry>>;

/** Returns true if the matrix contains at least one non-null cell. */
export function isMoodMatrixTouched(value: MoodMatrixValue): boolean {
  return MOOD_KEYS.some((k) => {
    const e = value[k];
    return e !== undefined && (e.before !== null || e.after !== null);
  });
}

/** Strips un-touched rows (both before and after are null) to keep the
 *  payload lean — rows where the user never tapped anything are omitted. */
export function buildMoodMatrixPayload(
  value: MoodMatrixValue,
): Record<string, { before: number | null; after: number | null }> {
  const out: Record<string, { before: number | null; after: number | null }> = {};
  for (const key of MOOD_KEYS) {
    const e = value[key];
    if (e && (e.before !== null || e.after !== null)) {
      out[key] = e;
    }
  }
  return out;
}

/** #792: the PATCH `moodMatrix` that turns the stored matrix (`persisted`) into
 *  `current`. `null` means clear the whole matrix — nothing is left selected.
 *  Otherwise it is the touched rows plus an all-null row for every stored row
 *  the user has since emptied, which the server deletes. */
export function buildMoodMatrixPatch(
  current: MoodMatrixValue,
  persisted: Record<string, MoodEntry>,
): Record<string, MoodEntry> | null {
  if (!isMoodMatrixTouched(current)) return null;
  const out = buildMoodMatrixPayload(current);
  for (const key of MOOD_KEYS) {
    if (persisted[key] && !out[key]) {
      out[key] = { before: null, after: null };
    }
  }
  return out;
}
