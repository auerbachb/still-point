import SwiftUI
import StillPointShared

@MainActor
@Observable
final class HistoryViewModel {
    var sessions: [SessionDTO] = []
    var stats: StatsDTO?
    var isLoading = false
    var errorMessage: String?
    /// Expanded standard session (by row id).
    var expandedSessionId: String?
    var sessionThoughts: [String: [ThoughtDTO]] = [:]

    /// Standard sits only, ordered for the Journey list (missed gaps + per-day session indices).
    var journeyRows: [HistoryJourneyListRow] = []

    /// Longest actualTime across standard sessions in the journey (floor 60).
    var maxDuration: Int = 60

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let result = try await APIClient.shared.getSessions()
            sessions = result.sessions.sorted { $0.sessionDate < $1.sessionDate }
            stats = result.stats
            buildJourney()
        } catch {
            errorMessage = "Failed to load sessions. Check your connection."
            print("Failed to load sessions: \(error)")
        }
    }

    func toggleSession(_ sessionId: String) async {
        if expandedSessionId == sessionId {
            expandedSessionId = nil
        } else {
            expandedSessionId = sessionId
            if sessionThoughts[sessionId] == nil {
                do {
                    let detail = try await APIClient.shared.getSessionBySessionId(sessionId)
                    sessionThoughts[sessionId] = detail.thoughts
                } catch {
                    print("Failed to load session \(sessionId) thoughts: \(error)")
                    expandedSessionId = nil
                }
            }
        }
    }

    // MARK: - Private

    private func buildJourney() {
        let standard = sessions.filter { $0.sessionType == .standard }
        journeyRows = HistoryJourney.buildRows(fromStandardSessions: standard)

        let sessionTimes = standard.map { $0.actualTime ?? $0.duration }
        maxDuration = max(sessionTimes.max() ?? 60, 60)
    }
}
