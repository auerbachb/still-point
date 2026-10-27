import Foundation

/// #1024 — whether a solo sit may start, resume, or end, decided without
/// touching the clock.
///
/// These gates answer what the session screen's buttons may do. They used to
/// sit beside the tick loop in `SessionTickLogic`, but they change for
/// different reasons (#848, #987) than the per-tick cue rules do, so they live
/// here and `SessionTickLogic` keeps only what one tick owes.
///
/// Free of UIKit / AVFoundation so it compiles and runs under `swift test` on macOS.
public enum SessionLifecycleLogic {

    /// #848: whether starting the timer may run the clock at all. A sit that
    /// has ended — run out, ended early or abandoned — stays stopped, so a
    /// Resume that lands before the completion screen replaces the session
    /// screen restarts neither its clock nor its cues.
    ///
    /// Checked before `isResume`, which cannot refuse a start: End Early and
    /// Abandon leave the clock where it stopped, which reads as a resume, and
    /// a `false` there begins the sit again from zero.
    public static func canStart(isComplete: Bool, isAbandoned: Bool) -> Bool {
        !hasEnded(isComplete: isComplete, isAbandoned: isAbandoned)
    }

    /// #987: whether End Early or Abandon may act. A sit ends once — it runs
    /// out, is ended early, or is abandoned — and after that neither button
    /// does anything. The session screen stays up while the save runs, so
    /// without this an Abandon tapped then went Home, and the completion
    /// screen opened over Home when the save settled.
    ///
    /// Mirrors web's `canEndSession` (`src/lib/sessionEndGuard.ts`, #930).
    public static func canEndSession(isComplete: Bool, isAbandoned: Bool) -> Bool {
        !hasEnded(isComplete: isComplete, isAbandoned: isAbandoned)
    }

    /// Whether starting the timer picks a paused sit back up rather than
    /// beginning a new one. A clock that already reached the duration always
    /// begins again.
    public static func isResume(
        pausedElapsed: Double,
        totalSeconds: Int,
        isPaused: Bool,
        isActive: Bool
    ) -> Bool {
        pausedElapsed < Double(totalSeconds)
            && (pausedElapsed > 0 || isPaused || isActive)
    }

    /// A sit has ended once it ran out, was ended early, or was abandoned.
    /// The one rule both `canStart` and `canEndSession` refuse on.
    private static func hasEnded(isComplete: Bool, isAbandoned: Bool) -> Bool {
        isComplete || isAbandoned
    }
}
