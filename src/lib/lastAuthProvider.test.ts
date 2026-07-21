import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthProvider, isOAuthProvider, loadLastAuthProvider, saveLastAuthProvider, STORAGE_KEY } from "./lastAuthProvider";

function stubBrowserStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorageStub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: localStorageStub });
  vi.stubGlobal("localStorage", localStorageStub);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isOAuthProvider", () => {
  it("accepts known providers", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("apple")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isOAuthProvider("facebook")).toBe(false);
    expect(isOAuthProvider("")).toBe(false);
    expect(isOAuthProvider(null)).toBe(false);
    expect(isOAuthProvider(undefined)).toBe(false);
  });

  it("rejects 'password' (password is not an OAuth provider)", () => {
    expect(isOAuthProvider("password")).toBe(false);
  });
});

describe("isAuthProvider", () => {
  it("accepts OAuth providers", () => {
    expect(isAuthProvider("google")).toBe(true);
    expect(isAuthProvider("apple")).toBe(true);
  });

  it("accepts 'password'", () => {
    expect(isAuthProvider("password")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isAuthProvider("facebook")).toBe(false);
    expect(isAuthProvider("")).toBe(false);
    expect(isAuthProvider(null)).toBe(false);
    expect(isAuthProvider(undefined)).toBe(false);
  });
});

describe("loadLastAuthProvider", () => {
  it("returns null during SSR (no window)", () => {
    expect(loadLastAuthProvider()).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    stubBrowserStorage();
    expect(loadLastAuthProvider()).toBeNull();
  });

  it("returns a stored valid OAuth provider", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "google" });
    expect(loadLastAuthProvider()).toBe("google");
  });

  it("returns 'password' when stored", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "password" });
    expect(loadLastAuthProvider()).toBe("password");
  });

  it("returns null for a tampered/unknown stored value", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "github" });
    expect(loadLastAuthProvider()).toBeNull();
  });

  it("returns null when localStorage throws", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    vi.stubGlobal("window", { localStorage: throwingStorage });
    vi.stubGlobal("localStorage", throwingStorage);
    expect(loadLastAuthProvider()).toBeNull();
  });
});

describe("saveLastAuthProvider", () => {
  it("is a no-op during SSR (no window)", () => {
    expect(() => saveLastAuthProvider("google")).not.toThrow();
  });

  it("persists an OAuth provider and round-trips through load", () => {
    const store = stubBrowserStorage();
    saveLastAuthProvider("apple");
    expect(store.get(STORAGE_KEY)).toBe("apple");
    expect(loadLastAuthProvider()).toBe("apple");
  });

  it("persists 'password' and round-trips through load", () => {
    const store = stubBrowserStorage();
    saveLastAuthProvider("password");
    expect(store.get(STORAGE_KEY)).toBe("password");
    expect(loadLastAuthProvider()).toBe("password");
  });

  it("overwrites a previously stored provider", () => {
    const store = stubBrowserStorage({ [STORAGE_KEY]: "google" });
    saveLastAuthProvider("apple");
    expect(store.get(STORAGE_KEY)).toBe("apple");
  });

  it("ignores storage write failures", () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.stubGlobal("window", { localStorage: throwingStorage });
    vi.stubGlobal("localStorage", throwingStorage);
    expect(() => saveLastAuthProvider("google")).not.toThrow();
  });
});
