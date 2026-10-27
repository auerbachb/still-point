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
        /// Identifies this scene's live sit on the server (#741). Minted when the
        /// sit starts and cleared after the `active: false` report is queued.
        var sessionKey: String?
        /// The account `sessionKey` was minted for (#1058): the credential owner at
        /// that moment, so its refreshes and its release go out only under that
        /// account's credentials. Set and cleared together with `sessionKey`.
        var sessionKeyOwner: String?
        /// The account that started the running sit (#1058). Captured on the
        /// aggregate false→true transition and never reassigned while it runs,
        /// so a sit kept running across an account switch stays the old account's.
        var ownership = SessionHoldOwnership()

        init(appViewModel: AppViewModel) {
            self.appViewModel = appViewModel
        }

        var sitting: Bool { localSessionRunning || buddySessionActive }

        /// Records the new flags' aggregate `sitting` value against the scene's
        /// account. Call after every flag change.
        func updateOwnership(sceneAccountId: String?) {
            ownership.update(sitting: sitting, sceneAccountId: sceneAccountId)
        }

        func clearSessionKey() {
            sessionKey = nil
            sessionKeyOwner = nil
        }
    }

    private static var registrations: [ObjectIdentifier: Registration] = [:]

    /// Session keys whose `active: true` has been reported and not yet released.
    private static var reportedActiveKeys = Set<String>()
    private static var heartbeatTask: Task<Void, Never>?
    /// The drain task for the report queue, and the newest state waiting for each
    /// session key (see `report(active:sessionKey:)`). `nil` task means nothing
    /// is draining.
    private static var reportTask: Task<Void, Never>?
    /// One queued report: the newest state for a session key, and the account it
    /// is for (#1058). The drain sends it only under that account's credentials.
    private struct QueuedReport {
        let active: Bool
        let ownerAccountId: String
    }

    private static var queuedReports: [String: QueuedReport] = [:]
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
        // without a session, and a queued clear that drained after the next
        // sign-in would run under that account's credentials. Each sit's hold is
        // its own row (#741), so the residual rows belong to the signing-out
        // account and expire with the TTL. A release that did drain later can
        // delete only a session key the new account does not own, which is a no-op.
        stopHeartbeat()
        cancelPendingReports()
        reportedActiveKeys = []
        // Keep each registration's flags and its sit's owner (#1058): a scene still
        // sitting for the outgoing account stays that account's, so the next
        // account's hydration cannot report it (see `syncServerSessionState`).
        for registration in registrations.values {
            registration.clearSessionKey()
        }
    }

    /// Call when local `SessionView` appears/disappears or its in-progress state changes.
    static func syncLocalSession(appVM: AppViewModel, inProgress: Bool) {
        pruneDeadRegistrations()
        let registration = registration(for: appVM)
        registration.localSessionRunning = inProgress
        registration.updateOwnership(sceneAccountId: appVM.currentUser?.id)
        syncServerSessionState()
    }

    /// Call when a buddy shared sit enters/leaves the `active` server state.
    static func syncBuddySessionActive(appVM: AppViewModel, active: Bool) {
        pruneDeadRegistrations()
        let registration = registration(for: appVM)
        registration.buddySessionActive = active
        registration.updateOwnership(sceneAccountId: appVM.currentUser?.id)
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

    /// Push each live sit's own key to the server, and keep those holds refreshed.
    /// Best-effort: a failed report leaves `willPresent` as the remaining layer,
    /// and the server's TTL cleans up a hold we stop refreshing.
    ///
    /// #1058: only a sit owned by the account that owns the credentials now is
    /// reported. A scene still sitting for a previous account holds no key here,
    /// so that account's sit never silences the next account's notifications.
    private static func syncServerSessionState() {
        var activeKeys = Set<String>()
        let holdsEnabled = suppressPreferenceEnabled
        let credentialOwner = CredentialOwner.shared.snapshot.accountId
        for registration in registrations.values where registration.appViewModel != nil {
            if holdsEnabled,
               registration.ownership.isReportable(forCredentialOwner: credentialOwner),
               let credentialOwner {
                if let sessionKey = registration.sessionKey, registration.sessionKeyOwner != credentialOwner {
                    // Minted for another account: drop it without a release, as
                    // `clearSuppressPreference()` does, and take a fresh key below.
                    reportedActiveKeys.remove(sessionKey)
                    registration.clearSessionKey()
                }
                if registration.sessionKey == nil {
                    registration.sessionKey = UUID().uuidString
                    registration.sessionKeyOwner = credentialOwner
                }
                if let sessionKey = registration.sessionKey {
                    activeKeys.insert(sessionKey)
                    if !reportedActiveKeys.contains(sessionKey) {
                        report(active: true, sessionKey: sessionKey, ownerAccountId: credentialOwner)
                    }
                }
            } else if let sessionKey = registration.sessionKey {
                let keyOwner = registration.sessionKeyOwner
                registration.clearSessionKey()
                // Release only under the account the key was minted for. Any other
                // account's credentials would make it a cross-account request, so
                // the server TTL expires that hold instead.
                if let keyOwner, keyOwner == credentialOwner {
                    report(active: false, sessionKey: sessionKey, ownerAccountId: keyOwner)
                }
            }
        }
        reportedActiveKeys = activeKeys
        if activeKeys.isEmpty {
            stopHeartbeat()
        } else if heartbeatTask == nil {
            startHeartbeat()
        }
    }

    private static func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { @MainActor in
            while !Task.isCancelled {
                refreshActiveHolds()
                do {
                    try await Task.sleep(for: serverHeartbeat)
                } catch {
                    return
                }
            }
        }
    }

    private static func refreshActiveHolds() {
        let credentialOwner = CredentialOwner.shared.snapshot.accountId
        var refreshedAny = false
        for registration in registrations.values {
            guard registration.appViewModel != nil,
                  suppressPreferenceEnabled,
                  registration.ownership.isReportable(forCredentialOwner: credentialOwner),
                  let sessionKey = registration.sessionKey,
                  let keyOwner = registration.sessionKeyOwner,
                  keyOwner == credentialOwner else { continue }
            report(active: true, sessionKey: sessionKey, ownerAccountId: keyOwner)
            refreshedAny = true
        }
        // #1058: nothing left this account may refresh (the credentials changed
        // under a running sit), so stop until a sync starts a hold again.
        if !refreshedAny {
            stopHeartbeat()
        }
    }

    private static func stopHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
    }

    /// Reports serially, newest-wins per session key. One sit's trailing `true`
    /// must not replace another sit's `false`: the server stores a row per key
    /// (#741), and only the newest report for *that* key still matters.
    private static func report(active: Bool, sessionKey: String, ownerAccountId: String) {
        queuedReports[sessionKey] = QueuedReport(active: active, ownerAccountId: ownerAccountId)
        guard reportTask == nil else { return }

        let generation = reportGeneration
        reportTask = Task { @MainActor in
            defer { if generation == reportGeneration { reportTask = nil } }
            while generation == reportGeneration, !Task.isCancelled, let sessionKey = queuedReports.keys.first {
                guard let next = queuedReports.removeValue(forKey: sessionKey) else { continue }
                try? await APIClient.shared.reportSessionNotificationState(
                    active: next.active,
                    sessionKey: sessionKey,
                    expectedOwnerAccountId: next.ownerAccountId
                )
            }
        }
    }

    /// Drop anything queued or in flight at an auth boundary: a report from the
    /// previous account draining after the next one signs in would carry the new
    /// account's credentials and silence *their* notifications for a full TTL.
    private static func cancelPendingReports() {
        reportGeneration += 1
        queuedReports = [:]
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
        let dead = registrations.filter { _, registration in registration.appViewModel == nil }
        guard !dead.isEmpty else { return }
        registrations = registrations.filter { _, registration in registration.appViewModel != nil }
        let credentialOwner = CredentialOwner.shared.snapshot.accountId
        for (_, registration) in dead {
            guard let sessionKey = registration.sessionKey else { continue }
            let keyOwner = registration.sessionKeyOwner
            registration.clearSessionKey()
            reportedActiveKeys.remove(sessionKey)
            // #1058: release only under the account the key was minted for;
            // otherwise the server TTL expires the hold.
            if let keyOwner, keyOwner == credentialOwner {
                report(active: false, sessionKey: sessionKey, ownerAccountId: keyOwner)
            }
        }
        let stillSitting = registrations.values.contains { registration in
            registration.appViewModel != nil
                && registration.ownership.isReportable(forCredentialOwner: credentialOwner)
                && registration.sessionKey != nil
                && registration.sessionKeyOwner == credentialOwner
        }
        if !stillSitting {
            stopHeartbeat()
        }
    }
}
