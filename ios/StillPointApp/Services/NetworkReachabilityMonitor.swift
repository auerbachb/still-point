import Foundation
import Network
import StillPointShared

/// Observes network reachability and flushes the offline session queue on reconnect (#557).
@Observable
final class NetworkReachabilityMonitor {
    private(set) var isConnected = true

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
                    await self.flushOfflineQueue()
                }
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    @MainActor
    func flushOfflineQueue() async {
        do {
            _ = try await SessionSyncCoordinator.shared.flushPending()
        } catch {
            print("Failed to flush offline session queue on reconnect: \(error)")
        }
    }
}
