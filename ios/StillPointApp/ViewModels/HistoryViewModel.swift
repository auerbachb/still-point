import SwiftUI
import StillPointShared

/// A display-ready row in the Journey list (session or missed day).
struct HistoryEntry: Identifiable {
    let id: String
    let sessionId: String?
    let dayNumber: Int?
    let duration: Int
    let actualTime: Int
    let completed: Bool
    let date: String          // "YYYY-MM-DD"
    let clearPercent: Int
    let thoughtCount: Int
    let missed: Bool
}

@MainActor
@Observable
final class HistoryViewModel {
    var sessions: [SessionDTO] = []
    var stats: StatsDTO?
    var isLoading = false
    var errorMessage: String?
    var expandedDay: Int?
    var dayThoughts: [Int: [ThoughtDTO]] = [:]

    /// Flattened journey entries including missed days.
    var history: [HistoryEntry] = []

    /// Longest actualTime across all real sessions (floor 60).
    var maxDuration: Int = 60

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let result = try await APIClient.shared.getSessions()
            sessions = result.sessions.sorted { $0.dayNumber < $1.dayNumber }
            stats = result.stats
            buildHistory()
        } catch {
            errorMessage = "Failed to load sessions. Check your connection."
            print("Failed to load sessions: \(error)")
        }
    }

    func toggleDay(_ dayNumber: Int) async {
        if expandedDay == dayNumber {
            expandedDay = nil
        } else {
            expandedDay = dayNumber
            if dayThoughts[dayNumber] == nil {
                do {
                    let detail = try await APIClient.shared.getSession(dayNumber: dayNumber)
                    dayThoughts[dayNumber] = detail.thoughts
                } catch {
                    print("Failed to load day \(dayNumber) thoughts: \(error)")
                }
            }
        }
    }

    // MARK: - Private

    private func buildHistory() {
        var entries: [HistoryEntry] = []
        let cal = Calendar.current
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"

        for (i, session) in sessions.enumerated() {
            // Detect missed days between consecutive sessions
            if i > 0,
               let prevDate = df.date(from: sessions[i - 1].sessionDate),
               let currDate = df.date(from: session.sessionDate) {
                let daysBetween = cal.dateComponents([.day], from: prevDate, to: currDate).day ?? 0
                for gap in 1..<daysBetween {
                    if let missedDate = cal.date(byAdding: .day, value: gap, to: prevDate) {
                        entries.append(HistoryEntry(
                            id: "missed-\(df.string(from: missedDate))",
                            sessionId: nil,
                            dayNumber: nil,
                            duration: 0,
                            actualTime: 0,
                            completed: false,
                            date: df.string(from: missedDate),
                            clearPercent: 0,
                            thoughtCount: 0,
                            missed: true
                        ))
                    }
                }
            }

            entries.append(HistoryEntry(
                id: session.id,
                sessionId: session.id,
                dayNumber: session.dayNumber,
                duration: session.duration,
                actualTime: session.actualTime ?? session.duration,
                completed: session.completed,
                date: session.sessionDate,
                clearPercent: session.clearPercent,
                thoughtCount: session.thoughtCount,
                missed: false
            ))
        }

        history = entries

        let sessionTimes = entries.filter { !$0.missed }.map(\.actualTime)
        maxDuration = max(sessionTimes.max() ?? 60, 60)
    }
}
