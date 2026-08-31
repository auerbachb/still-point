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
                applyAuthenticatedUser(user)
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
        do {
            guard let user = try await APIClient.shared.me(today: SessionCalendar.localTodayIsoDate()) else {
                guard generation == authGeneration else { return }
                applySignedOut(cause: .signedOut, message: nil)
                return
            }
            guard generation == authGeneration else { return }
            applyAuthenticatedUser(user)
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
        Task { [weak self] in
            guard let self else { return }
            guard let prefs = try? await APIClient.shared.getNotificationPreferences() else { return }
            guard generation == self.authGeneration else { return }
            SessionNotificationSuppressionController.setSuppressPreferenceEnabled(prefs.suppressDuringSession)
        }
    }

    /// Snapshot of the live identity, taken by a caller that will apply a response
    /// later. Capture this *before* an `await`, hand it back to
    /// `applySettingsUser(_:startedAtGeneration:)`.
    var identityGeneration: Int { authGeneration }

    /// - Parameter generation: `identityGeneration` as it was when the request
    ///   started. Required rather than defaulted so a new call site cannot forget
    ///   it and silently reintroduce the stale-write bug.
    /// - Returns: whether the response was adopted. Callers that show success UI
    ///   must branch on this — a silently discarded response would otherwise be
    ///   reported to the user as a saved change.
    @discardableResult
    func applySettingsUser(_ user: UserDTO, startedAtGeneration generation: Int) -> Bool {
        // The id check below cannot tell "same account throughout" from "signed out
        // and signed back in as the same account" — and in the second case a
        // response from the previous session would overwrite newer local fields,
        // clear offline mode, and persist stale data to the cache. That is the case
        // this generation check exists for (#665).
        guard generation == authGeneration else { return false }
        guard currentView != .auth, let existing = currentUser, existing.id == user.id else { return false }
        // Server-confirmed (a settings PATCH round-tripped), so the local copy is
        // refreshed too — otherwise a rename or track opt-in would vanish on the
        // next offline launch (#665).
        applyAuthenticatedUser(user)
        return true
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
    }

    func beginSession(type: SessionType = .standard, track: Track = .primary) {
        currentView = .session(type: type, track: track)
    }

    /// #240: opt into the dual-track fork, then refresh local user + badges.
    func enableDualTrack() async {
        // Same identity-lifetime guard as the other sites that adopt a server
        // response: without it, a sign-out mid-request lets the old account's
        // returned UserDTO replace the active account and be persisted (#665).
        let generation = authGeneration
        do {
            let updated = try await APIClient.shared.enableDualTrack()
            guard generation == authGeneration else { return }
            applyAuthenticatedUser(updated)
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
        let prior = WidgetDataStore.load()
        if let prior, prior.isLoggedIn, !WidgetDataStore.isSameLocalDay(prior.lastUpdated, now) {
            practiceDoneToday = false
            secondPracticeDoneToday = false
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
        // Starts equal to the entry capture and is refreshed if we adopt a user, so
        // an expected adoption is never mistaken for the session being replaced.
        var adopted = generation
        if let user = try? await APIClient.shared.me(today: SessionCalendar.localTodayIsoDate()) {
            guard generation == authGeneration else { return }
            applyAuthenticatedUser(user)
            adopted = authGeneration
        }
        await refreshTracksDoneToday()
        // As in `refreshAfterReconnect`: re-checked because the refresh above is a
        // suspension point, and consuming the invite burns a token against whatever
        // session is live when it runs.
        guard adopted == authGeneration else { return }
        await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        await consumePendingLogReasonIfNeeded()
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
        let snapshot = WidgetDataStore.makeSnapshot(
            user: currentUser,
            primaryDoneToday: primaryDoneToday,
            // #684: the widget's Track Two row is driven by the practice flag, not
            // the server-derived Home badge, so a just-finished sit checks today
            // immediately on the fast (network-free) path.
            secondDoneToday: secondPracticeDoneToday,
            practiceDoneToday: practiceDoneToday
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
                completedPracticeDates: completed.primary,
                secondCompletedPracticeDates: completed.second,
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
