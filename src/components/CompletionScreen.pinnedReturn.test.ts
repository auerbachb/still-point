/** @vitest-environment jsdom */
/**
 * Issue #979 — on phone widths (`compact`) the bottom return button is pinned
 * above the bottom nav with `position: sticky`. The top button and the desktop
 * recap keep their normal flow.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  render,
  resetCompletionScreenHarness,
  returnButton,
  setUpCompletionScreenHarness,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

const NAV_CLEARANCE = "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))";

describe("CompletionScreen pinned return button (#979)", () => {
  test("pins the bottom button above the nav on compact layouts", async () => {
    await render({ compact: true });

    const bottom = returnButton("bottom");
    expect(bottom.style.position).toBe("sticky");
    expect(bottom.style.bottom).toBe(NAV_CLEARANCE);
    expect(bottom.style.zIndex).toBe("10");
    // Opaque page background, so text scrolling behind the pill does not show.
    expect(bottom.style.background).toBe("rgb(var(--bg-rgb))");
  });

  test("leaves the top button in flow on compact layouts", async () => {
    await render({ compact: true });

    const top = returnButton("top");
    expect(top.style.position).toBe("");
    expect(top.style.background).toBe("none");
  });

  test("does not pin either button on the desktop recap", async () => {
    await render({ compact: false });

    expect(returnButton("bottom").style.position).toBe("");
    expect(returnButton("top").style.position).toBe("");
  });

  test("keeps the bottom button as the last child of the recap", async () => {
    await render({ compact: true });

    expect(returnButton("bottom").nextElementSibling).toBeNull();
  });
});
