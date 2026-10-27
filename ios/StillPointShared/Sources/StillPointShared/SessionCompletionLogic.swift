import Foundation

/// #724 — what a finished sit's save attempt decides, without saving anything.
///
/// A sit is handed to the local queue when it ends (#557), and two things hang
/// on how that goes. One is the #703 flag behind the offline strip's "sits are
/// saved" promise (`AppViewModel.localSaveFailed`). The other is whether a
/// standard or quick sit goes on to its completion screen or stops on the
/// "Session could not be saved" alert.
///
/// `SessionViewModel.completeSit(appVM:)` reads both rules, and
/// `AppViewModel.completeBreathSession` reads the flag rule alone, since a
/// breath sit has no completion screen to stop in front of. Both rules live here
/// so `swift test` can hold them; the app target only carries out what they
/// return.
///
/// Free of SwiftUI / UIKit so it compiles and runs under `swift test` on macOS.
public enum SessionCompletionLogic {

    /// What became of the sit the save was asked to keep.
    public enum SaveOutcome: Equatable, Sendable {
        /// On this device — uploaded, or queued to upload on reconnect. Both are
        /// safe (#557), so nothing here tells them apart.
        case stored
        /// The local write was refused, so the sit is nowhere (#703).
        case notStored
        /// No signed-in account to save the sit under, so no write was attempted.
        case noSignedInUser
    }

    /// #703: the new value for `AppViewModel.localSaveFailed`, or `nil` to leave
    /// it as it is.
    ///
    /// A failed write raises the flag, and a later successful one clears it —
    /// that is the proof storage works again. Only a write that ran says
    /// anything about this device's storage, so a save that was never attempted
    /// changes nothing: an earlier failure stays reported, and a clear flag
    /// stays clear.
    public static func localSaveFailed(after outcome: SaveOutcome) -> Bool? {
        switch outcome {
        case .stored:
            return false
        case .notStored:
            return true
        case .noSignedInUser:
            return nil
        }
    }

    /// Whether a finished standard sit stops on the "Session could not be saved"
    /// alert — Retry, or Continue without saving — instead of going on to its
    /// completion screen.
    ///
    /// Anything short of a stored sit stops: going on would show a completion
    /// screen for a sit that is nowhere, the false success #703 is about.
    public static func showsSaveError(after outcome: SaveOutcome) -> Bool {
        outcome != .stored
    }
}
