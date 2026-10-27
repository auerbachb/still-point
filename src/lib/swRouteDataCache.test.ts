/**
 * Issue #967 — the worker's stored route data is account-scoped, so every
 * account teardown drops it from the page side.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearSwRouteDataCache, SW_ROUTE_DATA_CACHE_PREFIX } from "./swRouteDataCache";

function stubCaches(names: string[]) {
  const live = new Set(names);
  const api = {
    keys: vi.fn(async () => [...live]),
    delete: vi.fn(async (name: string) => live.delete(name)),
  };
  vi.stubGlobal("caches", api);
  return { live, api };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clearSwRouteDataCache", () => {
  test("drops every route-data cache and leaves the others", async () => {
    const { live } = stubCaches(["stillpoint-rsc-v1", "stillpoint-rsc-v0", "stillpoint-app-shell-v1"]);

    await clearSwRouteDataCache();

    expect([...live]).toEqual(["stillpoint-app-shell-v1"]);
  });

  test("never throws when Cache Storage fails", async () => {
    const { api } = stubCaches([]);
    api.keys.mockRejectedValue(new Error("SecurityError"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(clearSwRouteDataCache()).resolves.toBeUndefined();
  });

  test("is a no-op where Cache Storage does not exist", async () => {
    vi.stubGlobal("caches", undefined);

    await expect(clearSwRouteDataCache()).resolves.toBeUndefined();
  });

  test("matches the cache the worker writes", () => {
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    const name = sw.match(/const RSC_CACHE = "([^"]+)"/)?.[1];
    expect(name?.startsWith(SW_ROUTE_DATA_CACHE_PREFIX)).toBe(true);
  });
});

describe("account teardown", () => {
  test("the app page's teardown clears the route-data cache", () => {
    const page = readFileSync(new URL("../app/app/[[...tab]]/page.tsx", import.meta.url), "utf8");
    const teardown = page.slice(page.indexOf("const clearAccountScopedLocalState = () => {"));
    const body = teardown.slice(0, teardown.indexOf("\n  };"));
    expect(body).toContain("clearSwRouteDataCache()");
  });
});
