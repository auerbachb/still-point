/**
 * Sand-carrier timer progress (#662, web v1).
 *
 * A small character carries sand from a source pile to a destination pile. The
 * source shrinks and the destination grows, so elapsed vs. remaining time reads
 * at a glance. Everything here is derived from elapsed time: a backgrounded tab
 * catches up on the next render instead of replaying, and a paused sit (elapsed
 * frozen) freezes the carrier in place.
 *
 * Pure logic only: no React, DOM, or timing. `SandCarrier.tsx` renders the state.
 */

/** Sit length per carry trip, before clamping the trip count. */
export const SAND_SECONDS_PER_TRIP = 60;

/** Upper bound on carry trips, so very long sits keep a calm, readable pace. */
export const SAND_MAX_TRIPS = 12;

/** Share of each trip spent carrying sand forward; the rest is the empty walk back. */
export const SAND_CARRY_SHARE = 0.7;

/** Period of one walk-bob cycle, in seconds of sit time. */
export const SAND_WALK_SECONDS = 2;

export type SandProgress = {
  /** Clamped 0..1 fraction of the sit that has elapsed. */
  fraction: number;
  /** True once the full sit has elapsed (source pile empty). */
  complete: boolean;
  /** Source pile height as a 0..1 fraction of its full height. */
  sourceFraction: number;
  /** Destination pile height as a 0..1 fraction of its full height. */
  destinationFraction: number;
  /** Carrier position along the route: 0 at the source, 1 at the destination. */
  carrierPosition: number;
  /** True while the carrier holds sand on its way to the destination. */
  carrying: boolean;
  /** Walk-cycle phase in [0, 1), derived from elapsed time. */
  walkPhase: number;
};

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Number of carry trips for a sit of `totalSeconds`. Always at least one, at
 * most `SAND_MAX_TRIPS`. Non-finite or non-positive lengths count as one trip.
 */
export function sandTripCount(totalSeconds: number): number {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 1;
  const trips = Math.round(totalSeconds / SAND_SECONDS_PER_TRIP);
  return Math.min(SAND_MAX_TRIPS, Math.max(1, trips));
}

/**
 * Map elapsed sit time to the sand-carrier state.
 *
 * `elapsedSeconds` and `totalSeconds` may be non-integers. Negative or
 * non-finite elapsed values are treated as zero; elapsed past the end clamps to
 * a complete sit.
 */
export function sandProgress(elapsedSeconds: number, totalSeconds: number): SandProgress {
  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;

  const fraction = total === 0 ? 1 : clamp01(elapsed / total);
  const complete = fraction >= 1;

  let carrierPosition = 0;
  let carrying = false;

  if (complete) {
    // The sit is over: the carrier rests at the destination pile.
    carrierPosition = 1;
  } else {
    const tripLength = total / sandTripCount(total);
    const local = (elapsed % tripLength) / tripLength;
    if (local < SAND_CARRY_SHARE) {
      carrying = true;
      carrierPosition = local / SAND_CARRY_SHARE;
    } else {
      carrierPosition = 1 - (local - SAND_CARRY_SHARE) / (1 - SAND_CARRY_SHARE);
    }
  }

  return {
    fraction,
    complete,
    sourceFraction: 1 - fraction,
    destinationFraction: fraction,
    carrierPosition: clamp01(carrierPosition),
    carrying,
    walkPhase: (elapsed % SAND_WALK_SECONDS) / SAND_WALK_SECONDS,
  };
}
