/** #753: completion-screen autosave rules. Pure so unit tests can cover them
 *  without rendering the screen. */

export const COMPLETION_RETURN_LABEL = "save and return to home";

/** Matches the existing iOS completion-note debounce so a short pause saves
 *  the latest text without a request per keystroke. */
export const COMPLETION_AUTOSAVE_MS = 800;

/** Non-empty trimmed note text, or null when there is nothing to store. */
export function noteTextToAutosave(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}
