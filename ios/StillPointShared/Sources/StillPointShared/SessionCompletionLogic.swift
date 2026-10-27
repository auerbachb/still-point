import Foundation

/// #724 — what a finished sit's save attempt decides, without saving anything.
///
/// A sit is handed to the local queue when it ends (#557), and two things hang
/// on how that goes. One is the #703 flag behind the offline strip's "sits are
/// saved" promise (`AppViewModel.localSaveFailed`). The other is whether a
/// standard or quick sit goes on to its completion screen or stops on the
/// "Session could not be saved" alert.
///
/// `SessionViewModel.completeSit(appVM:startedAtGeneration:)` reads both rules,
/// and `AppViewModel.completeBreathSession` reads the flag rule alone, since a
/// breath sit has no completion screen to stop in front of. Both rules live here
/// so `swift test` can hold them; the app target only carries out what they
/// return.
///
/// #921 adds two rules for a standard sit's completion screen: the elapsed time
/// its gaze summary is measured against, and whether the alert's "Continue
/// without saving" may still open it.
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

    /// #921: the elapsed time the completion screen measures a sit's gaze summary
    /// against, or `nil` when there is no attention log to summarize.
    ///
    /// Both ways onto that screen hand it over, `completeSit` for a stored sit and
    /// `continueWithoutSaving` for one that is not, so a sit that could not be saved
    /// shows the same gaze summary a stored one does (#873). Any log counts, an
    /// empty one included, and `elapsed` passes through unchanged: `CompletionView`
    /// shows no summary for a sit with no elapsed time.
    public static func attentionElapsed(attentionLog: [AttentionEntry]?, elapsed: Double) -> Double? {
        attentionLog == nil ? nil : elapsed
    }

    /// #921: whether the alert's "Continue without saving" may still open the
    /// completion screen.
    ///
    /// The alert belongs to the identity generation whose save raised it. Routing
    /// to sign-in does not take the alert down in the same turn, and the button's
    /// action runs in a turn of its own, so the action can still run after a
    /// sign-out: an auth check on a scene activation, or a reconnect refresh, whose
    /// `me()` answers "no session" is enough. Opening the completion screen then
    /// would cover the sign-in screen and, for a sit that ran to its end, credit it
    /// to the widget's day and unlock the app gate with nobody signed in. Signing
    /// back in as the same account moves the generation too, so it gets no
    /// exception.
    ///
    /// Someone also has to be signed in. A Retry tapped in that same window reads
    /// the new generation, finds nobody signed in and raises the alert again, so
    /// that alert's generation is live. Every way into a sit needs someone signed
    /// in, so the only alert raised with nobody signed in is one raised after a
    /// sign-out.
    ///
    /// - Parameter raisedGeneration: the generation the alert was raised under, or
    ///   `nil` when none was raised.
    /// - Parameter liveGeneration: the identity generation now.
    /// - Parameter isSignedIn: whether anyone is signed in now.
    public static func continuesWithoutSaving(
        alertRaisedAt raisedGeneration: Int?,
        liveGeneration: Int,
        isSignedIn: Bool
    ) -> Bool {
        isSignedIn && raisedGeneration == liveGeneration
    }
}
