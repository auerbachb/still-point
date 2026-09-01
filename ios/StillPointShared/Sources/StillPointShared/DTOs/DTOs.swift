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
    /// #238: miss-a-day recovery ramp. All three are nil when not recovering.
    public let recoveryTargetDay: Int?
    public let recoveryCurrentStep: Int?
    public let recoveryTotalSteps: Int?
    /// #563: opt-in ambient sound level capture during solo sits. Decoded
    /// permissively so older server responses (pre-#563) default to off.
    public let ambientSoundEnabled: Bool

    public init(
        id: String,
        email: String,
        username: String,
        isPublic: Bool,
        currentDay: Int,
        aphorismsEnabled: Bool = false,
        attentionTrackingEnabled: Bool? = nil,
        dualTrackEnabled: Bool = false,
        secondTrackDay: Int = 1,
        recoveryTargetDay: Int? = nil,
        recoveryCurrentStep: Int? = nil,
        recoveryTotalSteps: Int? = nil,
        ambientSoundEnabled: Bool? = nil
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
        self.recoveryTargetDay = recoveryTargetDay
        self.recoveryCurrentStep = recoveryCurrentStep
        self.recoveryTotalSteps = recoveryTotalSteps
        self.ambientSoundEnabled = ambientSoundEnabled ?? false
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
        recoveryTargetDay = try c.decodeIfPresent(Int.self, forKey: .recoveryTargetDay)
        recoveryCurrentStep = try c.decodeIfPresent(Int.self, forKey: .recoveryCurrentStep)
        recoveryTotalSteps = try c.decodeIfPresent(Int.self, forKey: .recoveryTotalSteps)
        ambientSoundEnabled = try c.decodeIfPresent(Bool.self, forKey: .ambientSoundEnabled) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, username, isPublic, currentDay, aphorismsEnabled, attentionTrackingEnabled
        case dualTrackEnabled, secondTrackDay
        case recoveryTargetDay, recoveryCurrentStep, recoveryTotalSteps
        case ambientSoundEnabled
    }
}

extension UserDTO {
    /// Public so the app module can merge a single server-confirmed field into the
    /// local copy without adopting a whole response (#697): the settings ordering
    /// drops a superseded `UserDTO`, but an individual *monotonic* field it
    /// committed still has to land. Every other member of this type is already
    /// public; only this helper was not.
    public func updating(
        username: String? = nil,
        isPublic: Bool? = nil,
        aphorismsEnabled: Bool? = nil,
        attentionTrackingEnabled: Bool? = nil,
        dualTrackEnabled: Bool? = nil,
        secondTrackDay: Int? = nil,
        ambientSoundEnabled: Bool? = nil
    ) -> UserDTO {
        UserDTO(
            id: id,
            email: email,
            username: username ?? self.username,
            isPublic: isPublic ?? self.isPublic,
            currentDay: currentDay,
            aphorismsEnabled: aphorismsEnabled ?? self.aphorismsEnabled,
            attentionTrackingEnabled: attentionTrackingEnabled ?? self.attentionTrackingEnabled,
            dualTrackEnabled: dualTrackEnabled ?? self.dualTrackEnabled,
            secondTrackDay: secondTrackDay ?? self.secondTrackDay,
            recoveryTargetDay: recoveryTargetDay,
            recoveryCurrentStep: recoveryCurrentStep,
            recoveryTotalSteps: recoveryTotalSteps,
            ambientSoundEnabled: ambientSoundEnabled ?? self.ambientSoundEnabled
        )
    }

    func updatingProgression(_ state: DurationRecovery.ProgressionState) -> UserDTO {
        UserDTO(
            id: id,
            email: email,
            username: username,
            isPublic: isPublic,
            currentDay: state.currentDay,
            aphorismsEnabled: aphorismsEnabled,
            attentionTrackingEnabled: attentionTrackingEnabled,
            dualTrackEnabled: dualTrackEnabled,
            secondTrackDay: secondTrackDay,
            recoveryTargetDay: state.recoveryTargetDay,
            recoveryCurrentStep: state.recoveryCurrentStep,
            recoveryTotalSteps: state.recoveryTotalSteps,
            ambientSoundEnabled: ambientSoundEnabled
        )
    }

