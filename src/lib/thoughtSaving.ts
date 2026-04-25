export type ThoughtInput = {
  timeInSession: number;
  text: string;
};

export type ThoughtNormalizationResult = {
  submittedCount: number;
  invalidCount: number;
  thoughts: ThoughtInput[];
};

export function normalizeThoughtInputs(raw: unknown): ThoughtNormalizationResult {
  if (!Array.isArray(raw)) {
    return { submittedCount: 0, invalidCount: 0, thoughts: [] };
  }

  const thoughts: ThoughtInput[] = [];
  let invalidCount = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      invalidCount += 1;
      continue;
    }

    const timeInSession = (item as { timeInSession?: unknown }).timeInSession;
    const text = (item as { text?: unknown }).text;

    if (
      typeof timeInSession !== "number" ||
      !Number.isFinite(timeInSession) ||
      typeof text !== "string"
    ) {
      invalidCount += 1;
      continue;
    }

    const trimmed = text.trim().slice(0, 1000);
    if (!trimmed) {
      invalidCount += 1;
      continue;
    }

    thoughts.push({ timeInSession, text: trimmed });
  }

  return { submittedCount: raw.length, invalidCount, thoughts };
}

export function hasRejectedSubmittedThoughts(result: ThoughtNormalizationResult): boolean {
  return result.submittedCount > 0 && result.invalidCount > 0;
}
