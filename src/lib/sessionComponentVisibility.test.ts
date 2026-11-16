/**
 * Issue #75 — which optional session-screen components render.
 */
import { describe, expect, it } from "vitest";
import { resolveSessionComponentVisibility } from "./sessionComponentVisibility";

const ALL_SHOWN = { showBlockGrid: true, showProgressBar: true, showMindStateBar: true };
const ALL_HIDDEN = { showBlockGrid: false, showProgressBar: false, showMindStateBar: false };

describe("resolveSessionComponentVisibility", () => {
  it("shows every optional component by default", () => {
    expect(resolveSessionComponentVisibility(ALL_SHOWN, false)).toEqual({
      blockGrid: true,
      progressBar: true,
      mindStateBar: true,
    });
  });

  it("follows each saved toggle independently", () => {
    expect(
      resolveSessionComponentVisibility(
        { showBlockGrid: false, showProgressBar: true, showMindStateBar: false },
        false,
      ),
    ).toEqual({ blockGrid: false, progressBar: true, mindStateBar: false });
  });

  it("hides everything optional in minimal view, whatever the saved toggles say", () => {
    expect(resolveSessionComponentVisibility(ALL_SHOWN, true)).toEqual({
      blockGrid: false,
      progressBar: false,
      mindStateBar: false,
    });
  });

  it("keeps the saved toggles intact for when minimal view is turned off", () => {
    const prefs = { showBlockGrid: false, showProgressBar: true, showMindStateBar: true };
    resolveSessionComponentVisibility(prefs, true);
    expect(prefs).toEqual({ showBlockGrid: false, showProgressBar: true, showMindStateBar: true });
    expect(resolveSessionComponentVisibility(prefs, false)).toEqual({
      blockGrid: false,
      progressBar: true,
      mindStateBar: true,
    });
  });

  it("hides all three when every toggle is off outside minimal view", () => {
    expect(resolveSessionComponentVisibility(ALL_HIDDEN, false)).toEqual({
      blockGrid: false,
      progressBar: false,
      mindStateBar: false,
    });
  });
});
