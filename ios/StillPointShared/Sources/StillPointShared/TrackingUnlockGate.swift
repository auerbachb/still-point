import Foundation

/// Pure progressive-unlock rule for distraction/hyperfocus tracking controls (#186 / #188).
///
/// A user unlocks the hold-cluster controls after completing one sit whose planned
/// duration is ≥ 300 seconds (5 minutes). This mirrors web's
/// `sessionQualifiesForTrackingUnlock` in `src/lib/trackingControlPrefs.ts` exactly,
/// including the constant value.
///
/// Kept in the shared package (Foundation only — no UIKit / SwiftUI imports) so the
/// rule is unit-testable on every platform and cannot drift between the app target
/// and any future extensions, following the `AppBlockGate` pattern.
public enum TrackingUnlockGate {
    /// Planned sit length in seconds required to unlock tracking controls.
    /// Matches web's `TRACKING_UNLOCK_MIN_DURATION_SECONDS = 300`.
    public static let minDurationSeconds = 300

    /// Returns `true` when a session with the given attributes earns the tracking-
    /// controls unlock: the sit must have been completed naturally **and** its
    /// planned duration must be at least `minDurationSeconds` (300 s / 5 min).
    ///
    /// - Parameters:
    ///   - completed: `true` when the sit finished naturally (not ended early or
    ///     abandoned). Mirrors web's `session.completed` semantics.
    ///   - duration: planned duration in seconds. Matches web's `session.duration`.
    public static func qualifies(completed: Bool, duration: Int) -> Bool {
        completed && duration >= minDurationSeconds
    }
}
