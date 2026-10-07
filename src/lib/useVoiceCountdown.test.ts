/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockNode {
  connect() {}
}

class MockBufferSource extends MockNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    super();
    MockBufferSource.created.push(this);
  }
  static created: MockBufferSource[] = [];
}

class MockAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = new MockNode();
  addEventListener() {}
  removeEventListener() {}
  createBufferSource() {
    return new MockBufferSource();
  }
  createBuffer() {
    return {};
  }
  async decodeAudioData() {
    return { duration: 0.5 };
  }
}

async function load() {
  vi.resetModules();
  window.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  const audio = await import("./audio");
  const hook = await import("./useVoiceCountdown");
  return { ...audio, useVoiceCountdown: hook.useVoiceCountdown };
}

function VoiceProbe({
  enabled,
  hook,
}: {
  enabled: boolean;
  hook: (enabled: boolean) => void;
}) {
  hook(enabled);
  return null;
}

async function renderEnabled(useVoiceCountdown: (enabled: boolean) => void, enabled: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const render = async (next: boolean) => {
    await act(async () => {
      root?.render(createElement(VoiceProbe, { enabled: next, hook: useVoiceCountdown }));
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

beforeEach(() => {
  MockBufferSource.created = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useVoiceCountdown", () => {
  it("preloads when enabled so a countdown clip can start", async () => {
    const { useVoiceCountdown, playVoiceCountdown } = await load();
    const view = await renderEnabled(useVoiceCountdown, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(playVoiceCountdown(10)).toBe(true);
    expect(MockBufferSource.created).toHaveLength(1);
    expect(MockBufferSource.created[0].start).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("stops the playing clip when voice is turned off", async () => {
    const { useVoiceCountdown, playVoiceCountdown } = await load();
    const view = await renderEnabled(useVoiceCountdown, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    playVoiceCountdown(10);
    const source = MockBufferSource.created[0];
    await view.rerender(false);
    expect(source.stop).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("does not preload when voice stays off", async () => {
    const fetchMock = vi.mocked(fetch);
    const { useVoiceCountdown } = await load();
    const view = await renderEnabled(useVoiceCountdown, false);
    expect(fetchMock).not.toHaveBeenCalled();
    await view.unmount();
  });
});
