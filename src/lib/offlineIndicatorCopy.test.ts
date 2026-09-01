/**
 * Issue #703 — the offline strip must not keep promising that sits are saved
 * once a local write is known to have failed.
 *
 * Issue #717 — and it must be able to say so while the user is online, without
 * calling them offline to do it.
 *
 * Ported to `ios/StillPointShared/Tests/StillPointSharedTests/OfflineIndicatorCopyTests.swift`
 * so both clients assert the same strings; keep the two files in step.
 */
import { describe, expect, test } from "vitest";
import { offlineIndicatorCopy, offlineIndicatorStateFor } from "@/lib/offlineIndicatorCopy";

const PROMISE = "sits are saved and upload when you reconnect";

describe("offlineIndicatorCopy (#703)", () => {
  test("the usual strip keeps the #665/#666 copy verbatim", () => {
    const copy = offlineIndicatorCopy("offlineSavedProgress");

    expect(copy.label).toBe("OFFLINE · SAVED PROGRESS");
    expect(copy.accessibilityLabel).toBe(
      "Offline. Showing your saved progress; sits are saved and upload when you reconnect.",
    );
  });

  test("the not-stored strip drops the promise instead of softening it", () => {
    const copy = offlineIndicatorCopy("offlineSitNotStored");

    expect(copy.label).toBe("OFFLINE · SIT NOT SAVED");
    expect(copy.accessibilityLabel).toBe(
      "Offline. A sit could not be saved on this device, so it will not upload when you reconnect.",
    );
    expect(copy.accessibilityLabel).not.toContain(PROMISE);
    expect(copy.accessibilityLabel).toContain("could not be saved on this device");
    expect(copy.label).not.toBe(offlineIndicatorCopy("offlineSavedProgress").label);
  });
});

describe("offlineIndicatorCopy — online write failure (#717)", () => {
  test("the online strip reports the same loss without claiming a disconnection", () => {
    const copy = offlineIndicatorCopy("onlineSitNotStored");

    expect(copy.label).toBe("SIT NOT SAVED");
    expect(copy.accessibilityLabel).toBe(
      "A sit could not be saved on this device, so it will not upload.",
    );
  });

  test("neither string tells a connected user they are offline", () => {
    const copy = offlineIndicatorCopy("onlineSitNotStored");

    expect(copy.label).not.toContain("OFFLINE");
    expect(copy.accessibilityLabel.toLowerCase()).not.toContain("offline");
    // There is nothing to reconnect to, so nothing is waiting to upload later.
    expect(copy.accessibilityLabel).not.toContain("reconnect");
  });

  test("the accessibility label carries the visible label's meaning", () => {
    // The glyph and label are `aria-hidden`, so this string is the whole
    // announcement — it has to say what the strip shows, in both states.
    expect(offlineIndicatorCopy("onlineSitNotStored").accessibilityLabel)
      .toContain("could not be saved on this device");
    expect(offlineIndicatorCopy("offlineSitNotStored").accessibilityLabel)
      .toContain("could not be saved on this device");
    expect(offlineIndicatorCopy("offlineSitNotStored").accessibilityLabel)
      .toContain("Offline.");
  });
});

describe("offlineIndicatorStateFor (#717)", () => {
  test("a known write failure selects the not-stored copy for either connectivity", () => {
    expect(offlineIndicatorStateFor({ offline: true, sitNotStored: true }))
      .toBe("offlineSitNotStored");
    expect(offlineIndicatorStateFor({ offline: false, sitNotStored: true }))
      .toBe("onlineSitNotStored");
  });

  test("being offline with everything intact keeps the #665/#666 strip", () => {
    expect(offlineIndicatorStateFor({ offline: true, sitNotStored: false }))
      .toBe("offlineSavedProgress");
  });

  test("online with the sit stored is the one combination with nothing to say", () => {
    expect(offlineIndicatorStateFor({ offline: false, sitNotStored: false })).toBeNull();
  });
});
