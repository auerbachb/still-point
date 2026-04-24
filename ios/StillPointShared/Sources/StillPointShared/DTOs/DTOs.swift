import Foundation

// MARK: - API Response Types (matching web app's api.ts)

public struct UserDTO: Codable, Sendable {
    public let id: String
    public let email: String
    public let username: String
    public let isPublic: Bool
    public let currentDay: Int
}

public struct SessionDTO: Codable, Sendable {
    public let id: String
    public let dayNumber: Int
    public let duration: Int
    public let completed: Bool
    public let actualTime: Int?
    public let clearPercent: Int
    public let thoughtCount: Int
    public let mindStateLog: [MindStateEntry]?
    public let sessionDate: String
    public let buddySessionId: String?
}

public struct ThoughtDTO: Codable, Sendable {
    public let id: String
    public let sessionId: String
    public let dayNumber: Int
    public let timeInSession: Int
    public let text: String
}

public struct BoardEntryDTO: Codable, Sendable {
    public let username: String
    public let currentDay: Int
    public let streak: Int
    public let avgClear: Int
    public let totalSessions: Int
}

public struct StatsDTO: Codable, Sendable {
    public let streak: Int
    public let avgClearPercent: Int
    public let avgThoughtsPerSession: Double
    public let avgThoughtsPerMinute: Double
}

// MARK: - API Request Types

public struct CreateSessionRequest: Codable, Sendable {
    public let dayNumber: Int
    public let duration: Int
    public let completed: Bool
    public let actualTime: Int
    public let clearPercent: Int
    public let thoughtCount: Int
    public let mindStateLog: [MindStateEntry]
    public let sessionDate: String

    public init(
        dayNumber: Int, duration: Int, completed: Bool, actualTime: Int,
        clearPercent: Int, thoughtCount: Int, mindStateLog: [MindStateEntry],
        sessionDate: String
    ) {
        self.dayNumber = dayNumber
        self.duration = duration
        self.completed = completed
        self.actualTime = actualTime
        self.clearPercent = clearPercent
        self.thoughtCount = thoughtCount
        self.mindStateLog = mindStateLog
        self.sessionDate = sessionDate
    }
}

public struct BatchThoughtsRequest: Codable, Sendable {
    public let sessionId: String
    public let dayNumber: Int
    public let thoughts: [ThoughtInput]

    public struct ThoughtInput: Codable, Sendable {
        public let timeInSession: Int
        public let text: String

        public init(timeInSession: Int, text: String) {
            self.timeInSession = timeInSession
            self.text = text
        }
    }

    public init(sessionId: String, dayNumber: Int, thoughts: [ThoughtInput]) {
        self.sessionId = sessionId
        self.dayNumber = dayNumber
        self.thoughts = thoughts
    }
}

// MARK: - Buddy Session API Types

public struct BuddySessionCreatedDTO: Codable, Sendable {
    public let id: String
    public let shareToken: String
    public let sharePath: String
    public let durationSeconds: Int
}

public struct BuddyParticipantDTO: Codable, Sendable {
    public let userId: String
    public let username: String
    public let isHost: Bool
    public let ready: Bool
    public let joinedAt: String
    public let leftAt: String?
    public let connected: Bool
    public let participantCompletedAt: String?
}

public struct BuddySnapshotDTO: Codable, Sendable {
    public let id: String
    public let state: String
    public let revision: Int
    public let durationSeconds: Int
    public let startedAt: String?
    public let serverNow: String
    public let endsAt: String?
    public let elapsedSeconds: Int?
    public let remainingSeconds: Int?
    public let dailyRoomUrl: String?
    public let hostUserId: String
    public let isHost: Bool
    public let participants: [BuddyParticipantDTO]
}

public struct SetBuddyReadyRequest: Codable, Sendable {
    public let ready: Bool
}

public struct JoinBuddySessionRequest: Codable, Sendable {
    public let token: String
}

public struct RecordBuddyPersonalSessionRequest: Codable, Sendable {
    public let clearPercent: Int
    public let thoughtCount: Int
    public let mindStateLog: [MindStateEntry]
    public let actualTime: Int
    public let sessionDate: String
    public let thoughts: [BatchThoughtsRequest.ThoughtInput]?
}

// MARK: - API Wrappers (match JSON response shapes)

public struct UserResponse: Codable, Sendable {
    public let user: UserDTO
    public let token: String?
}

public struct SessionResponse: Codable, Sendable {
    public let session: SessionDTO
}

public struct SessionsResponse: Codable, Sendable {
    public let sessions: [SessionDTO]
    public let stats: StatsDTO
}

public struct SessionDetailResponse: Codable, Sendable {
    public let session: SessionDTO
    public let thoughts: [ThoughtDTO]
}

public struct ThoughtsResponse: Codable, Sendable {
    public let thoughts: [ThoughtDTO]
}

public struct BoardResponse: Codable, Sendable {
    public let board: [BoardEntryDTO]
}

public struct CreateBuddySessionResponse: Codable, Sendable {
    public let session: BuddySessionCreatedDTO
}

public struct JoinBuddySessionResponse: Codable, Sendable {
    public let sessionId: String
}

public struct BuddySnapshotResponse: Codable, Sendable {
    public let snapshot: BuddySnapshotDTO
}

public struct BuddyMeetingTokenResponse: Codable, Sendable {
    public let token: String
}

public struct BuddyBooleanResponse: Codable, Sendable {
    public let ok: Bool
}

public struct StartBuddySessionResponse: Codable, Sendable {
    public let ok: Bool
    public let startedAt: String?
}

public struct RecordBuddyPersonalSessionResponse: Codable, Sendable {
    public let session: SessionDTO
    public let already: Bool?
}
