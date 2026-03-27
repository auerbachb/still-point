import Foundation
import SwiftData

@Model
public final class Session {
    @Attribute(.unique) public var id: UUID
    public var user: User?
    public var dayNumber: Int
    /// Target duration in seconds
    public var duration: Int
    public var completed: Bool
    /// Actual wall-clock seconds elapsed (nil if abandoned)
    public var actualTime: Int?
    /// Percentage of time in "clear" state (0-100)
    public var clearPercent: Int
    /// Number of "I'm thinking" taps
    public var thoughtCount: Int
    /// Array of mind state transitions
    public var mindStateLog: [MindStateEntry]
    public var sessionDate: Date
    public var createdAt: Date
    public var syncStatus: SyncStatus

    @Relationship(deleteRule: .cascade, inverse: \Thought.session)
    public var thoughts: [Thought] = []

    public init(
        id: UUID = UUID(),
        user: User? = nil,
        dayNumber: Int,
        duration: Int,
        completed: Bool,
        actualTime: Int? = nil,
        clearPercent: Int,
        thoughtCount: Int,
        mindStateLog: [MindStateEntry] = [],
        sessionDate: Date = Date(),
        createdAt: Date = Date(),
        syncStatus: SyncStatus = .pending
    ) {
        self.id = id
        self.user = user
        self.dayNumber = dayNumber
        self.duration = duration
        self.completed = completed
        self.actualTime = actualTime
        self.clearPercent = clearPercent
        self.thoughtCount = thoughtCount
        self.mindStateLog = mindStateLog
        self.sessionDate = sessionDate
        self.createdAt = createdAt
        self.syncStatus = syncStatus
    }
}
