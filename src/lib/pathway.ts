/**
 * Duolingo-style pathway derivation (#336, web v1).
 *
 * Levels and node states are derived purely from the user's `currentDay`; there
 * is no backend or migration. `currentDay` is the day the user is *on* (not yet
 * completed) — completing a standard sit advances it by one (see
 * `handleSessionComplete` in `src/app/app/page.tsx`). That gives the v1 unlock
 * rule: finishing a lesson unlocks the next.
 */

/** Days that make up a single level. Five levels cover days 1–50. */
export const DAYS_PER_LEVEL = 10;

/** Ordered L1–L5 level names. */
export const LEVEL_NAMES = [
  "Stillness",
  "Awareness",
  "Focus",
  "Intention",
  "Kindness",
] as const;

export const TOTAL_LEVELS = LEVEL_NAMES.length;

/** Highest day represented in the pathway (L5, day 10). */
export const PATHWAY_MAX_DAY = TOTAL_LEVELS * DAYS_PER_LEVEL;

export type NodeState = "completed" | "current" | "locked";

export type PathwayNode = {
  /** 1-based day number this node represents. */
  day: number;
  /** Position within the level (1..DAYS_PER_LEVEL). */
  dayInLevel: number;
  state: NodeState;
};

export type PathwayLevel = {
  /** 1-based level index (1..TOTAL_LEVELS). */
  level: number;
  name: string;
  nodes: PathwayNode[];
  /** Count of completed nodes within this level. */
  completedCount: number;
  /**
   * Level rollup state: `completed` when every node is done, `current` when the
   * user's current day falls in this level, otherwise `locked`.
   */
  state: NodeState;
};

/**
 * Resolve a single day's node state relative to `currentDay`.
 * - day < currentDay  → completed
 * - day === currentDay → current
 * - day > currentDay  → locked
 */
export function nodeStateForDay(day: number, currentDay: number): NodeState {
  if (day < currentDay) return "completed";
  if (day === currentDay) return "current";
  return "locked";
}

/**
 * Build the full L1–L5 pathway for a given `currentDay`. Non-finite or sub-1
 * inputs are clamped to day 1 so the first node is always the current one.
 */
export function buildPathway(currentDay: number): PathwayLevel[] {
  const day = Number.isFinite(currentDay) ? Math.max(1, Math.floor(currentDay)) : 1;

  const levels: PathwayLevel[] = [];
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const nodes: PathwayNode[] = [];
    let completedCount = 0;

    for (let dayInLevel = 1; dayInLevel <= DAYS_PER_LEVEL; dayInLevel++) {
      const nodeDay = (level - 1) * DAYS_PER_LEVEL + dayInLevel;
      const state = nodeStateForDay(nodeDay, day);
      if (state === "completed") completedCount += 1;
      nodes.push({ day: nodeDay, dayInLevel, state });
    }

    const levelStartDay = (level - 1) * DAYS_PER_LEVEL + 1;
    const levelEndDay = level * DAYS_PER_LEVEL;
    let state: NodeState;
    if (day > levelEndDay) {
      state = "completed";
    } else if (day >= levelStartDay) {
      state = "current";
    } else {
      state = "locked";
    }

    levels.push({
      level,
      name: LEVEL_NAMES[level - 1]!,
      nodes,
      completedCount,
      state,
    });
  }

  return levels;
}
