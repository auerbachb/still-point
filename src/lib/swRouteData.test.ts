/**
 * Issue #967 — offline, an in-app move's route data comes from the service
 * worker, so `router.push` stays in the same document instead of falling back
 * to a full page load.
 *
 * `public/sw.js` is a plain script with no exports, so this runs the real file
 * in a `node:vm` context (as sw.upload-deadline.test.ts does) with an in-memory
 * Cache Storage, then fires its `fetch` listener.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { ALL_TABS, pathForTab } from "./appTabs";

const serviceWorkerSource = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

const ORIGIN = "http://localhost:3000";
const RSC_KEY_ORIGIN = "https://still-point.internal/__rsc__";

type FetchStub = (input: string | { url: string }, init?: RequestInit) => Promise<Response>;

/** Cache Storage held in memory. Keys are compared as URLs, with no Vary. */
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (request: string | { url: string }) => (typeof request === "string" ? request : request.url);
  const open = async (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    const entries = store;
    return {
      match: async (request: string | { url: string }) => entries.get(keyOf(request))?.clone(),
      put: async (request: string | { url: string }, response: Response) => {
        entries.set(keyOf(request), response);
      },
      addAll: async () => {},
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (request: string | { url: string }) => {
        for (const store of stores.values()) {
          const hit = store.get(keyOf(request));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
  };
}

function rscResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { "Content-Type": "text/x-component", Vary: "RSC, Next-Router-State-Tree", ...init.headers },
  });
}

