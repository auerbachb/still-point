/** #753: completion-screen autosave rules. Pure so unit tests can cover them
 *  without rendering the screen. */

export const COMPLETION_RETURN_LABEL = "save and return to home";

/** Matches the existing iOS completion-note debounce so a short pause saves
 *  the latest text without a request per keystroke. */
export const COMPLETION_AUTOSAVE_MS = 800;

export type RatingsAutosavePayload = {
  focusRating?: number;
  happinessRating?: number;
};

/** Non-empty trimmed note text, or null when there is nothing to store. */
export function noteTextToAutosave(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Only sliders the user moved. Untouched defaults are not a save — there is
 *  no longer an explicit "save ratings" click that would commit them. */
export function ratingsAutosavePayload(input: {
  focusRating: number;
  happinessRating: number;
  focusTouched: boolean;
  happinessTouched: boolean;
}): RatingsAutosavePayload | null {
  const payload: RatingsAutosavePayload = {};
  if (input.focusTouched) payload.focusRating = input.focusRating;
  if (input.happinessTouched) payload.happinessRating = input.happinessRating;
  if (payload.focusRating === undefined && payload.happinessRating === undefined) {
    return null;
  }
  return payload;
}
