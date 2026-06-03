import SwiftUI
import SwiftData
import StillPointShared
import os

enum AppView: Equatable {
    case auth
    case home
    case session(type: SessionType)
    case buddyHub
    case buddySession(sessionId: String)
    case completion(
        sessionId: String,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        sessionType: SessionType,
        duration: Int,
        bonusSeconds: Int
    )
    case history
    case journal
    case board
    case settings

    static func == (lhs: AppView, rhs: AppView) -> Bool {
        switch (lhs, rhs) {
        case (.auth, .auth), (.home, .home),
             (.buddyHub, .buddyHub),
             (.history, .history), (.journal, .journal), (.board, .board),
             (.settings, .settings):
            return true
        case let (.session(lhsType), .session(rhsType)):
            return lhsType == rhsType
        case let (.buddySession(lhsSessionId), .buddySession(rhsSessionId)):
            return lhsSessionId == rhsSessionId
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

    /// Persisted: keep device screen awake during an active sit when enabled.
    var keepScreenAwakeDuringSession: Bool {
        didSet {
            SessionIdleTimerController.setKeepScreenAwakePreferenceEnabled(keepScreenAwakeDuringSession)
        }
    }

    var currentDay: Int {
        StillPoint.clampedCurrentDay(for: currentUser)
    }

    var todayDuration: Int {
        StillPoint.duration(forDay: currentDay)
    }

    var todayBlockCount: Int {
        StillPoint.blockCount(forDuration: todayDuration)
    }

    var isInSession: Bool {
        if case .session = currentView { return true }
        if case .buddySession = currentView { return true }
        if case .completion = currentView { return true }
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
            if let user = try await APIClient.shared.me() {
                currentUser = user
                currentView = Self.truthy(ProcessInfo.processInfo.environment["SP_UI_TEST_FORCE_START_SESSION"]) ? .session(type: .standard) : .home
                authStatusMessage = nil
                lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
                PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
                await consumePendingBuddyInviteIfNeeded()
                await consumePendingSessionDeepLinkIfNeeded()
                return
            } else {
                currentView = .auth
                authStatusMessage = nil
            }
        } catch let apiError as APIError where apiError.status == 401 && apiError.code == "TOKEN_EXPIRED" {
            currentView = .auth
            authStatusMessage = apiError.message
        } catch let apiError as APIError {
            currentView = .auth
            authStatusMessage = apiError.message
        } catch {
            currentView = .auth
            authStatusMessage = "Connection failed. Please try again."
        }
        lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
    }

    private func viewSlug(_ view: AppView) -> String {
        switch view {
        case .auth: return "auth"
        case .home: return "home"
        case .session: return "session"
        case .buddyHub: return "buddyHub"
        case .buddySession: return "buddySession"
        case .completion: return "completion"
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

    /// Initial tab index. Honors SP_UI_TEST_FORCE_PROGRESS_TAB (Progress = 1).
    private static func defaultSelectedTab() -> Int {
        truthy(ProcessInfo.processInfo.environment["SP_UI_TEST_FORCE_PROGRESS_TAB"]) ? 1 : 0
    }

    func didLogin(user: UserDTO) {
        currentUser = user
        currentView = .home
        // Reset to Home so a prior session's tab (e.g. Settings) doesn't leak
        // across auth transitions now that selectedTab lives on the view model.
        selectedTab = 0
        authStatusMessage = nil
        PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
        Task {
            await consumePendingBuddyInviteIfNeeded()
            await consumePendingSessionDeepLinkIfNeeded()
        }
    }

    func applySettingsUser(_ user: UserDTO) {
        guard currentView != .auth, let existing = currentUser, existing.id == user.id else { return }
        currentUser = user
    }

    func didLogout() {
        currentUser = nil
        pendingBuddyInviteToken = nil
        pendingSessionDeepLink = nil
        buddyInviteError = nil
        authStatusMessage = nil
        currentView = .auth
    }

    func beginSession(type: SessionType = .standard) {
        currentView = .session(type: type)
    }

    func beginBuddySession() {
        buddyInviteError = nil
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
        pendingSessionDeepLink = nil
        guard !isInSession else { return }
        beginSession(type: sessionType)
    }

    func completeSession(
        sessionId: String,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        sessionType: SessionType = .standard,
        duration: Int,
        bonusSeconds: Int = 0,
        unlockAppGate: Bool
    ) {
        // Daily-lock model (#348): any naturally-completed session — quick-minute
        // or standard — unlocks the gated apps for the rest of the day.
        if unlockAppGate {
            appBlockingManager.unlockAfterCompletedSession()
        } else {
            appBlockingManager.prepareForSession()
        }
        currentView = .completion(
            sessionId: sessionId,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            thoughts: thoughts,
            dayNumber: dayNumber,
            sessionType: sessionType,
            duration: duration,
            bonusSeconds: bonusSeconds
        )
    }

    func returnHome() async {
        currentView = .home
        selectedTab = 0
        if let user = try? await APIClient.shared.me() {
            currentUser = user
        }
        await consumePendingBuddyInviteIfNeeded()
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
        let host = (url.host ?? "").lowercased()
        guard scheme == "stillpoint", host == "home" else { return false }
        openHomeFromNotification()
        return true
    }

    private func extractBuddyToken(from url: URL) -> String? {
        BuddyInviteTokenParser.token(from: url)
    }
}

enum SessionDeepLinkParser {
    static func sessionType(from url: URL) -> SessionType? {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "stillpoint" else { return nil }
        let host = (url.host ?? "").lowercased()
        guard host == "session" else { return nil }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        if path == "quick" || path == "quick-minute" {
            return .quick
        }
        if path.isEmpty {
            return .standard
        }
        return nil
    }
}

enum BuddyInviteTokenParser {
    static func token(from raw: String, allowRawFallback: Bool) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let url = URL(string: trimmed), let token = token(from: url) {
            return token
        }

        if let buddy = tokenFromBuddyQueryFragment(in: trimmed) {
            return buddy
        }

        return allowRawFallback ? trimmed : nil
    }

    static func token(from url: URL) -> String? {
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let buddy = queryValue(named: "buddy", in: components) {
                return buddy
            }

            if isBuddyRoute(components), let token = queryValue(named: "token", in: components) {
                return token
            }
        }

        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        if scheme == "stillpoint" && host == "buddy" {
            let token = url.path
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return token.isEmpty ? nil : token
        }

        return nil
    }

    private static func queryValue(named name: String, in components: URLComponents) -> String? {
        guard let value = components.queryItems?.first(where: { $0.name == name })?.value?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func isBuddyRoute(_ components: URLComponents) -> Bool {
        let host = (components.host ?? "").lowercased()
        let path = components.path.lowercased()
        return host == "buddy" || path == "/buddy" || path.hasPrefix("/buddy/") || path.contains("/invite/buddy")
    }

    private static func tokenFromBuddyQueryFragment(in raw: String) -> String? {
        if raw.hasPrefix("buddy=") {
            return valueAfterParameterPrefix("buddy=", in: raw)
        }
        if let range = raw.range(of: "?buddy=") {
            return valueAfterParameterPrefix("?buddy=", in: String(raw[range.lowerBound...]))
        }
        if let range = raw.range(of: "&buddy=") {
            return valueAfterParameterPrefix("&buddy=", in: String(raw[range.lowerBound...]))
        }
        return nil
    }

    private static func valueAfterParameterPrefix(_ prefix: String, in raw: String) -> String? {
        guard let range = raw.range(of: prefix) else { return nil }
        let rest = raw[range.upperBound...]
        let value = rest.split(separator: "&", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
