/** @vitest-environment jsdom */
import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@/lib/api";
import {
  clearCachedUser,
  clearCachedUserIfAuthoritative,
  loadCachedUser,
  saveCachedUser,
} from "./cachedUser";

const STORAGE_KEY = "stillpoint_cached_user_v1";

/**
 * jsdom 29 under Vitest 4 exposes a `window` with no `localStorage`, so the
 * suite supplies its own conforming Storage. The module reads the global at
 * call time (never at import), so installing it per test is enough, and the
 * production path is unchanged — it still talks to whatever `localStorage` the
 * browser provides.
 */
function installMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
  return storage;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "sitter@stillpoint.test",
    username: "sitter",
    isPublic: false,
    currentDay: 42,
    aphorismsEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  installMemoryStorage();
});

describe("cached identity round trip", () => {
  test("saves and reloads the full payload", () => {
    const user = makeUser({ recoveryTargetDay: 7, dualTrackEnabled: true, secondTrackDay: 3 });
    saveCachedUser(user);
    expect(loadCachedUser()).toEqual(user);
  });

  test("an empty store reads as no cache", () => {
    expect(loadCachedUser()).toBeNull();
  });

  test("clearing removes the copy", () => {
    saveCachedUser(makeUser());
    clearCachedUser();
    expect(loadCachedUser()).toBeNull();
  });

  test("unparseable storage reads as no cache rather than throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadCachedUser()).toBeNull();
  });

  test("a payload missing a required field is rejected, not half-rendered", () => {
    for (const field of ["id", "email", "username", "isPublic", "currentDay", "aphorismsEnabled"] as const) {
      const partial: Record<string, unknown> = { ...makeUser() };
      delete partial[field];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
      expect(loadCachedUser()).toBeNull();
    }
  });

  test("a wrongly-typed required field is rejected", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...makeUser(), currentDay: "42" }));
    expect(loadCachedUser()).toBeNull();
  });

  test("a non-object payload is rejected", () => {
    for (const raw of ["null", '"sitter"', "7", "[]"]) {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(loadCachedUser()).toBeNull();
    }
  });
});

describe("clearCachedUserIfAuthoritative", () => {
  test("an authoritative cause clears and reports that it did", () => {
    for (const cause of ["unauthorized", "signedOut"] as const) {
      saveCachedUser(makeUser());
      expect(clearCachedUserIfAuthoritative(cause)).toBe(true);
      expect(loadCachedUser()).toBeNull();
    }
  });

  test("a transport or server failure never destroys the cached identity", () => {
    for (const cause of ["unreachable", "serverError"] as const) {
      const user = makeUser();
      saveCachedUser(user);
      expect(clearCachedUserIfAuthoritative(cause)).toBe(false);
      expect(loadCachedUser()).toEqual(user);
    }
  });
});
