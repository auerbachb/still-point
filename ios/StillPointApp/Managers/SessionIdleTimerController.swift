import UIKit

/// Central place to apply `UIApplication.shared.isIdleTimerDisabled` for active sits.
/// When the preference is off, or no sit timer is running, the system idle timer stays enabled.
///
/// Last-known local/buddy activity is retained so a no-argument re-apply (e.g. after
/// `scenePhase` becomes `.active`) still matches an in-progress sit.
@MainActor
enum SessionIdleTimerController {
    private static let userDefaultsKey = "sp_keepScreenAwakeDuringSession"

    private static var lastLocalSessionRunning = false
    private static var lastBuddySessionActive = false

    static var keepScreenAwakePreferenceEnabled: Bool {
        UserDefaults.standard.bool(forKey: userDefaultsKey)
    }

    static func setKeepScreenAwakePreferenceEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: userDefaultsKey)
        applyDesiredIdleTimerState()
    }

    /// Call when local `SessionView` is on screen and timer state changes, or preference toggles.
    static func syncLocalSession(isRunning: Bool, preferenceEnabled: Bool) {
        applyDesiredIdleTimerState(
            localSessionRunning: isRunning,
            localSessionPreference: preferenceEnabled,
            buddySessionActive: nil
        )
    }

    /// Call when buddy shared sit is in the `active` server state.
    static func syncBuddySessionActive(_ active: Bool) {
        applyDesiredIdleTimerState(
            localSessionRunning: nil,
            localSessionPreference: nil,
            buddySessionActive: active
        )
    }

    /// Recompute from stored session flags and UserDefaults (e.g. after foreground).
    static func applyDesiredIdleTimerState(
        localSessionRunning: Bool? = nil,
        localSessionPreference: Bool? = nil,
        buddySessionActive: Bool? = nil
    ) {
        if let localSessionRunning {
            lastLocalSessionRunning = localSessionRunning
        }
        if let buddySessionActive {
            lastBuddySessionActive = buddySessionActive
        }
        let pref = localSessionPreference ?? keepScreenAwakePreferenceEnabled
        let shouldDisable = (lastLocalSessionRunning && pref) || (lastBuddySessionActive && pref)
        UIApplication.shared.isIdleTimerDisabled = shouldDisable
    }
}