    func updatingRecovery(targetDay: Int, currentStep: Int, totalSteps: Int) -> UserDTO {
        UserDTO(
            id: id,
            email: email,
            username: username,
            isPublic: isPublic,
            currentDay: currentDay,
            aphorismsEnabled: aphorismsEnabled,
            attentionTrackingEnabled: attentionTrackingEnabled,
            dualTrackEnabled: dualTrackEnabled,
            secondTrackDay: secondTrackDay,
            recoveryTargetDay: targetDay,
            recoveryCurrentStep: currentStep,
            recoveryTotalSteps: totalSteps,
            ambientSoundEnabled: ambientSoundEnabled
        )
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
    /// #563: ambient sound level summary; nil when capture was off or mic was denied.
    public let ambientSoundSummary: AmbientSoundSummary?
    /// #521: post-session self-report ratings (1–10); nil until set via the PATCH endpoint.
    public let focusRating: Int?
    /// #521: post-session self-report ratings (1–10); nil until set via the PATCH endpoint.
    public let happinessRating: Int?
    /// #472 / #635: before/after mood matrix (1–5 per cell); nil until set via PATCH.
    public let moodMatrix: [String: MoodMatrixEntry]?

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
        track: Track? = nil,
        ambientSoundSummary: AmbientSoundSummary? = nil,
        focusRating: Int? = nil,
        happinessRating: Int? = nil,
        moodMatrix: [String: MoodMatrixEntry]? = nil
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
        self.ambientSoundSummary = ambientSoundSummary
        self.focusRating = focusRating
        self.happinessRating = happinessRating
        self.moodMatrix = moodMatrix
    }

