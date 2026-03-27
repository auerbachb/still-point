import Foundation

/// Tracks whether a local record has been synced to the server.
public enum SyncStatus: String, Codable {
    case pending
    case synced
    case failed
}
