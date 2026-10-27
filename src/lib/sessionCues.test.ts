/**
 * Issue #732 — when a sit's cues are due.
 *
 * Pure rules, so each case states a cursor and an elapsed time and checks the
 * cues owed. End-to-end timing through the real clocks is pinned separately by
 * `src/components/BlockTimer.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { SoundPrefs } from "@/lib/audio";
import {
  INITIAL_CUE_CURSOR,
  followControlledVoice,
  freshCueCursor,
  planCountdownCues,
  planSessionEndCues,
  rewoundCueCursor,
  seededCueCursor,
  type Cue,
  type CueCursor,
} from "./sessionCues";

const TICK: SoundPrefs = {
  tick: true,
  chime: true,
  completion: true,
  voiceCountdown: false,
  haptics: false,
  hapticInterval: "minute",
};
const VOICE: SoundPrefs = { ...TICK, tick: false, voiceCountdown: true };
const HAPTIC: SoundPrefs = { ...TICK, tick: false, haptics: true };

/** Plays `elapsed` values in order from `cursor`, collecting every cue owed. */
function run(
  cursor: CueCursor,
  elapsedValues: number[],
  totalSeconds: number,
  prefs: SoundPrefs | undefined,
): { cursor: CueCursor; cues: Array<[number, Cue]> } {
  const cues: Array<[number, Cue]> = [];
  let current = cursor;
  for (const elapsed of elapsedValues) {
    const planned = planCountdownCues(current, elapsed, totalSeconds, prefs);
    current = planned.cursor;
    for (const cue of planned.cues) cues.push([elapsed, cue]);
  }
  return { cursor: current, cues };
}

/** The cues that make a sound — haptic cues are planned whatever the haptics preference. */
function sounds(cues: Cue[]): Cue[] {
  return cues.filter(cue => cue.kind !== "haptic");
}

/** 50ms clock updates from `from` (exclusive) to `to` (inclusive), as the clocks deliver them. */
function updates(from: number, to: number): number[] {
  const out: number[] = [];
  for (let ms = Math.round(from * 1000) + 50; ms <= Math.round(to * 1000); ms += 50) {
    out.push(ms / 1000);
  }
  return out;
}

describe("cue cursors", () => {
  it("starts a fresh sit with nothing played, counting haptics in the chosen interval", () => {
    expect(freshCueCursor(TICK)).toEqual({ ...INITIAL_CUE_CURSOR, lastHapticInterval: 60 });
    expect(freshCueCursor({ ...TICK, hapticInterval: "tenSeconds" }).lastHapticInterval).toBe(10);
    expect(freshCueCursor(undefined).lastHapticInterval).toBe(60);
  });

  it("seeds a resumed sit so the cues behind it count as played", () => {
    expect(seededCueCursor(30.5, 300, TICK)).toEqual({
      lastTickSec: 30,
      lastVoiceSec: 61,
      lastCompletedBlockIndex: -1,
      lastHapticIndex: 0,
      lastHapticInterval: 60,
    });
    expect(seededCueCursor(250.4, 300, { ...TICK, hapticInterval: "tenSeconds" })).toEqual({
      lastTickSec: 250,
      lastVoiceSec: 49,
      lastCompletedBlockIndex: 3,
      lastHapticIndex: 25,
      lastHapticInterval: 10,
    });
  });

  it("seeds a sit joined after its end without counting the end as a boundary", () => {
    expect(seededCueCursor(600, 600, TICK)).toMatchObject({
      lastVoiceSec: 0,
      lastCompletedBlockIndex: 8,
      lastHapticIndex: 9,
    });
  });

  it("rewinds every cue but the voice countdown, which keeps its own rule", () => {
    const finished = { ...seededCueCursor(129, 130, TICK), lastVoiceSec: 1 };
    expect(rewoundCueCursor(finished, 0, 130, TICK)).toEqual({
      lastTickSec: 0,
      lastVoiceSec: 1,
      lastCompletedBlockIndex: -1,
      lastHapticIndex: 0,
      lastHapticInterval: 60,
    });
  });

  it("keeps a controlled voice cursor from dropping below the current second", () => {
    const at = (lastVoiceSec: number) => ({ ...INITIAL_CUE_CURSOR, lastVoiceSec });
    expect(followControlledVoice(at(40), 30, 100).lastVoiceSec).toBe(61);
    expect(followControlledVoice(at(40), 50, 100).lastVoiceSec).toBe(50);
    expect(followControlledVoice(at(45), 60, 100).lastVoiceSec).toBe(45);
  });
});

