import Foundation

// MARK: - API Response Types (matching web app's api.ts)

public struct UserDTO: Codable, Sendable {
    public let id: String
    public let email: String
    public let username: String
    public let isPublic: Bool
    public let currentDay: Int
    /// #88: opt-in pre-session aphorism shown on Home. Decoded permissively so
    /// responses from a server that predates this field (or cached fixtures)
    /// still decode, defaulting to off.
    public let aphorismsEnabled: Bool
    /// #113: opt-in iOS ARKit gaze attention tracking during sessions.
    public let attentionTrackingEnabled: Bool
    /// #240: dual-track fork. `dualTrackEnabled` gates the opt-in second daily
    /// track; `secondTrackDay` is its independent day counter. Both decoded
    /// permissively so a server that predates #240 defaults to single-track.
    public let dualTrackEnabled: Bool
    public let secondTrackDay: Int

    public init(
        id: String,
        email: String,
        username: String,
        isPublic: Bool,
        currentDay: Int,
        aphorismsEnabled: Bool = false,
        attentionTrackingEnabled: Bool? = nil,
        dualTrackEnabled: Bool = false,
        secondTrackDay: Int = 1
    ) {
        self.id = id
        self.email = email
        self.username = username
        self.isPublic = isPublic
        self.currentDay = currentDay
        self.aphorismsEnabled = aphorismsEnabled
        self.attentionTrackingEnabled = attentionTrackingEnabled ?? false
        self.dualTrackEnabled = dualTrackEnabled
        self.secondTrackDay = secondTrackDay
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decode(String.self, forKey: .email)
        username = try c.decode(String.self, forKey: .username)
        isPublic = try c.decode(Bool.self, forKey: .isPublic)
        currentDay = try c.decode(Int.self, forKey: .currentDay)
        aphorismsEnabled = try c.decodeIfPresent(Bool.self, forKey: .aphorismsEnabled) ?? false
        attentionTrackingEnabled = try c.decodeIfPresent(Bool.self, forKey: .attentionTrackingEnabled) ?? false
        dualTrackEnabled = try c.decodeIfPresent(Bool.self, forKey: .dualTrackEnabled) ?? false
        secondTrackDay = try c.decodeIfPresent(Int.self, forKey: .secondTrackDay) ?? 1
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, username, isPublic, currentDay, aphorismsEnabled, attentionTrackingEnabled, dualTrackEnabled, secondTrackDay
    }
}

public struct SessionDTO: Codable, Sendable {
    public let id: String
    public let dayNumber: Int
    public let sessionType: SessionType
    public let duration: Int
    /// Extension seconds beyond `duration` from +1/+5 controls (#90).
    public let bonusSeconds: Int?
    public let completed: Bool
    public let actualTime: Int?
    public let clearPercent: Int
    public let thoughtCount: Int
    public let mindStateLog: [MindStateEntry]?
    /// #113: ARKit gaze attention transitions ("attentive" | "away").
    public let attentionLog: [AttentionEntry]?
    public let sessionDate: String
    /// ISO-8601 from API when present; used for same-day ordering (matches web `sessionSortKey`).
    public let createdAt: String?
    public let buddySessionId: String?
    /// Number of full breaths counted during a breath session (nil for non-breath sessions).
    public let breathCount: Int?
    /// #240: which daily track this sit advanced. Decoded permissively (nil from a
    /// server that predates #240); nil is treated as `.primary` by callers.
    public let track: Track?

    public init(
        id: String,
        dayNumber: Int,
        sessionType: SessionType = .standard,
        duration: Int,
        bonusSeconds: Int? = nil,
        completed: Bool,
        actualTime: Int?,
        clearPercent: Int,
        thoughtCount: Int,
        mindStateLog: [MindStateEntry]?,
        attentionLog: [AttentionEntry]? = nil,
        sessionDate: String,
        createdAt: String? = nil,
        buddySessionId: String?,
        breathCount: Int? = nil,
        track: Track? = nil
    ) {
        self.id = id
        self.dayNumber = dayNumber
        self.sessionType = sessionType
        self.duration = duration
        self.bonusSeconds = bonusSeconds
        self.completed = completed
        self.actualTime = actualTime
        self.clearPercent = clearPercent
        self.thoughtCount = thoughtCount
        self.mindStateLog = mindStateLog
        self.attentionLog = attentionLog
        self.sessionDate = sessionDate
        self.createdAt = createdAt
        self.buddySessionId = buddySessionId
        self.breathCount = breathCount
        self.track = track
    }
}

