import SwiftUI
import StillPointShared

@MainActor
@Observable
final class HistoryViewModel {
    var sessions: [SessionDTO] = []
    var stats: StatsDTO?
    var isLoading = false
    var errorMessage: String?
    var expandedDay: Int?
    var dayThoughts: [Int: [ThoughtDTO]] = [:]

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let result = try await APIClient.shared.getSessions()
            sessions = result.sessions.sorted { $0.dayNumber < $1.dayNumber }
            stats = result.stats
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
}