describe("planCountdownCues — tick", () => {
  it("ticks once per whole second", () => {
    const { cues } = run(freshCueCursor(TICK), updates(0, 3), 300, TICK);
    expect(cues).toEqual([
      [0.05, { kind: "tick" }],
      [1, { kind: "tick" }],
      [2, { kind: "tick" }],
      [3, { kind: "tick" }],
    ]);
  });

  it("ticks a jump once rather than once per skipped second", () => {
    const { cues } = run(seededCueCursor(10, 300, TICK), [15.2], 300, TICK);
    expect(cues).toEqual([[15.2, { kind: "tick" }]]);
  });

  it("owes nothing — and leaves the cursor alone — with no preferences at all", () => {
    const cursor = freshCueCursor(undefined);
    const planned = planCountdownCues(cursor, 60, 300, undefined);
    expect(planned.cues).toEqual([]);
    expect(planned.cursor).toBe(cursor);
  });
});

describe("planCountdownCues — voice countdown", () => {
  it("never ticks in voice mode, even outside the final minute", () => {
    const { cues } = run(freshCueCursor(VOICE), updates(0, 5), 300, { ...VOICE, tick: true });
    expect(cues).toEqual([]);
  });

  it("opens the final minute with 60 and then counts each second down to 1", () => {
    const { cues } = run(freshCueCursor(VOICE), updates(14.9, 75), 75, VOICE);
    const voice = cues.filter(([, cue]) => cue.kind === "voice");
    expect(voice.map(([, cue]) => (cue.kind === "voice" ? cue.second : 0))).toEqual(
      Array.from({ length: 60 }, (_, i) => 60 - i),
    );
    expect(voice[0]).toEqual([15, { kind: "voice", second: 60 }]);
    expect(voice[1]).toEqual([15.05, { kind: "voice", second: 59 }]);
    expect(voice.at(-1)).toEqual([73.05, { kind: "voice", second: 1 }]);
  });

  it("still opens with 60 when the first update lands inside the final minute", () => {
    const planned = planCountdownCues(freshCueCursor(VOICE), 15.03, 75, VOICE);
    expect(planned.cues).toEqual([{ kind: "voice", second: 60 }]);
  });

  it("cancels a countdown in progress when the sit moves back above a minute", () => {
    const cursor = { ...seededCueCursor(99.95, 200, VOICE), lastVoiceSec: 12 };
    const planned = planCountdownCues(cursor, 100, 200, VOICE);
    expect(planned.cues).toEqual([{ kind: "cancelVoice" }]);
    expect(planned.cursor.lastVoiceSec).toBe(61);
  });
});

