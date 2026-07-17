import SwiftUI
import StillPointShared

enum HistoryViewMode: String, CaseIterable {
    case calendar
    case journey

    var label: String {
        switch self {
        case .calendar: return "Calendar"
        case .journey: return "Session buildup"
        }
    }
}

enum HistoryCalendarSubView {
    case `default`
    case yearInReview
}

@MainActor
@Observable
final class HistoryViewModel {
    var sessions: [SessionDTO] = []
    var stats: StatsDTO?
    var isLoading = false
    var errorMessage: String?
    /// Expanded session (by row id).
    var expandedSessionId: String?
    var sessionThoughts: [String: [ThoughtDTO]] = [:]

    var viewMode: HistoryViewMode = .calendar
    var calendarSubView: HistoryCalendarSubView = .default

    /// All sits (standard + quick), ordered for the Journey list with collapsed missed-day gaps.
    var journeyRows: [HistoryJourneyListRow] = []

    /// Longest actualTime across sessions in the journey (floor 60).
    var maxDuration: Int = 60

    /// Stable local calendar day for the current load cycle (refreshed in `load()`).
    private(set) var todayIsoDate: String = HistoryViewModel.currentLocalIsoDate()

    var monthGrid: CurrentMonthGrid {
        HistoryMonthGrid.buildCurrentMonthGrid(sessions: sessions, todayIso: todayIsoDate)
    }

    var priorMonthSummaries: [MonthlySummary] {
        HistoryMonthGrid.buildPriorMonthSummaries(sessions: sessions, todayIso: todayIsoDate)
    }

    var trailing12MonthSummaries: [MonthlySummary] {
        HistoryMonthlyAggregation.buildTrailing12MonthSummaries(sessions: sessions, todayIso: todayIsoDate)
    }

    var mindStateTrends: MindStateTrendStats {
        stats?.mindStateTrends ?? .empty
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let today = Self.currentLocalIsoDate()
            todayIsoDate = today
            let result = try await APIClient.shared.getSessions(today: today)
            sessions = result.sessions.sorted { $0.sessionDate < $1.sessionDate }
            stats = StatsDTO.enrich(result.stats, sessions: sessions, todayIso: today)
            buildJourney(todayIso: today)
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
                    if expandedSessionId == sessionId {
                        expandedSessionId = nil
                    }
                }
            }
        }
    }

    // MARK: - Private

    private func buildJourney(todayIso: String? = nil) {
        journeyRows = HistoryJourney.buildRows(
            fromSessions: sessions,
            todayIsoDate: todayIso ?? todayIsoDate
        )

        let sessionTimes = sessions.map { $0.actualTime ?? $0.duration }
        maxDuration = max(sessionTimes.max() ?? 60, 60)
    }

    private static func currentLocalIsoDate() -> String {
        localIsoDateFormatter.string(from: Date())
    }

    private static let localIsoDateFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "en_US_POSIX")
        df.calendar = Calendar(identifier: .gregorian)
        return df
    }()
}
