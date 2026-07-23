/**
 * #472: Pure helpers for the before/after mood matrix.
 * Extracted from MoodMatrix.tsx so vitest (node mode, jsx:preserve) can import
 * and test them without a JSX transform.
 */

export const MOOD_KEYS = ["calm", "focus", "energy", "anxiety", "overall"] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

export const MOOD_LABELS: Record<MoodKey, string> = {
  calm: "Calm",
  focus: "Focus",
  energy: "Energy",
  anxiety: "Anxiety",
  overall: "Overall",
};

export type MoodEntry = { before: number | null; after: number | null };
export type MoodMatrixValue = Partial<Record<MoodKey, MoodEntry>>;

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