    /// #612: decode defensively. Identity/structural fields stay strict — a row missing
    /// these is genuinely malformed — but every additive, newly-nullable, or enum field is
    /// tolerated (unknown `sessionType`/`track` raw values fall back rather than throwing),
    /// so one drifted or unexpected value never fails the whole history list. This mirrors
    /// the permissive decoders on `UserDTO`/`StatsDTO` and the web app's tolerant parsing.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        dayNumber = try c.decode(Int.self, forKey: .dayNumber)
        duration = try c.decode(Int.self, forKey: .duration)
        completed = try c.decode(Bool.self, forKey: .completed)
        clearPercent = try c.decode(Int.self, forKey: .clearPercent)
        thoughtCount = try c.decode(Int.self, forKey: .thoughtCount)
        sessionDate = try c.decode(String.self, forKey: .sessionDate)
        // Enums tolerate an unknown raw value (a future server case) by falling back rather
        // than throwing. The collection / nested-object fields (mindStateLog, attentionLog,
        // ambientSoundSummary) use `try?` too, so a malformed element or shape degrades to
        // nil instead of failing the whole history list (#612) — only the strict identity
        // fields above can fail a row. Absent/null keys default the same way throughout.
        sessionType = (try? c.decode(SessionType.self, forKey: .sessionType)) ?? .standard
        track = try? c.decode(Track.self, forKey: .track)
        bonusSeconds = try c.decodeIfPresent(Int.self, forKey: .bonusSeconds)
        actualTime = try c.decodeIfPresent(Int.self, forKey: .actualTime)
        mindStateLog = try? c.decode([MindStateEntry].self, forKey: .mindStateLog)
        attentionLog = try? c.decode([AttentionEntry].self, forKey: .attentionLog)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        buddySessionId = try c.decodeIfPresent(String.self, forKey: .buddySessionId)
        breathCount = try c.decodeIfPresent(Int.self, forKey: .breathCount)
        ambientSoundSummary = try? c.decode(AmbientSoundSummary.self, forKey: .ambientSoundSummary)
        focusRating = try c.decodeIfPresent(Int.self, forKey: .focusRating)
        happinessRating = try c.decodeIfPresent(Int.self, forKey: .happinessRating)
        moodMatrix = try? c.decode([String: MoodMatrixEntry].self, forKey: .moodMatrix)
    }

    private enum CodingKeys: String, CodingKey {
        case id, dayNumber, sessionType, duration, bonusSeconds, completed, actualTime
        case clearPercent, thoughtCount, mindStateLog, attentionLog, sessionDate
        case createdAt, buddySessionId, breathCount, track, ambientSoundSummary
        case focusRating, happinessRating, moodMatrix
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
    public let trailing4WeekDays: Int
    public let trailing4WeekDayPercent: Double
    public let trailing4WeekTotalTime: Int
    public let trailing4WeekTimePercent: Double
    public let totalTimeAllTime: Int
    public let progressTo10kHours: Double
    public let mindStateTrends: MindStateTrendStats

    public init(
        streak: Int,
        avgClearPercent: Int,
        avgThoughtsPerSession: Double,
        avgThoughtsPerMinute: Double,
        bonusMinutesTotal: Int? = nil,
        trailing4WeekDays: Int = 0,
        trailing4WeekDayPercent: Double = 0,
        trailing4WeekTotalTime: Int = 0,
        trailing4WeekTimePercent: Double = 0,
        totalTimeAllTime: Int = 0,
        progressTo10kHours: Double = 0,
        mindStateTrends: MindStateTrendStats = .empty
    ) {
        self.streak = streak
        self.avgClearPercent = avgClearPercent
        self.avgThoughtsPerSession = avgThoughtsPerSession
        self.avgThoughtsPerMinute = avgThoughtsPerMinute
        self.bonusMinutesTotal = bonusMinutesTotal
        self.trailing4WeekDays = trailing4WeekDays
        self.trailing4WeekDayPercent = trailing4WeekDayPercent
        self.trailing4WeekTotalTime = trailing4WeekTotalTime
        self.trailing4WeekTimePercent = trailing4WeekTimePercent
        self.totalTimeAllTime = totalTimeAllTime
        self.progressTo10kHours = progressTo10kHours
        self.mindStateTrends = mindStateTrends
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // #612: decoded permissively. A server-side NaN (e.g. avg over zero sessions)
        // serializes to JSON `null`, which a required `decode` would reject — failing the
        // whole Progress load. Default to 0; `enrich` recomputes period fields client-side.
        streak = try c.decodeIfPresent(Int.self, forKey: .streak) ?? 0
        avgClearPercent = try c.decodeIfPresent(Int.self, forKey: .avgClearPercent) ?? 0
        avgThoughtsPerSession = try c.decodeIfPresent(Double.self, forKey: .avgThoughtsPerSession) ?? 0
        avgThoughtsPerMinute = try c.decodeIfPresent(Double.self, forKey: .avgThoughtsPerMinute) ?? 0
        bonusMinutesTotal = try c.decodeIfPresent(Int.self, forKey: .bonusMinutesTotal)
        trailing4WeekDays = try c.decodeIfPresent(Int.self, forKey: .trailing4WeekDays) ?? 0
        trailing4WeekDayPercent = try c.decodeIfPresent(Double.self, forKey: .trailing4WeekDayPercent) ?? 0
        trailing4WeekTotalTime = try c.decodeIfPresent(Int.self, forKey: .trailing4WeekTotalTime) ?? 0
        trailing4WeekTimePercent = try c.decodeIfPresent(Double.self, forKey: .trailing4WeekTimePercent) ?? 0
        totalTimeAllTime = try c.decodeIfPresent(Int.self, forKey: .totalTimeAllTime) ?? 0
        progressTo10kHours = try c.decodeIfPresent(Double.self, forKey: .progressTo10kHours) ?? 0
        mindStateTrends = try c.decodeIfPresent(MindStateTrendStats.self, forKey: .mindStateTrends) ?? .empty
    }

    private enum CodingKeys: String, CodingKey {
        case streak, avgClearPercent, avgThoughtsPerSession, avgThoughtsPerMinute, bonusMinutesTotal
        case trailing4WeekDays, trailing4WeekDayPercent, trailing4WeekTotalTime, trailing4WeekTimePercent
        case totalTimeAllTime, progressTo10kHours, mindStateTrends
    }

    /// Fills period and mind-state trend fields client-side when the API omits them.
    public static func enrich(
        _ base: StatsDTO,
        sessions: [SessionDTO],
        todayIso: String
    ) -> StatsDTO {
        let hasSessions = !sessions.isEmpty
        let needsTrends = base.mindStateTrends == .empty && hasSessions
        let needsPeriodComputation = hasSessions && (
            base.trailing4WeekDays == 0
                || base.trailing4WeekTotalTime == 0
                || base.trailing4WeekDayPercent == 0
                || base.trailing4WeekTimePercent == 0
                || base.totalTimeAllTime == 0
                || base.progressTo10kHours == 0
        )
        let period = needsPeriodComputation
            ? HistoryStats.calculatePeriodStats(sessions: sessions, todayIso: todayIso)
            : nil
        let trends = needsTrends
            ? HistoryMindStateTrends.calculateTrendStats(sessions: sessions, todayIso: todayIso)
            : nil

        func pickInt(_ baseValue: Int, _ computed: Int?) -> Int {
            guard baseValue == 0, let computed else { return baseValue }
            return computed
        }

        func pickDouble(_ baseValue: Double, _ computed: Double?) -> Double {
            guard baseValue == 0, let computed else { return baseValue }
            return computed
        }

        return StatsDTO(
            streak: base.streak,
            avgClearPercent: base.avgClearPercent,
            avgThoughtsPerSession: base.avgThoughtsPerSession,
            avgThoughtsPerMinute: base.avgThoughtsPerMinute,
            bonusMinutesTotal: base.bonusMinutesTotal,
            trailing4WeekDays: pickInt(base.trailing4WeekDays, period?.trailing4WeekDays),
            trailing4WeekDayPercent: pickDouble(base.trailing4WeekDayPercent, period?.trailing4WeekDayPercent),
            trailing4WeekTotalTime: pickInt(base.trailing4WeekTotalTime, period?.trailing4WeekTotalTime),
            trailing4WeekTimePercent: pickDouble(base.trailing4WeekTimePercent, period?.trailing4WeekTimePercent),
            totalTimeAllTime: pickInt(base.totalTimeAllTime, period?.totalTimeAllTime),
            progressTo10kHours: pickDouble(base.progressTo10kHours, period?.progressTo10kHours),
            mindStateTrends: needsTrends ? trends! : base.mindStateTrends
        )
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
    /// #557: client-generated UUID for offline idempotent create; omitted for web.
    public let clientSessionId: UUID?
    /// #563: ambient sound level summary; omitted when capture was off or mic was denied.
    public let ambientSoundSummary: AmbientSoundSummary?

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
        track: Track = .primary,
        clientSessionId: UUID? = nil,
        ambientSoundSummary: AmbientSoundSummary? = nil
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
        self.clientSessionId = clientSessionId
        self.ambientSoundSummary = ambientSoundSummary
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

/// #521: nil-omitting patch for `PATCH /api/sessions/by-session/{sessionId}`.
/// Mirrors the web's touched-field payload: only include a rating if it was
/// explicitly set; omit nil fields so the server's partial-update logic is
/// used correctly and no unintended default overwrites occur.
public struct SessionRatingsPatch: Encodable, Sendable {
    public let focusRating: Int?
    public let happinessRating: Int?

    public init(focusRating: Int? = nil, happinessRating: Int? = nil) {
        self.focusRating = focusRating
        self.happinessRating = happinessRating
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let focusRating { try c.encode(focusRating, forKey: .focusRating) }
        if let happinessRating { try c.encode(happinessRating, forKey: .happinessRating) }
    }

    private enum CodingKeys: String, CodingKey {
        case focusRating
        case happinessRating
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

/// Reports whether a sit is running so the server withholds this user's pushes
/// for the duration (#709).
public struct SessionNotificationStateRequest: Codable, Sendable {
    public let active: Bool

    public init(active: Bool) {
        self.active = active
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
    /// Opt-in (#599): outbound missed-sit voice call via Vapi.
    public let callOptIn: Bool
    public let callPhoneNumber: String?
    public let callConsentAt: String?
    public let callWindowStart: String?
    public let callWindowStop: String?
    public let tz: String
    public let updatedAt: String?

    public init(
        pushEnabled: Bool,
        dailyReminderEnabled: Bool,
        missADayEnabled: Bool,
        friendRequestNotificationsEnabled: Bool = true,
        failureReasonReminderEnabled: Bool = false,
        suppressDuringSession: Bool = true,
        dailyReminderTime: String,
        dailyReminderFrequency: DailyReminderFrequency,
        quietHoursStart: String?,
        quietHoursEnd: String?,
        callOptIn: Bool = false,
        callPhoneNumber: String? = nil,
        callConsentAt: String? = nil,
        callWindowStart: String? = nil,
        callWindowStop: String? = nil,
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
        self.callOptIn = callOptIn
        self.callPhoneNumber = callPhoneNumber
        self.callConsentAt = callConsentAt
        self.callWindowStart = callWindowStart
        self.callWindowStop = callWindowStop
        self.tz = tz
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pushEnabled = try c.decode(Bool.self, forKey: .pushEnabled)
        dailyReminderEnabled = try c.decode(Bool.self, forKey: .dailyReminderEnabled)
        missADayEnabled = try c.decode(Bool.self, forKey: .missADayEnabled)
        friendRequestNotificationsEnabled =
            try c.decodeIfPresent(Bool.self, forKey: .friendRequestNotificationsEnabled) ?? true
        failureReasonReminderEnabled =
            try c.decodeIfPresent(Bool.self, forKey: .failureReasonReminderEnabled) ?? false
        // On by default (#709): a server that omits the field must not read as
        // "notifications allowed during sits".
        suppressDuringSession = try c.decodeIfPresent(Bool.self, forKey: .suppressDuringSession) ?? true
        dailyReminderTime = try c.decode(String.self, forKey: .dailyReminderTime)
        dailyReminderFrequency = try c.decode(DailyReminderFrequency.self, forKey: .dailyReminderFrequency)
        quietHoursStart = try c.decodeIfPresent(String.self, forKey: .quietHoursStart)
        quietHoursEnd = try c.decodeIfPresent(String.self, forKey: .quietHoursEnd)
        callOptIn = try c.decodeIfPresent(Bool.self, forKey: .callOptIn) ?? false
        callPhoneNumber = try c.decodeIfPresent(String.self, forKey: .callPhoneNumber)
        callConsentAt = try c.decodeIfPresent(String.self, forKey: .callConsentAt)
        callWindowStart = try c.decodeIfPresent(String.self, forKey: .callWindowStart)
        callWindowStop = try c.decodeIfPresent(String.self, forKey: .callWindowStop)
        tz = try c.decode(String.self, forKey: .tz)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
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
        case callOptIn
        case callPhoneNumber
        case callConsentAt
        case callWindowStart
        case callWindowStop
        case tz
        case updatedAt
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
    public var callOptIn: Bool?
    public var callPhoneNumber: String??
    public var callWindowStart: String??
    public var callWindowStop: String??
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
        callOptIn: Bool? = nil,
        callPhoneNumber: String?? = nil,
        callWindowStart: String?? = nil,
        callWindowStop: String?? = nil,
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
        self.callOptIn = callOptIn
        self.callPhoneNumber = callPhoneNumber
        self.callWindowStart = callWindowStart
        self.callWindowStop = callWindowStop
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
        if let callOptIn { try c.encode(callOptIn, forKey: .callOptIn) }
        if let callPhoneNumber {
            switch callPhoneNumber {
            case .none: try c.encodeNil(forKey: .callPhoneNumber)
            case .some(let value): try c.encode(value, forKey: .callPhoneNumber)
            }
        }
        if let callWindowStart {
            switch callWindowStart {
            case .none: try c.encodeNil(forKey: .callWindowStart)
            case .some(let value): try c.encode(value, forKey: .callWindowStart)
            }
        }
        if let callWindowStop {
            switch callWindowStop {
            case .none: try c.encodeNil(forKey: .callWindowStop)
            case .some(let value): try c.encode(value, forKey: .callWindowStop)
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
        case callOptIn
        case callPhoneNumber
        case callWindowStart
        case callWindowStop
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
