import UIKit
import StillPointShared

/// Central place to apply `UIApplication.shared.isIdleTimerDisabled` for active sits.
/// The preference is on unless the user turned it off (#730), so an untouched install
/// keeps the screen awake for the length of a sit. When the preference is off, or no
/// sit timer is running, the system idle timer stays enabled.
///
/// Tracks activity per `AppViewModel` so multiple `WindowGroup` scenes do not overwrite
/// each other. Re-applies after foreground using stored registration state.
@MainActor
enum SessionIdleTimerController {
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

    /// Resolved through `WakeLockPrefs`, which distinguishes "never set" (default on)
    /// from an explicit `false` — `UserDefaults.bool(forKey:)` cannot (#730).
    static var keepScreenAwakePreferenceEnabled: Bool {
        WakeLockPrefs.isKeepScreenAwakeEnabled
    }

    /// #742: recorded through the shared store rather than straight into
    /// `WakeLockPrefs`, so every scene's Settings switch re-renders from the one
    /// value. The store declines a set that matches what is already stored — a
    /// duplicate write for a single tap, and on an untouched install a write of the
    /// #730 default the user never chose. The idle timer is re-applied either way:
    /// it resolves storage itself and is idempotent.
    static func setKeepScreenAwakePreferenceEnabled(_ enabled: Bool) {
        WakeLockPreferenceStore.shared.setEnabled(enabled)
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