describe("planCountdownCues — minute chime", () => {
  it("strikes when a minute block completes with a full minute still to go", () => {
    const planned = planCountdownCues(seededCueCursor(59.95, 300, TICK), 60, 300, TICK);
    expect(sounds(planned.cues)).toEqual([{ kind: "tick" }, { kind: "chime" }]);
  });

  it("stays silent for the last minute block when less than a minute remains", () => {
    const planned = planCountdownCues(seededCueCursor(119.95, 130, TICK), 120, 130, TICK);
    expect(sounds(planned.cues)).toEqual([{ kind: "tick" }]);
    expect(planned.cursor.lastCompletedBlockIndex).toBe(1);
  });

  // #853: in voice mode the chime keeps its own switch and gives way only to
  // the countdown. iOS pins the same rule in `SessionTickLogicTests.swift`.
  it("still strikes in voice mode at a minute outside the final minute", () => {
    const planned = planCountdownCues(seededCueCursor(59.95, 300, VOICE), 60, 300, VOICE);
    expect(sounds(planned.cues)).toEqual([{ kind: "chime" }]);
  });

  it("gives way in voice mode to the countdown opening the final minute", () => {
    const withVoice = planCountdownCues(seededCueCursor(119.95, 180, VOICE), 120, 180, VOICE);
    expect(sounds(withVoice.cues)).toEqual([{ kind: "voice", second: 60 }]);
    expect(withVoice.cursor.lastCompletedBlockIndex).toBe(1);

    const chimeOnly: SoundPrefs = { ...VOICE, voiceCountdown: false };
    const withoutVoice = planCountdownCues(seededCueCursor(119.95, 180, chimeOnly), 120, 180, chimeOnly);
    expect(sounds(withoutVoice.cues)).toEqual([{ kind: "chime" }]);
  });

  it("strikes at every minute of a voice-mode sit but the one opening the final minute", () => {
    const { cues } = run(freshCueCursor(VOICE), updates(0, 299.95), 300, VOICE);
    const chimes = cues.filter(([, cue]) => cue.kind === "chime").map(([elapsed]) => elapsed);
    expect(chimes).toEqual([60, 120, 180]);
  });

  it("never strikes on a sit too short for minute blocks", () => {
    const { cues } = run(freshCueCursor(TICK), [60, 61], 120, { ...TICK, tick: false });
    expect(sounds(cues.map(([, cue]) => cue))).toEqual([]);
  });

  it("marks the block even with the chime off, so turning it on cannot replay it", () => {
    const silent = { ...TICK, tick: false, chime: false };
    const off = planCountdownCues(seededCueCursor(59.95, 300, silent), 60, 300, silent);
    expect(sounds(off.cues)).toEqual([]);
    const on = planCountdownCues(off.cursor, 61, 300, { ...silent, chime: true });
    expect(sounds(on.cues)).toEqual([]);
  });
});

describe("planCountdownCues — repeating haptic", () => {
  it("buzzes at each minute that is not the end of the sit", () => {
    const { cues } = run(freshCueCursor(HAPTIC), updates(0, 180), 180, { ...HAPTIC, chime: false });
    expect(cues).toEqual([
      [60, { kind: "haptic", cue: "minuteMarker" }],
      [120, { kind: "haptic", cue: "minuteMarker" }],
    ]);
  });

  it("buzzes every ten seconds when asked to", () => {
    const tenSeconds: SoundPrefs = { ...HAPTIC, hapticInterval: "tenSeconds" };
    const { cues } = run(freshCueCursor(tenSeconds), updates(0, 35), 300, tenSeconds);
    expect(cues.map(([elapsed]) => elapsed)).toEqual([10, 20, 30]);
  });

  it("is planned with haptics off too — maybeFireHaptic applies that preference", () => {
    const planned = planCountdownCues(seededCueCursor(59.95, 300, TICK), 60, 300, { ...TICK, tick: false, chime: false });
    expect(planned.cues).toEqual([{ kind: "haptic", cue: "minuteMarker" }]);
  });

  it("re-counts on an interval change instead of firing for the boundaries behind it", () => {
    const tenSeconds: SoundPrefs = { ...HAPTIC, hapticInterval: "tenSeconds" };
    const switched = planCountdownCues(seededCueCursor(25, 300, HAPTIC), 25.05, 300, tenSeconds);
    expect(switched.cues).toEqual([]);
    expect(switched.cursor).toMatchObject({ lastHapticInterval: 10, lastHapticIndex: 2 });
    const { cues } = run(switched.cursor, updates(25.05, 30), 300, tenSeconds);
    expect(cues).toEqual([[30, { kind: "haptic", cue: "minuteMarker" }]]);
  });

  it("plays voice or tick first, then the chime, then the buzz", () => {
    const both: SoundPrefs = { ...TICK, haptics: true };
    const planned = planCountdownCues(seededCueCursor(59.95, 300, both), 60, 300, both);
    expect(planned.cues).toEqual([
      { kind: "tick" },
      { kind: "chime" },
      { kind: "haptic", cue: "minuteMarker" },
    ]);
  });
});

describe("planSessionEndCues", () => {
  it("buzzes the end before the bell", () => {
    expect(planSessionEndCues(TICK)).toEqual([
      { kind: "haptic", cue: "sessionEnd" },
      { kind: "completion" },
    ]);
  });

  it("keeps the end buzz when the bell is off", () => {
    expect(planSessionEndCues({ ...TICK, completion: false })).toEqual([
      { kind: "haptic", cue: "sessionEnd" },
    ]);
    expect(planSessionEndCues(undefined)).toEqual([{ kind: "haptic", cue: "sessionEnd" }]);
  });
});
