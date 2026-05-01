import UIKit

/// Central place to apply `UIApplication.shared.isIdleTimerDisabled` for active sits.
/// When the preference is off, or no sit timer is running, the system idle timer stays enabled.
///
/// Tracks activity per `AppViewModel` so multiple `WindowGroup` scenes do not overwrite
/// each other. Re-applies after foreground using stored registration state.
@MainActor
enum SessionIdleTimerController {
    private static let userDefaultsKey = "sp_keepScreenAwakeDuringSession"

    private final class IdleRegistration {
        weak var appViewModel: AppViewModel?
        var sceneForegroundActive = false
        var localSessionRunning = false
        var buddySessionActive = false

        init(appViewModel: AppViewModel) {
            self.appViewModel = appViewModel
        }
    }

    private static var registrations: [ObjectIdentifier: IdleRegistration] = [:]

    static var keepScreenAwakePreferenceEnabled: Bool {
        UserDefaults.standard.bool(forKey: userDefaultsKey)
    }

    static func setKeepScreenAwakePreferenceEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: userDefaultsKey)
        applyDesiredIdleTimerState()
    }

    /// Call when local `SessionView` is on screen and timer state changes, or preference toggles.
    static func syncLocalSession(appVM: AppViewModel, isRunning: Bool) {
        let reg = registration(for: appVM)
        reg.localSessionRunning = isRunning
        applyDesiredIdleTimerState()
    }

    /// Call when buddy shared sit is in the `active` server state.
    static func syncBuddySessionActive(appVM: AppViewModel, active: Bool) {
        let reg = registration(for: appVM)
        reg.buddySessionActive = active
        applyDesiredIdleTimerState()
    }

    /// Call from each window’s `RootView` when `scenePhase` changes.
    static func syncSceneForegroundActive(appVM: AppViewModel, isForegroundActive: Bool) {
        let reg = registration(for: appVM)
        reg.sceneForegroundActive = isForegroundActive
        applyDesiredIdleTimerState()
    }

    /// Recompute from all registrations and UserDefaults (e.g. after foreground).
    static func applyDesiredIdleTimerState() {
        pruneDeadRegistrations()
        let pref = keepScreenAwakePreferenceEnabled
        let shouldDisable = pref && registrations.values.contains { reg in
            reg.appViewModel != nil && reg.sceneForegroundActive
                && (reg.localSessionRunning || reg.buddySessionActive)
        }
        UIApplication.shared.isIdleTimerDisabled = shouldDisable
    }

    /// True if any connected scene is foreground-active (multi-window safe).
    static var hasForegroundActiveScene: Bool {
        UIApplication.shared.connectedScenes.contains { scene in
            scene.activationState == .foregroundActive
        }
    }

    /// When the app has no foreground-active scene, force the idle timer on so the device can lock.
    static func applyBackgroundIdleTimerPolicyIfNoForegroundScene() {
        guard !hasForegroundActiveScene else { return }
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private static func registration(for appVM: AppViewModel) -> IdleRegistration {
        let id = ObjectIdentifier(appVM)
        if let existing = registrations[id] {
            return existing
        }
        let reg = IdleRegistration(appViewModel: appVM)
        registrations[id] = reg
        return reg
    }

    private static func pruneDeadRegistrations() {
        registrations = registrations.filter { _, reg in
            reg.appViewModel != nil
        }
    }
}
