import Foundation

/// #703/#717: the three things the offline strip is allowed to say.
///
/// The strip started (#665) as a pure connectivity surface, so both of #703's
/// strings lead with "OFFLINE". #717 is the case that breaks that assumption: a
/// local write can be refused — SwiftData, IndexedDB quota, private browsing,
/// an evicted store — with a perfectly good network, and the breath-session
/// path has no completion screen to say so on. The strip is the only surface,
/// so it has to be able to raise itself while the user is online, and it cannot
/// do that while every string it owns opens by calling them offline.
///
/// So the state is two independent facts, connectivity and whether the sit
/// reached the device, rather than one:
///
/// - `offlineSavedProgress` — the #665 copy, kept byte-for-byte identical to the
///   web port at `src/lib/offlineIndicatorCopy.ts` so the two clients still read
///   the same while disconnected.
/// - `offlineSitNotStored` — #703's withdrawn promise. That copy contains a
///   guarantee — "sits are saved and upload when you reconnect" — that a device
///   with no working local storage cannot keep. Once a write is known to have
///   failed, the promise is withdrawn rather than softened: the base string is
///   untouched, and this second string is shown in its place.
/// - `onlineSitNotStored` — #717. Same loss, no connectivity claim, and no
///   "when you reconnect" either: there is nothing to reconnect to, and the sit
///   is not waiting anywhere to be uploaded later.
///
/// The fourth combination — online, and the sit stored fine — is not a state at
/// all. `state(offline:sitNotStored:)` returns `nil` for it, and the strip does
/// not render.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum OfflineIndicatorCopy {

    public enum State: Equatable {
        /// Offline, and everything the device holds is intact.
        case offlineSavedProgress
        /// Offline, and a sit could not be written to this device at all.
        case offlineSitNotStored
        /// Connected, and a sit could not be written to this device at all.
        case onlineSitNotStored
    }

    public struct Copy: Equatable {
        /// Short strip text, uppercase mono.
        public let label: String
        /// What VoiceOver announces in place of the strip's glyph + label.
        public let accessibilityLabel: String

        public init(label: String, accessibilityLabel: String) {
            self.label = label
            self.accessibilityLabel = accessibilityLabel
        }
    }

    public static func copy(for state: State) -> Copy {
        switch state {
        case .offlineSavedProgress:
            return Copy(
                label: "OFFLINE · SAVED PROGRESS",
                accessibilityLabel:
                    "Offline. Showing your saved progress; sits are saved and upload when you reconnect."
            )
        case .offlineSitNotStored:
            return Copy(
                label: "OFFLINE · SIT NOT SAVED",
                accessibilityLabel:
                    "Offline. A sit could not be saved on this device, so it will not upload when you reconnect."
            )
        case .onlineSitNotStored:
            return Copy(
                label: "SIT NOT SAVED",
                accessibilityLabel:
                    "A sit could not be saved on this device, so it will not upload."
            )
        }
    }

    /// The strip's whole visibility rule, in one place on both clients: a failed
    /// local write raises it regardless of connectivity, and being online with
    /// nothing lost is the one combination with nothing to say.
    public static func state(offline: Bool, sitNotStored: Bool) -> State? {
        if sitNotStored {
            return offline ? .offlineSitNotStored : .onlineSitNotStored
        }
        return offline ? .offlineSavedProgress : nil
    }
}
