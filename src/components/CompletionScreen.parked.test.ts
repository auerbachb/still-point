/** @vitest-environment jsdom */
/**
 * Issue #982 — a sit the server turned down for good on its first upload
 * (#978) is kept on this device, but no flush sends it. The completion screen
 * must say so, with the server's reason, and not read as a sit that uploads on
 * reconnect.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  render,
  resetCompletionScreenHarness,
  screen,
  setUpCompletionScreenHarness,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

describe("CompletionScreen for a sit parked on its first upload (#982)", () => {
  test("says the server did not accept it, gives the reason, and points to History", async () => {
    await render({ parkedReason: '{"error":"Invalid track"}' });

    const banner = screen().querySelector('[data-testid="completion-parked"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/did not accept this sit/i);
    expect(banner!.textContent).toContain("saved on this device");
    expect(banner!.textContent).toContain("History");
    expect(banner!.textContent).toMatch(/try it again or discard it/i);
    expect(screen().querySelector('[data-testid="completion-parked-reason"]')!.textContent)
      .toBe('Reason: {"error":"Invalid track"}');
  });

  test("does not promise an upload on reconnect", async () => {
    await render({ parkedReason: "Session not found" });

    const text = screen().textContent ?? "";
    expect(text).not.toMatch(/upload(s)? (when|once) you reconnect/i);
    expect(text).toMatch(/will not upload on its own, even after\s+you reconnect/i);
    // Not the not-stored alert: the sit is on this device.
    expect(screen().querySelector('[data-testid="completion-not-stored"]')).toBeNull();
  });

  test("shows nothing for a sit that was not parked", async () => {
    await render({});
    expect(screen().querySelector('[data-testid="completion-parked"]')).toBeNull();
  });
});