public struct ThoughtDTO: Codable, Sendable {
    public let id: String
    public let sessionId: String
    public let dayNumber: Int
    public let timeInSession: Int
    public let text: String

    public init(id: String, sessionId: String, dayNumber: Int, timeInSession: Int, text: String) {
        self.id = id
        self.sessionId = sessionId
        self.dayNumber = dayNumber
        self.timeInSession = timeInSession
        self.text = text
    }
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
    public let bonusMinutesTotal: Int?

    public init(
        streak: Int,
        avgClearPercent: Int,
        avgThoughtsPerSession: Double,
        avgThoughtsPerMinute: Double,
        bonusMinutesTotal: Int? = nil
    ) {
        self.streak = streak
        self.avgClearPercent = avgClearPercent
        self.avgThoughtsPerSession = avgThoughtsPerSession
        self.avgThoughtsPerMinute = avgThoughtsPerMinute
        self.bonusMinutesTotal = bonusMinutesTotal
    }
}

// MARK: - API Request Types

public struct CreateSessionRequest: Codable, Sendable {
    public let dayNumber: Int
    public let sessionType: SessionType
    public let duration: Int
    public let bonusSeconds: Int
    public let completed: Bool
    public let actualTime: Int
    public let clearPercent: Int
    public let thoughtCount: Int
    public let mindStateLog: [MindStateEntry]
    /// #113: ARKit gaze attention log; omitted when tracking is off.
    public let attentionLog: [AttentionEntry]?
    public let sessionDate: String
    /// Number of full breaths counted. Only sent for `.breath` sessions; nil otherwise.
    public let breathCount: Int?
    /// #240: which daily track this sit advances. Defaults to `.primary`.
    public let track: Track

