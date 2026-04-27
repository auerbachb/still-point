import SwiftUI
import SwiftData
import StillPointShared

enum AppView: Equatable {
    case auth
    case home
    case session
    case buddyHub
    case buddySession(sessionId: String)
    case completion(sessionId: String, clearPercent: Int, thoughtCount: Int, thoughts: [CapturedThought], dayNumber: Int, duration: Int)
    case history
    case journal
    case board
    case settings

    static func == (lhs: AppView, rhs: AppView) -> Bool {
        switch (lhs, rhs) {
        case (.auth, .auth), (.home, .home), (.session, .session),
             (.buddyHub, .buddyHub),
             (.history, .history), (.journal, .journal), (.board, .board),
             (.settings, .settings):
            return true
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
    var currentView: AppView = .auth
    var currentUser: UserDTO?
    var isLoading = true
    var authStatusMessage: String?
    var lastColdStartAuthCheckMs: Int?
    var buddyInviteError: String?
    private var pendingBuddyInviteToken: String?

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

    func checkAuth() async {
        let startedAt = Date()
        isLoading = true
        defer { isLoading = false }

        do {
            if let user = try await APIClient.shared.me() {
                currentUser = user
                currentView = .home
                authStatusMessage = nil
                lastColdStartAuthCheckMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
                await consumePendingBuddyInviteIfNeeded()
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

    func didLogin(user: UserDTO) {
        currentUser = user
        currentView = .home
        authStatusMessage = nil
        Task { await consumePendingBuddyInviteIfNeeded() }
    }

    func didLogout() {
        currentUser = nil
        pendingBuddyInviteToken = nil
        buddyInviteError = nil
        authStatusMessage = nil
        currentView = .auth
    }

    func beginSession() {
        currentView = .session
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

    func completeSession(
        sessionId: String,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        duration: Int
    ) {
        currentView = .completion(
            sessionId: sessionId,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            thoughts: thoughts,
            dayNumber: dayNumber,
            duration: duration
        )
    }

    func returnHome() async {
        // Refresh user data to get updated currentDay BEFORE navigating
        if let user = try? await APIClient.shared.me() {
            currentUser = user
        }
        currentView = .home
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

    private func extractBuddyToken(from url: URL) -> String? {
        BuddyInviteTokenParser.token(from: url)
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
