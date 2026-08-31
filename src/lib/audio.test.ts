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
/** Every context the module under test constructed, newest last. */
const createdContexts: MockAudioContext[] = [];

/** The context the audio module is currently using. */
function currentContext(): MockAudioContext {
  const ctx = createdContexts.at(-1);
  if (!ctx) throw new Error("no AudioContext was created");
  return ctx;
}

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
  /** Number of `resume()` calls, so tests can assert the no-op path (#710). */
  resumeCallCount = 0;

  constructor() {
    // A context created outside a gesture (e.g. by a silent chime attempt while
    // the buddy timer is already running) starts suspended.
    this.state = gesture.active ? "running" : "suspended";
    if (gesture.active) this.primedDuringGesture = true;
    createdContexts.push(this);
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
    this.resumeCallCount++;
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
  createdContexts.length = 0;
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

describe("resumeAudioContext — mid-session recovery (#710)", () => {
  it("does not create a context when none exists", async () => {
    // Creating one outside a user gesture would leave it permanently suspended
    // on strict-autoplay browsers — worse than doing nothing.
    const { resumeAudioContext } = await loadAudio();
    await expect(resumeAudioContext()).resolves.toBe(false);
    expect(createdContexts).toHaveLength(0);
  });

  it("returns false when Web Audio is unsupported", async () => {
    const { resumeAudioContext } = await loadAudio({ withAudioContext: false });
    await expect(resumeAudioContext()).resolves.toBe(false);
  });

  it("resumes a context the browser suspended mid-session, no new gesture needed", async () => {
    const { unlockAudioContext, resumeAudioContext, playTick } = await loadAudio();

    // Sound is working at the start of the sit.
    gesture.active = true;
    await unlockAudioContext();
    gesture.active = false;
    expect(playTick()).toBe(true);

    // The tab is backgrounded or the screen locks and the browser suspends the
    // context. This is the state that used to persist for the rest of the sit.
    await currentContext().suspend();
    expect(playTick()).toBe(false);

    // Returning to the page recovers it: the context was primed by the original
    // gesture, so resume() alone is enough even under the strict policy.
    await expect(resumeAudioContext()).resolves.toBe(true);
    expect(playTick()).toBe(true);
  });

  it("reports false when the browser refuses to resume", async () => {
    const { resumeAudioContext, playTick } = await loadAudio();
    // Context created outside a gesture → never primed → strict policy refuses.
    // The gesture-driven unlockAudioContext() stays the recovery path.
    expect(playTick()).toBe(false);
    await expect(resumeAudioContext()).resolves.toBe(false);
  });

  it("is a no-op that reports success when the context is already running", async () => {
    const { unlockAudioContext, resumeAudioContext } = await loadAudio();
    gesture.active = true;
    await unlockAudioContext();
    gesture.active = false;

    const ctx = currentContext();
    const callsBefore = ctx.resumeCallCount;
    await expect(resumeAudioContext()).resolves.toBe(true);
    expect(ctx.resumeCallCount).toBe(callsBefore);
  });

  it("swallows a rejected resume() instead of throwing into the tick loop", async () => {
    const rejectingCtor = class extends MockAudioContext {
      async resume(): Promise<void> {
        throw new Error("NotAllowedError");
      }
    };
    const { resumeAudioContext, playTick } = await loadAudio({ ctor: rejectingCtor });
    expect(playTick()).toBe(false); // lazily creates the suspended context
    await expect(resumeAudioContext()).resolves.toBe(false);
  });
});