function loadServiceWorker(fetch: FetchStub) {
  const listeners = new Map<string, (event: unknown) => void>();
  const caches = memoryCaches();
  const context = vm.createContext({
    self: {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      location: { origin: ORIGIN },
    },
    caches: caches.api,
    fetch,
    URL,
    Headers,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(serviceWorkerSource, context);

  /** Fires the `fetch` listener. `responded` is undefined when the worker
   *  left the request to the network. */
  function dispatchFetch(request: { url: string; mode?: string; headers?: Record<string, string> }) {
    const listener = listeners.get("fetch");
    if (!listener) throw new Error("public/sw.js added no fetch listener");
    let responded: Promise<Response> | undefined;
    const waited: Promise<unknown>[] = [];
    listener({
      request: {
        method: "GET",
        mode: request.mode ?? "cors",
        url: request.url,
        headers: new Headers(request.headers ?? {}),
      },
      respondWith: (promise: Promise<Response>) => {
        responded = Promise.resolve(promise);
      },
      waitUntil: (promise: Promise<unknown>) => waited.push(Promise.resolve(promise)),
    });
    return {
      responded,
      /** Settles once the response and everything handed to `waitUntil` have. */
      settled: async () => {
        await responded?.catch(() => {});
        await Promise.all(waited);
      },
    };
  }

  async function storePayload(path: string, body: string) {
    const cache = await caches.api.open("stillpoint-rsc-v1");
    await cache.put(`${RSC_KEY_ORIGIN}${path}`, rscResponse(body));
  }

  return {
    dispatchFetch,
    storePayload,
    caches,
    warmPaths: vm.runInContext("RSC_WARM_PATHS", context) as string[],
  };
}

const offline: FetchStub = async () => {
  throw new TypeError("Failed to fetch");
};

describe("public/sw.js offline route data (#967)", () => {
  test("warms a payload for every app tab and every static app page", () => {
    const { warmPaths } = loadServiceWorker(offline);
    const staticPages = ["/app/settings/notifications", "/app/buddies/calendar", "/app/log-reason"];
    expect([...warmPaths].sort()).toEqual(["/app", ...ALL_TABS.map(pathForTab), ...staticPages].sort());
  });

  test("every static page under src/app/app is warmed", () => {
    const { warmPaths } = loadServiceWorker(offline);
    const appDir = fileURLToPath(new URL("../app/app", import.meta.url));
    const staticPages = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((file) => path.basename(file) === "page.tsx")
      .map((file) => path.dirname(file))
      // The tab catch-all and dynamic segments have no fixed path to warm.
      .filter((dir) => dir !== "." && !dir.split(path.sep).some((part) => part.startsWith("[")))
      .map((dir) => `/app/${dir.split(path.sep).join("/")}`);
    expect(staticPages.length).toBeGreaterThan(0);
    for (const page of staticPages) expect(warmPaths).toContain(page);
  });

  test("online, a move's route data comes from the network", async () => {
    const network = vi.fn<FetchStub>(async () => rscResponse("fresh"));
    const { dispatchFetch, storePayload } = loadServiceWorker(network);
    await storePayload("/app/progress", "stored");

    const { responded } = dispatchFetch({ url: `${ORIGIN}/app/progress?_rsc=abc`, headers: { RSC: "1" } });

    expect(await (await responded!).text()).toBe("fresh");
    expect(network).toHaveBeenCalledTimes(1);
  });

  test("offline, a move's route data comes from the stored payload", async () => {
    const { dispatchFetch, storePayload } = loadServiceWorker(offline);
    await storePayload("/app/progress", "stored home");

    const { responded } = dispatchFetch({ url: `${ORIGIN}/app/progress?_rsc=abc`, headers: { RSC: "1" } });
    const response = await responded!;

    expect(response.ok).toBe(true);
    expect(response.headers.get("Content-Type")).toBe("text/x-component");
    expect(await response.text()).toBe("stored home");
  });

  test("offline, a move with a search falls back to the path's payload", async () => {
    const { dispatchFetch, storePayload } = loadServiceWorker(offline);
    await storePayload("/app/progress", "stored home");

    const { responded } = dispatchFetch({
      url: `${ORIGIN}/app/progress?buddy=tok&_rsc=abc`,
      headers: { RSC: "1" },
    });

    expect(await (await responded!).text()).toBe("stored home");
  });

  test("offline with nothing stored, the fetch still fails, so Next.js loads the document", async () => {
    const { dispatchFetch } = loadServiceWorker(offline);

    const { responded } = dispatchFetch({ url: `${ORIGIN}/app/journal?_rsc=abc`, headers: { RSC: "1" } });

    await expect(responded!).rejects.toThrow("Failed to fetch");
  });

  test("prefetches are left to the network", () => {
    const { dispatchFetch } = loadServiceWorker(offline);

    const { responded } = dispatchFetch({
      url: `${ORIGIN}/app/journal?_rsc=abc`,
      headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    });

    expect(responded).toBeUndefined();
  });

  test("an app document loaded online refreshes every route's whole-tree payload", async () => {
    const calls: { url: string; rsc: string | null }[] = [];
    const network = vi.fn<FetchStub>(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("?_rsc")) {
        calls.push({ url, rsc: new Headers(init?.headers).get("RSC") });
        return rscResponse(`payload for ${url.split("?")[0]}`);
      }
      return new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
    });
    const { dispatchFetch, caches, warmPaths } = loadServiceWorker(network);

    const { settled } = dispatchFetch({ url: `${ORIGIN}/app/progress`, mode: "navigate" });
    await settled();

    expect(calls.map((call) => call.url).sort()).toEqual(warmPaths.map((path) => `${path}?_rsc`).sort());
    expect(calls.every((call) => call.rsc === "1")).toBe(true);
    const stored = caches.stores.get("stillpoint-rsc-v1");
    expect(await stored?.get(`${RSC_KEY_ORIGIN}/app/journal`)?.text()).toBe("payload for /app/journal");
    expect(stored?.get(`${RSC_KEY_ORIGIN}/app/journal`)?.headers.get("Vary")).toBeNull();
  });

  test("a refresh keeps the stored payload when the answer is not route data", async () => {
    const network = vi.fn<FetchStub>(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("?_rsc")) return new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } });
      return new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
    });
    const { dispatchFetch, storePayload, caches } = loadServiceWorker(network);
    await storePayload("/app/journal", "older payload");

    const { settled } = dispatchFetch({ url: `${ORIGIN}/app/progress`, mode: "navigate" });
    await settled();

    expect(await caches.stores.get("stillpoint-rsc-v1")?.get(`${RSC_KEY_ORIGIN}/app/journal`)?.text()).toBe(
      "older payload",
    );
  });

  describe("refresh throttle", () => {
    /** A network whose route-data answers can be failed per path, counting them. */
    function countingNetwork(failing: Set<string>) {
      const rscCalls: string[] = [];
      const network = vi.fn<FetchStub>(async (input) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("?_rsc")) {
          const path = url.split("?")[0];
          rscCalls.push(path);
          if (failing.has(path)) throw new TypeError("Failed to fetch");
          return rscResponse(`payload for ${path}`);
        }
        return new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
      });
      return { network, rscCalls };
    }

    async function loadApp(dispatchFetch: ReturnType<typeof loadServiceWorker>["dispatchFetch"]) {
      await dispatchFetch({ url: `${ORIGIN}/app/progress`, mode: "navigate" }).settled();
    }

    test("a pass that stored every route holds off the next refresh", async () => {
      const { network, rscCalls } = countingNetwork(new Set());
      const { dispatchFetch, warmPaths } = loadServiceWorker(network);

      await loadApp(dispatchFetch);
      await loadApp(dispatchFetch);

      expect(rscCalls).toHaveLength(warmPaths.length);
    });

    test("a pass that missed a route does not hold off the next refresh", async () => {
      const failing = new Set(["/app/journal"]);
      const { network, rscCalls } = countingNetwork(failing);
      const { dispatchFetch, caches, warmPaths } = loadServiceWorker(network);

      await loadApp(dispatchFetch);
      failing.clear();
      await loadApp(dispatchFetch);

      expect(rscCalls).toHaveLength(warmPaths.length * 2);
      expect(await caches.stores.get("stillpoint-rsc-v1")?.get(`${RSC_KEY_ORIGIN}/app/journal`)?.text()).toBe(
        "payload for /app/journal",
      );
    });

    test("a cache cleared on sign-out is warmed again at once", async () => {
      const { network, rscCalls } = countingNetwork(new Set());
      const { dispatchFetch, caches, warmPaths } = loadServiceWorker(network);

      await loadApp(dispatchFetch);
      await caches.api.delete("stillpoint-rsc-v1");
      await loadApp(dispatchFetch);

      expect(rscCalls).toHaveLength(warmPaths.length * 2);
      expect(caches.stores.get("stillpoint-rsc-v1")?.size).toBe(warmPaths.length);
    });
  });

  test("an offline page load never gets route data in place of its document", async () => {
    const { dispatchFetch, storePayload } = loadServiceWorker(offline);
    await storePayload("/app/journal", "stored journal");

    const { responded } = dispatchFetch({ url: `${ORIGIN}/app/journal`, mode: "navigate" });

    // No document is stored here, so the fallback finds nothing rather than
    // the route data stored for the same path.
    expect(await responded!).toBeUndefined();
  });
});
