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
    /// The drain task for the report queue, and the newest state waiting for it
    /// (see `report(active:)`). `nil` task means nothing is draining.
    private static var reportTask: Task<Void, Never>?
    private static var queuedReport: Bool?
    /// Bumped at every auth boundary so a drain task started by the previous
    /// account cannot outlive `cancelPendingReports()` or clear a newer task,
    /// and so a preference response that left before a sign-out cannot be
    /// applied after it (see `setSuppressPreferenceEnabled`).
    private static var reportGeneration = 0

    /// Orders the three independent readers of the server preference row —
    /// `NotificationPreferencesViewModel.load()`, its `persist()`, and
    /// `AppViewModel.hydrateNotificationSuppressionPreference()` — against each
    /// other. They serialize against themselves but not against one another, so
    /// without this a slow `load()` that left *before* the user's toggle could
    /// land after the toggle's PATCH and re-plant the pre-toggle value: "During
    /// sessions" turned off, then silently back on. Web parity: the
    /// `suppressDuringSessionPrefVersion()` sampling in `useSessionSuppressionRelay`.
    ///
    /// Deliberately separate from `reportGeneration`: that one is the *auth* epoch
    /// and `report(active:)` drains only while it is unchanged, so bumping it per
    /// preference write would cancel legitimate in-flight session-state reports.
    /// The two guards answer different questions — "is this still the same
    /// account?" and "is this still the newest word on the preference?" — and both
    /// must pass.
    private static var preferenceOrdering = StaleResponseGuard()

    /// On by default (#709): a sit is silent unless the user turned the "During
    /// sessions" toggle off. `bool(forKey:)` cannot express that — it returns false
    /// for an unset key — so read the object and fall back explicitly.
    static var suppressPreferenceEnabled: Bool {
        UserDefaults.standard.object(forKey: preferenceDefaultsKey) as? Bool ?? true
    }

    /// Snapshot of the auth epoch, taken by a caller that will apply a preference
    /// response later. Capture this *before* the `await`, hand it back to
    /// `setSuppressPreferenceEnabled(_:startedAtGeneration:requestTicket:responseKind:)`.
    static var preferenceGeneration: Int { reportGeneration }

    /// Ticket ordering this preference request against every other one in flight.
    /// Take it *before* the `await` — alongside `preferenceGeneration` — so it
    /// records when the request left rather than when its response arrived.
    static func nextPreferenceRequestTicket() -> Int {
        preferenceOrdering.nextTicket()
    }

    /// - Parameter generation: `preferenceGeneration` as it was when the request
    ///   started. Required rather than defaulted so a new call site cannot forget
    ///   it and silently reintroduce the cross-account leak.
    /// - Parameter ticket: `nextPreferenceRequestTicket()` as taken when the
    ///   request started. Also required, for the same reason.
    /// - Parameter kind: `.write` for a PATCH response (server truth as of its
    ///   commit), `.read` for a GET. A read that *started* after a write was
    ///   issued is still stale — it can reach the server before the write commits
    ///   — so only `.write` supersedes what was in flight beside it.
    /// - Returns: whether the response was adopted. Callers holding their own copy
    ///   of the preference must branch on this — writing the field while the cache
    ///   rejected the same value would leave the Settings toggle showing one
    ///   answer and `willPresent` acting on the other.
    @discardableResult
    static func setSuppressPreferenceEnabled(
        _ enabled: Bool,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int,
        responseKind kind: StaleResponseGuard.ResponseKind
    ) -> Bool {
        // This applies a per-account server preference to a device-global
        // controller, so a response that left before a sign-out must not land
        // after it: it would re-plant the choice `clearSuppressPreference()` just
        // removed onto whoever signs in next, and — with a registration still
        // reporting a sit — restart that hold under the new account's
        // credentials. Same #665 generation pattern as
        // `AppViewModel.hydrateNotificationSuppressionPreference`.
        guard generation == reportGeneration else { return false }
        // Same account, so the question left is which answer is newest. Checked
        // second: a response from a previous account must not count as "the newest
        // word" and consume a ticket on this account's behalf.
        guard preferenceOrdering.shouldApply(ticket: ticket, from: kind) else { return false }
        UserDefaults.standard.set(enabled, forKey: preferenceDefaultsKey)
        // Opting out mid-sit must release the server-side hold, and opting back in
        // must re-take it, without waiting for the next session state change.
        syncServerSessionState()
        return true
    }

    /// Clear the cached preference at an auth boundary so one account's choice
    /// never leaks into the next account on a shared device. Called from both ends
    /// of a session: `didLogout()` for an explicit sign-out, and `applySignedOut`
    /// for an authoritative automatic one (expired token, 401) — a rejected
    /// credential ends the session just as finally as tapping Sign out.
    static func clearSuppressPreference() {
        UserDefaults.standard.removeObject(forKey: preferenceDefaultsKey)
        // Stop reporting rather than clearing server-side: the request would 401
        // without a session, and the server's TTL expires the hold on its own.
        stopHeartbeat()
        cancelPendingReports()
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

    /// Reports serially with newest-wins coalescing: an in-flight heartbeat `true`
    /// landing after the `false` that ended the sit would re-suppress notifications
    /// for the whole server-side TTL after the user got up, so reports must reach
    /// the server in call order. Web parity: `reportSessionActiveState`.
    ///
    /// Superseded states are dropped rather than queued. `APIClient` uses
    /// `URLSessionConfiguration.default`, whose 60s request timeout is no shorter
    /// than the heartbeat interval, so on a slow network reports can be issued
    /// faster than they drain; queueing them all would delay the ending `false` by
    /// one full request per stacked heartbeat. The endpoint stores absolute state,
    /// so only the newest report still matters.
    private static func report(active: Bool) {
        queuedReport = active
        guard reportTask == nil else { return }

        let generation = reportGeneration
        reportTask = Task { @MainActor in
            defer { if generation == reportGeneration { reportTask = nil } }
            while generation == reportGeneration, !Task.isCancelled, let next = queuedReport {
                queuedReport = nil
                try? await APIClient.shared.reportSessionNotificationState(active: next)
            }
        }
    }

    /// Drop anything queued or in flight at an auth boundary: a report from the
    /// previous account draining after the next one signs in would carry the new
    /// account's credentials and silence *their* notifications for a full TTL.
    private static func cancelPendingReports() {
        reportGeneration += 1
        queuedReport = nil
        reportTask?.cancel()
        reportTask = nil
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
