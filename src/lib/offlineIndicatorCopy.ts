/**
 * #703/#717: the three things the offline strip is allowed to say.
 *
 * The strip started (#665/#666) as a pure connectivity surface, so both of
 * #703's strings lead with "OFFLINE". #717 is the case that breaks that
 * assumption: a local write can be refused — IndexedDB quota, private
 * browsing, an evicted store, SwiftData — with a perfectly good network, and
 * the breath and abandon paths have no completion screen to say so on. The
 * strip is the only surface, so it has to be able to raise itself while the
 * user is online, and it cannot do that while every string it owns opens by
 * calling them offline.
 *
 * So the state is two independent facts, connectivity and whether the sit
 * reached the device, rather than one:
 *
 * - `offlineSavedProgress` — the #665/#666 copy, kept byte-for-byte identical
 *   to the iOS `OfflineIndicatorCopy` so the two clients still read the same
 *   while disconnected.
 * - `offlineSitNotStored` — #703's withdrawn promise. That copy contains a
 *   guarantee — "sits are saved and upload when you reconnect" — that a device
 *   with no working local storage cannot keep. Once a write is known to have
 *   failed, the promise is withdrawn rather than softened: the base string is
 *   untouched, and this second string is shown in its place.
 * - `onlineSitNotStored` — #717. Same loss, no connectivity claim, and no
 *   "when you reconnect" either: there is nothing to reconnect to, and the sit
 *   is not waiting anywhere to be uploaded later.
 *
 * The fourth combination — online, and the sit stored fine — is not a state at
 * all. `offlineIndicatorStateFor` returns `null` for it, and the strip does not
 * render.
 */
export type OfflineIndicatorState =
  | "offlineSavedProgress"
  | "offlineSitNotStored"
  | "onlineSitNotStored";

export type OfflineIndicatorCopy = {
  /** Short strip text, uppercase mono. */
  label: string;
  /** What a screen reader announces in place of the strip's glyph + label. */
  accessibilityLabel: string;
};

const COPY: Record<OfflineIndicatorState, OfflineIndicatorCopy> = {
  offlineSavedProgress: {
    label: "OFFLINE · SAVED PROGRESS",
    accessibilityLabel:
      "Offline. Showing your saved progress; sits are saved and upload when you reconnect.",
  },
  offlineSitNotStored: {
    label: "OFFLINE · SIT NOT SAVED",
    accessibilityLabel:
      "Offline. A sit could not be saved on this device, so it will not upload when you reconnect.",
  },
  onlineSitNotStored: {
    label: "SIT NOT SAVED",
    accessibilityLabel:
      "A sit could not be saved on this device, so it will not upload.",
  },
};

export function offlineIndicatorCopy(state: OfflineIndicatorState): OfflineIndicatorCopy {
  return COPY[state];
}

/**
 * The strip's whole visibility rule, in one place on both clients: a failed
 * local write raises it regardless of connectivity, and being online with
 * nothing lost is the one combination with nothing to say.
 */
export function offlineIndicatorStateFor(
  { offline, sitNotStored }: { offline: boolean; sitNotStored: boolean },
): OfflineIndicatorState | null {
  if (sitNotStored) {
    return offline ? "offlineSitNotStored" : "onlineSitNotStored";
  }
  return offline ? "offlineSavedProgress" : null;
}
