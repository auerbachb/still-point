import Foundation
import Network
import StillPointShared

/// Observes network reachability and flushes the offline session queue on reconnect (#557).
@Observable
final class NetworkReachabilityMonitor {
    private(set) var isConnected = true
    var ownerUserIdProvider: (@MainActor () -> String?)?
    /// #840: called after a flush that uploaded at least one sit, so the account is
    /// re-read once the server has it (web's `onSynced`, #666).
    var onSynced: (@MainActor () -> Void)?

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.brettonauerbach.stillpoint.network-reachability")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let wasConnected = self.isConnected
                self.isConnected = connected
                if !wasConnected && connected {
                    await self.flushOfflineQueue(ownerUserId: self.ownerUserIdProvider?())
                }
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    @MainActor
    func flushOfflineQueue(ownerUserId: String?) async {
        guard let ownerUserId, !ownerUserId.isEmpty else { return }
        do {
            let syncedCount = try await SessionSyncCoordinator.shared.flushPending(ownerUserId: ownerUserId)
            if syncedCount > 0 {
                onSynced?()
            }
        } catch {
            print("Failed to flush offline session queue on reconnect: \(error)")
            // A flush that throws partway has still uploaded every entry before the
            // failing one, and its count is lost with the throw. Re-read anyway: the
            // read is idempotent and a failed one is dropped (`refreshUserAfterSync`).
            onSynced?()
        }
    }
}
