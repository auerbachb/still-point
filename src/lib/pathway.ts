/**
 * Duolingo-style pathway structure (#336, web v1).
 *
 * L1–L5 levels and node layout are fixed. Until real lesson content ships,
 * every node is a coming-soon preview — node state is **not** derived from
 * `currentDay` (#587). When lessons exist, `buildPathwayFromCompletions` (or
 * similar) can drive `completed` / `current` / `locked` from actual progress.
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

/** Copy shown when a pathway node is tapped before lessons ship. */
export const PATHWAY_COMING_SOON_MESSAGE = "Lessons coming soon";

export type NodeState = "completed" | "current" | "locked" | "comingSoon";

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
  /** Level rollup state. */
  state: NodeState;
};

/**
 * Resolve a single day's node state relative to `currentDay`.
 * Reserved for future real-lesson progression — not used by `buildPathway`.
 */
export function nodeStateForDay(day: number, currentDay: number): NodeState {
  if (day < currentDay) return "completed";
  if (day === currentDay) return "current";
  return "locked";
}

/**
 * Build the L1–L5 pathway preview. Every node is `comingSoon` until lesson
 * completions drive state (#587).
 */
export function buildPathway(): PathwayLevel[] {
  const levels: PathwayLevel[] = [];
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const nodes: PathwayNode[] = [];

    for (let dayInLevel = 1; dayInLevel <= DAYS_PER_LEVEL; dayInLevel++) {
      const nodeDay = (level - 1) * DAYS_PER_LEVEL + dayInLevel;
      nodes.push({ day: nodeDay, dayInLevel, state: "comingSoon" });
    }

    levels.push({
      level,
      name: LEVEL_NAMES[level - 1]!,
      nodes,
      completedCount: 0,
      state: "comingSoon",
    });
  }

  return levels;
}
