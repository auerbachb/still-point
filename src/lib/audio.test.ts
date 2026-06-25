import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Faithful-enough model of the Web Audio autoplay policy.
 *
 * - "lenient" (desktop Chrome): `resume()` invoked during a user gesture flips
 *   the context to "running" on its own.
 * - "strict" (iOS Safari / WebKit): `resume()` resolves but the context only
 *   becomes "running" once a sound-producing node has actually been *started*
 *   from within a user gesture. This is the case that left a buddy's tick
 *   silent even after #233 added a `resume()`-only unlock (issue #131).
 */
type Policy = "lenient" | "strict";

const gesture = { active: false };
let policy: Policy = "strict";

class MockAudioParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class MockNode {
  connect() {}
}

class MockOscillator extends MockNode {
  type = "sine";
  frequency = new MockAudioParam();
  constructor(private readonly ctx: MockAudioContext) {
    super();
  }
  start() {
    this.ctx.noteStarted();
  }
  stop() {}
}

class MockGain extends MockNode {
  gain = new MockAudioParam();
}

class MockBufferSource extends MockNode {
  buffer: unknown = null;
  constructor(private readonly ctx: MockAudioContext) {
    super();
  }
  start() {
    this.ctx.noteStarted();
  }
  stop() {}
}

class MockAudioContext {
  state: "suspended" | "running" | "closed";
  currentTime = 0;
  destination = new MockNode();
  /** True once a node has been started while a user gesture was active. */
  primedDuringGesture = false;

  constructor() {
    // A context created outside a gesture (e.g. by a silent chime attempt while
    // the buddy timer is already running) starts suspended.
    this.state = gesture.active ? "running" : "suspended";
    if (gesture.active) this.primedDuringGesture = true;
  }

  noteStarted() {
    if (gesture.active) this.primedDuringGesture = true;
  }

  createOscillator() {
    return new MockOscillator(this);
  }
  createGain() {
    return new MockGain();
  }
  createBufferSource() {
    return new MockBufferSource(this);
  }
  createBuffer() {
    return {};
  }

  async resume() {
    if (policy === "lenient") {
      if (gesture.active || this.primedDuringGesture) this.state = "running";
    } else {
      // strict: resume() alone is not enough — a node must have been started
      // from within a gesture.
      if (this.primedDuringGesture) this.state = "running";
    }
  }

  async suspend() {
    this.state = "suspended";
  }
}

type AudioModule = typeof import("./audio");

async function loadAudio(opts?: {
  withAudioContext?: boolean;
  ctor?: typeof MockAudioContext;
}): Promise<AudioModule> {
  const withAudioContext = opts?.withAudioContext ?? true;
  const ctor = opts?.ctor ?? MockAudioContext;
  vi.resetModules();
  (globalThis as { window?: unknown }).window = withAudioContext
    ? { AudioContext: ctor as unknown as typeof AudioContext }
    : {};
  return import("./audio");
}

beforeEach(() => {
  gesture.active = false;
  policy = "strict";
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("unlockAudioContext — autoplay policy", () => {
  it("returns 'unavailable' when Web Audio is not supported", async () => {
    const { unlockAudioContext } = await loadAudio({ withAudioContext: false });
    await expect(unlockAudioContext()).resolves.toBe("unavailable");
  });

  it("desktop Chrome (lenient): toggle gesture unlocks and tick plays", async () => {
    policy = "lenient";
    const { unlockAudioContext, playTick } = await loadAudio();

    // Before any gesture the suspended context cannot produce sound.
    expect(playTick()).toBe(false);

    gesture.active = true;
    const result = await unlockAudioContext();
    gesture.active = false;

    expect(result).toBe("unlocked");
    expect(playTick()).toBe(true);
  });

  it("regression: on a strict (iOS/WebKit) context, resume() alone stays silent", async () => {
    // This reproduces the #131 silent path: #233 only called resume().
    const ctx = new MockAudioContext(); // suspended (created outside a gesture)
    gesture.active = true;
    await ctx.resume(); // resume-only, no primed node
    gesture.active = false;

    expect(ctx.state).toBe("suspended"); // still blocked → buddy hears nothing
  });

  it("fix: strict (iOS/WebKit) context unlocks because the gesture primes a node", async () => {
    const { unlockAudioContext, playTick, playChime, playCompletion } = await loadAudio();

    // Simulate a silent chime attempt that lazily created the suspended context
    // before the buddy ever interacted with the sound controls.
    expect(playTick()).toBe(false);

    // Buddy toggles tick ON → unlock runs inside the user gesture.
    gesture.active = true;
    const result = await unlockAudioContext();
    gesture.active = false;

    expect(result).toBe("unlocked");
    // All synthesized sounds now reach the (running) context.
    expect(playTick()).toBe(true);
    expect(playChime(2)).toBe(true);
    expect(playCompletion()).toBe(true);
  });

  it("reports 'blocked' when the gesture cannot unlock the context", async () => {
    const { unlockAudioContext } = await loadAudio();
    // No gesture active → strict policy keeps it suspended even after priming.
    const result = await unlockAudioContext();
    expect(result).toBe("blocked");
  });

  it("priming is best-effort: unlock still resolves if node creation throws", async () => {
    const throwingCtor = class extends MockAudioContext {
      createBufferSource(): MockBufferSource {
        throw new Error("createBufferSource not implemented");
      }
    };
    const { unlockAudioContext, playTick } = await loadAudio({ ctor: throwingCtor });

    policy = "lenient";
    // Create the suspended context outside a gesture so unlock takes the
    // prime + resume() path where createBufferSource throws.
    expect(playTick()).toBe(false);

    gesture.active = true;
    const result = await unlockAudioContext();
    gesture.active = false;

    expect(result).toBe("unlocked");
  });
});
