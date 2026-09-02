import SwiftUI
import SwiftData
import StillPointShared
import os

enum AppView: Equatable {
    case auth
    case home
    case session(type: SessionType, track: Track)
    case buddyHub
    case buddyCalendar
    case buddyCalendarWithBuddy(buddyId: String, buddyUsername: String)
    case buddySession(sessionId: String)
    case completion(
        sessionId: String,
        clientSessionId: UUID,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        sessionType: SessionType,
        track: Track,
        sessionCompleted: Bool,
        duration: Int,
        bonusSeconds: Int,
        attentionLog: [AttentionEntry]?,
        attentionElapsed: Double?,
        ambientSoundSummary: AmbientSoundSummary?
    )
    case breathCounting
    case logReason(date: String)
    case history
    case journal
    case board
    case settings

    static func == (lhs: AppView, rhs: AppView) -> Bool {
        switch (lhs, rhs) {
        case (.auth, .auth), (.home, .home),
             (.buddyHub, .buddyHub),
             (.buddyCalendar, .buddyCalendar),
             (.breathCounting, .breathCounting),
             (.history, .history), (.journal, .journal), (.board, .board),
             (.settings, .settings):
            return true
        case let (.session(lhsType, lhsTrack), .session(rhsType, rhsTrack)):
            return lhsType == rhsType && lhsTrack == rhsTrack
        case let (.buddySession(lhsSessionId), .buddySession(rhsSessionId)):
            return lhsSessionId == rhsSessionId
        case let (.buddyCalendarWithBuddy(lhsId, lhsName), .buddyCalendarWithBuddy(rhsId, rhsName)):
            return lhsId == rhsId && lhsName == rhsName
        case let (.logReason(lhsDate), .logReason(rhsDate)):
            return lhsDate == rhsDate
        case (.completion, .completion):
            return true
        default:
            return false
        }
    }
}

struct CapturedThought: Identifiable {
    let id = UUID()
    let timeInSession: Int
    let text: String
}

@Observable
@MainActor
final class AppViewModel {
    /// Diagnostic logger for `[E2E-DIAG]` lines. os_log is used (not `print`)
    /// so the lines reach the xcresult bundle in CI. Issue #276.
    private static let diagLog = Logger(subsystem: "com.brettonauerbach.stillpoint", category: "e2e-diag")

    var currentView: AppView = .auth
    /// Selected tab in `MainTabView`, lifted here so non-tab views (e.g. the Home
    /// app-gate pill) can navigate to a tab. 0 = Home … 4 = Settings.
    var selectedTab: Int = AppViewModel.defaultSelectedTab()
    var currentUser: UserDTO?
    /// #665: true while the app is running from its local copy of identity and
    /// state because the server could not be reached. Drives the offline
    /// indicator; any successful `me()` clears it.
    var isOfflineMode = false
    /// #703: a local save has failed on this device and has not since succeeded.
    /// Withdraws the offline indicator's "sits are saved and upload when you
    /// reconnect" promise, which is false for as long as storage refuses writes.
    /// A later successful save clears it — that is the proof storage works again.
    var localSaveFailed = false
    var isLoading = true
    var authStatusMessage: String?
    var lastColdStartAuthCheckMs: Int?
    var buddyInviteError: String?
    /// Guards `completeBreathSession` against re-entrant End taps creating duplicate rows.
    private var isSavingBreathSession = false
    /// #526: client-local progressive-unlock + hide preference for the hold-cluster controls.
    var trackingControlPrefsManager = TrackingControlPrefsManager()
    private var appBlockingManagerStorage: AppBlockingManager?
    var appBlockingManager: AppBlockingManager {
        if let appBlockingManagerStorage {
            return appBlockingManagerStorage
        }
        let manager = AppBlockingManager()
        appBlockingManagerStorage = manager
        return manager
    }
    private var pendingBuddyInviteToken: String?
    private var pendingSessionDeepLink: SessionType?
    private var pendingLogReasonDate: String?

    /// Persisted: keep device screen awake during an active sit when enabled.
    var keepScreenAwakeDuringSession: Bool {
        didSet {
            SessionIdleTimerController.setKeepScreenAwakePreferenceEnabled(keepScreenAwakeDuringSession)
        }
    }

    /// #240: per-track "completed a standard sit today", drives the Home badges.
    var primaryDoneToday = false
    var secondDoneToday = false
    /// Any counted Track One practice today (standard primary, quick, or breath)
    /// for the widget. Deliberately separate from `primaryDoneToday`: the Home
    /// badges are server-derived, while this drives the widget's weekday row.
    var practiceDoneToday = false
    /// #684: the Track Two equivalent — a second-track standard sit today. Feeds
    /// the widget's second weekday row without touching the Home badge above.
    var secondPracticeDoneToday = false
    /// #679: a *primary* **standard** sit today, known locally. The Track One
    /// analogue of `secondPracticeDoneToday`, and narrower than
    /// `practiceDoneToday`, which quick and breath sits also raise. It exists
    /// because the widget's standard-only day set may only be extended by days the
    /// server would itself have counted, and `primaryDoneToday` — the server-derived
    /// Home badge — is still false in the moment a sit finishes, which delayed the
    /// streak until the next `getTracksDoneToday` round-trip.
    var primaryStandardDoneToday = false
    /// The moment the five flags above were last rolled over — i.e. the local day
    /// they are a statement *about*. They are all same-day claims, and
    /// `WidgetDataStore.makeSnapshot` folds each of them into *today*; carrying
    /// one across local midnight would claim a day that was never sat. Passed to
    /// `makeSnapshot` as `flagsAsOf` so the fold is retired at the boundary, and
    /// used by `rollOverDoneTodayFlagsIfNeeded()` to retire the flags themselves.
    private var doneTodayFlagsStamp: Date?

    var currentDay: Int {
        StillPoint.clampedCurrentDay(for: currentUser)
    }

    var recoveryFields: DurationRecovery.RecoveryFields {
        DurationRecovery.recoveryFields(from: currentUser)
    }

    var activeRecovery: DurationRecovery.ActiveRecovery? {
        DurationRecovery.activeRecovery(recoveryFields)
    }

    var todayDuration: Int {
        DurationRecovery.sessionDurationForUser(
            sessionType: .standard,
            currentDay: currentDay,
            recovery: recoveryFields
        )
    }

    var todayBlockCount: Int {
        StillPoint.blockCount(forDuration: todayDuration)
    }

    // MARK: - #240 Dual-track fork

    /// Whether the user has opted into the second daily track.
    var dualTrackEnabled: Bool {
        currentUser?.dualTrackEnabled ?? false
    }

    /// True once the primary track has passed the 10-minute mark (fork available).
    var dualTrackEligible: Bool {
        StillPoint.isDualTrackEligible(currentDay: currentDay)
    }

    /// Second-track day counter (clamped to >= 1 for defensive upstream data).
    var secondTrackDay: Int {
        max(currentUser?.secondTrackDay ?? 1, 1)
    }

    var secondTrackDuration: Int {
        StillPoint.duration(forDay: secondTrackDay)
    }

    var secondTrackBlockCount: Int {
        StillPoint.blockCount(forDuration: secondTrackDuration)
    }

    var isInSession: Bool {
        if case .session = currentView { return true }
        if case .buddySession = currentView { return true }
        if case .completion = currentView { return true }
        if case .breathCounting = currentView { return true }
        return false
    }

    init() {
        self.keepScreenAwakeDuringSession = SessionIdleTimerController.keepScreenAwakePreferenceEnabled
    }

    func checkAuth() async {
        let startedAt = Date()
        // Not only the cold-start path: `RootView` also runs this on every
        // `scenePhase == .active`, so it re-validates an *existing* session as
        // often as it establishes a new one. A sign-out landing while `me()` is
        // suspended would otherwise let the late response re-adopt the old account
        // and route back into the authenticated UI (#665).
        let generation = authGeneration
        // Overlapping checks are possible (cold start immediately followed by a
        // scene activation). Only the newest may drop the overlay: an older check
        // finishing first would otherwise clear it while the newest is still
        // awaiting `me()`, briefly exposing an intermediate or stale route.
        activeAuthCheckID &+= 1
        let checkID = activeAuthCheckID
        isLoading = true
        defer {
            if checkID == activeAuthCheckID { isLoading = false }
            // Diagnostic for issue #266 / #276. Gated on UI-test mode so we
            // don't leak PII in production logs. Switched to os_log
            // (Logger.notice) because `print()` from the app process is not
            // captured by Xcode UI test xcresult bundles — that's why the
            // prior diagnostic from PR #261 never showed up in CI.
            if ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1" {
                let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
                Self.diagLog.notice("[E2E-DIAG] checkAuth.done currentView=\(self.viewSlug(self.currentView), privacy: .public) currentUser=\(self.currentUser?.email ?? "nil", privacy: .public) elapsedMs=\(elapsedMs, privacy: .public)")
            }
        }

