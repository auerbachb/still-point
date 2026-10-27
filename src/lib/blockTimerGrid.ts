/**
 * #732: the block grid a sit is drawn as, the seconds its countdown digits
 * show, and the minute-block arithmetic the minute chime is timed from.
 *
 * A sit longer than two minutes is drawn as one block per minute, then its final
 * minute in ten-second blocks; anything shorter is ten-second blocks throughout.
 *
 * Kept separate from `BlockTimer.tsx` so the rules are unit-testable without
 * rendering the timer. iOS counterpart: `SessionLogic` in
 * `ios/StillPointShared/Sources/StillPointShared/SessionLogic.swift`; keep the
 * two in step.
 */
import { BLOCK_DURATION } from "@/lib/constants";

export type BlockDef = {
  duration: number;
  startTime: number;
  label: string;
  type: "minute" | "second";
};

/**
 * The whole seconds the countdown digits show at `elapsedSeconds`: the time
 * left, rounded up. The digits read 1:00 through the whole first second of the
 * final minute and 0:00 only once the sit is over, as iOS
 * `SessionViewModel.displaySeconds` does.
 *
 * #922: the voice countdown speaks this number, so the number heard is the one
 * on screen as each clip starts.
 */
export function countdownSeconds(elapsedSeconds: number, totalSeconds: number): number {
  return Math.ceil(Math.max(0, totalSeconds - elapsedSeconds));
}

/** Whether the sit is long enough (over two minutes) to be drawn in minute blocks. */
export function usesMinuteBlocks(totalSeconds: number): boolean {
  return totalSeconds > 120;
}

/**
 * Number of 60-second blocks before the final-minute ten-second blocks; 0 when
 * the sit has no minute blocks.
 */
export function minuteBlockCount(totalSeconds: number): number {
  if (!usesMinuteBlocks(totalSeconds)) return 0;
  const fullMinutes = Math.floor(totalSeconds / 60);
  return totalSeconds % 60 > 0 ? fullMinutes : fullMinutes - 1;
}

/**
 * Highest minute block completed at `elapsedSeconds`, or -1 when none is (or the
 * sit has no minute blocks). Capped at the last minute block: the final minute
 * is ten-second blocks, so it never completes a minute block of its own.
 */
export function completedMinuteBlockIndex(elapsedSeconds: number, totalSeconds: number): number {
  const count = minuteBlockCount(totalSeconds);
  if (count <= 0) return -1;
  return Math.min(count - 1, Math.floor(elapsedSeconds / 60) - 1);
}

/** Every block of the grid, in drawing order. */
export function buildBlocks(totalSeconds: number): BlockDef[] {
  const blocks: BlockDef[] = [];

  if (usesMinuteBlocks(totalSeconds)) {
    const count = minuteBlockCount(totalSeconds);
    for (let i = 0; i < count; i++) {
      blocks.push({ duration: 60, startTime: i * 60, label: `${i + 1}m`, type: "minute" });
    }

    const lastMinuteStart = count * 60;
    const lastMinuteDuration = totalSeconds - lastMinuteStart;
    const tenSecCount = Math.ceil(lastMinuteDuration / BLOCK_DURATION);
    for (let i = 0; i < tenSecCount; i++) {
      blocks.push({
        duration: BLOCK_DURATION,
        startTime: lastMinuteStart + i * BLOCK_DURATION,
        label: `${(i + 1) * BLOCK_DURATION}s`,
        type: "second",
      });
    }
  } else {
    const totalBlocks = Math.ceil(totalSeconds / BLOCK_DURATION);
    for (let i = 0; i < totalBlocks; i++) {
      blocks.push({
        duration: BLOCK_DURATION,
        startTime: i * BLOCK_DURATION,
        label: `${(i + 1) * BLOCK_DURATION}s`,
        type: "second",
      });
    }
  }

  return blocks;
}
