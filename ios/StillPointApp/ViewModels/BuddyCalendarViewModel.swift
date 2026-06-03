import SwiftUI
import StillPointShared

enum BuddyCalendarMode: Equatable {
    case unified
    case perBuddy(buddyId: String, buddyUsername: String)
}

@MainActor
@Observable
final class BuddyCalendarViewModel {
    var sessions: [BuddyCalendarSession] = []
    var isLoading = false
    var isLoadingMore = false
    var errorMessage: String?
    var loadMoreErrorMessage: String?
    var fromDate = ""
    var toDate = ""
    var hasMore = false
    var hiddenBuddyIds: Set<String> = []

    private var currentMode: BuddyCalendarMode = .unified

    var allBuddyIds: [String] {
        guard case .unified = currentMode else { return [] }
        var ids = Set<String>()
        for session in sessions {
            for id in session.buddyIds {
                ids.insert(id)
            }
        }
        return ids.sorted { username(for: $0).localizedCaseInsensitiveCompare(username(for: $1)) == .orderedAscending }
    }

    var showBuddyFilters: Bool {
        guard case .unified = currentMode else { return false }
        return allBuddyIds.count >= 3
    }

    var visibleSessions: [BuddyCalendarSession] {
        guard showBuddyFilters, !hiddenBuddyIds.isEmpty else { return sessions }
        return sessions.filter { session in
            !session.buddyIds.contains(where: { hiddenBuddyIds.contains($0) })
        }
    }

    var sessionsByDate: [(date: String, sessions: [BuddyCalendarSession])] {
        var groups: [String: [BuddyCalendarSession]] = [:]
        for session in visibleSessions {
            groups[session.calendarDate, default: []].append(session)
        }
        return groups
            .map { (date: $0.key, sessions: $0.value) }
            .sorted { $0.date > $1.date }
    }

    func username(for buddyId: String) -> String {
        for session in sessions {
            if let participant = session.participants.first(where: { $0.userId == buddyId }) {
                return participant.username
            }
        }
        return "Buddy"
    }

    func load(mode: BuddyCalendarMode, viewerUserId: String?) async {
        guard !isLoading else { return }
        currentMode = mode
        isLoading = true
        errorMessage = nil
        loadMoreErrorMessage = nil
        sessions = []
        hasMore = false
        defer { isLoading = false }

        do {
            let response = try await fetchCalendar(mode: mode, offset: 0)
            sessions = response.sessions
            fromDate = response.fromDate
            toDate = response.toDate
            hasMore = response.hasMore
            _ = viewerUserId
        } catch let error as APIError {
            errorMessage = message(for: error)
        } catch {
            errorMessage = "Could not load buddy calendar. Check your connection and try again."
        }
    }

    func loadMore(mode: BuddyCalendarMode) async {
        guard hasMore, !isLoading, !isLoadingMore else { return }
        isLoadingMore = true
        loadMoreErrorMessage = nil
        defer { isLoadingMore = false }

        do {
            let response = try await fetchCalendar(mode: mode, offset: sessions.count)
            sessions.append(contentsOf: response.sessions)
            fromDate = response.fromDate
            toDate = response.toDate
            hasMore = response.hasMore
        } catch let error as APIError {
            loadMoreErrorMessage = message(for: error)
        } catch {
            loadMoreErrorMessage = "Could not load more sessions. Try again."
        }
    }

    func toggleBuddyVisibility(buddyId: String) {
        if hiddenBuddyIds.contains(buddyId) {
            hiddenBuddyIds.remove(buddyId)
        } else {
            hiddenBuddyIds.insert(buddyId)
        }
    }

    // MARK: - Private

    private func fetchCalendar(mode: BuddyCalendarMode, offset: Int) async throws -> BuddyCalendarListResponse {
        switch mode {
        case .unified:
            return try await APIClient.shared.getBuddyCalendar(offset: offset)
        case .perBuddy(let buddyId, _):
            return try await APIClient.shared.getBuddyCalendarForBuddy(buddyId: buddyId, offset: offset)
        }
    }

    private func message(for error: APIError) -> String {
        switch error.status {
        case 401:
            return "Please sign in to view your buddy calendar."
        case 403:
            return "You are not friends with this user."
        case 400:
            return error.message.isEmpty ? "Invalid date range." : error.message
        case 500...599:
            return "Server error. Please try again."
        default:
            return error.message.isEmpty ? "Could not load buddy calendar." : error.message
        }
    }
}
