/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAudioContextResume } from "./useAudioContextResume";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audio = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  let releaseResume: (() => void) | null = null;
  const resumeAudioContext = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        releaseResume = () => resolve(true);
      }),
  );
  return {
    listeners,
    resumeAudioContext,
    release() {
      const done = releaseResume;
      releaseResume = null;
      done?.();
    },
    emit(state: string) {
      for (const listener of listeners) listener(state);
    },
  };
});

vi.mock("@/lib/audio", () => ({
  audioContextStateNeedsResume: (state: string) =>
    state === "suspended" || state === "interrupted",
  resumeAudioContext: () => audio.resumeAudioContext(),
  subscribeAudioContextState: (listener: (state: string) => void) => {
    audio.listeners.add(listener);
    return () => {
      audio.listeners.delete(listener);
    };
  },
}));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function renderHook(enabled: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const render = async (next: boolean) => {
    await act(async () => {
      root?.render(createElement(() => {
        useAudioContextResume(next);
        return null;
      }));
    });
  };
  await act(async () => {
    root = createRoot(container);
  });
  await render(enabled);
  return {
    rerender: render,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

describe("useAudioContextResume", () => {
  afterEach(() => {
    audio.listeners.clear();
    audio.resumeAudioContext.mockClear();
    audio.release();
    document.body.innerHTML = "";
  });

  it("resumes when the context suspends while the page is visible", async () => {
    setVisibility("visible");
    const view = await renderHook(true);
    // Mount itself resumes once, for a context suspended before the sit.
    expect(audio.resumeAudioContext).toHaveBeenCalledTimes(1);
    audio.release();
    await act(async () => {
      audio.emit("suspended");
    });
    expect(audio.resumeAudioContext).toHaveBeenCalledTimes(2);
    audio.release();
    await view.unmount();
  });

  it("does not resume while the page is hidden", async () => {
    setVisibility("hidden");
    const view = await renderHook(true);
    await act(async () => {
      audio.emit("interrupted");
    });
    expect(audio.resumeAudioContext).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("stops listening after the sit ends", async () => {
    setVisibility("visible");
    const view = await renderHook(true);
    audio.release();
    await view.unmount();
    audio.resumeAudioContext.mockClear();
    audio.emit("suspended");
    expect(audio.resumeAudioContext).not.toHaveBeenCalled();
    expect(audio.listeners.size).toBe(0);
  });

  it("stops listening when the sit is disabled", async () => {
    setVisibility("visible");
    const view = await renderHook(true);
    audio.release();
    await view.rerender(false);
    audio.resumeAudioContext.mockClear();
    audio.emit("suspended");
    expect(audio.resumeAudioContext).not.toHaveBeenCalled();
    expect(audio.listeners.size).toBe(0);
    await view.unmount();
  });

  it("does not run two resumes at once", async () => {
    setVisibility("visible");
    let inFlight = 0;
    let maxInFlight = 0;
    audio.resumeAudioContext.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          queueMicrotask(() => {
            inFlight -= 1;
            resolve(true);
          });
        }),
    );
    const view = await renderHook(true);
    await act(async () => {
      audio.emit("suspended");
      audio.emit("interrupted");
    });
    expect(maxInFlight).toBe(1);
    // The in-flight call plus one follow-up for the event that landed mid-flight.
    expect(audio.resumeAudioContext.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(audio.resumeAudioContext.mock.calls.length).toBeLessThanOrEqual(3);
    await view.unmount();
  });
});
