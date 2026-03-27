import Foundation
import SwiftData

@Model
public final class User {
    @Attribute(.unique) public var id: UUID
    @Attribute(.unique) public var email: String
    @Attribute(.unique) public var username: String
    public var isPublic: Bool
    public var currentDay: Int
    public var createdAt: Date
    public var updatedAt: Date

    @Relationship(deleteRule: .cascade, inverse: \Session.user)
    public var sessions: [Session] = []

    @Relationship(deleteRule: .cascade, inverse: \Thought.user)
    public var thoughts: [Thought] = []

    public init(
        id: UUID = UUID(),
        email: String,
        username: String,
        isPublic: Bool = false,
        currentDay: Int = 1,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.email = email
        self.username = username
        self.isPublic = isPublic
        self.currentDay = currentDay
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
