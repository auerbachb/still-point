import Foundation

/// #703: the two things the offline strip is allowed to say.
///
/// `savedProgress` is the #665 copy, kept byte-for-byte identical to the web port
/// at `src/lib/offlineIndicatorCopy.ts` so the two clients still read the same
/// while disconnected.
///
/// `sitNotStored` exists because that copy contains a promise — "sits are saved
/// and upload when you reconnect" — that a device with no working local storage
/// cannot keep. Once a write is known to have failed, the promise is withdrawn
/// rather than softened: the base string is untouched, and this second string is
/// shown in its place.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum OfflineIndicatorCopy {

    public enum State: Equatable {
        /// Offline, and everything the device holds is intact.
        case savedProgress
        /// Offline, and a sit could not be written to this device at all.
        case sitNotStored
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
        case .savedProgress:
            return Copy(
                label: "OFFLINE · SAVED PROGRESS",
                accessibilityLabel:
                    "Offline. Showing your saved progress; sits are saved and upload when you reconnect."
            )
        case .sitNotStored:
            return Copy(
                label: "OFFLINE · SIT NOT SAVED",
                accessibilityLabel:
                    "Offline. A sit could not be saved on this device, so it will not upload when you reconnect."
            )
        }
    }

    public static func state(sitNotStored: Bool) -> State {
        sitNotStored ? .sitNotStored : .savedProgress
    }
}