        // Enqueued rather than run outright: this read adopts a whole `UserDTO`, so a
        // settings save whose PATCH left first would otherwise supersede it and put
        // that save's response — which may predate today's sit — into `currentUser`
        // and the offline cache (#697). Awaited, because the routing and the overlay
        // above both depend on the answer.
        await enqueueSettingsRead { [weak self] in
            guard let self else { return }
            await self.performAuthCheck(startedAt: startedAt, generation: generation, checkID: checkID)
        }.value
    }

    /// The body of `checkAuth()`, run from the settings queue.
    ///
    /// - Parameter startedAt: when the caller began, for the cold-start timing metric.
    /// - Parameter generation: `authGeneration` as it was when the check was asked for.
    /// - Parameter checkID: `activeAuthCheckID` as it was then, so a superseded check
    ///   cannot route or sign out on behalf of a newer one.
    private func performAuthCheck(startedAt: Date, generation: Int, checkID: Int) async {
        // Re-checked now that the queue turn has arrived: waiting for a place in line
        // is an `await` like any other, so a sign-out or account switch can have landed
        // while a slower save ahead of us was still resolving, and neither this read
        // nor the routing under it belongs to the session that replaced ours.
        guard generation == authGeneration, checkID == activeAuthCheckID else { return }
        // Taken here, immediately before the request, so it records when this read
        // left rather than when it was asked for (#697). Taken unconditionally even
        // though only the re-confirmation branch below spends it — a ticket that goes
        // unused leaves a gap and nothing else.
        let settingsTicket = nextSettingsRequestTicket()

        do {
            if let user = try await APIClient.shared.me(today: SessionCalendar.localTodayIsoDate()) {
                // Paired with the check ID for the same reason as the terminal
                // branches below. Adopting the user is idempotent, but the route
                // reset and the badge reset under it are not: `RootView` starts a
                // check from both `.task` and `scenePhase == .active`, and since
                // re-confirming the same account does not move the generation, an
                // older call landing after the newest one finished would send a
                // user who has since navigated back to the initial view.
                guard generation == authGeneration, checkID == activeAuthCheckID else { return }
                // Re-confirming the account already on screen still goes through the
                // settings ordering (#697). The queue turn above is what makes this
                // response the newest word — no settings save can be in flight — so
                // the guard is the backstop rather than the mechanism, and it is kept
                // for the caller that reads the account without queueing. A superseded
                // read would change nothing anyway: a newer settings write already
                // described this account, `isOfflineMode` included, so the side effects
                // below run either way; they are keyed to this being the newest check,
                // not to the adoption.
                if currentUser?.id == user.id {
                    applySettingsResponse(
                        user,
                        startedAtGeneration: generation,
                        requestTicket: settingsTicket,
                        responseKind: .read
                    )
                } else {
                    // A cold start, or an account switch. Nothing to order it
                    // against, and the guards inside `applySettingsResponse` would
                    // read it as `.discarded`.
                    applyAuthenticatedUser(user)
                }
                // Re-captured deliberately. Adopting the user is itself an expected
                // transition on a cold start (nil -> user), so the entry generation
                // is stale from here on *by design* and reusing it below would skip
                // the side effects on every launch. The entry capture protects the
                // decision to adopt; this one protects everything after it.
                let adopted = authGeneration
                resetTrackCompletionBadges()
                currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
                authStatusMessage = nil
                lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
                PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
                hydrateNotificationSuppressionPreference()
                await refreshTracksDoneToday()
                // The guard above only covered adopting the response. The refresh is
                // another suspension point, and everything below it is an
                // identity-scoped side effect — the widget snapshot and three
                // non-idempotent deep-link/invite consumptions — so none of it may
                // run for a session that has since been replaced.
                guard adopted == authGeneration else { return }
                syncWidgetData()
                await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
                await consumePendingSessionDeepLinkIfNeeded()
                await consumePendingLogReasonIfNeeded()
                return
            }
            // `me()` swallows a 401 that is *not* `TOKEN_EXPIRED` and returns nil:
            // the server answered, and the answer was "no session". Authoritative —
            // but only for the session that asked. `checkAuth()` runs on every scene
            // activation, so an older overlapping call must not sign out the account
            // that has signed in since.
            //
            // The generation alone cannot express that. Re-confirming the *same*
            // account is deliberately not a transition (`applyAuthenticatedUser`),
            // so once a newer check has confirmed this user the generation is
            // unchanged and an older check's "no session" would still pass this
            // guard. `activeAuthCheckID` is the value that distinguishes newest
            // from superseded — the same reason it gates the overlay above — so a
            // stale answer can no longer sign the live account out.
            guard generation == authGeneration, checkID == activeAuthCheckID else { return }
            applySignedOut(cause: .signedOut, message: nil)
        } catch {
            // #665: a failed request is not a sign-out. `OfflineAuth` makes that
            // call once, in the taxonomy #676 gave the widget, so the app and the
            // widget can never disagree about what "signed out" means.
            // Same reasoning as the nil branch, including the check-ID half: a
            // transport failure belonging to a superseded call must not drag the
            // current session into offline mode or sign it out, and after a newer
            // check has re-confirmed the same account the generation no longer
            // moves to say so.
            guard generation == authGeneration, checkID == activeAuthCheckID else { return }
            let cachedUser = CachedIdentityStore.load()
            let outcome = OfflineAuth.outcome(for: error, hasCachedIdentity: cachedUser != nil)
            // Matching on the pair keeps the cached user's presence and the
            // outcome from drifting apart: without an identity to render there is
            // nothing to fall back to, whatever the outcome says.
            switch (outcome, cachedUser) {
            case let (.offline(cause), .some(user)):
                await enterOfflineMode(user: user, cause: cause)
                lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
                return
            case (.offline, .none), (.signedOut, _):
                applySignedOut(cause: outcome.cause, message: Self.authStatusMessage(for: error))
            }
        }
        lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
    }

    /// Status line for a route to sign-in. Unchanged from the pre-#665 behavior:
    /// whatever the server said, else the generic connection copy.
    private static func authStatusMessage(for error: Error) -> String? {
        (error as? APIError)?.message ?? "Connection failed. Please try again."
    }

    /// Bumped on every identity transition — adopt, offline-adopt, sign-out,
    /// logout. `@MainActor` serializes these mutations but an `await` is still a
    /// suspension point, so a request that started under one identity can land
    /// after another has taken over. Anything that applies a network result to
    /// identity-scoped state captures this before its `await` and re-checks after,
    /// rather than re-reading `currentUser` (which cannot distinguish "same user
    /// throughout" from "signed out and back in").
    private var authGeneration: Int = 0

    /// Identifies the newest in-flight `checkAuth()`. Separate from
    /// `authGeneration`: this tracks *which check is latest* (so only it may drop
    /// the loading overlay), not *which identity is live*.
    private var activeAuthCheckID: Int = 0

    /// Orders the settings mutations against each other (#697): `SettingsView`'s
    /// four toggles, `UsernameEditView`'s rename, and `enableDualTrack()`. Each
    /// launches its own unstructured task and each response carries a *whole*
    /// `UserDTO`, so without this an older PATCH landing last reinstates every
    /// field as it stood when that request left — reverting a newer setting in
    /// `currentUser` and, because #665 made the cached identity the offline source
    /// of truth, in `CachedIdentityStore` too, where it survives a cold start.
    ///
    /// Deliberately separate from `authGeneration` and `activeAuthCheckID`. The
    /// three answer different questions — "is this still the same account?", "is
    /// this still the newest auth check?", and "is this still the newest word on
    /// the user's settings?" — and the first two cannot express this one: every
    /// site here is the *same* account throughout, which is exactly the case
    /// `applyAuthenticatedUser` deliberately does not bump the generation for.
    ///
    /// Not scoped to writes. `checkAuth()` and `refreshAfterReconnect()` order their
    /// `me()` responses through this too, as `.read`s, whenever they are merely
    /// *re-confirming* the account already adopted. Both run on a scene activation,
    /// so both can overlap a save in flight, and both adopt a whole `UserDTO` into
    /// the same cached identity — an older read landing after a newer PATCH reverts
    /// the setting with the identical blast radius, which makes it this race and not
    /// a separate one. The read/write asymmetry is what makes sharing the guard safe:
    /// a read describes the account only as of the moment it left, so a save the user
    /// makes while it is in flight still wins.
    ///
    /// Adoption proper — a cold start, or any response naming a *different* account —
    /// stays on `applyAuthenticatedUser`. There is nothing to order it against, and
    /// routing it here would read as `.discarded`, which cannot distinguish "nothing
    /// adopted yet" from "that session is gone" (#665).
    private var settingsOrdering = StaleResponseGuard()

    /// Single place a server-confirmed user is adopted — in memory *and* in the
    /// local copy that survives a launch with no network (#665).
    private func applyAuthenticatedUser(_ user: UserDTO) {
        // Only an actual *transition* invalidates in-flight work. Re-confirming the
        // same account (a reconnect refresh, a settings PATCH round-trip) is not a
        // transition, and bumping for it was wrong twice over: it made every
        // post-adoption `generation == authGeneration` check unsatisfiable, and it
        // let an unrelated settings save cancel identity work that was still valid.
        // A sign-out sets `currentUser = nil` and bumps, so a sign-out/sign-in cycle
        // on the *same* account still bumps twice and stale work is still rejected.
        if currentUser?.id != user.id { authGeneration &+= 1 }
        currentUser = user
        CachedIdentityStore.save(user)
        isOfflineMode = false
    }

    /// Route to sign-in.
    ///
    /// Local state — the cached identity and the per-account tracking unlock — is
    /// torn down only for a cause authoritative enough to prove the session is
    /// over, which is the same predicate guarding the widget's stored week (#676).
    /// Before #665 every failure path ran this teardown, so a dropped connection
    /// wiped state the server never contradicted.
    private func applySignedOut(cause: WidgetDataStore.SignedOutCause, message: String?) {
        authGeneration &+= 1
        cancelIdentityScopedTasks()
        currentUser = nil
        isOfflineMode = false
        currentView = .auth
        authStatusMessage = message
        if CachedIdentityStore.clearIfAuthoritative(on: cause) {
            // #526: reset account-scoped unlock so the next sign-in re-qualifies
            // (mirrors the clearOnLogout called by didLogout).
            trackingControlPrefsManager.clearOnLogout()
            // #709: an expired token or a 401 ends the session just as finally as
            // tapping Sign out, but only `didLogout()` was clearing this — so an
            // automatic sign-out left the previous account's "During sessions"
            // choice cached device-globally for whoever signed in next, and left
            // its queued session-state reports free to drain under the new
            // account's credentials and silence *their* notifications for a full
            // TTL. Clearing here also bumps the controller's auth epoch, which is
            // what stops an in-flight preference response from writing the old
            // account's value afterwards.
            //
            // Inside the authoritative branch deliberately: `.serverError` and
            // `.unreachable` say nothing about auth, and discarding a live user's
            // preference because the network dropped is the #665 mistake.
            SessionNotificationSuppressionController.clearSuppressPreference()
        }
        syncWidgetData(signedOutCause: cause)
    }

    /// #665: run the app from what the device already knows.
    ///
    /// Mirrors the success path minus the parts that need the server to be
    /// believed. `refreshTracksDoneToday()` is still called: it fails closed on its
    /// own, and it is what pushes a fresh widget snapshot. Push registration and
    /// the buddy-invite handoff are deliberately skipped — both are doomed without
    /// a network, and consuming a pending invite here would burn the token on a
    /// request that cannot succeed. `refreshAfterReconnect()` picks both up.
    private func enterOfflineMode(user: UserDTO, cause: WidgetDataStore.SignedOutCause) async {
        // Transition-only, matching `applyAuthenticatedUser`.
        if currentUser?.id != user.id { authGeneration &+= 1 }
        currentUser = user
        isOfflineMode = true
        // `checkAuth()` runs on every scene activation, so this path is reached
        // mid-sit whenever the app is foregrounded on a bad connection. Routing to
        // the initial authenticated view there would eject the user from a session
        // in progress, so the route — and the badge reset that goes with it — is
        // preserved while one is running. Matches `refreshAfterReconnect()`, which
        // never touches the route, and the `isInSession` checks the deep-link entry
        // points already make. Going offline is still recorded either way: the
        // identity, the offline flag, and the status line below are unconditional.
        if !isInSession {
            resetTrackCompletionBadges()
            currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
        }
        // Not an error the user must act on — the offline indicator says it instead.
        authStatusMessage = nil
        // Paint from local state immediately. Nothing here may `await` a request we
        // already know is failing: `checkAuth`'s `defer` only drops the cold-start
        // overlay once this returns, so on flaky wifi (as opposed to Airplane Mode,
        // which fails instantly) a blocking call would hold the launch for a full
        // URLSession timeout — the offline launch has to be fast, not just correct.
        //
        // We are signed in, so this saves rather than clears — but the real cause is
        // passed rather than the `.signedOut` default so that if the snapshot ever
        // did come back logged-out, it could not wipe the widget's week on a failure
        // the server never confirmed (#676).
        syncWidgetData(signedOutCause: cause)
        // Local-only deep links still route; the buddy invite is network-bound.
        await consumePendingSessionDeepLinkIfNeeded()
        await consumePendingLogReasonIfNeeded()
        // Detached from the launch path: if connectivity is actually back by the
        // time this runs, the Home badges and widget history catch up on their own;
        // if not, it fails closed without having delayed anything. Retained (not
        // fire-and-forget) so sign-out can cancel it, and `refreshTracksDoneToday()`
        // re-checks `authGeneration` after its await so a late response can never
        // write another account's badges or widget snapshot.
        offlineCatchUpTask?.cancel()
        offlineCatchUpTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshTracksDoneToday()
        }
    }

    /// In-flight identity-scoped background work, cancelled the moment the session
    /// they were started for ends. The `authGeneration` re-checks are what make a
    /// late result harmless; cancelling is how we stop paying for it at all.
    private var offlineCatchUpTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var loginCatchUpTask: Task<Void, Never>?
    /// Buddy invite join/consume. One property: these are alternative routes into
    /// the same invite flow and never need to run concurrently.
    private var buddyInviteTask: Task<Void, Never>?

    private func cancelIdentityScopedTasks() {
        offlineCatchUpTask?.cancel()
        offlineCatchUpTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        loginCatchUpTask?.cancel()
        loginCatchUpTask = nil
        buddyInviteTask?.cancel()
        buddyInviteTask = nil
        // The widget history backfill is identity-scoped too. Its own key check is
        // `"userId|localDay"`, which a sign-out and sign-in on the *same* account
        // within the same day would satisfy — so a late response could land in the
        // freshly rebuilt snapshot. Clearing the key also forces a re-backfill
        // rather than leaving the row blank. `didLogout` cancelled this already;
        // `applySignedOut` did not, which is the gap this closes.
        widgetHistoryTask?.cancel()
        widgetHistoryTask = nil
        widgetHistoryRefreshKey = nil
    }

    /// #665: non-`async` entry point for the reconnect refresh so the view layer
    /// hands ownership of the task to the view model instead of spawning an
    /// unstructured one it cannot cancel.
    func refreshAfterReconnectInBackground() {
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshAfterReconnect()
        }
    }

    /// #665: reconcile with the server once connectivity returns.
    ///
    /// Deliberately narrow. It refreshes identity and today's state *in place* and
    /// never re-routes on success — re-running `checkAuth()` here would flash the
    /// cold-start overlay and send the user back to Home, which is exactly the
    /// user-visible reset offline-first exists to avoid (and would eject someone
    /// mid-sit). Only an authoritative rejection moves anyone to sign-in.
    ///
    /// The queued-sit upload is the other half and already exists (#557):
    /// `NetworkReachabilityMonitor` flushes the write queue on the same transition.
    func refreshAfterReconnect() async {
        guard currentUser != nil, currentView != .auth else { return }
        // Captured before the await: signing out (or switching accounts) while
        // `me()` is in flight must not let the response reinstate the old session.
        // Applying it would resurrect a signed-out account *and* re-save the cached
        // identity `applySignedOut` just tore down via `clearIfAuthoritative` (#676).
        let generation = authGeneration
        // Enqueued for the same reason as `checkAuth()`: this read adopts a whole
        // `UserDTO`, and a settings save whose PATCH left first would otherwise
        // supersede it wholesale (#697).
        await enqueueSettingsRead { [weak self] in
            guard let self else { return }
            await self.performReconnectRefresh(startedAtGeneration: generation)
        }.value
    }

    /// The body of `refreshAfterReconnect()`, run from the settings queue.
    ///
    /// - Parameter generation: `authGeneration` as it was when the reconnect fired.
    private func performReconnectRefresh(startedAtGeneration generation: Int) async {
        // Re-checked now that the queue turn has arrived, as in `performAuthCheck`:
        // the wait is an `await`, so the session that asked for this refresh may be
        // gone, and applying the response would resurrect it (#665).
        guard generation == authGeneration else { return }
        // Same reasoning as `checkAuth()`: this is a read of an account already
        // adopted, taken immediately before the request so it records when the read
        // left. The queue turn already makes it the newest word; the ticket is the
        // backstop (#697).
        let settingsTicket = nextSettingsRequestTicket()
        do {
            guard let user = try await APIClient.shared.me(today: SessionCalendar.localTodayIsoDate()) else {
                guard generation == authGeneration else { return }
                applySignedOut(cause: .signedOut, message: nil)
                return
            }
            guard generation == authGeneration else { return }
            // Ordered rather than adopted outright. A superseded read leaves
            // `currentUser` on the newer settings response, which already cleared
            // `isOfflineMode` on its way through `applyAuthenticatedUser`, so the
            // reconnect still ends with the app online either way and the refreshes
            // below still belong to this account. A reconnect that returns a
            // *different* account is a legitimate transition and keeps adopting
            // directly, as before — it is not this race, and the guard would read it
            // as `.discarded`.
            if currentUser?.id == user.id {
                applySettingsResponse(
                    user,
                    startedAtGeneration: generation,
                    requestTicket: settingsTicket,
                    responseKind: .read
                )
            } else {
                applyAuthenticatedUser(user)
            }
            // Re-captured after adoption, as in `checkAuth()`: if the reconnect ever
            // returns a different account, that adoption is a legitimate transition
            // and the work below belongs to the account we just adopted.
            let adopted = authGeneration
            PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
            hydrateNotificationSuppressionPreference()
            await refreshTracksDoneToday()
            // Re-checked again here: `refreshTracksDoneToday()` is itself a
            // suspension point, so the session can end between the check above and
            // this line. Consuming the invite is not idempotent — it burns the
            // token and joins a session — so it must not run for a session that has
            // since been replaced. (`consumePendingBuddyInviteIfNeeded`'s own
            // `currentUser != nil` test cannot tell a new account from the old one.)
            guard adopted == authGeneration else { return }
            await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        } catch let apiError as APIError where apiError.status == 401 {
            // The cached identity outlived the server session — the accepted cost
            // of sitting offline on a stale copy. Sign in again, now, rather than
            // having been signed out back when the network dropped. Generation-
            // guarded like the success path: a 401 for the *previous* session must
            // not sign out an account that has since signed in.
            guard generation == authGeneration else { return }
            applySignedOut(cause: .unauthorized, message: apiError.message)
        } catch {
            // Still no usable answer: stay on local state, say nothing.
        }
    }

    private func viewSlug(_ view: AppView) -> String {
        switch view {
        case .auth: return "auth"
        case .home: return "home"
        case .session: return "session"
        case .buddyHub: return "buddyHub"
        case .buddyCalendar: return "buddyCalendar"
        case .buddyCalendarWithBuddy: return "buddyCalendarWithBuddy"
        case .buddySession: return "buddySession"
        case .completion: return "completion"
        case .breathCounting: return "breathCounting"
        case .logReason: return "logReason"
        case .history: return "history"
        case .journal: return "journal"
        case .board: return "board"
        case .settings: return "settings"
        }
    }

    private static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    /// Initial tab index. Honors SP_UI_TEST_FORCE_SETTINGS_TAB (Settings = 4)
    /// and SP_UI_TEST_FORCE_PROGRESS_TAB (Progress = 1).
    private static func defaultSelectedTab() -> Int {
        let env = ProcessInfo.processInfo.environment
        if truthy(env["SP_UI_TEST_FORCE_SETTINGS_TAB"]) { return 4 }
        if truthy(env["SP_UI_TEST_FORCE_PROGRESS_TAB"]) { return 1 }
        return 0
    }

    /// Boot destination for authenticated UI-test launches. Seed knobs are
    /// mutually exclusive; the first match wins.
    private static func initialAuthenticatedView(from env: [String: String]) -> AppView {
        if truthy(env["SP_UI_TEST_FORCE_START_SESSION"]) {
            return .session(type: .standard, track: .primary)
        }
        if truthy(env["SP_UI_TEST_FORCE_BREATH_COUNTING"]) {
            return .breathCounting
        }
        if truthy(env["SP_UI_TEST_FORCE_BUDDY_HUB"]) {
            return .buddyHub
        }
        return .home
    }

    func didLogin(user: UserDTO) {
        applyAuthenticatedUser(user)
        // Re-captured after adoption, same rule as `checkAuth()`: signing in is
        // itself the transition, so the generation to defend is the one that exists
        // once this user is adopted.
        let adopted = authGeneration
        resetTrackCompletionBadges()
        currentView = .home
        // Reset to Home so a prior session's tab (e.g. Settings) doesn't leak
        // across auth transitions now that selectedTab lives on the view model.
        selectedTab = 0
        authStatusMessage = nil
        PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
        hydrateNotificationSuppressionPreference()
        // Retained and generation-guarded like the other identity-scoped catch-ups.
        // `refreshTracksDoneToday()` self-guards, but it returns silently either
        // way, so the caller cannot infer from it whether the session survived —
        // hence the explicit re-check before the widget sync and the three
        // non-idempotent consumptions.
        loginCatchUpTask?.cancel()
        loginCatchUpTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshTracksDoneToday()
            guard adopted == self.authGeneration else { return }
            self.syncWidgetData()
            await self.consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
            await self.consumePendingSessionDeepLinkIfNeeded()
            await self.consumePendingLogReasonIfNeeded()
        }
    }

    /// Fetch the server-synced suppress-during-session opt-in at an auth point so
    /// `PushNotificationCoordinator.willPresent` reflects current server truth
    /// even before the Notifications screen is opened this launch (#431).
    private func hydrateNotificationSuppressionPreference() {
        // Same class as the flagged sites, guarded pre-emptively: this reads a
        // per-account server preference and applies it to a device-global
        // controller, so a response arriving after a sign-out would push the old
        // account's setting onto whoever is signed in next (#665).
        let generation = authGeneration
        let preferenceGeneration = SessionNotificationSuppressionController.preferenceGeneration
        // This is a third independent reader of the same row, alongside the two in
        // `NotificationPreferencesViewModel`, and nothing serializes it against
        // them. Taken here rather than inside the `Task` so it records when the
        // fetch was asked for, not when the task happened to be scheduled — a
        // toggle saved in between must still win (#709).
        let ticket = SessionNotificationSuppressionController.nextPreferenceRequestTicket()
        Task { [weak self] in
            guard let self else { return }
            guard let prefs = try? await APIClient.shared.getNotificationPreferences() else { return }
            guard generation == self.authGeneration else { return }
            SessionNotificationSuppressionController.setSuppressPreferenceEnabled(
                prefs.suppressDuringSession,
                startedAtGeneration: preferenceGeneration,
                requestTicket: ticket,
                responseKind: .read
            )
        }
    }

    /// Snapshot of the live identity, taken by a caller that will apply a response
    /// later. Capture this *before* an `await`, hand it back to
    /// `applySettingsUser(_:startedAtGeneration:requestTicket:)`.
    var identityGeneration: Int { authGeneration }

    /// Serializes every settings mutation in the app against every other one (#697).
    ///
    /// Issue #697 offers two mechanisms — serialize the writes, or tag each request
    /// and reject a response older than the latest applied mutation. This is the
    /// first, and it is the one that holds: with only one write in flight at a time,
    /// each response describes the account *after* every earlier mutation committed,
    /// so responses are adopted in intent order and are complete by construction.
    /// See ``SettingsWriteQueue``.
    private let settingsWrites = SettingsWriteQueue()

    /// Runs a settings mutation once every mutation enqueued before it has finished.
    ///
    /// Call this at the moment the user acts and put the *whole* round trip inside —
    /// every `await` the mutation needs, including a permission prompt, and the
    /// `applySettingsUser` that adopts its response. Enqueuing is what records the
    /// order the user expressed their intent in; taking the ticket, prompting, or
    /// sending outside the operation would let a later intent overtake an earlier
    /// one, which is the inversion #697 exists to stop.
    /// - Returns: the operation's task, for a caller that must not finish before its
    ///   own save has. Discardable — a toggle reports progress through its own state
    ///   instead.
    @discardableResult
    func enqueueSettingsWrite(_ operation: @escaping @Sendable @MainActor () async -> Void) -> Task<Void, Never> {
        settingsWrites.enqueue(operation)
    }

    /// Runs a whole-account `me()` read on the same queue as the mutations (#697).
    ///
    /// The three reads that adopt a whole `UserDTO` — `checkAuth()`,
    /// `refreshAfterReconnect()` and `returnHome()` — are enqueued rather than left to
    /// overlap, because a ticket cannot settle a write that left *before* the read: no
    /// number says whether that write committed before or after the read's snapshot,
    /// so `StaleResponseGuard` breaks the tie in the write's favour and adopts its
    /// whole response, dropping the server-derived fields (`currentDay`, the recovery
    /// ramp, `secondTrackDay`) the read existed to refresh. Waiting for the queue
    /// removes the tie instead of deciding it.
    ///
    /// The wait is an `await` like any other, so re-check the identity generation as
    /// the operation's first statement: a queue turn can arrive under the account that
    /// replaced the one that asked.
    @discardableResult
    func enqueueSettingsRead<T: Sendable>(_ operation: @escaping @Sendable @MainActor () async -> T) -> Task<T, Never> {
        settingsWrites.enqueue(operation)
    }

    /// Ticket ranking one settings request against the `me()` reads racing it (#697,
    /// #709).
    ///
    /// Take it immediately before the request's own `await`, so it records when the
    /// request left. Ordering is `enqueueSettingsWrite`/`enqueueSettingsRead`'s job,
    /// not this one's: the queue lets only one settings request be in flight at a
    /// time, reads included, so every response is already the newest word when it
    /// lands. The ticket stays as the backstop for any future caller that reads the
    /// account without taking a place in line.
    ///
    /// A ticket whose request never returns (a permission denial that bails out
    /// before the PATCH) is simply never handed back; it leaves a gap and nothing
    /// else, since the guard only ever compares tickets for rank.
    func nextSettingsRequestTicket() -> Int {
        settingsOrdering.nextTicket()
    }

    /// Why a settings response was or was not adopted.
    ///
    /// Three-way rather than a Bool because the two rejections call for opposite
    /// UI. A *superseded* response was accepted by the server and merely lost the
    /// race to describe the account, so reverting the control the user just touched
    /// would show them their own change being undone when in fact it took. A
    /// *discarded* one belongs to a session that no longer exists, and reverting is
    /// the honest answer there.
    enum SettingsApplyOutcome {
        /// Adopted into `currentUser` and the offline cache: this is the newest
        /// word on the account.
        case applied

        /// A newer settings response has already been applied, so this one is no
        /// longer the newest word. Nothing is reverted and nothing is reported as
        /// failed — where this is a write, the server did commit it.
        ///
        /// Not reachable from any current caller: `enqueueSettingsWrite` and
        /// `enqueueSettingsRead` share one queue, so a settings request — read or
        /// write — never overlaps another and always outranks everything applied
        /// before it. Kept because it is the honest answer for a caller that reads the
        /// account without taking a place in line, and because the two rejections
        /// still call for opposite UI if one ever appears.
        case superseded

        /// The response belongs to a session that is gone — signed out, or another
        /// account signed in. None of it is safe to apply.
        case discarded
    }

    /// - Parameter generation: `identityGeneration` as it was when the request
    ///   started. Required rather than defaulted so a new call site cannot forget
    ///   it and silently reintroduce the cross-session write (#665).
    /// - Parameter ticket: `nextSettingsRequestTicket()` as taken when the request
    ///   started. Also required, and for the same reason (#697).
    /// - Returns: see ``SettingsApplyOutcome``. Callers that show success UI or
    ///   revert a control must branch on this — a silently dropped response would
    ///   otherwise be reported to the user as a saved change.
    @discardableResult
    func applySettingsUser(
        _ user: UserDTO,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int
    ) -> SettingsApplyOutcome {
        // `.write`: a PATCH response is server truth as of a commit, so it outranks
        // every `me()` read still outstanding beside it.
        //
        // No repair follows it, because `enqueueSettingsWrite` leaves nothing to
        // repair. The two ways a response could contradict a committed save both
        // required a second write in flight — one whose response is the only carrier
        // of its field (so dropping it stales `currentUser` and the cache #665 reads
        // on the next offline launch), or one serialized before this save committed
        // and adopted after it (so it carries the pre-save value). Serializing the
        // writes makes both unreachable: this request left only after every earlier
        // mutation had committed *and* been adopted, so its `UserDTO` carries all of
        // them and nothing older can follow it.
        return applySettingsResponse(
            user,
            startedAtGeneration: generation,
            requestTicket: ticket,
            responseKind: .write
        )
    }

    /// Shared body of the settings-apply path. Split out so the `me()` reads that
    /// race a save can reuse the identity guards while entering the ordering as a
    /// `.read`.
    @discardableResult
    private func applySettingsResponse(
        _ user: UserDTO,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int,
        responseKind kind: StaleResponseGuard.ResponseKind
    ) -> SettingsApplyOutcome {
        // The id check below cannot tell "same account throughout" from "signed out
        // and signed back in as the same account" — and in the second case a
        // response from the previous session would overwrite newer local fields,
        // clear offline mode, and persist stale data to the cache. That is the case
        // this generation check exists for (#665).
        guard generation == authGeneration else { return .discarded }
        guard currentView != .auth, let existing = currentUser, existing.id == user.id else { return .discarded }
        // Same account throughout, so the question left is which response is the
        // newest word. Checked after the identity guards, not before: a response
        // from a session that is gone must not consume a ticket on the live
        // account's behalf and bar its genuine saves.
        guard settingsOrdering.shouldApply(ticket: ticket, from: kind) else { return .superseded }
        // Server-confirmed (a settings PATCH round-tripped), so the local copy is
        // refreshed too — otherwise a rename or track opt-in would vanish on the
        // next offline launch (#665).
        applyAuthenticatedUser(user)
        return .applied
    }

    func didLogout() {
        // Invalidate in-flight identity-scoped work synchronously, before the
        // `clearQueue()` await below — the moment sign-out is known is the moment a
        // response for the old session stops being allowed to write anything (#665).
        authGeneration &+= 1
        // Cancels the widget history backfill and clears its key too.
        cancelIdentityScopedTasks()
        // Captured before the teardown clears it. The queue cleanup below is scoped
        // to this account *and* to this moment: once `currentUser` is nil there is
        // nothing left to scope it by, and signing back in as the same account would
        // otherwise let the deferred delete take the new session's sits with it.
        let signedOutUserId = currentUser?.id
        let logoutBoundary = Date()
        // The teardown is synchronous for the same reason. Deferring it until after
        // the `clearQueue()` await left `currentUser` set across a suspension point,
        // so a `checkAuth()` starting inside that window (scene activation) could
        // re-adopt the account and route back into the authenticated UI — and the
        // deferred teardown would then wipe *that* session's state. A generation
        // guard inside the task would not have closed it: re-adopting the same
        // account is deliberately not a transition, so the generation would not have
        // moved. Signing out is local truth and needs nothing from the queue flush,
        // so it lands now and the flush follows on its own.
        currentUser = nil
        isOfflineMode = false
        // #665: a real sign-out is the one thing that must take the local copy
        // of identity with it. `APIClient.logout()` also clears it (in a
        // `defer`, so an offline sign-out still does), but didLogout is reachable
        // on its own — belt and braces rather than a single fragile path.
        CachedIdentityStore.clear()
        pendingBuddyInviteToken = nil
        pendingSessionDeepLink = nil
        pendingLogReasonDate = nil
        buddyInviteError = nil
        authStatusMessage = nil
        // #703: the not-stored warning is about one account's sit. Left set, the
        // next user to go offline on this device sees a red strip for a failure
        // that was never theirs. Mirrored by `clearAccountScopedLocalState` on web.
        localSaveFailed = false
        resetTrackCompletionBadges()
        LastAuthProvider.resetPersisted()
        currentView = .auth
        SessionNotificationSuppressionController.clearSuppressPreference()
        // #526: reset account-scoped tracking unlock so the next sign-in re-qualifies.
        trackingControlPrefsManager.clearOnLogout()
        syncWidgetData()
        if let signedOutUserId {
            Task { @MainActor in
                try? await SessionSyncCoordinator.shared.clearQueue(
                    ownerUserId: signedOutUserId,
                    enqueuedBefore: logoutBoundary
                )
            }
        }
    }

    private func resetTrackCompletionBadges() {
        primaryDoneToday = false
        secondDoneToday = false
        practiceDoneToday = false
        secondPracticeDoneToday = false
        primaryStandardDoneToday = false
        doneTodayFlagsStamp = nil
    }

    /// Retire the "done today" flags when the local day has advanced past the one
    /// they describe, and re-stamp them onto the current day.
    ///
    /// The flags used to be cleared in exactly one place: the top of
    /// `refreshTracksDoneToday()`, which is a network round-trip. The path that
    /// actually crosses midnight with them raised is the one deliberately built to
    /// need no network — `markPracticeDoneToday` -> `syncWidgetData()`, called the
    /// instant a sit ends. A quick sit at 00:05, or a second-track sit, therefore
    /// reached the snapshot with yesterday's primary-standard flag still true and
    /// let it fold today into the standard-only set that extends `serverStreak`:
    /// the exact inflation #679 exists to remove.
    ///
    /// Called before the flags are written and before they are read, so no caller
    /// has to remember the rollover. The server-derived Home badges are rolled
    /// over with the rest for the same reason and on the same fail-closed logic
    /// the refresh failure path already uses: on a new day nothing has been sat
    /// yet, and the next successful refresh restores the truth.
    private func rollOverDoneTodayFlagsIfNeeded(now: Date = Date()) {
        if let stamp = doneTodayFlagsStamp, WidgetDataStore.isSameLocalDay(stamp, now) {
            return
        }
        // A nil stamp means nothing has been claimed yet this process; the flags
        // are already false, so this just establishes the day.
        if doneTodayFlagsStamp != nil {
            primaryDoneToday = false
            secondDoneToday = false
            practiceDoneToday = false
            secondPracticeDoneToday = false
            primaryStandardDoneToday = false
        }
        doneTodayFlagsStamp = now
    }

    func beginSession(type: SessionType = .standard, track: Track = .primary) {
        currentView = .session(type: type, track: track)
    }

    /// #240: opt into the dual-track fork, then refresh local user + badges.
    func enableDualTrack() async {
        // Serialized with every other settings mutation (#697). This is a user
        // mutation returning the same whole `UserDTO` as the Settings toggles and the
        // rename, and it races them identically — left outside the queue, a slow
        // opt-in landing last would revert a newer rename in precisely the way the
        // toggles no longer can. It is also the only settings write reachable from
        // outside the Settings screen, so it is exactly the overlap that screen's own
        // `isSavingSettings` gate cannot cover.
        //
        // Awaited rather than fired and forgotten so the caller's `Task` still
        // represents the whole opt-in.
        //
        // The generation is captured *here*, synchronously with the tap, and not
        // inside the operation: waiting for a turn is an await like any other, so a
        // read taken after it would bind this opt-in to whatever account is live when
        // the queue finally reaches it rather than the one the user tapped on. A tap
        // that sat behind a slow Settings save while the session changed would then
        // enable the fork on — and persist the `UserDTO` of — the account that
        // replaced them (#665). Same capture-then-recheck shape as every Settings
        // write.
        let identityAtStart = authGeneration
        await settingsWrites.enqueue { [weak self] in
            guard let self else { return }
            await self.performEnableDualTrack(startedAtGeneration: identityAtStart)
        }.value
    }

    private func performEnableDualTrack(startedAtGeneration generation: Int) async {
        // Re-checked now that the wait is over and before the request is issued:
        // sending this would otherwise apply the previous user's intent to the
        // account that replaced them.
        guard generation == authGeneration else { return }
        // Taken immediately before the request, so it records when this left and
        // outranks the `me()` reads racing it (#697).
        let ticket = nextSettingsRequestTicket()
        do {
            let updated = try await APIClient.shared.enableDualTrack()
            let outcome = applySettingsUser(
                updated,
                startedAtGeneration: generation,
                requestTicket: ticket
            )
            // `.discarded` means there is no session left to refresh badges for. The
            // opt-in is otherwise adopted — nothing else can be in flight to
            // supersede it — so `currentUser.dualTrackEnabled` is on before the
            // refresh below, and Home's per-track cards, which render only inside
            // that branch, have something to draw into. Ordered before the refresh so
            // the badges it writes and the widget snapshot it persists both see the
            // fork as on.
            guard outcome != .discarded else { return }
            await refreshTracksDoneToday()
        } catch {
            print("Failed to enable dual track: \(error)")
        }
    }

    /// #240: derive per-track "completed a standard sit today" from a lightweight
    /// server-side filtered query.
    func refreshTracksDoneToday() async {
        guard currentUser != nil else { return }
        // Captured before the request: the `currentUser` check above only holds at
        // entry, and everything below the await writes identity-scoped state
        // (Home badges, the widget snapshot, the week history). Re-checked after,
        // so a response that outlived its session cannot repaint badges or persist
        // a widget snapshot for an account that has signed out or been switched.
        let generation = authGeneration
        let now = Date()
        // Two rollovers, because they cover different evidence. The stamp-based
        // one below knows what *this process* claimed and when; the snapshot-based
        // one here also catches a relaunch that inherited a stored snapshot from a
        // previous day. Both are cheap and idempotent.
        rollOverDoneTodayFlagsIfNeeded(now: now)
        let prior = WidgetDataStore.load()
        if let prior, prior.isLoggedIn, !WidgetDataStore.isSameLocalDay(prior.lastUpdated, now) {
            practiceDoneToday = false
            secondPracticeDoneToday = false
            // #679: same rollover as its siblings — yesterday's standard sit must
            // not fold today into the standard-only set.
            primaryStandardDoneToday = false
        }
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.calendar = Calendar(identifier: .gregorian)
        let today = dateFormatter.string(from: Date())
        do {
            let tracksDoneToday = try await APIClient.shared.getTracksDoneToday(date: today)
            guard generation == authGeneration else { return }
            primaryDoneToday = tracksDoneToday.primary
            secondDoneToday = tracksDoneToday.second
            if primaryDoneToday {
                practiceDoneToday = true
                // #679: the server confirming a primary standard sit today is the
                // same fact the local flag records, so raise it here too. Like its
                // siblings this only ever goes up — the failure path below clears
                // the server badges, never the local flags.
                primaryStandardDoneToday = true
            }
            if secondDoneToday {
                secondPracticeDoneToday = true
            }
        } catch {
            // Non-fatal: fail closed so stale "done today" badges do not leak.
            // Only the server-derived Home badges are cleared. The widget
            // practice flags are local truth — a sit finished on this device,
            // possibly offline and still queued for sync — and a failed status
            // request is not the server contradicting them, just an absent
            // answer. Clearing them here (and persisting that at the
            // `syncWidgetData()` below) dropped a mark the user had already
            // earned, and could break the day's streak until sync succeeded.
            // Note the success path above only ever raises these flags, never
            // lowers them; the failure path must not be the one exception.
            // Midnight rollover is already handled at the top of this method.
            guard generation == authGeneration else { return }
            // Failing closed is right at rest, but not mid-sit. `enterOfflineMode`
            // deliberately keeps the badges when a session is running, and it
            // schedules this catch-up moments later against the same dead network
            // — so clearing here would undo that preservation for the very sit it
            // was meant to protect. Outside a session the reset stands, and the
            // next successful refresh restores the truth either way.
            if !isInSession {
                primaryDoneToday = false
                secondDoneToday = false
            }
        }
        // Both branches above return early on a generation change, so reaching
        // here means the session that started this request is still the live one.
        syncWidgetData()
        refreshWidgetWeekHistory()
    }

    func beginBreathCounting() {
        currentView = .breathCounting
    }

    /// Save a completed breath session and return to home.
    ///
    /// Local-first via the offline write queue (#557); non-fatal API failures no longer drop data.
    func completeBreathSession(elapsedSeconds: Int, breathCount: Int) async {
        guard elapsedSeconds > 0 || breathCount > 0 else {
            currentView = .home
            return
        }
        guard !isSavingBreathSession else { return }
        guard let ownerUserId = currentUser?.id else { return }
        applyAppGateAfterSessionCompletion(unlock: true)
        // #526: breath sessions always complete naturally; unlock if duration qualifies.
        trackingControlPrefsManager.markTrackingUnlockIfQualifying(completed: true, duration: max(elapsedSeconds, 1))
        isSavingBreathSession = true
        defer { isSavingBreathSession = false }

        let clientSessionId = UUID()
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.calendar = Calendar(identifier: .gregorian)

        let request = CreateSessionRequest(
            dayNumber: currentDay,
            sessionType: .breath,
            duration: max(elapsedSeconds, 1),
            bonusSeconds: 0,
            completed: true,
            actualTime: elapsedSeconds,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: dateFormatter.string(from: Date()),
            breathCount: breathCount,
            clientSessionId: clientSessionId
        )

        do {
            _ = try await SessionSyncCoordinator.shared.saveCompletedSession(
                request: request,
                clientSessionId: clientSessionId,
                ownerUserId: ownerUserId,
                thoughts: []
            )
            markPracticeDoneToday(sessionType: .breath, track: .primary)
            localSaveFailed = false
            currentView = .home
        } catch {
            print("Failed to persist breath session locally: \(error)")
            // #703: a breath sit has no completion screen to say this on, so the
            // offline indicator is the only place the loss can surface.
            localSaveFailed = true
            currentView = .home
        }
    }

    func beginBuddySession() {
        buddyInviteError = nil
        currentView = .buddyHub
    }

    func openBuddyCalendar() {
        currentView = .buddyCalendar
    }

    func openBuddyCalendarForBuddy(buddyId: String, username: String) {
        currentView = .buddyCalendarWithBuddy(buddyId: buddyId, buddyUsername: username)
    }

    func closeBuddyCalendar() {
        currentView = .buddyHub
    }

    func enterBuddySession(sessionId: String) {
        buddyInviteError = nil
        currentView = .buddySession(sessionId: sessionId)
    }

    func leaveBuddySession() {
        currentView = .home
        // Retained and guarded like the other identity-scoped work: the task body
        // runs on a later main-actor turn, and consuming an invite is not
        // idempotent, so a sign-out in between must not let it burn the token
        // against whoever is signed in next (#665).
        let adopted = authGeneration
        buddyInviteTask?.cancel()
        buddyInviteTask = Task { [weak self] in
            guard let self else { return }
            guard adopted == self.authGeneration else { return }
            await self.consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        }
    }

    func handleIncomingURL(_ url: URL) {
        if let sessionType = SessionDeepLinkParser.sessionType(from: url) {
            openSessionDeepLink(sessionType)
            return
        }
        if handleNotificationDeepLink(url) {
            return
        }
        guard let token = extractBuddyToken(from: url) else { return }
        if currentUser == nil {
            pendingBuddyInviteToken = token
            return
        }
        if isInSession {
            // Queue invite while preserving in-progress local session state.
            pendingBuddyInviteToken = token
            return
        }
        // Same reasoning as `leaveBuddySession()`: joining is a non-idempotent
        // network action, so it must not run for a session that replaced this one.
        let adopted = authGeneration
        buddyInviteTask?.cancel()
        buddyInviteTask = Task { [weak self] in
            guard let self else { return }
            guard adopted == self.authGeneration else { return }
            await self.joinBuddySession(token: token, startedAtGeneration: adopted)
        }
    }

    func handlePushDeepLink(_ url: URL) {
        handleIncomingURL(url)
    }

    private func openSessionDeepLink(_ sessionType: SessionType) {
        if currentUser == nil {
            pendingSessionDeepLink = sessionType
            return
        }
        if isInSession { return }
        beginSession(type: sessionType)
    }

    private func consumePendingSessionDeepLinkIfNeeded() async {
        guard currentUser != nil, let sessionType = pendingSessionDeepLink else { return }
        guard !isInSession else { return }
        pendingSessionDeepLink = nil
        beginSession(type: sessionType)
    }

    func openLogReason(date: String) {
        if currentUser == nil {
            pendingLogReasonDate = date
            return
        }
        if isInSession { return }
        currentView = .logReason(date: date)
    }

    private func consumePendingLogReasonIfNeeded() async {
        guard currentUser != nil, let date = pendingLogReasonDate else { return }
        guard !isInSession else { return }
        pendingLogReasonDate = nil
        currentView = .logReason(date: date)
    }

    /// Shared app-gate side effect for any local session completion path (#590).
    /// Keeps standard/quick (`completeSession`), breath (`completeBreathSession`), and
    /// future completion handlers (#589 widget sync, etc.) aligned on one call site.
    private func applyAppGateAfterSessionCompletion(unlock: Bool) {
        if unlock {
            appBlockingManager.unlockAfterCompletedSession()
        } else {
            appBlockingManager.prepareForSession()
        }
    }

    func completeSession(
        sessionId: String,
        clientSessionId: UUID,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        sessionType: SessionType = .standard,
        track: Track,
        duration: Int,
        bonusSeconds: Int = 0,
        unlockAppGate: Bool,
        attentionLog: [AttentionEntry]? = nil,
        attentionElapsed: Double? = nil,
        ambientSoundSummary: AmbientSoundSummary? = nil
    ) {
        // #684: every counted sit now earns widget credit on its own track — a
        // second-track standard sit checks the Track Two row instead of being
        // dropped, so partial two-a-day days are visible immediately.
        // Gated on `unlockAppGate` (== the sit ran to its planned end):
        // `endEarly()` leaves `completedNaturally` false while still setting
        // `isComplete`, so it reaches this call site too. Crediting there would
        // check a weekday row — and extend the streak — for a sit the user cut
        // short.
        if unlockAppGate {
            markPracticeDoneToday(sessionType: sessionType, track: track)
        }
        applyAppGateAfterSessionCompletion(unlock: unlockAppGate)
        // #526: unlock hold-cluster controls if this sit qualifies (completed + ≥ 300 s planned).
        trackingControlPrefsManager.markTrackingUnlockIfQualifying(completed: unlockAppGate, duration: duration)
        currentView = .completion(
            sessionId: sessionId,
            clientSessionId: clientSessionId,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            thoughts: thoughts,
            dayNumber: dayNumber,
            sessionType: sessionType,
            track: track,
            sessionCompleted: unlockAppGate,
            duration: duration,
            bonusSeconds: bonusSeconds,
            attentionLog: attentionLog,
            attentionElapsed: attentionElapsed,
            ambientSoundSummary: ambientSoundSummary
        )
    }

    func returnHome() async {
        currentView = .home
        selectedTab = 0
        // Same hazard as `refreshAfterReconnect` (#665): the queue flush and the
        // `me()` request below are both suspension points, so a sign-out or account
        // switch can land mid-flight and a late response would otherwise restore the
        // previous `currentUser` and re-save its cached identity after the session
        // was invalidated.
        let generation = authGeneration
        if let ownerUserId = currentUser?.id {
            do {
                _ = try await SessionSyncCoordinator.shared.flushPending(ownerUserId: ownerUserId)
                // The flush is a suspension point; don't follow it with a prune for
                // a session that has since been replaced. Both calls are explicitly
                // scoped to the `ownerUserId` captured before the await, so neither
                // can touch another account's rows — this only stops us doing more
                // work on behalf of a session that is over.
                guard generation == authGeneration else { return }
                try await SessionSyncCoordinator.shared.pruneCompletedEntries(ownerUserId: ownerUserId)
            } catch {
                print("Failed to flush offline session queue: \(error)")
            }
        }
        // Enqueued rather than issued straight away. `currentView` is set to `.home`
        // on this function's first line, so the user is interactive on Home for the
        // whole flush above and "Add second track" can start a settings write from
        // there. A ticket cannot settle that: the opt-in's PATCH left *first*, and an
        // accepted `.write` sets `applied = issued` (`StaleResponseGuard`), so its
        // response supersedes this read whichever of the two took the lower number.
        // If that PATCH left before the sit committed, adopting it wholesale drops the
        // post-sit `currentDay` and recovery ramp this `me()` exists to fetch, and
        // `applyAuthenticatedUser` re-saves the stale snapshot to the cache #665 reads
        // on the next offline launch. Taking a place in line removes the ambiguity
        // instead of deciding it: no settings write is outstanding when this read
        // leaves, so its response is the newest word by construction.
        let read: Task<Int?, Never> = enqueueSettingsRead { [weak self] in
            guard let self else { return nil }
            return await self.refreshUserAfterSit(startedAtGeneration: generation)
        }
        // `nil` means the session that finished the sit is gone, so none of the
        // identity-scoped work below belongs to this call any more.
        guard let adopted = await read.value else { return }
        await refreshTracksDoneToday()
        // As in `refreshAfterReconnect`: re-checked because the refresh above is a
        // suspension point, and consuming the invite burns a token against whatever
        // session is live when it runs.
        guard adopted == authGeneration else { return }
        await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        await consumePendingLogReasonIfNeeded()
    }

    /// The post-sit `me()` read, run from the settings queue.
    ///
    /// - Parameter generation: `authGeneration` as it was when the sit ended.
    /// - Returns: the generation the rest of `returnHome()` belongs to — the entry
    ///   capture when the read did not land, or the live one after an adoption, so an
    ///   expected adoption is never mistaken for the session being replaced — or `nil`
    ///   when that session is gone and there is nothing left to finish.
    private func refreshUserAfterSit(startedAtGeneration generation: Int) async -> Int? {
        // Re-checked now that the queue turn has arrived: waiting for a place in line
        // is an `await` like any other, so a sign-out or account switch may have landed
        // while a save ahead of us was still resolving (#665).
        guard generation == authGeneration else { return nil }
        // Taken immediately before the request, as at every other settings site, so it
        // records when this read left. The queue turn is what makes the response the
        // newest word; the ticket is the backstop (#697).
        let settingsTicket = nextSettingsRequestTicket()
        guard let user = try? await APIClient.shared.me(today: SessionCalendar.localTodayIsoDate()) else {
            // A read that never landed is not a reason to skip the badge refresh and
            // the deep-link consumptions, and never was.
            return generation
        }
        guard generation == authGeneration else { return nil }
        // Finishing a sit re-confirms the account already on screen, so it enters the
        // same ordering as the auth-path reads (#697). Adoption proper — a response
        // naming a *different* account — keeps going through `applyAuthenticatedUser`:
        // there is nothing to order it against and the guard would read it as
        // `.discarded`.
        if currentUser?.id == user.id {
            applySettingsResponse(
                user,
                startedAtGeneration: generation,
                requestTicket: settingsTicket,
                responseKind: .read
            )
        } else {
            applyAuthenticatedUser(user)
        }
        return authGeneration
    }

    /// - Parameter generation: `authGeneration` as it was when the caller decided
    ///   to consume the invite, threaded through to the join so the network result
    ///   is checked against the identity that asked for it.
    private func consumePendingBuddyInviteIfNeeded(startedAtGeneration generation: Int) async {
        guard currentUser != nil, let token = pendingBuddyInviteToken else { return }
        pendingBuddyInviteToken = nil
        await joinBuddySession(token: token, startedAtGeneration: generation)
    }

    /// - Parameter generation: `authGeneration` at the point the join was decided.
    ///   Required rather than defaulted, matching `applySettingsUser`, so a new
    ///   call site cannot forget it and silently reintroduce the stale-write bug.
    private func joinBuddySession(token: String, startedAtGeneration generation: Int) async {
        do {
            let sessionId = try await APIClient.shared.joinBuddySession(token: token)
            // The request is a suspension point like every other identity-scoped
            // network call here. The pre-task guards only decided whether to
            // *start* the join; a sign-out or account switch landing while it was
            // in flight must not route the replacement account into this session
            // (#665).
            guard generation == authGeneration else { return }
            buddyInviteError = nil
            currentView = .buddySession(sessionId: sessionId)
        } catch {
            // The failure path needs the same guard — including for the
            // cancellation error that a sign-out's own `cancelIdentityScopedTasks`
            // produces. Cancellation is cooperative and does not by itself stop the
            // post-await mutation, so without this the previous session's failure
            // would surface as an invite error on whoever is signed in next.
            guard generation == authGeneration else { return }
            if let apiError = error as? APIError {
                buddyInviteError = apiError.message
            } else {
                buddyInviteError = "Could not open buddy invite."
            }
        }
    }

    func openHomeFromNotification() {
        guard currentUser != nil else { return }
        if isInSession {
            return
        }
        currentView = .home
    }

    private func handleNotificationDeepLink(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "stillpoint" else { return false }
        let host = (url.host ?? "").lowercased()
        if host == "home" {
            openHomeFromNotification()
            return true
        }
        if host == "friends" {
            // Friends management UI is web-only today; land on home until an iOS friends tab ships.
            openHomeFromNotification()
            return true
        }
        if host == "log-reason" {
            let date = LogReasonDeepLinkParser.date(from: url)
            openLogReason(date: date)
            return true
        }
        return false
    }

    private func extractBuddyToken(from url: URL) -> String? {
        BuddyInviteTokenParser.token(from: url)
    }

    /// Persist a widget snapshot to the App Group container and reload timelines.
    /// Called from auth + session-completion flows; no extra API calls.
    ///
    /// `signedOutCause` distinguishes a real sign-out (wipe the shared blob) from
    /// merely failing to reach the server at cold start — see #671 and
    /// `WidgetDataStore.shouldClearStoredSnapshot(on:)`.
    private func syncWidgetData(signedOutCause: WidgetDataStore.SignedOutCause = .signedOut) {
        // Read site for all five flags, and the one every write path funnels
        // through — including the network-free `markPracticeDoneToday` that can
        // reach here first on a sit just after local midnight.
        rollOverDoneTodayFlagsIfNeeded()
        let snapshot = WidgetDataStore.makeSnapshot(
            user: currentUser,
            primaryDoneToday: primaryDoneToday,
            // #684: the widget's Track Two row is driven by the practice flag, not
            // the server-derived Home badge, so a just-finished sit checks today
            // immediately on the fast (network-free) path.
            secondDoneToday: secondPracticeDoneToday,
            practiceDoneToday: practiceDoneToday,
            // #679: the Track One analogue of the line above — a standard sit that
            // just finished is known here before the Home badge learns of it, and
            // the standard-only set must see it now or the streak lags a round-trip.
            primaryStandardDoneToday: primaryStandardDoneToday,
            // Belt to the rollover's braces: the flags were just retired if the day
            // had turned, and this tells `makeSnapshot` the day they describe so it
            // refuses the same-day folds itself rather than trusting the caller.
            flagsAsOf: doneTodayFlagsStamp
        )
        if snapshot.isLoggedIn {
            WidgetDataStore.save(snapshot)
        } else if WidgetDataStore.shouldClearStoredSnapshot(on: signedOutCause) {
            WidgetDataStore.clear()
            // #671: the next sign-in must re-backfill the week. Without this the
            // once-per-account-per-day throttle below would suppress the fetch for
            // the rest of the day, leaving the row blank on a sign-out/sign-in.
            widgetHistoryRefreshKey = nil
        }
        WidgetTimelineReloader.reloadHabitWidget()
    }

    /// In-flight widget history backfill, cancelled before a new one starts so a
    /// slow earlier fetch can't overwrite a newer snapshot out of order.
    private var widgetHistoryTask: Task<Void, Never>?
    /// `"userId|localDay"` of the last successful backfill; throttles the fetch to
    /// once per account per local day (past days don't change intra-day, and
    /// today's completion is handled synchronously by `syncWidgetData()`).
    private var widgetHistoryRefreshKey: String?

    /// #84 follow-up: backfill the widget's 7-day completion row from real
    /// session history so the weekday checkmarks reflect actual practice (not
    /// just days seen since install). Runs as a cancellable task off the auth/home
    /// path so it never blocks cold-start; a fetch failure keeps the
    /// locally-accumulated week that `syncWidgetData()` already wrote.
    private func refreshWidgetWeekHistory() {
        guard ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] != "1",
              let user = currentUser else { return }
        // Throttle: `/api/sessions` returns the full history, so skip the re-fetch
        // when we've already backfilled for this account today. `syncWidgetData`
        // resets the key whenever it clears the stored snapshot (#671), so a
        // sign-out/sign-in always re-backfills rather than showing a blank row.
        let refreshKey = "\(user.id)|\(WidgetDataStore.localDayString(Date()))"
        guard widgetHistoryRefreshKey != refreshKey else { return }
        widgetHistoryRefreshKey = refreshKey

        widgetHistoryTask?.cancel()
        widgetHistoryTask = Task {
            // #678: the generation of the stored snapshot as it is *before* this
            // task suspends. Every `WidgetDataStore` write advances it, so if a
            // sit finishes — or `refreshTracksDoneToday()` learns from the server
            // that today is already done — while `getSessions()` is in flight,
            // the save below sees the move and merges onto that fresher snapshot
            // instead of overwriting it with this pre-await view. Read here
            // rather than outside the task so nothing can slip between the read
            // and the `await`.
            let baselineGeneration = WidgetDataStore.currentWriteGeneration()
            guard let result = try? await APIClient.shared.getSessions() else {
                // Allow a later attempt to retry this account+day.
                if widgetHistoryRefreshKey == refreshKey { widgetHistoryRefreshKey = nil }
                return
            }
            // Drop if superseded, or the account changed during the await.
            guard !Task.isCancelled,
                  let current = currentUser, current.id == user.id else { return }
            let now = Date()
            // #684: one completed-date set per track, so each weekday row is
            // backfilled from that track's own sits.
            let completed = WidgetDataStore.recentCompletedPracticeDates(from: result.sessions, now: now)
            // Derive today's completion from the fetched sessions (consistent with
            // `now`) rather than the in-memory flags, which could be stale past midnight.
            let today = WidgetDataStore.localDayString(now)
            let doneToday = completed.primary.contains(today)
            let secondDone = completed.second.contains(today)
            // #671: keep the server-computed streak (the same number the app and
            // web history show) instead of discarding it — it's the only source
            // that knows about days older than the widget's trailing-7 row. It is
            // anchored onto a day, so it can only ever extend a run both rows
            // already corroborate (#684 day-credit rule: either track keeps a day).
            let snapshot = WidgetDataStore.makeSnapshot(
                user: current,
                primaryDoneToday: primaryDoneToday,
                secondDoneToday: secondDone,
                practiceDoneToday: doneToday,
                now: now,
                // Deliberately no `flagsAsOf` here. The two flags above are derived
                // from `result.sessions` against this same `now`, so they are fresh
                // by construction — stamping the set would retire freshly-computed
                // truth if this fetch happened to span midnight. This path also
                // supplies the authoritative sets below, so none of the same-day
                // folds `flagsAsOf` guards are reachable from here.
                completedPracticeDates: completed.primary,
                secondCompletedPracticeDates: completed.second,
                // #679: the days that actually produced `result.stats.streak` —
                // completed standard sits on either track, the same policy web's
                // `calculateSessionStats` applies. Persisted so a later day may
                // extend that total only when the server would have counted it;
                // the rows above also count quick and breath sits, so extending
                // by them pushed the widget past the app and web.
                completedStandardDates: WidgetDataStore.recentCompletedStandardDates(
                    from: result.sessions,
                    now: now
                ),
                serverStreak: result.stats.streak,
                serverStreakDate: WidgetDataStore.serverStreakAnchorDate(from: result.sessions)
            )
            // Newest-wins (#678): merges rather than clobbers when the stored
            // snapshot moved during the fetch, and declines to write at all if
            // the container was cleared by a sign-out in the meantime.
            WidgetDataStore.save(snapshot, ifWriteGeneration: baselineGeneration, now: now)
            WidgetTimelineReloader.reloadHabitWidget()
            // #526: backfill tracking-controls unlock from history so existing users
            // who have a qualifying sit start in the unlocked state (mirrors web's
            // syncTrackingUnlockFromSessions).
            trackingControlPrefsManager.syncTrackingUnlockFromSessions(result.sessions)
        }
    }

    /// Mark today as done on the completed sit's own track and push an immediate
    /// widget snapshot, so that session's weekday row checks today right away
    /// rather than waiting for the other session (#684).
    /// Shared touchpoint with #590 completion-handler work — rebase carefully.
    private func markPracticeDoneToday(sessionType: SessionType, track: Track) {
        // BEFORE the writes below, never after. This sit belongs to the current
        // local day; any flag still standing from yesterday does not. Rolling over
        // first retires those and re-stamps onto today, so the flag raised just
        // below survives the identical (now no-op) rollover inside
        // `syncWidgetData()`. Doing it afterwards would clear the very sit that
        // just finished.
        rollOverDoneTodayFlagsIfNeeded()
        switch sessionType {
        case .quick, .breath:
            // Quick and breath sits are Track One practice whichever track the
            // user launched them from — they have no second-track counterpart.
            practiceDoneToday = true
        case .standard:
            if track == .second {
                secondPracticeDoneToday = true
            } else {
                practiceDoneToday = true
                // #679: and record it as a *standard* sit. `practiceDoneToday` alone
                // cannot say so — quick and breath sits raise it too — and the
                // standard-only day set that extends `serverStreak` may only take
                // days the server would have counted. Without this the flame stood
                // still until `getTracksDoneToday` caught up.
                primaryStandardDoneToday = true
            }
        }
        // The Home badges (`primaryDoneToday` / `secondDoneToday`) stay
        // server-derived — this flag is the widget's own fast, network-free
        // path, and the two are refreshed from different sources.
        //
        // Drop any in-flight `refreshWidgetWeekHistory()` fetch first (same
        // pattern as `didLogout()`): a `getSessions()` call that started before
        // this sit finished returns without it, so there is no point paying for
        // the rest of it. Clearing the throttle key lets the next
        // `refreshTracksDoneToday()` re-fetch and backfill from history once
        // `returnHome()` has flushed the sit to the server.
        //
        // Not the guard against that fetch un-checking the row, though — it only
        // covers writers that know to cancel, and `refreshTracksDoneToday()`
        // raises `practiceDoneToday` from the server response and syncs without
        // one. The store-level write generation is what actually makes a late
        // backfill merge instead of overwrite (#678).
        widgetHistoryTask?.cancel()
        widgetHistoryRefreshKey = nil
        syncWidgetData()
    }
}
