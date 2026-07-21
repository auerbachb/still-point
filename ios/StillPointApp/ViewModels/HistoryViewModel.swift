import SwiftUI
import StillPointShared
import UIKit

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
    /// Local environment photos keyed by session ID — only sessions that have a photo.
    /// Use `photoCheckedIds` to distinguish "not yet checked" from "checked, no photo".
    var sessionPhotos: [String: UIImage] = [:]
    /// Session IDs whose local photo file has already been looked up (avoids repeat disk reads).
    private(set) var photoCheckedIds: Set<String> = []

    var viewMode: HistoryViewMode = .calendar
    var calendarSubView: HistoryCalendarSubView = .default

    /// All sits (standard + quick), ordered for the Journey list with collapsed missed-day gaps.
    var journeyRows: [HistoryJourneyListRow] = []

    /// Longest actualTime across sessions in the journey (floor 60).
    var maxDuration: Int = 60

    /// Stable local calendar day for the current load cycle (refreshed in `load()`).
    private(set) var todayIsoDate: String = HistoryViewModel.currentLocalIsoDate()

    private(set) var monthGrid: CurrentMonthGrid = CurrentMonthGrid(
        yearMonth: "",
        monthLabel: "",
        cells: []
    )
    private(set) var priorMonthSummaries: [MonthlySummary] = []
    private(set) var trailing12MonthSummaries: [MonthlySummary] = []

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
            rebuildCalendarAggregates(todayIso: today)
        } catch is CancellationError {
            // SwiftUI cancelled this task (e.g. tab switch or view dismissal) — not a user-facing error.
        } catch let error as DecodingError {
            // #612: the payload did not match the strict session DTOs. Surface a distinct
            // message and log the coding path so the offending field is pinpointable from
            // device logs, instead of masking a data problem as a connection problem.
            errorMessage = "We couldn't read your session history. Please update the app, or try again later."
            print("Failed to decode sessions (\(Self.describe(error))): \(error)")
        } catch let error as APIError {
            errorMessage = message(for: error)
            print("Failed to load sessions (API \(error.status)): \(error.message)")
        } catch {
            // Genuine transport failures (URLError, etc.) land here.
            errorMessage = "Failed to load sessions. Check your connection."
            print("Failed to load sessions: \(error)")
        }
    }

    /// Maps an `APIError` to a user-facing message, mirroring `BuddyCalendarViewModel` (#612).
    private func message(for error: APIError) -> String {
        switch error.status {
        case 401:
            return error.code == "TOKEN_EXPIRED"
                ? "Your session expired. Please sign in again."
                : "Please sign in to view your session history."
        case 400:
            return error.message.isEmpty ? "We couldn't load your session history." : error.message
        case 500...599:
            return "Server hiccup. Please try again in a moment."
        default:
            return error.message.isEmpty ? "We couldn't load your session history." : error.message
        }
    }

    /// Compact, log-friendly description of a decoding failure — the failure kind and its
    /// coding path — so a mismatched field can be pinpointed from device logs (#612).
    private static func describe(_ error: DecodingError) -> String {
        func path(_ context: DecodingError.Context) -> String {
            let joined = context.codingPath.map(\.stringValue).joined(separator: ".")
            return joined.isEmpty ? "<root>" : joined
        }
        switch error {
        case let .keyNotFound(key, context):
            return "keyNotFound '\(key.stringValue)' at \(path(context))"
        case let .typeMismatch(type, context):
            return "typeMismatch \(type) at \(path(context))"
        case let .valueNotFound(type, context):
            return "valueNotFound \(type) at \(path(context))"
        case let .dataCorrupted(context):
            return "dataCorrupted at \(path(context))"
        @unknown default:
            return "unknown decoding error"
        }
    }

    func toggleSession(_ sessionId: String) async {
        if expandedSessionId == sessionId {
            expandedSessionId = nil
        } else {
            expandedSessionId = sessionId
            // Load thoughts from the server
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
            // Load local environment photo off the main thread (disk I/O + JPEG decode).
            // photoCheckedIds deduplicates lookup across expands; nil → no photo (expected)
            // vs. a transient read error (extremely rare for our own-written JPEGs — MVP).
            if !photoCheckedIds.contains(sessionId) {
                photoCheckedIds.insert(sessionId)
                let id = sessionId
                let photo: UIImage? = await withCheckedContinuation { continuation in
                    DispatchQueue.global(qos: .userInitiated).async {
                        continuation.resume(returning: SessionPhotoStore.shared.loadImage(forSessionId: id))
                    }
                }
                if let photo {
                    sessionPhotos[id] = photo
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

    private func rebuildCalendarAggregates(todayIso: String) {
        monthGrid = HistoryMonthGrid.buildCurrentMonthGrid(sessions: sessions, todayIso: todayIso)
        priorMonthSummaries = HistoryMonthGrid.buildPriorMonthSummaries(sessions: sessions, todayIso: todayIso)
        trailing12MonthSummaries = HistoryMonthlyAggregation.buildTrailing12MonthSummaries(
            sessions: sessions,
            todayIso: todayIso
        )
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
