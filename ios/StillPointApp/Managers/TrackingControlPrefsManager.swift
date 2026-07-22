import Foundation
import StillPointShared

/// Client-local persistence and decision logic for distraction/hyperfocus tracking controls
/// (#186 / #188).
///
/// Mirrors web's `trackingControlPrefs.ts` (PR #511) using `UserDefaults` instead of
/// `localStorage`. The two UserDefaults keys are the already-reserved iOS parity keys
/// declared in `src/lib/trackingControlPrefs.ts` so both platforms share identical key names:
///
/// - `sp_trackingControlsUnlocked` — `true` once the user has completed a qualifying
///   5+ minute sit. Mirrors web's `IOS_TRACKING_UNLOCK_KEY`.
/// - `sp_hideDistractionHyperfocusControls` — `true` when the user opted out of the
///   hold-cluster UI. Mirrors web's `IOS_HIDE_TRACKING_CONTROLS_KEY`.
///
/// Follows the `AppBlockingManager` / `SessionIdleTimerController` conventions: an injectable
/// `UserDefaults` (defaults to `.standard`) and `@Observable` so SwiftUI views react to
/// changes without extra state variables.
///
/// **Unlock lifecycle (mirrors web):**
/// 1. On session completion: call `markTrackingUnlockIfQualifying(completed:duration:)`.
/// 2. At login / app launch: call `syncTrackingUnlockFromSessions(_:)` with the user's
///    history to backfill unlock for existing users (mirrors `syncTrackingUnlockFromSessions`).
/// 3. On logout: call `clearOnLogout()` to reset unlock so the next sign-in re-qualifies
///    (mirrors `resetTrackingUnlockOnLogout`). The hide preference is kept, matching web.
@Observable
@MainActor
final class TrackingControlPrefsManager {

    // MARK: - UserDefaults keys (parity with web's IOS_* constants)

    /// Mirrors web's `IOS_TRACKING_UNLOCK_KEY = "sp_trackingControlsUnlocked"`.
    static let unlockKey = "sp_trackingControlsUnlocked"
    /// Mirrors web's `IOS_HIDE_TRACKING_CONTROLS_KEY = "sp_hideDistractionHyperfocusControls"`.
    static let hideKey = "sp_hideDistractionHyperfocusControls"

    // MARK: - Observable state

    /// `true` once the user has completed a qualifying 5+ min sit.
    /// Persisted to `UserDefaults` via `didSet`.
    var trackingControlsUnlocked: Bool {
        didSet { defaults.set(trackingControlsUnlocked, forKey: Self.unlockKey) }
    }

    /// `true` when the user has opted to hide the distraction/hyperfocus hold cluster.
    /// Persisted to `UserDefaults` via `didSet`.
    var hideDistractionHyperfocusControls: Bool {
        didSet { defaults.set(hideDistractionHyperfocusControls, forKey: Self.hideKey) }
    }

    // MARK: - Derived visibility

    /// `true` when the hold cluster should be visible in a solo session:
    /// unlocked **and** not explicitly hidden by the user.
    /// Mirrors web's `showDistractionHyperfocusCluster = trackingControlsUnlocked && !hideDistractionHyperfocusControls`.
    var showDistractionHyperfocusCluster: Bool {
        trackingControlsUnlocked && !hideDistractionHyperfocusControls
    }

    // MARK: - Init

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.trackingControlsUnlocked = defaults.bool(forKey: Self.unlockKey)
        self.hideDistractionHyperfocusControls = defaults.bool(forKey: Self.hideKey)
    }

    // MARK: - Unlock

    /// Unlocks tracking controls if this session qualifies (completed + ≥ 300 s).
    /// No-op if already unlocked. Delegates the qualification check to `TrackingUnlockGate`
    /// so the pure rule stays in the shared package.
    ///
    /// Mirrors web's `markTrackingUnlockIfQualifying`.
    func markTrackingUnlockIfQualifying(completed: Bool, duration: Int) {
        guard !trackingControlsUnlocked else { return }
        guard TrackingUnlockGate.qualifies(completed: completed, duration: duration) else { return }
        trackingControlsUnlocked = true
    }

    /// Backfill: scans the provided session list and unlocks if any qualifying sit is found.
    /// No-op if already unlocked. Mirrors web's `syncTrackingUnlockFromSessions`.
    ///
    /// Call this at login / app launch using the full `[SessionDTO]` history so existing
    /// users who completed a 5+ minute sit before this feature shipped start in the
    /// unlocked state.
    func syncTrackingUnlockFromSessions(_ sessions: [SessionDTO]) {
        guard !trackingControlsUnlocked else { return }
        guard sessions.contains(where: {
            TrackingUnlockGate.qualifies(completed: $0.completed, duration: $0.duration)
        }) else { return }
        trackingControlsUnlocked = true
    }

    // MARK: - Logout reset

    /// Resets the unlock flag on logout so the next sign-in re-qualifies.
    /// The hide preference is intentionally preserved, matching web's
    /// `resetTrackingUnlockOnLogout` behaviour (which only resets the unlock flag).
    func clearOnLogout() {
        guard trackingControlsUnlocked else { return }
        trackingControlsUnlocked = false
    }
}
