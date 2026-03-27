import SwiftUI
import StillPointShared

@Observable
final class BoardViewModel {
    var entries: [BoardEntryDTO] = []
    var isLoading = false

    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            entries = try await APIClient.shared.getBoard()
        } catch {
            print("Failed to load board: \(error)")
        }
    }
}
