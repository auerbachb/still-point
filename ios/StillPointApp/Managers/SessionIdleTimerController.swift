import UIKit

/// Central place to apply `UIApplication.shared.isIdleTimerDisabled` for active sits.
/// Resets to `false` whenever the app is not in an active session UI or the user opts out.
@MainActor
enum SessionIdleTimerController {
    private static let userDefaultsKey = "sp_keepScreenAwakeDuringSession"

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
            localSessionPreference: preferenceEnabled
        )
    }

    /// Call when buddy shared sit is in the `active` server state.
    static func syncBuddySessionActive(_ active: Bool) {
        applyDesiredIdleTimerState(buddySessionActive: active)
    }

    /// Recompute from stored preference and current flags (e.g. after foreground).
    static func applyDesiredIdleTimerState(
        localSessionRunning: Bool = false,
        localSessionPreference: Bool? = nil,
        buddySessionActive: Bool = false
    ) {
        let pref = localSessionPreference ?? keepScreenAwakePreferenceEnabled
        let shouldDisable = (localSessionRunning && pref) || (buddySessionActive && pref)
        UIApplication.shared.isIdleTimerDisabled = shouldDisable
    }
}
