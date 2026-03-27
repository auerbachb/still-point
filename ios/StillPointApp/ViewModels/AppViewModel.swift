import SwiftUI
import SwiftData
import StillPointShared

enum AppView: Equatable {
    case auth
    case home
    case session
    case completion(sessionId: String, clearPercent: Int, thoughtCount: Int, thoughts: [CapturedThought], dayNumber: Int, duration: Int)
    case history
    case journal
    case board
    case settings

    static func == (lhs: AppView, rhs: AppView) -> Bool {
        switch (lhs, rhs) {
        case (.auth, .auth), (.home, .home), (.session, .session),
             (.history, .history), (.journal, .journal), (.board, .board),
             (.settings, .settings):
            return true
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
final class AppViewModel {
    var currentView: AppView = .auth
    var currentUser: UserDTO?
    var isLoading = true

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
    }

    func didLogout() {
        currentUser = nil
        currentView = .auth
    }

    func beginSession() {
        currentView = .session
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
    }
}
