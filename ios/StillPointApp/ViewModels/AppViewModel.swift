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
    /// Any counted practice today (standard primary, quick, or breath) for the widget.
    var practiceDoneToday = false

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
                currentUser = user
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
            } else {
                currentView = .auth
                authStatusMessage = nil
                syncWidgetData()
            }
        } catch let apiError as APIError where apiError.status == 401 && apiError.code == "TOKEN_EXPIRED" {
            currentView = .auth
            authStatusMessage = apiError.message
            syncWidgetData()
        } catch let apiError as APIError {
            currentView = .auth
            authStatusMessage = apiError.message
            syncWidgetData()
        } catch {
            currentView = .auth
            authStatusMessage = "Connection failed. Please try again."
            syncWidgetData()
        }
        // #526: clear per-account unlock state on any unauthenticated redirect so the
        // next sign-in always re-qualifies (mirrors clearOnLogout called by didLogout).
        // The success path returns early above; only auth-redirect branches reach here.
        trackingControlPrefsManager.clearOnLogout()
        lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
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
        currentUser = user
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
        currentUser = user
    }

    func didLogout() {
        widgetHistoryTask?.cancel()
        widgetHistoryRefreshKey = nil
        Task { @MainActor in
            try? await SessionSyncCoordinator.shared.clearQueue()
            currentUser = nil
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
    }

    func beginSession(type: SessionType = .standard, track: Track = .primary) {
        currentView = .session(type: type, track: track)
    }

    /// #240: opt into the dual-track fork, then refresh local user + badges.
    func enableDualTrack() async {
        do {
            let updated = try await APIClient.shared.enableDualTrack()
            currentUser = updated
            await refreshTracksDoneToday()
        } catch {
            print("Failed to enable dual track: \(error)")
        }
    }

    /// #240: derive per-track "completed a standard sit today" from a lightweight
    /// server-side filtered query.
    func refreshTracksDoneToday() async {
        guard currentUser != nil else { return }
        let now = Date()
        let prior = WidgetDataStore.load()
        if let prior, prior.isLoggedIn, !WidgetDataStore.isSameLocalDay(prior.lastUpdated, now) {
            practiceDoneToday = false
        }
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.calendar = Calendar(identifier: .gregorian)
        let today = dateFormatter.string(from: Date())
        do {
            let tracksDoneToday = try await APIClient.shared.getTracksDoneToday(date: today)
            primaryDoneToday = tracksDoneToday.primary
            secondDoneToday = tracksDoneToday.second
            if primaryDoneToday {
                practiceDoneToday = true
            }
        } catch {
            // Non-fatal: fail closed so stale "done today" badges do not leak.
            primaryDoneToday = false
            secondDoneToday = false
            practiceDoneToday = false
        }
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
            markPracticeDoneToday()
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
        if countsForWidgetPractice(sessionType: sessionType, track: track) {
            markPracticeDoneToday()
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
            currentUser = user
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
    private func syncWidgetData() {
        let snapshot = WidgetDataStore.makeSnapshot(
            user: currentUser,
            primaryDoneToday: primaryDoneToday,
            secondDoneToday: secondDoneToday,
            practiceDoneToday: practiceDoneToday
        )
        if snapshot.isLoggedIn {
            WidgetDataStore.save(snapshot)
        } else {
            WidgetDataStore.clear()
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
        // when we've already backfilled for this account today.
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
            let completed = WidgetDataStore.recentCompletedPracticeDates(from: result.sessions, now: now)
            // Derive today's completion from the fetched sessions (consistent with
            // `now`) rather than the in-memory flag, which could be stale past midnight.
            let doneToday = completed.contains(WidgetDataStore.localDayString(now))
            let snapshot = WidgetDataStore.makeSnapshot(
                user: current,
                primaryDoneToday: primaryDoneToday,
                secondDoneToday: secondDoneToday,
                practiceDoneToday: doneToday,
                now: now,
                completedPracticeDates: completed
            )
            WidgetDataStore.save(snapshot)
            WidgetTimelineReloader.reloadHabitWidget()
            // #526: backfill tracking-controls unlock from history so existing users
            // who have a qualifying sit start in the unlocked state (mirrors web's
            // syncTrackingUnlockFromSessions).
            trackingControlPrefsManager.syncTrackingUnlockFromSessions(result.sessions)
        }
    }

    /// Mark today as having counted practice and push an immediate widget snapshot.
    /// Shared touchpoint with #590 completion-handler work — rebase carefully.
    private func markPracticeDoneToday() {
        practiceDoneToday = true
        syncWidgetData()
    }

    private func countsForWidgetPractice(sessionType: SessionType, track: Track) -> Bool {
        switch sessionType {
        case .quick, .breath:
            return true
        case .standard:
            return track == .primary
        }
    }
}
