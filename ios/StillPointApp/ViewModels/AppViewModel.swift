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
    var buddyInviteError: String?
    private var pendingBuddyInviteToken: String?

    var currentDay: Int {
        currentUser?.currentDay ?? 1
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
        isLoading = true
        defer { isLoading = false }

        do {
            if let user = try await APIClient.shared.me() {
                currentUser = user
                currentView = .home
                await consumePendingBuddyInviteIfNeeded()
            } else {
                currentView = .auth
            }
        } catch {
            currentView = .auth
        }
    }

    func didLogin(user: UserDTO) {
        currentUser = user
        currentView = .home
        Task { await consumePendingBuddyInviteIfNeeded() }
    }

    func didLogout() {
        currentUser = nil
        pendingBuddyInviteToken = nil
        buddyInviteError = nil
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
            if case .auth = currentView {} else {
                currentView = .buddyHub
            }
        } catch {
            buddyInviteError = "Could not open buddy invite."
            if case .auth = currentView {} else {
                currentView = .buddyHub
            }
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

        if let range = trimmed.range(of: "buddy=") {
            let rest = String(trimmed[range.upperBound...])
            if let amp = rest.firstIndex(of: "&") {
                return String(rest[..<amp]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            return rest.trimmingCharacters(in: .whitespacesAndNewlines)
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
}
