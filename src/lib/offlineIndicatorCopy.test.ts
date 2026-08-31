/**
 * Issue #703 — the offline strip must not keep promising that sits are saved
 * once a local write is known to have failed.
 */
import { describe, expect, test } from "vitest";
import { offlineIndicatorCopy, offlineIndicatorStateFor } from "@/lib/offlineIndicatorCopy";

const PROMISE = "sits are saved and upload when you reconnect";

describe("offlineIndicatorCopy (#703)", () => {
  test("the usual strip keeps the #665/#666 copy verbatim", () => {
    const copy = offlineIndicatorCopy("savedProgress");

    expect(copy.label).toBe("OFFLINE · SAVED PROGRESS");
    expect(copy.accessibilityLabel).toBe(
      "Offline. Showing your saved progress; sits are saved and upload when you reconnect.",
    );
  });

  test("the not-stored strip drops the promise instead of softening it", () => {
    const copy = offlineIndicatorCopy("sitNotStored");

    expect(copy.accessibilityLabel).not.toContain(PROMISE);
    expect(copy.accessibilityLabel).toContain("could not be saved on this device");
    expect(copy.label).not.toBe(offlineIndicatorCopy("savedProgress").label);
  });

  test("a known write failure selects the not-stored copy", () => {
    expect(offlineIndicatorStateFor(true)).toBe("sitNotStored");
    expect(offlineIndicatorStateFor(false)).toBe("savedProgress");
  });
});
