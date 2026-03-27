import SwiftUI
import StillPointShared

@Observable
final class ThoughtJournalViewModel {
    var thoughts: [ThoughtDTO] = []
    var isLoading = false

    /// Thoughts grouped by day number, sorted descending
    var groupedThoughts: [(dayNumber: Int, thoughts: [ThoughtDTO])] {
        let grouped = Dictionary(grouping: thoughts, by: { $0.dayNumber })
        return grouped
            .sorted { $0.key > $1.key }
            .map { (dayNumber: $0.key, thoughts: $0.value.sorted { $0.timeInSession < $1.timeInSession }) }
    }

    var totalCount: Int { thoughts.count }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            thoughts = try await APIClient.shared.getThoughts()
        } catch {
            print("Failed to load thoughts: \(error)")
        }
    }
}
