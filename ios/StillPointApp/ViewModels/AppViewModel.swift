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
        isLoading = true
        defer {
            isLoading = false
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
                applyAuthenticatedUser(user)
                resetTrackCompletionBadges()
                currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
                authStatusMessage = nil
                lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
                PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
                hydrateNotificationSuppressionPreference()
                await refreshTracksDoneToday()
                syncWidgetData()
                await consumePendingBuddyInviteIfNeeded()
                await consumePendingSessionDeepLinkIfNeeded()
                await consumePendingLogReasonIfNeeded()
                return
            }
            // `me()` swallows a 401 that is *not* `TOKEN_EXPIRED` and returns nil:
            // the server answered, and the answer was "no session". Authoritative.
            applySignedOut(cause: .signedOut, message: nil)
        } catch {
            // #665: a failed request is not a sign-out. `OfflineAuth` makes that
            // call once, in the taxonomy #676 gave the widget, so the app and the
            // widget can never disagree about what "signed out" means.
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

    /// Single place a server-confirmed user is adopted — in memory *and* in the
    /// local copy that survives a launch with no network (#665).
    private func applyAuthenticatedUser(_ user: UserDTO) {
        authGeneration &+= 1
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
        authGeneration &+= 1
        currentUser = user
        isOfflineMode = true
        resetTrackCompletionBadges()
        currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
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

    private func cancelIdentityScopedTasks() {
        offlineCatchUpTask?.cancel()
        offlineCatchUpTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
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
            PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
            hydrateNotificationSuppressionPreference()
            await refreshTracksDoneToday()
            await consumePendingBuddyInviteIfNeeded()
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
        resetTrackCompletionBadges()
        currentView = .home
        // Reset to Home so a prior session's tab (e.g. Settings) doesn't leak
        // across auth transitions now that selectedTab lives on the view model.
        selectedTab = 0
        authStatusMessage = nil
        PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
        hydrateNotificationSuppressionPreference()
        Task {
            await refreshTracksDoneToday()
            syncWidgetData()
            await consumePendingBuddyInviteIfNeeded()
            await consumePendingSessionDeepLinkIfNeeded()
            await consumePendingLogReasonIfNeeded()
        }
    }

    /// Fetch the server-synced suppress-during-session opt-in at an auth point so
    /// `PushNotificationCoordinator.willPresent` reflects current server truth
    /// even before the Notifications screen is opened this launch (#431).
    private func hydrateNotificationSuppressionPreference() {
        Task {
            if let prefs = try? await APIClient.shared.getNotificationPreferences() {
                SessionNotificationSuppressionController.setSuppressPreferenceEnabled(prefs.suppressDuringSession)
            }
        }
    }

    func applySettingsUser(_ user: UserDTO) {
        guard currentView != .auth, let existing = currentUser, existing.id == user.id else { return }
        // Server-confirmed (a settings PATCH round-tripped), so the local copy is
        // refreshed too — otherwise a rename or track opt-in would vanish on the
        // next offline launch (#665).
        applyAuthenticatedUser(user)
    }

    func didLogout() {
        // Invalidate in-flight identity-scoped work synchronously, before the
        // `clearQueue()` await below — the moment sign-out is known is the moment a
        // response for the old session stops being allowed to write anything (#665).
        authGeneration &+= 1
        cancelIdentityScopedTasks()
        widgetHistoryTask?.cancel()
        widgetHistoryRefreshKey = nil
        Task { @MainActor in
            try? await SessionSyncCoordinator.shared.clearQueue()
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
            resetTrackCompletionBadges()
            LastAuthProvider.resetPersisted()
            currentView = .auth
            SessionNotificationSuppressionController.clearSuppressPreference()
            // #526: reset account-scoped tracking unlock so the next sign-in re-qualifies.
            trackingControlPrefsManager.clearOnLogout()
            syncWidgetData()
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
        do {
            let updated = try await APIClient.shared.enableDualTrack()
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
            primaryDoneToday = false
            secondDoneToday = false
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
            currentView = .home
        } catch {
            print("Failed to persist breath session locally: \(error)")
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
        Task { await consumePendingBuddyInviteIfNeeded() }
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
        Task { await joinBuddySession(token: token) }
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
        if let ownerUserId = currentUser?.id {
            do {
                _ = try await SessionSyncCoordinator.shared.flushPending(ownerUserId: ownerUserId)
                try await SessionSyncCoordinator.shared.pruneCompletedEntries(ownerUserId: ownerUserId)
            } catch {
                print("Failed to flush offline session queue: \(error)")
            }
        }
        if let user = try? await APIClient.shared.me(today: SessionCalendar.localTodayIsoDate()) {
            applyAuthenticatedUser(user)
        }
        await refreshTracksDoneToday()
        await consumePendingBuddyInviteIfNeeded()
        await consumePendingLogReasonIfNeeded()
    }

    private func consumePendingBuddyInviteIfNeeded() async {
        guard currentUser != nil, let token = pendingBuddyInviteToken else { return }
        pendingBuddyInviteToken = nil
        await joinBuddySession(token: token)
    }

    private func joinBuddySession(token: String) async {
        do {
            let sessionId = try await APIClient.shared.joinBuddySession(token: token)
            buddyInviteError = nil
            currentView = .buddySession(sessionId: sessionId)
        } catch let error as APIError {
            buddyInviteError = error.message
        } catch {
            buddyInviteError = "Could not open buddy invite."
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
            WidgetDataStore.save(snapshot)
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
        // this sit finished returns without it, and its unconditional
        // `WidgetDataStore.save` would clobber the snapshot written just below,
        // un-checking the row we are here to check. Clearing the throttle key
        // lets the next `refreshTracksDoneToday()` re-fetch and backfill from
        // history once `returnHome()` has flushed the sit to the server.
        widgetHistoryTask?.cancel()
        widgetHistoryRefreshKey = nil
        syncWidgetData()
    }
}
