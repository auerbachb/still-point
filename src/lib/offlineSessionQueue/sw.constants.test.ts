/**
 * Issue #1118 — `public/sw.js` cannot import `./constants`, so it keeps its own
 * copy of the constants it shares with the tabs. This runs the real worker
 * script in a `node:vm` context and checks every export of `./constants`
 * against it, so a constant added on one side only, or changed on one side
 * only, fails here instead of drifting silently.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import * as constants from "./constants";

const serviceWorkerSource = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

/** Exports the service worker never uses, so it must not declare them. */
const TAB_ONLY = new Set<string>(["OFFLINE_OPEN_ROW_LOCK_PREFIX"]);

/** Runs `public/sw.js` with only the globals its top level touches. */
function loadServiceWorkerContext(): vm.Context {
  const context = vm.createContext({
    self: { addEventListener: () => {} },
    clients: { matchAll: async () => [] },
    fetch: async () => ({}),
    AbortController,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(serviceWorkerSource, context);
  return context;
}

/** Whether the worker's top level declares `name`. `typeof` never throws on an undeclared name. */
function workerDeclares(context: vm.Context, name: string): boolean {
  return vm.runInContext(`typeof ${name} !== "undefined"`, context) as boolean;
}

const exportedNames = Object.keys(constants).sort();
const sharedNames = exportedNames.filter((name) => !TAB_ONLY.has(name));

describe("public/sw.js copies of ./constants (#1118)", () => {
  const context = loadServiceWorkerContext();

  test("every tab-only name is still exported", () => {
    // A stale entry would let a later export of the same name skip the check below.
    expect([...TAB_ONLY].filter((name) => !exportedNames.includes(name))).toEqual([]);
  });

  test.each(sharedNames)("declares %s with the same value", (name) => {
    expect(workerDeclares(context, name)).toBe(true);
    // `toEqual`, not `toBe`, so a future array or object constant compares by value.
    expect(vm.runInContext(name, context)).toEqual(constants[name as keyof typeof constants]);
  });

  test.each([...TAB_ONLY])("does not declare tab-only %s", (name) => {
    expect(workerDeclares(context, name)).toBe(false);
  });
});
