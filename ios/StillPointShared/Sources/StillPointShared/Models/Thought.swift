import Foundation
import SwiftData

@Model
public final class Thought {
    @Attribute(.unique) public var id: UUID
    public var user: User?
    public var session: Session?
    public var dayNumber: Int
    /// Seconds into session when thought was captured. -1 for end-of-session notes.
    public var timeInSession: Int
    public var text: String
    public var createdAt: Date
    public var syncStatus: SyncStatus

    public init(
        id: UUID = UUID(),
        user: User? = nil,
        session: Session? = nil,
        dayNumber: Int,
        timeInSession: Int,
        text: String,
        createdAt: Date = Date(),
        syncStatus: SyncStatus = .pending
    ) {
        self.id = id
        self.user = user
        self.session = session
        self.dayNumber = dayNumber
        self.timeInSession = timeInSession
        self.text = text
        self.createdAt = createdAt
        self.syncStatus = syncStatus
    }

    /// Whether this is an end-of-session note (not a mid-session thought)
    public var isEndNote: Bool { timeInSession == -1 }
}
