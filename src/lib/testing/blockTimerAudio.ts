import type * as Audio from "@/lib/audio";

/**
 * The fake audio boundary behind every `src/components/BlockTimer.*.test.ts`
 * file (#1143). Each file mocks `@/lib/audio` from a factory that imports this
 * module:
 *
 * ```ts
 * vi.mock("@/lib/audio", async (importOriginal) => {
 *   const { mockAudio } = await import("@/lib/testing/blockTimerAudio");
 *   return mockAudio(await importOriginal<typeof import("@/lib/audio")>());
 * });
 * ```
 *
 * It lives apart from `blockTimerHarness.ts` on purpose: the harness imports
 * the component, the component imports the mocked module, so a factory that
 * imported the harness would wait on itself.
 *
 * Every cue is recorded at the boundary it leaves the app, stamped with the
 * fake clock, so the same log has to come out whichever module produces it.
 */

export const env = {
  t0: 0,
  log: [] as string[],
  /** Sound name → how many of its next plays fail (a suspended context). */
  failures: new Map<string, number>(),
  resume: (): Promise<boolean> => Promise.resolve(true),
};

export function record(what: string) {
  env.log.push(`${((Date.now() - env.t0) / 1000).toFixed(2)} ${what}`);
}

function play(name: string) {
  const left = env.failures.get(name) ?? 0;
  if (left > 0) {
    env.failures.set(name, left - 1);
    record(`${name} blocked`);
    return false;
  }
  record(name);
  return true;
}

/** The real module with every sound, and the context it plays through, faked. */
export function mockAudio(actual: typeof Audio): typeof Audio {
  return {
    ...actual,
    playTick: () => play("tick"),
    playChime: () => play("chime"),
    playCompletion: () => play("completion"),
    playVoiceCountdown: (seconds: number) => play(`voice:${seconds}`),
    cancelVoiceCountdownPlayback: () => record("cancelVoice"),
    resumeAudioContext: () => {
      record("resume");
      return env.resume();
    },
    subscribeAudioContextState: () => () => {},
  };
}
