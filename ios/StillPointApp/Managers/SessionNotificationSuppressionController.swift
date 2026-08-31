import Foundation
import StillPointShared

/// Holds Still Point's own notifications while a sit is in progress, on two layers
/// (#431 display suppression, #709 server-side send suppression).
///
/// 1. **Server:** reports session-active state to `/api/notifications/session-state`
///    so scheduled reminders and friend-request pushes are never *sent* during a
///    sit. This is the only layer that covers a push delivered while the app is
///    backgrounded, where `willPresent` never runs.
/// 2. **Display:** `PushNotificationCoordinator.willPresent` consults
///    `shouldSuppressPresentation` and returns empty presentation options, which
///    drops anything already in flight when the sit starts.
///
/// Web parity: `useSessionSuppressionRelay` + the service-worker suppression in
/// `public/sw.js`.
///
/// Tracks activity per `AppViewModel` so multiple `WindowGroup` scenes do not
/// overwrite each other, mirroring `SessionIdleTimerController`.
@MainActor
enum SessionNotificationSuppressionController {
    /// Server-synced preference, cached locally so `willPresent` can decide even
    /// before the Notifications screen is opened in this launch. Updated whenever
    /// preferences load or the toggle is changed.
    private static let preferenceDefaultsKey = "sp_suppressNotificationsDuringSession"

    /// How often an active sit re-reports itself to the server. Must stay shorter
    /// than `SESSION_ACTIVE_TTL_MS` in `src/lib/notifications/session-active.ts`
    /// (3 min) so a long sit never lapses between refreshes, while an app that
    /// stops reporting self-heals once the server-side TTL passes.
    private static let serverHeartbeat: Duration = .seconds(60)

    private final class Registration {
        weak var appViewModel: AppViewModel?
        var localSessionRunning = false
        var buddySessionActive = false

        init(appViewModel: AppViewModel) {
            self.appViewModel = appViewModel
        }
    }

    private static var registrations: [ObjectIdentifier: Registration] = [:]

    /// Last state reported to the server, so repeated syncs for the same sit do not
    /// re-POST on every SwiftUI state change.
    private static var reportedSessionActive = false
    private static var heartbeatTask: Task<Void, Never>?
    /// Tail of the serialized report chain (see `report(active:)`).
    private static var reportTask: Task<Void, Never>?

    /// On by default (#709): a sit is silent unless the user turned the "During
    /// sessions" toggle off. `bool(forKey:)` cannot express that — it returns false
    /// for an unset key — so read the object and fall back explicitly.
    static var suppressPreferenceEnabled: Bool {
        UserDefaults.standard.object(forKey: preferenceDefaultsKey) as? Bool ?? true
    }

    static func setSuppressPreferenceEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: preferenceDefaultsKey)
        // Opting out mid-sit must release the server-side hold, and opting back in
        // must re-take it, without waiting for the next session state change.
        syncServerSessionState()
    }

    /// Clear the cached preference at an auth boundary (logout) so one account's
    /// choice never leaks into the next account on a shared device.
    static func clearSuppressPreference() {
        UserDefaults.standard.removeObject(forKey: preferenceDefaultsKey)
        // Stop reporting rather than clearing server-side: the request would 401
        // without a session, and the server's TTL expires the hold on its own.
        stopHeartbeat()
        reportedSessionActive = false
    }

    /// Call when local `SessionView` appears/disappears or its in-progress state changes.
    static func syncLocalSession(appVM: AppViewModel, inProgress: Bool) {
        pruneDeadRegistrations()
        registration(for: appVM).localSessionRunning = inProgress
        syncServerSessionState()
    }

    /// Call when a buddy shared sit enters/leaves the `active` server state.
    static func syncBuddySessionActive(appVM: AppViewModel, active: Bool) {
        pruneDeadRegistrations()
        registration(for: appVM).buddySessionActive = active
        syncServerSessionState()
    }

    /// True when the preference is on AND any live scene has a sit in progress.
    static var shouldSuppressPresentation: Bool {
        pruneDeadRegistrations()
        guard suppressPreferenceEnabled else { return false }
        return registrations.values.contains { reg in
            reg.appViewModel != nil && (reg.localSessionRunning || reg.buddySessionActive)
        }
    }

    /// Push the current state to the server when it changed, and keep it refreshed
    /// while a sit runs. Best-effort: a failed report leaves `willPresent` as the
    /// remaining layer, and the server's TTL cleans up a hold we stop refreshing.
    private static func syncServerSessionState() {
        let active = shouldSuppressPresentation
        guard active != reportedSessionActive else { return }
        reportedSessionActive = active

        if active {
            startHeartbeat()
        } else {
            stopHeartbeat()
            report(active: false)
        }
    }

    private static func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { @MainActor in
            while !Task.isCancelled {
                report(active: true)
                do {
                    try await Task.sleep(for: serverHeartbeat)
                } catch {
                    return
                }
            }
        }
    }

    private static func stopHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
    }

    /// Reports serially: an in-flight heartbeat `true` landing after the `false`
    /// that ended the sit would re-suppress notifications for the whole server-side
    /// TTL after the user got up. Chaining each report behind the previous one keeps
    /// the server's view in call order. Web parity: `reportSessionActiveState`.
    ///
    /// A stalled request cannot block the chain indefinitely — `APIClient` uses
    /// `URLSessionConfiguration.default`, whose 60s request timeout fails it — and
    /// reports are rare enough (state changes plus one per heartbeat) that the chain
    /// needs no coalescing.
    private static func report(active: Bool) {
        let previous = reportTask
        reportTask = Task { @MainActor in
            _ = await previous?.value
            try? await APIClient.shared.reportSessionNotificationState(active: active)
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
