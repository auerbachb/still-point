import { describe, expect, test } from "vitest";
import {
  authErrorMessageFor,
  mayClearAccountScopedState,
  resolveAuthBootstrap,
  signedOutCauseFor,
  type SignedOutCause,
} from "./offlineAuth";

/**
 * #666 — the web half of offline-first identity. These mirror the iOS
 * `OfflineAuthTests` case for case, so a divergence between the two clients
 * shows up as a failing test rather than as different behavior in a dead zone.
 */
describe("signedOutCauseFor", () => {
  test("only an auth answer from the server is authoritative", () => {
    expect(signedOutCauseFor({ kind: "status", status: 401 })).toBe("unauthorized");
    expect(signedOutCauseFor({ kind: "status", status: 403 })).toBe("unauthorized");
  });

  test("a missing account row is an authoritative sign-out", () => {
    expect(signedOutCauseFor({ kind: "status", status: 404 })).toBe("signedOut");
  });

  test("a response that never arrived is unreachable, never a sign-out", () => {
    expect(signedOutCauseFor({ kind: "transport" })).toBe("unreachable");
    expect(signedOutCauseFor({ kind: "status", status: 0 })).toBe("unreachable");
    expect(signedOutCauseFor({ kind: "status", status: -1 })).toBe("unreachable");
  });

  test("anything else the server said says nothing about auth", () => {
    for (const status of [400, 408, 429, 500, 502, 503, 504]) {
      expect(signedOutCauseFor({ kind: "status", status })).toBe("serverError");
    }
  });
});

describe("mayClearAccountScopedState", () => {
  test("mirrors the widget predicate exactly", () => {
    const table: Array<[SignedOutCause, boolean]> = [
      ["signedOut", true],
      ["unauthorized", true],
      ["serverError", false],
      ["unreachable", false],
    ];
    for (const [cause, expected] of table) {
      expect(mayClearAccountScopedState(cause)).toBe(expected);
    }
  });
});

describe("resolveAuthBootstrap", () => {
  test("a transport failure with a cached user keeps you signed in, offline", () => {
    const outcome = resolveAuthBootstrap({ kind: "transport" }, true);
    expect(outcome).toEqual({
      action: "offline",
      cause: "unreachable",
      clearsLocalState: false,
      usesCachedIdentity: true,
    });
  });

  test("a 5xx with a cached user keeps you signed in too", () => {
    const outcome = resolveAuthBootstrap({ kind: "status", status: 503 }, true);
    expect(outcome.action).toBe("offline");
    expect(outcome.cause).toBe("serverError");
    expect(outcome.clearsLocalState).toBe(false);
  });

  test("a 401 signs you out and authorizes the local teardown", () => {
    const outcome = resolveAuthBootstrap({ kind: "status", status: 401 }, true);
    expect(outcome).toEqual({
      action: "signedOut",
      cause: "unauthorized",
      clearsLocalState: true,
      usesCachedIdentity: false,
    });
  });

  test("a 403 signs you out the same way", () => {
    expect(resolveAuthBootstrap({ kind: "status", status: 403 }, true).action).toBe("signedOut");
  });

  test("a 401 signs you out even with nothing cached", () => {
    const outcome = resolveAuthBootstrap({ kind: "status", status: 401 }, false);
    expect(outcome.action).toBe("signedOut");
    expect(outcome.clearsLocalState).toBe(true);
  });

  test("a transport failure with nothing cached is retryable, and destroys nothing", () => {
    const outcome = resolveAuthBootstrap({ kind: "transport" }, false);
    expect(outcome).toEqual({
      action: "unavailable",
      cause: "unreachable",
      clearsLocalState: false,
      usesCachedIdentity: false,
    });
  });

  test("no transport failure ever authorizes clearing local state", () => {
    for (const hasCachedUser of [true, false]) {
      expect(resolveAuthBootstrap({ kind: "transport" }, hasCachedUser).clearsLocalState).toBe(false);
      expect(resolveAuthBootstrap({ kind: "status", status: 500 }, hasCachedUser).clearsLocalState).toBe(false);
    }
  });

  test("only the offline outcome runs from the cached identity", () => {
    expect(resolveAuthBootstrap({ kind: "transport" }, true).usesCachedIdentity).toBe(true);
    expect(resolveAuthBootstrap({ kind: "transport" }, false).usesCachedIdentity).toBe(false);
    expect(resolveAuthBootstrap({ kind: "status", status: 401 }, true).usesCachedIdentity).toBe(false);
  });
});

describe("authErrorMessageFor", () => {
  test("distinguishes a dead network from a server problem", () => {
    expect(authErrorMessageFor("unreachable")).toContain("network issue");
    expect(authErrorMessageFor("serverError")).toContain("server issue");
  });
});
