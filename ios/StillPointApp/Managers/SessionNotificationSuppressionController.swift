import Foundation

/// Decides whether incoming push notifications should be silently dropped while
/// a sit is in progress (#431). Web parity: `useSessionSuppressionRelay` + the
/// service-worker suppression in `public/sw.js`.
///
/// `PushNotificationCoordinator.willPresent` consults `shouldSuppressPresentation`
/// and returns empty presentation options when it is true.
///
/// Tracks activity per `AppViewModel` so multiple `WindowGroup` scenes do not
/// overwrite each other, mirroring `SessionIdleTimerController`.
@MainActor
enum SessionNotificationSuppressionController {
    /// Server-synced opt-in, cached locally so `willPresent` can decide even
    /// before the Notifications screen is opened in this launch. Updated whenever
    /// preferences load or the toggle is changed.
    private static let preferenceDefaultsKey = "sp_suppressNotificationsDuringSession"

    private final class Registration {
        weak var appViewModel: AppViewModel?
        var localSessionRunning = false
        var buddySessionActive = false

        init(appViewModel: AppViewModel) {
            self.appViewModel = appViewModel
        }
    }

    private static var registrations: [ObjectIdentifier: Registration] = [:]

    static var suppressPreferenceEnabled: Bool {
        UserDefaults.standard.bool(forKey: preferenceDefaultsKey)
    }

    static func setSuppressPreferenceEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: preferenceDefaultsKey)
    }

    /// Call when local `SessionView` appears/disappears or its in-progress state changes.
    static func syncLocalSession(appVM: AppViewModel, inProgress: Bool) {
        registration(for: appVM).localSessionRunning = inProgress
    }

    /// Call when a buddy shared sit enters/leaves the `active` server state.
    static func syncBuddySessionActive(appVM: AppViewModel, active: Bool) {
        registration(for: appVM).buddySessionActive = active
    }

    /// True when the opt-in is on AND any live scene has a sit in progress.
    static var shouldSuppressPresentation: Bool {
        guard suppressPreferenceEnabled else { return false }
        pruneDeadRegistrations()
        return registrations.values.contains { reg in
            reg.appViewModel != nil && (reg.localSessionRunning || reg.buddySessionActive)
        }
    }

    private static func registration(for appVM: AppViewModel) -> Registration {
        let id = ObjectIdentifier(appVM)
        // A deallocated AppViewModel can free its ObjectIdentifier for reuse by a
        // new instance; the weak `appViewModel === appVM` check discards that
        // stale entry instead of resurrecting another window's session state.
        if let existing = registrations[id], existing.appViewModel === appVM {
            return existing
        }
        let reg = Registration(appViewModel: appVM)
        registrations[id] = reg
        return reg
    }

    private static func pruneDeadRegistrations() {
        registrations = registrations.filter { _, reg in
            reg.appViewModel != nil
        }
    }
}
