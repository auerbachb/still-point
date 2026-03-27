import SwiftUI
import StillPointShared

@MainActor
@Observable
final class BoardViewModel {
    var entries: [BoardEntryDTO] = []
    var isLoading = false
    var errorMessage: String?

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            entries = try await APIClient.shared.getBoard()
        } catch {
            errorMessage = "Failed to load board. Check your connection."
            print("Failed to load board: \(error)")
        }
    }
}
