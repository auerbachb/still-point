import type { DisplayPrefs } from "./displayPrefs";

/** The session-screen components the user can hide (#75). */
export type SessionComponentVisibility = {
  blockGrid: boolean;
  progressBar: boolean;
  mindStateBar: boolean;
};

export type SessionComponentPrefs = Pick<
  DisplayPrefs,
  "showBlockGrid" | "showProgressBar" | "showMindStateBar"
>;

/**
 * Resolves which optional session components render.
 *
 * Minimal view (#669) is "just the timer", so it hides all of them whatever the
 * saved preference says. Outside minimal view the saved toggles apply. The
 * countdown and the pause/end controls are not represented here: they are never
 * hideable.
 */
export function resolveSessionComponentVisibility(
  prefs: SessionComponentPrefs,
  minimal: boolean,
): SessionComponentVisibility {
  if (minimal) {
    return { blockGrid: false, progressBar: false, mindStateBar: false };
  }
  return {
    blockGrid: prefs.showBlockGrid,
    progressBar: prefs.showProgressBar,
    mindStateBar: prefs.showMindStateBar,
  };
}
