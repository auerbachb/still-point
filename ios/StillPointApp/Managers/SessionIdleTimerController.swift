import AVFoundation
import UIKit
import StillPointShared

/// Central place to apply `UIApplication.shared.isIdleTimerDisabled` for active sits.
/// The preference is on unless the user turned it off (#730), so an untouched install
/// keeps the screen awake for the length of a sit. When the preference is off, or no
/// sit timer is running, the system idle timer stays enabled.
///
/// Tracks activity per `AppViewModel` so multiple `WindowGroup` scenes do not overwrite
/// each other. Re-applies after foreground using stored registration state.
///
/// #1176: the rule lives in `KeepAwakeLogic` (StillPointShared, `swift test`-covered)
/// and never reads cue mode, so a haptic sit is held like any other. Besides the
/// view call sites (scene phase, pause/resume, cue-mode change, overlays closing),
/// the controller re-applies itself when an audio interruption ends and when the
/// app becomes active, since neither always reaches a view.
///
/// The iOS limit: a side-button lock suspends the app regardless, and no haptic or
/// bell can fire until the sitter reopens it.
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
    private static var systemObservers: [NSObjectProtocol] = []

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
        let shouldDisable = KeepAwakeLogic.shouldDisableIdleTimer(
            preferenceEnabled: keepScreenAwakePreferenceEnabled,
            registrations: registrations.values.map { reg in
                KeepAwakeLogic.Registration(
                    isAlive: reg.appViewModel != nil,
                    sceneForegroundActive: reg.sceneForegroundActive,
                    localSessionRunning: reg.localSessionRunning,
                    buddySessionActive: reg.buddySessionActive
                )
            }
        )
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
        installSystemObserversIfNeeded()
        return reg
    }

    /// #1176: re-apply after an audio interruption ends (a call, Siri, an alarm)
    /// and when the app becomes active, so a lapse during either never outlasts it.
    /// Installed once, on the first registration, for the life of the process.
    private static func installSystemObserversIfNeeded() {
        guard systemObservers.isEmpty else { return }
        let center = NotificationCenter.default
        systemObservers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .ended else { return }
            MainActor.assumeIsolated { applyDesiredIdleTimerState() }
        })
        systemObservers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { _ in
            MainActor.assumeIsolated { applyDesiredIdleTimerState() }
        })
    }

    private static func pruneDeadRegistrations() {
        registrations = registrations.filter { _, reg in
            reg.appViewModel != nil
        }
    }
}