    public init(
        dayNumber: Int,
        sessionType: SessionType = .standard,
        duration: Int,
        bonusSeconds: Int = 0,
        completed: Bool,
        actualTime: Int,
        clearPercent: Int,
        thoughtCount: Int,
        mindStateLog: [MindStateEntry],
        attentionLog: [AttentionEntry]? = nil,
        sessionDate: String,
        breathCount: Int? = nil,
        track: Track = .primary
    ) {
        self.dayNumber = dayNumber
        self.sessionType = sessionType
        self.duration = duration
        self.bonusSeconds = bonusSeconds
        self.completed = completed
        self.actualTime = actualTime
        self.clearPercent = clearPercent
        self.thoughtCount = thoughtCount
        self.mindStateLog = mindStateLog
        self.attentionLog = attentionLog
        self.sessionDate = sessionDate
        self.breathCount = breathCount
        self.track = track
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

// MARK: - Buddy Calendar API Types (#350 / #358)

public struct BuddyCalendarParticipant: Codable, Sendable {
    public let userId: String
    public let username: String
}

public struct BuddyCalendarSession: Codable, Sendable {
    public let id: String
    public let state: String
    public let durationSeconds: Int
    public let calendarDate: String
    public let scheduledStartAt: String?
    public let startedAt: String?
    public let participants: [BuddyCalendarParticipant]
    public let buddyIds: [String]
}

public struct BuddyCalendarListResponse: Codable, Sendable {
    public let sessions: [BuddyCalendarSession]
    public let fromDate: String
    public let toDate: String
    public let hasMore: Bool
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

public struct DeviceTokenRegistrationRequest: Codable, Sendable {
    public let token: String
    public let platform: String
    public let apnsEnvironment: String

    public init(token: String, platform: String = "ios", apnsEnvironment: String) {
        self.token = token
        self.platform = platform
        self.apnsEnvironment = apnsEnvironment
    }
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

    public init(
        clearPercent: Int,
        thoughtCount: Int,
        mindStateLog: [MindStateEntry],
        actualTime: Int,
        sessionDate: String,
        thoughts: [BatchThoughtsRequest.ThoughtInput]?
    ) {
        self.clearPercent = clearPercent
        self.thoughtCount = thoughtCount
        self.mindStateLog = mindStateLog
        self.actualTime = actualTime
        self.sessionDate = sessionDate
        self.thoughts = thoughts
    }
}

// MARK: - API Wrappers (match JSON response shapes)

public struct AppleNativeSignInRequest: Encodable, Sendable {
    public let identityToken: String
    public let authorizationCode: String?
    public let rawNonce: String
    public let user: AppleUserFirstSignInPayload?

    public struct AppleUserFirstSignInPayload: Encodable, Sendable {
        public let name: Name?
        public let email: String?

        public struct Name: Encodable, Sendable {
            public let firstName: String?
            public let lastName: String?

            public init(firstName: String?, lastName: String?) {
                self.firstName = firstName
                self.lastName = lastName
            }
        }

        public init(name: Name?, email: String?) {
            self.name = name
            self.email = email
        }
    }

    public init(
        identityToken: String,
        authorizationCode: String?,
        rawNonce: String,
        user: AppleUserFirstSignInPayload?
    ) {
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.rawNonce = rawNonce
        self.user = user
    }
}

/// Body for `POST /api/auth/google-native`. The server verifies `idToken` against
/// Google's JWKS and resolves the user via `resolveOAuthUserId`. `serverAuthCode`
/// is sent for parity with Google's API and is not used for linking today.
public struct GoogleNativeSignInRequest: Encodable, Sendable {
    public let idToken: String
    public let serverAuthCode: String?

    public init(idToken: String, serverAuthCode: String? = nil) {
        self.idToken = idToken
        self.serverAuthCode = serverAuthCode
    }
}

public struct UserResponse: Codable, Sendable {
    public let user: UserDTO
    public let token: String?
}

public struct PasswordResetRequestResponse: Codable, Sendable {
    public let message: String
}

public struct SessionResponse: Codable, Sendable {
    public let session: SessionDTO
}

public struct SessionsResponse: Codable, Sendable {
    public let sessions: [SessionDTO]
    public let stats: StatsDTO
}

public struct TracksDoneTodayDTO: Codable, Sendable {
    public let primary: Bool
    public let second: Bool

    public init(primary: Bool, second: Bool) {
        self.primary = primary
        self.second = second
    }
}

public struct TracksDoneTodayResponse: Codable, Sendable {
    public let tracksDoneToday: TracksDoneTodayDTO
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

public struct DeviceTokenResponse: Codable, Sendable {
    public struct RegisteredDeviceToken: Codable, Sendable {
        public let id: String
        public let platform: String
        public let apnsEnvironment: String
    }

    public let deviceToken: RegisteredDeviceToken
}

public struct StartBuddySessionResponse: Codable, Sendable {
    public let ok: Bool
    public let startedAt: String?
}

public struct RecordBuddyPersonalSessionResponse: Codable, Sendable {
    public let session: SessionDTO
    public let already: Bool?
}

// MARK: - Notification preferences (#345)

public enum DailyReminderFrequency: String, Codable, Sendable, CaseIterable {
    case daily
    case everyOther = "every_other"
    case weekly

    public var label: String {
        switch self {
        case .daily: return "Daily"
        case .everyOther: return "Every other day"
        case .weekly: return "Weekly"
        }
    }
}

public struct NotificationPreferencesDTO: Codable, Sendable, Equatable {
    public let pushEnabled: Bool
    public let dailyReminderEnabled: Bool
    public let missADayEnabled: Bool
    public let friendRequestNotificationsEnabled: Bool
    /// Opt-in (#441): fixed 8 PM local nudge to log why the user could not meditate.
    public let failureReasonReminderEnabled: Bool
    /// Opt-in (#431): suppress push presentation while a sit is in progress.
    public let suppressDuringSession: Bool
    public let dailyReminderTime: String
    public let dailyReminderFrequency: DailyReminderFrequency
    public let quietHoursStart: String?
    public let quietHoursEnd: String?
    public let tz: String
    public let updatedAt: String?

    public init(
        pushEnabled: Bool,
        dailyReminderEnabled: Bool,
        missADayEnabled: Bool,
        friendRequestNotificationsEnabled: Bool = true,
        failureReasonReminderEnabled: Bool = false,
        suppressDuringSession: Bool = false,
        dailyReminderTime: String,
        dailyReminderFrequency: DailyReminderFrequency,
        quietHoursStart: String?,
        quietHoursEnd: String?,
        tz: String,
        updatedAt: String? = nil
    ) {
        self.pushEnabled = pushEnabled
        self.dailyReminderEnabled = dailyReminderEnabled
        self.missADayEnabled = missADayEnabled
        self.friendRequestNotificationsEnabled = friendRequestNotificationsEnabled
        self.failureReasonReminderEnabled = failureReasonReminderEnabled
        self.suppressDuringSession = suppressDuringSession
        self.dailyReminderTime = dailyReminderTime
        self.dailyReminderFrequency = dailyReminderFrequency
        self.quietHoursStart = quietHoursStart
        self.quietHoursEnd = quietHoursEnd
        self.tz = tz
        self.updatedAt = updatedAt
    }
}

public struct NotificationPreferencesResponse: Codable, Sendable {
    public let preferences: NotificationPreferencesDTO
}

public struct NotificationPreferencesPatch: Encodable, Sendable {
    public var pushEnabled: Bool?
    public var dailyReminderEnabled: Bool?
    public var missADayEnabled: Bool?
    public var friendRequestNotificationsEnabled: Bool?
    public var failureReasonReminderEnabled: Bool?
    public var suppressDuringSession: Bool?
    public var dailyReminderTime: String?
    public var dailyReminderFrequency: DailyReminderFrequency?
    public var quietHoursStart: String??
    public var quietHoursEnd: String??
    public var tz: String?

    public init(
        pushEnabled: Bool? = nil,
        dailyReminderEnabled: Bool? = nil,
        missADayEnabled: Bool? = nil,
        friendRequestNotificationsEnabled: Bool? = nil,
        failureReasonReminderEnabled: Bool? = nil,
        suppressDuringSession: Bool? = nil,
        dailyReminderTime: String? = nil,
        dailyReminderFrequency: DailyReminderFrequency? = nil,
        quietHoursStart: String?? = nil,
        quietHoursEnd: String?? = nil,
        tz: String? = nil
    ) {
        self.pushEnabled = pushEnabled
        self.dailyReminderEnabled = dailyReminderEnabled
        self.missADayEnabled = missADayEnabled
        self.friendRequestNotificationsEnabled = friendRequestNotificationsEnabled
        self.failureReasonReminderEnabled = failureReasonReminderEnabled
        self.suppressDuringSession = suppressDuringSession
        self.dailyReminderTime = dailyReminderTime
        self.dailyReminderFrequency = dailyReminderFrequency
        self.quietHoursStart = quietHoursStart
        self.quietHoursEnd = quietHoursEnd
        self.tz = tz
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let pushEnabled { try c.encode(pushEnabled, forKey: .pushEnabled) }
        if let dailyReminderEnabled { try c.encode(dailyReminderEnabled, forKey: .dailyReminderEnabled) }
        if let missADayEnabled { try c.encode(missADayEnabled, forKey: .missADayEnabled) }
        if let friendRequestNotificationsEnabled {
            try c.encode(friendRequestNotificationsEnabled, forKey: .friendRequestNotificationsEnabled)
        }
        if let failureReasonReminderEnabled {
            try c.encode(failureReasonReminderEnabled, forKey: .failureReasonReminderEnabled)
        }
        if let suppressDuringSession { try c.encode(suppressDuringSession, forKey: .suppressDuringSession) }
        if let dailyReminderTime { try c.encode(dailyReminderTime, forKey: .dailyReminderTime) }
        if let dailyReminderFrequency { try c.encode(dailyReminderFrequency, forKey: .dailyReminderFrequency) }
        if let quietHoursStart {
            switch quietHoursStart {
            case .none: try c.encodeNil(forKey: .quietHoursStart)
            case .some(let value): try c.encode(value, forKey: .quietHoursStart)
            }
        }
        if let quietHoursEnd {
            switch quietHoursEnd {
            case .none: try c.encodeNil(forKey: .quietHoursEnd)
            case .some(let value): try c.encode(value, forKey: .quietHoursEnd)
            }
        }
        if let tz { try c.encode(tz, forKey: .tz) }
    }

    private enum CodingKeys: String, CodingKey {
        case pushEnabled
        case dailyReminderEnabled
        case missADayEnabled
        case friendRequestNotificationsEnabled
        case failureReasonReminderEnabled
        case suppressDuringSession
        case dailyReminderTime
        case dailyReminderFrequency
        case quietHoursStart
        case quietHoursEnd
        case tz
    }
}

public struct FailureReasonDTO: Codable, Sendable, Equatable {
    public let id: String
    public let reasonDate: String
    public let text: String
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        reasonDate: String,
        text: String,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.reasonDate = reasonDate
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct FailureReasonLookupDTO: Codable, Sendable, Equatable {
    public let exists: Bool
    public let failureReason: FailureReasonDTO?

    public init(exists: Bool, failureReason: FailureReasonDTO?) {
        self.exists = exists
        self.failureReason = failureReason
    }
}

public struct FailureReasonResponse: Codable, Sendable {
    public let failureReason: FailureReasonDTO

    public init(failureReason: FailureReasonDTO) {
        self.failureReason = failureReason
    }
}

public struct SubmitFailureReasonRequest: Encodable, Sendable {
    public let reasonDate: String
    public let text: String

    public init(reasonDate: String, text: String) {
        self.reasonDate = reasonDate
        self.text = text
    }
}
