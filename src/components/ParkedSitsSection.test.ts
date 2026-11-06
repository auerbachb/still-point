/** @vitest-environment jsdom */
/**
 * Issue #982 — History lists this account's parked sits (#978) with the
 * server's reason, and lets their owner try one again or discard it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ParkedRetryResult, ParkedSession, PendingSessionEntry } from "@/lib/offlineSessionQueue";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ParkedSitsSection, parkedRetryMessage } = await import("@/components/ParkedSitsSection");

const owner = "user-982";
type ParkedEntry = PendingSessionEntry & { parked: ParkedSession };

function parkedEntry(clientSessionId: string, message: string): ParkedEntry {
  return {
    clientSessionId,
    ownerUserId: owner,
    request: {
      dayNumber: 4,
      sessionType: "standard",
      duration: 600,
      completed: true,
      actualTime: 600,
      clearPercent: 80,
      thoughtCount: 0,
      mindStateLog: [],
      sessionDate: "2026-10-27",
      clientSessionId,
    },
    thoughts: [],
    serverSessionId: null,
    sessionSynced: false,
    enqueuedAt: "2026-10-27T09:00:00.000Z",
    parked: { at: "2026-10-27T09:01:00.000Z", status: 400, message },
  };
}

/** A queue holding `entries`: discard drops one, retry answers `retryResult`. */
function fakeQueue(entries: ParkedEntry[], retryResult: ParkedRetryResult) {
  let held = [...entries];
  return {
    parkedEntries: vi.fn(async () => [...held]),
    retryParkedEntry: vi.fn(async (clientSessionId: string) => {
      if (retryResult.status !== "parked") held = held.filter((entry) => entry.clientSessionId !== clientSessionId);
      return retryResult;
    }),
    discardParkedEntry: vi.fn(async (clientSessionId: string) => {
      held = held.filter((entry) => entry.clientSessionId !== clientSessionId);
      return true;
    }),
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function render(queue: ReturnType<typeof fakeQueue>, onSynced = vi.fn()): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ParkedSitsSection, { ownerUserId: owner, coordinator: queue, onSynced }));
  });
}

function rows(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('[data-testid="parked-sit"]')];
}

async function click(element: Element | null | undefined): Promise<void> {
  await act(async () => {
    (element as HTMLButtonElement).click();
  });
}

describe("ParkedSitsSection (#982)", () => {
  test("renders nothing while the account has no parked sits", async () => {
    await render(fakeQueue([], { status: "synced" }));
    expect(container!.querySelector('[data-testid="parked-sits"]')).toBeNull();
  });

  test("lists each parked sit with its date, length and the server's reason", async () => {
    const queue = fakeQueue([parkedEntry("a", '{"error":"Invalid track"}')], { status: "synced" });
    await render(queue);

    expect(queue.parkedEntries).toHaveBeenCalledWith(owner);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("Oct 27, 2026");
    expect(rows()[0]!.textContent).toContain("10m");
    expect(rows()[0]!.querySelector('[data-testid="parked-sit-reason"]')!.textContent)
      .toBe('Reason: {"error":"Invalid track"}');
  });

  test("Try again retries the sit once and reports that it uploaded", async () => {
    const queue = fakeQueue([parkedEntry("a", "bad"), parkedEntry("b", "bad")], { status: "synced" });
    const onSynced = vi.fn();
    await render(queue, onSynced);

    await click(rows()[0]!.querySelector('[data-testid="parked-sit-retry"]'));

    expect(queue.retryParkedEntry).toHaveBeenCalledTimes(1);
    expect(queue.retryParkedEntry).toHaveBeenCalledWith("a", owner);
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(container!.querySelector('[role="status"]')!.textContent).toMatch(/^Uploaded/);
    expect(rows()).toHaveLength(1);
  });

  test("Try again that is turned down again keeps the row and says why", async () => {
    const reparked: ParkedRetryResult = {
      status: "parked",
      parked: { at: "2026-11-05T12:00:00.000Z", status: 400, message: "still invalid" },
      sessionUploaded: false,
    };
    const queue = fakeQueue([parkedEntry("a", "bad")], reparked);
    const onSynced = vi.fn();
    await render(queue, onSynced);

    await click(rows()[0]!.querySelector('[data-testid="parked-sit-retry"]'));

    expect(onSynced).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(container!.querySelector('[role="status"]')!.textContent).toBe(
      "The server turned it down again: still invalid",
    );
  });

  test("Try again whose row went up before its thoughts were turned down still refreshes progression", async () => {
    const reparked: ParkedRetryResult = {
      status: "parked",
      parked: { at: "2026-11-05T12:00:00.000Z", status: 404, message: "thoughts refused" },
      sessionUploaded: true,
    };
    const queue = fakeQueue([parkedEntry("a", "bad")], reparked);
    const onSynced = vi.fn();
    await render(queue, onSynced);

    await click(rows()[0]!.querySelector('[data-testid="parked-sit-retry"]'));

    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
  });

  test("Discard asks to confirm, then removes only that sit", async () => {
    const queue = fakeQueue([parkedEntry("a", "bad"), parkedEntry("b", "bad")], { status: "synced" });
    await render(queue);

    await click(rows()[1]!.querySelector('[data-testid="parked-sit-discard"]'));
    expect(queue.discardParkedEntry).not.toHaveBeenCalled();

    await click(rows()[1]!.querySelector('[data-testid="parked-sit-discard-confirm"]'));

    expect(queue.discardParkedEntry).toHaveBeenCalledTimes(1);
    expect(queue.discardParkedEntry).toHaveBeenCalledWith("b", owner);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.querySelector('[data-testid="parked-sit-retry"]')).not.toBeNull();
  });
});

describe("parkedRetryMessage (#982)", () => {
  test("names each way a retry ends", () => {
    expect(parkedRetryMessage({ status: "synced" })).toMatch(/^Uploaded/);
    expect(parkedRetryMessage({ status: "pending" })).toMatch(/queued again and uploads once you are online and signed in/);
    expect(parkedRetryMessage({ status: "gone" })).toMatch(/no longer on this device/);
  });
});
