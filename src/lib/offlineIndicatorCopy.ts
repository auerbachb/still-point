/**
 * #703: the two things the offline strip is allowed to say.
 *
 * `savedProgress` is the #665/#666 copy, kept byte-for-byte identical to the iOS
 * `OfflineIndicatorCopy.savedProgress` so the two clients still read the same
 * while disconnected.
 *
 * `sitNotStored` exists because that copy contains a promise — "sits are saved
 * and upload when you reconnect" — that a device with no working local storage
 * cannot keep. Once a write is known to have failed, the promise is withdrawn
 * rather than softened: the base string is untouched, and this second string is
 * shown in its place.
 */
export type OfflineIndicatorState = "savedProgress" | "sitNotStored";

export type OfflineIndicatorCopy = {
  /** Short strip text, uppercase mono. */
  label: string;
  /** What a screen reader announces in place of the strip's glyph + label. */
  accessibilityLabel: string;
};

const COPY: Record<OfflineIndicatorState, OfflineIndicatorCopy> = {
  savedProgress: {
    label: "OFFLINE · SAVED PROGRESS",
    accessibilityLabel:
      "Offline. Showing your saved progress; sits are saved and upload when you reconnect.",
  },
  sitNotStored: {
    label: "OFFLINE · SIT NOT SAVED",
    accessibilityLabel:
      "Offline. A sit could not be saved on this device, so it will not upload when you reconnect.",
  },
};

export function offlineIndicatorCopy(state: OfflineIndicatorState): OfflineIndicatorCopy {
  return COPY[state];
}

export function offlineIndicatorStateFor(sitNotStored: boolean): OfflineIndicatorState {
  return sitNotStored ? "sitNotStored" : "savedProgress";
}
