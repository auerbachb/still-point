import { vi } from "vitest";

/**
 * The fake sync coordinator behind every `useSessionSaveLifecycle.*.test.ts`
 * file (#1006). Each file mocks `@/lib/offlineSessionQueue` to return this
 * object, from a factory that imports this module:
 *
 * ```ts
 * vi.mock("@/lib/offlineSessionQueue", async () => {
 *   const { queue } = await import("@/lib/testing/sessionSaveLifecycleQueue");
 *   return { getWebSessionSyncCoordinator: () => queue };
 * });
 * ```
 *
 * It lives apart from `sessionSaveLifecycleHarness.ts` on purpose: the harness
 * imports the hook, the hook imports the mocked module, so a factory that
 * imported the harness would wait on itself.
 *
 * Only the coordinator is faked. The outcome classifier stays real, so the
 * tests exercise the same `LocalSessionWriteError` / `SessionSyncError` split
 * the app relies on (#703).
 */
export const queue = {
  saveCompletedSession: vi.fn(),
};
