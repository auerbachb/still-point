import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BREATH_KEY_BINDING,
  breathKeyBindingLabel,
  eventMatchesBreathKeyBinding,
  loadBreathKeyBinding,
  saveBreathKeyBinding,
  subscribeBreathKeyBinding,
} from "./breathKeyBinding";

const STORAGE_KEY = "stillpoint_breath_key_binding";

function stubBrowserStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  vi.stubGlobal("window", {
    localStorage: localStorageMock,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("localStorage", localStorageMock);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadBreathKeyBinding", () => {
  it("defaults to Space without window (SSR guard)", () => {
    expect(loadBreathKeyBinding()).toBe("Space");
    expect(DEFAULT_BREATH_KEY_BINDING).toBe("Space");
  });

  it("returns default when nothing is stored", () => {
    stubBrowserStorage();
    expect(loadBreathKeyBinding()).toBe("Space");
  });

  it("reads a stored ArrowRight binding", () => {
    stubBrowserStorage({ [STORAGE_KEY]: JSON.stringify({ binding: "ArrowRight" }) });
    expect(loadBreathKeyBinding()).toBe("ArrowRight");
  });

  it("falls back to default on corrupt JSON", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "{not json" });
    expect(loadBreathKeyBinding()).toBe("Space");
  });

  it.each([
    ["non-object JSON", JSON.stringify("ArrowRight")],
    ["null", JSON.stringify(null)],
    ["unknown binding value", JSON.stringify({ binding: "Enter" })],
    ["missing field", JSON.stringify({ other: true })],
  ])("falls back to default for %s", (_label, raw) => {
    stubBrowserStorage({ [STORAGE_KEY]: raw });
    expect(loadBreathKeyBinding()).toBe("Space");
  });
});

describe("saveBreathKeyBinding", () => {
  it("is a no-op without window (SSR guard)", () => {
    expect(() => saveBreathKeyBinding("ArrowRight")).not.toThrow();
  });

  it("round-trips through storage", () => {
    const store = stubBrowserStorage();
    saveBreathKeyBinding("ArrowRight");
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toEqual({ binding: "ArrowRight" });
    expect(loadBreathKeyBinding()).toBe("ArrowRight");
  });
});

describe("eventMatchesBreathKeyBinding", () => {
  it("matches Space by code", () => {
    expect(eventMatchesBreathKeyBinding({ code: "Space", key: " " }, "Space")).toBe(true);
  });

  it("matches Space by legacy key values", () => {
    expect(eventMatchesBreathKeyBinding({ code: "", key: " " }, "Space")).toBe(true);
    expect(eventMatchesBreathKeyBinding({ code: "", key: "Spacebar" }, "Space")).toBe(true);
  });

  it("matches ArrowRight by code and key", () => {
    expect(eventMatchesBreathKeyBinding({ code: "ArrowRight", key: "ArrowRight" }, "ArrowRight")).toBe(true);
    expect(eventMatchesBreathKeyBinding({ code: "", key: "ArrowRight" }, "ArrowRight")).toBe(true);
  });

  it("does not cross-match between bindings", () => {
    expect(eventMatchesBreathKeyBinding({ code: "Space", key: " " }, "ArrowRight")).toBe(false);
    expect(eventMatchesBreathKeyBinding({ code: "ArrowRight", key: "ArrowRight" }, "Space")).toBe(false);
  });

  it("does not match unrelated keys", () => {
    expect(eventMatchesBreathKeyBinding({ code: "Enter", key: "Enter" }, "Space")).toBe(false);
    expect(eventMatchesBreathKeyBinding({ code: "KeyA", key: "a" }, "ArrowRight")).toBe(false);
  });
});

describe("breathKeyBindingLabel", () => {
  it("labels bindings for the UI", () => {
    expect(breathKeyBindingLabel("Space")).toBe("Space");
    expect(breathKeyBindingLabel("ArrowRight")).toBe("Right Arrow");
  });
});

describe("subscribeBreathKeyBinding", () => {
  it("notifies subscribers on save and stops after unsubscribe", () => {
    stubBrowserStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeBreathKeyBinding(listener);

    saveBreathKeyBinding("ArrowRight");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveBreathKeyBinding("Space");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("registers a cross-tab storage listener while subscribed", () => {
    stubBrowserStorage();
    const win = window as unknown as {
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };
    const unsubscribe = subscribeBreathKeyBinding(() => {});
    expect(win.addEventListener).toHaveBeenCalledWith("storage", expect.any(Function));
    unsubscribe();
    expect(win.removeEventListener).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});
