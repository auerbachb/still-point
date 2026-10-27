import { isUuid } from "@/lib/friends";

type ThoughtInput = {
  timeInSession: number;
  text: string;
  /** #948: the client's replay key for this thought, lowercased. Absent when
   *  the client sent none. POST /api/thoughts/batch stores a thought with one
   *  at most once. The buddy personal-session route ignores it: its thoughts
   *  are written by the statement that creates the session row, which
   *  `sessions_user_buddy_session_unique` already makes safe to replay. */
  clientThoughtId?: string;
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
    const clientThoughtId = parseClientThoughtId(
      (item as { clientThoughtId?: unknown }).clientThoughtId,
    );

    if (
      typeof timeInSession !== "number" ||
      !Number.isFinite(timeInSession) ||
      typeof text !== "string" ||
      !clientThoughtId.ok
    ) {
      invalidCount += 1;
      continue;
    }

    const trimmed = text.trim().slice(0, 1000);
    if (!trimmed) {
      invalidCount += 1;
      continue;
    }

    thoughts.push({
      timeInSession,
      text: trimmed,
      ...(clientThoughtId.value ? { clientThoughtId: clientThoughtId.value } : {}),
    });
  }

  return { submittedCount: raw.length, invalidCount, thoughts };
}

/** #948: a thought's optional `clientThoughtId`. Absent or null reads as none,
 *  which is every thought sent before #948; anything else must be a UUID. */
function parseClientThoughtId(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || !isUuid(raw)) return { ok: false };
  // Postgres compares uuids without regard to case, so the route's own
  // duplicate check has to as well.
  return { ok: true, value: raw.toLowerCase() };
}

export function hasRejectedSubmittedThoughts(result: ThoughtNormalizationResult): boolean {
  return result.submittedCount > 0 && result.invalidCount > 0;
}

/** #792: the optional `clearCompletionNote` flag on POST /api/thoughts/batch.
 *  Absent reads as false. Anything else that is not a boolean is malformed —
 *  a flag that deletes data must never be inferred from a loose value. */
export function parseClearCompletionNote(raw: unknown): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, value: false };
  if (typeof raw !== "boolean") return { ok: false };
  return { ok: true, value: raw };
}
