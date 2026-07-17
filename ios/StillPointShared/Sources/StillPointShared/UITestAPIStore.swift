import Foundation

/// UI-test infrastructure extracted out of `APIClient` (issue #416).
///
/// When the app launches with `SP_UI_TEST_MODE` set, `APIClient` builds one of
/// these actors and delegates every request to it instead of hitting the
/// network. It owns the in-memory + `UserDefaults`-persisted fake backend
/// (`UITestStore`) plus the launch config (`UITestConfig`).
///
/// The actor deliberately does NOT touch the `URLSession`, cookies, keychain
/// token, or `URLCredentialStorage` — those are owned by `APIClient`. Instead,
/// `logout()`/`deleteAccount()` return a flag telling the client whether to run
/// its own `clearLocalSessionArtifacts()`, and `resetStore` lets the client
/// clear those artifacts during init.
actor UITestAPIStore {
    private let config: UITestConfig
    private var store: UITestStore
    private var notificationPreferences: NotificationPreferencesDTO
    private let defaultsKey: String

    private static let maxFailureReasonLength = 1000

    /// Whether launch requested a full reset. `APIClient` reads this
    /// synchronously during init so it can also clear the session artifacts it
    /// owns (auth token, cookies, URL credentials).
    nonisolated let resetStore: Bool

    private init(config: UITestConfig, store: UITestStore, defaultsKey: String) {
        self.config = config
        self.store = store
        self.defaultsKey = defaultsKey
        self.resetStore = config.resetStore
        self.notificationPreferences = NotificationPreferencesDTO(
            pushEnabled: false,
            dailyReminderEnabled: false,
            missADayEnabled: false,
            friendRequestNotificationsEnabled: true,
            failureReasonReminderEnabled: false,
            suppressDuringSession: false,
            dailyReminderTime: "09:00",
            dailyReminderFrequency: .daily,
            quietHoursStart: nil,
            quietHoursEnd: nil,
            tz: TimeZone.current.identifier
        )
    }

    /// Builds the store from `SP_UI_TEST_*` env vars, or returns `nil` when the
    /// app is not running in UI-test mode. Emits the same `[E2E-DIAG]` lines the
    /// original `APIClient.init` did so CI xcresult logs are unchanged.
    static func fromProcessInfo(defaultsKey: String = "StillPoint.UITest.Store") -> UITestAPIStore? {
        guard let config = UITestConfig.fromProcessInfo() else {
            APIClient.diagLog.notice("[E2E-DIAG] APIClient.init uiTestMode=NO")
            return nil
        }

        let defaults = UserDefaults.standard
        if config.resetStore {
            // Wipe ALL persisted state, not just the UI-test store. State that
            // bled across tests previously: Keychain auth tokens, cookies, URL
            // credentials, AudioEngine sound prefs. Issue #266 surfaced this
            // when the runner script started actually running tests after the
            // silent-skip fix from issue #253.
            // Note: the SwiftData store is wiped earlier in
            // `StillPointApp.init()`, before `.modelContainer(...)` opens
            // its SQLite files (issue #276). The offline write queue (#557)
            // is stored separately and cleared here on UI-test reset.
            OfflineSessionQueue.removePersistedQueue()
            defaults.removeObject(forKey: defaultsKey)
            AudioEngine.resetPersistedPrefs()
            SessionIntroPrefs.resetPersistedPrefs()
            // Flush the in-memory cache to cfprefsd so the immediately
            // following read sees the cleared state. Issue #266 follow-up.
            defaults.synchronize()
        }

        let resolvedStore: UITestStore
        if config.snapshotSeed {
            resolvedStore = UITestStore.makeSnapshot(seedAuthenticated: config.seedAuthenticated)
            persist(store: resolvedStore, key: defaultsKey)
        } else if let persistedData = defaults.data(forKey: defaultsKey),
                  let persistedStore = try? JSONDecoder().decode(UITestStore.self, from: persistedData) {
            resolvedStore = persistedStore
        } else {
            resolvedStore = UITestStore.makeDefault(seedAuthenticated: config.seedAuthenticated)
            persist(store: resolvedStore, key: defaultsKey)
        }

        // Diagnostic for issue #266 / #276. Use os_log so the line lands
        // in the xcresult bundle — `print()` from the app process is not
        // captured by Xcode UI test runs, which is why the prior
        // [E2E-DIAG] prints from PR #261 never showed up in CI logs.
        APIClient.diagLog.notice("[E2E-DIAG] APIClient.init uiTestMode=YES seedAuth=\(config.seedAuthenticated, privacy: .public) resetStore=\(config.resetStore, privacy: .public) forceOffline=\(config.forceLaunchOffline, privacy: .public) forceTokenExpired=\(config.forceTokenExpired, privacy: .public) finalIsAuthenticated=\(resolvedStore.isAuthenticated, privacy: .public)")

        return UITestAPIStore(config: config, store: resolvedStore, defaultsKey: defaultsKey)
    }

    // MARK: - Auth

    func signup(email: String, username: String, password: String) -> UserDTO {
        store.user = UserDTO(
            id: store.user.id,
            email: email,
            username: username,
            isPublic: store.user.isPublic,
            currentDay: 1,
            aphorismsEnabled: false
        )
        store.loginEmail = email
        store.loginPassword = password
        store.isAuthenticated = true
        persist()
        return store.user
    }

    func login(email: String, password: String) throws -> UserDTO {
        guard email.lowercased() == store.loginEmail.lowercased(),
              password == store.loginPassword else {
            throw APIError(status: 401, message: "Invalid email or password")
        }

        store.isAuthenticated = true
        persist()
        return store.user
    }

    func signInWithApple() throws -> UserDTO {
        throw APIError(status: 0, message: "Apple sign-in is not available in UI test mode")
    }

    func signInWithGoogle() throws -> UserDTO {
        throw APIError(status: 0, message: "Google sign-in is not available in UI test mode")
    }

    func requestPasswordReset(email: String) throws -> String {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw APIError(status: 400, message: "Email required")
        }
        return "If an account exists for that email, a reset link will arrive shortly."
    }

    /// Returns `true` when `APIClient` should also clear its local session artifacts.
    func logout() -> Bool {
        store.isAuthenticated = false
        persist()
        return true
    }

    /// Returns `true` when `APIClient` should also clear its local session artifacts.
    func deleteAccount() -> Bool {
        store.isAuthenticated = false
        store.sessions = []
        store.thoughts = []
        store.failureReasons = [:]
        persist()
        return true
    }

    func me() throws -> UserDTO? {
        if config.forceLaunchOffline {
            throw APIError(status: 0, message: "No internet connection")
        }

        if config.forceTokenExpired {
            if store.isAuthenticated {
                store.isAuthenticated = false
                persist()
            }
            throw APIError(
                status: 401,
                message: "Session expired. Please log in again.",
                code: "TOKEN_EXPIRED"
            )
        }

        return store.isAuthenticated ? store.user : nil
    }

    // MARK: - Device Tokens

    func registerDeviceToken(_ request: DeviceTokenRegistrationRequest) -> DeviceTokenResponse.RegisteredDeviceToken {
        DeviceTokenResponse.RegisteredDeviceToken(
            id: "ui-device-token",
            platform: request.platform,
            apnsEnvironment: request.apnsEnvironment
        )
    }

    // MARK: - Sessions

    func getSessions(today: String? = nil) throws -> (sessions: [SessionDTO], stats: StatsDTO) {
        try ensureAuthenticated()

        if config.forceSessionsFailure {
            throw APIError(status: 503, message: "Failed to load sessions. Check your connection.")
        }

        let sortedSessions = store.sessions.sorted { $0.sessionDate < $1.sessionDate }
        let todayIso: String
        if let today, !today.isEmpty {
            todayIso = today
        } else {
            todayIso = localTodayIsoDate()
        }
        let base = SessionStatistics.calculateStats(for: sortedSessions)
        let period = HistoryStats.calculatePeriodStats(sessions: sortedSessions, todayIso: todayIso)
        let trends = HistoryMindStateTrends.calculateTrendStats(sessions: sortedSessions, todayIso: todayIso)
        let stats = StatsDTO(
            streak: base.streak,
            avgClearPercent: base.avgClearPercent,
            avgThoughtsPerSession: base.avgThoughtsPerSession,
            avgThoughtsPerMinute: base.avgThoughtsPerMinute,
            bonusMinutesTotal: base.bonusMinutesTotal,
            trailing4WeekDays: period.trailing4WeekDays,
            trailing4WeekDayPercent: period.trailing4WeekDayPercent,
            trailing4WeekTotalTime: period.trailing4WeekTotalTime,
            trailing4WeekTimePercent: period.trailing4WeekTimePercent,
            totalTimeAllTime: period.totalTimeAllTime,
            progressTo10kHours: period.progressTo10kHours,
            mindStateTrends: trends
        )
        return (sortedSessions, stats)
    }

    private func localTodayIsoDate() -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.locale = Locale(identifier: "en_US_POSIX")
        df.calendar = Calendar(identifier: .gregorian)
        return df.string(from: Date())
    }

    func getTracksDoneToday(date: String) throws -> TracksDoneTodayDTO {
        try ensureAuthenticated()

        if config.forceSessionsFailure {
            throw APIError(status: 503, message: "Failed to load sessions. Check your connection.")
        }

        var primary = false
        var second = false
        for session in store.sessions where session.completed
            && session.sessionType == .standard
            && session.sessionDate == date {
            if session.track == .second {
                second = true
            } else {
                primary = true
            }
        }
        return TracksDoneTodayDTO(primary: primary, second: second)
    }

    func createSession(_ data: CreateSessionRequest) throws -> SessionDTO {
        try ensureAuthenticated()

        if let clientSessionId = data.clientSessionId?.uuidString,
           let existing = store.sessions.first(where: { $0.id == clientSessionId }) {
            return existing
        }

        let nextOrdinal = store.nextSessionOrdinal
        let sessionId = data.clientSessionId?.uuidString ?? "ui-session-\(nextOrdinal)"
        let session = SessionDTO(
            id: sessionId,
            dayNumber: data.dayNumber,
            sessionType: data.sessionType,
            duration: data.duration,
            bonusSeconds: data.bonusSeconds == 0 ? nil : data.bonusSeconds,
            completed: data.completed,
            actualTime: data.actualTime,
            clearPercent: data.clearPercent,
            thoughtCount: data.thoughtCount,
            mindStateLog: data.mindStateLog,
            attentionLog: data.attentionLog,
            sessionDate: data.sessionDate,
            createdAt: nil,
            buddySessionId: nil,
            track: data.track
        )
        store.nextSessionOrdinal += 1
        store.sessions.append(session)

        if data.completed && data.sessionType == .standard {
            // #240: a `second`-track sit advances the second-track counter (only when
            // opted in); a `primary` sit advances currentDay as before.
            if data.track == .second {
                let nextSecond = store.user.dualTrackEnabled
                    ? StillPoint.advanceSecondTrackDay(sessionType: data.sessionType, completed: data.completed, secondTrackDay: store.user.secondTrackDay)
                    : store.user.secondTrackDay
                store.user = UserDTO(
                    id: store.user.id,
                    email: store.user.email,
                    username: store.user.username,
                    isPublic: store.user.isPublic,
                    currentDay: store.user.currentDay,
                    aphorismsEnabled: store.user.aphorismsEnabled,
                    attentionTrackingEnabled: store.user.attentionTrackingEnabled,
                    dualTrackEnabled: store.user.dualTrackEnabled,
                    secondTrackDay: nextSecond
                )
            } else {
                store.user = UserDTO(
                    id: store.user.id,
                    email: store.user.email,
                    username: store.user.username,
                    isPublic: store.user.isPublic,
                    currentDay: max(store.user.currentDay, data.dayNumber + 1),
                    aphorismsEnabled: store.user.aphorismsEnabled,
                    attentionTrackingEnabled: store.user.attentionTrackingEnabled,
                    dualTrackEnabled: store.user.dualTrackEnabled,
                    secondTrackDay: store.user.secondTrackDay
                )
            }
        }

        persist()
        return session
    }

    /// #240: opt into the dual-track fork (enable a second daily track).
    func enableDualTrack() throws -> UserDTO {
        try ensureAuthenticated()
        store.user = UserDTO(
            id: store.user.id,
            email: store.user.email,
            username: store.user.username,
            isPublic: store.user.isPublic,
            currentDay: store.user.currentDay,
            aphorismsEnabled: store.user.aphorismsEnabled,
            attentionTrackingEnabled: store.user.attentionTrackingEnabled,
            dualTrackEnabled: true,
            secondTrackDay: store.user.secondTrackDay
        )
        persist()
        return store.user
    }

    func getSession(sessionId: String) throws -> (session: SessionDTO, thoughts: [ThoughtDTO]) {
        try ensureAuthenticated()

        guard let session = store.sessions.first(where: { $0.id == sessionId }) else {
            throw APIError(status: 404, message: "Session not found")
        }

        let thoughts = store.thoughts.filter { $0.sessionId == session.id }
            .sorted { $0.timeInSession < $1.timeInSession }
        return (session, thoughts)
    }

    // MARK: - Thoughts

    func getThoughts() throws -> [ThoughtDTO] {
        try ensureAuthenticated()
        return store.thoughts
            .sorted {
                if $0.dayNumber == $1.dayNumber {
                    return $0.timeInSession < $1.timeInSession
                }
                return $0.dayNumber > $1.dayNumber
            }
    }

    func batchThoughts(_ data: BatchThoughtsRequest) throws -> [ThoughtDTO] {
        try ensureAuthenticated()

        let createdThoughts = data.thoughts.map { input -> ThoughtDTO in
            let thought = ThoughtDTO(
                id: "ui-thought-\(store.nextThoughtOrdinal)",
                sessionId: data.sessionId,
                dayNumber: data.dayNumber,
                timeInSession: input.timeInSession,
                text: input.text
            )
            store.nextThoughtOrdinal += 1
            return thought
        }
        store.thoughts.append(contentsOf: createdThoughts)
        persist()
        return createdThoughts
    }

    // MARK: - Board

    /// Board data in UI test mode: empty unless snapshot seed is enabled (marketing screenshots).
    func getBoard() -> [BoardEntryDTO] {
        guard config.snapshotSeed else { return [] }
        guard store.isAuthenticated else { return [] }
        let me = store.user.username
        return [
            BoardEntryDTO(username: "quietledger", currentDay: 24, streak: 18, avgClear: 84, totalSessions: 52),
            BoardEntryDTO(username: me, currentDay: store.user.currentDay, streak: 6, avgClear: 77, totalSessions: 22),
            BoardEntryDTO(username: "morningstill", currentDay: 11, streak: 9, avgClear: 71, totalSessions: 30),
            BoardEntryDTO(username: "deepamber", currentDay: 9, streak: 4, avgClear: 68, totalSessions: 17),
        ]
    }

    // MARK: - Settings

    func updateSettings(
        isPublic: Bool?,
        username: String?,
        aphorismsEnabled: Bool?,
        attentionTrackingEnabled: Bool?
    ) throws -> UserDTO {
        try ensureAuthenticated()

        var nextUsername = store.user.username
        var nextIsPublic = store.user.isPublic
        var nextAphorismsEnabled = store.user.aphorismsEnabled
        var nextAttentionTrackingEnabled = store.user.attentionTrackingEnabled

        if let username {
            let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
            if config.forceUsernameConflict {
                throw APIError(status: 409, message: "Username already taken")
            }
            guard UsernameValidation.isValid(trimmed) else {
                throw APIError(status: 400, message: UsernameValidation.errorMessage)
            }
            nextUsername = trimmed
        }

        if let isPublic {
            nextIsPublic = isPublic
        }

        if let aphorismsEnabled {
            nextAphorismsEnabled = aphorismsEnabled
        }

        if let attentionTrackingEnabled {
            nextAttentionTrackingEnabled = attentionTrackingEnabled
        }

        store.user = UserDTO(
            id: store.user.id,
            email: store.user.email,
            username: nextUsername,
            isPublic: nextIsPublic,
            currentDay: store.user.currentDay,
            aphorismsEnabled: nextAphorismsEnabled,
            attentionTrackingEnabled: nextAttentionTrackingEnabled,
            dualTrackEnabled: store.user.dualTrackEnabled,
            secondTrackDay: store.user.secondTrackDay
        )
        persist()
        return store.user
    }

    // MARK: - Notification preferences

    func getNotificationPreferences() -> NotificationPreferencesDTO {
        notificationPreferences
    }

    func updateNotificationPreferences(_ patch: NotificationPreferencesPatch) throws -> NotificationPreferencesDTO {
        try ensureAuthenticated()

        let current = notificationPreferences
        var quietStart = current.quietHoursStart
        var quietEnd = current.quietHoursEnd
        if let quietHoursStart = patch.quietHoursStart {
            switch quietHoursStart {
            case .none: quietStart = nil
            case .some(let value): quietStart = value
            }
        }
        if let quietHoursEnd = patch.quietHoursEnd {
            switch quietHoursEnd {
            case .none: quietEnd = nil
            case .some(let value): quietEnd = value
            }
        }

        let next = NotificationPreferencesDTO(
            pushEnabled: patch.pushEnabled ?? current.pushEnabled,
            dailyReminderEnabled: patch.dailyReminderEnabled ?? current.dailyReminderEnabled,
            missADayEnabled: patch.missADayEnabled ?? current.missADayEnabled,
            friendRequestNotificationsEnabled: patch.friendRequestNotificationsEnabled ?? current.friendRequestNotificationsEnabled,
            failureReasonReminderEnabled: patch.failureReasonReminderEnabled ?? current.failureReasonReminderEnabled,
            suppressDuringSession: patch.suppressDuringSession ?? current.suppressDuringSession,
            dailyReminderTime: patch.dailyReminderTime ?? current.dailyReminderTime,
            dailyReminderFrequency: patch.dailyReminderFrequency ?? current.dailyReminderFrequency,
            quietHoursStart: quietStart,
            quietHoursEnd: quietEnd,
            tz: patch.tz ?? current.tz,
            updatedAt: current.updatedAt
        )

        notificationPreferences = next
        return next
    }

    // MARK: - Failure reasons

    func getFailureReason(date: String) throws -> FailureReasonLookupDTO {
        try ensureAuthenticated()
        guard SessionCalendar.isValidSessionCalendarDate(date) else {
            throw APIError(status: 400, message: "date must be YYYY-MM-DD", code: "VALIDATION_ERROR")
        }
        if let row = store.failureReasons[date] {
            return FailureReasonLookupDTO(exists: true, failureReason: row)
        }
        return FailureReasonLookupDTO(exists: false, failureReason: nil)
    }

    func submitFailureReason(_ request: SubmitFailureReasonRequest) throws -> FailureReasonDTO {
        try ensureAuthenticated()
        guard SessionCalendar.isValidSessionCalendarDate(request.reasonDate) else {
            throw APIError(status: 400, message: "reasonDate must be YYYY-MM-DD", code: "VALIDATION_ERROR")
        }
        let maxAllowedDate = WidgetDataStore.localDayString(Date())
        guard request.reasonDate <= maxAllowedDate else {
            throw APIError(status: 400, message: "reasonDate cannot be in the future", code: "VALIDATION_ERROR")
        }

        let trimmed = request.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw APIError(status: 400, message: "text must not be empty", code: "VALIDATION_ERROR")
        }
        guard trimmed.count <= Self.maxFailureReasonLength else {
            throw APIError(
                status: 400,
                message: "text must be at most \(Self.maxFailureReasonLength) characters",
                code: "VALIDATION_ERROR"
            )
        }

        let now = ISO8601DateFormatter().string(from: Date())
        if let existing = store.failureReasons[request.reasonDate] {
            let updated = FailureReasonDTO(
                id: existing.id,
                reasonDate: existing.reasonDate,
                text: trimmed,
                createdAt: existing.createdAt,
                updatedAt: now
            )
            store.failureReasons[request.reasonDate] = updated
            persist()
            return updated
        }

        let created = FailureReasonDTO(
            id: "ui-failure-reason-\(store.failureReasons.count + 1)",
            reasonDate: request.reasonDate,
            text: trimmed,
            createdAt: now,
            updatedAt: now
        )
        store.failureReasons[request.reasonDate] = created
        persist()
        return created
    }

    // MARK: - Helpers

    private func ensureAuthenticated() throws {
        guard store.isAuthenticated else {
            throw APIError(status: 401, message: "Please log in", code: "UNAUTHORIZED")
        }
    }

    private func persist() {
        Self.persist(store: store, key: defaultsKey)
    }

    private static func persist(store: UITestStore, key: String) {
        guard let encoded = try? JSONEncoder().encode(store) else { return }
        UserDefaults.standard.set(encoded, forKey: key)
    }

    private static func utcTodayIsoDate() -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }
}

// MARK: - Launch config

private struct UITestConfig: Sendable {
    let seedAuthenticated: Bool
    let resetStore: Bool
    let forceLaunchOffline: Bool
    let forceTokenExpired: Bool
    let forceSessionsFailure: Bool
    let forceUsernameConflict: Bool
    /// Deterministic marketing/scenario data for Fastlane snapshot runs (Issue #325).
    let snapshotSeed: Bool

    static func fromProcessInfo() -> UITestConfig? {
        let env = ProcessInfo.processInfo.environment
        guard truthy(env["SP_UI_TEST_MODE"]) else { return nil }
        return UITestConfig(
            seedAuthenticated: truthy(env["SP_UI_TEST_SEED_AUTH"]),
            resetStore: truthy(env["SP_UI_TEST_RESET_STORE"]),
            forceLaunchOffline: truthy(env["SP_UI_TEST_FORCE_LAUNCH_OFFLINE"]),
            forceTokenExpired: truthy(env["SP_UI_TEST_FORCE_TOKEN_EXPIRED"]),
            forceSessionsFailure: truthy(env["SP_UI_TEST_FORCE_SESSIONS_FAILURE"]),
            forceUsernameConflict: truthy(env["SP_UI_TEST_FORCE_USERNAME_CONFLICT"]),
            snapshotSeed: truthy(env["SP_UI_TEST_SNAPSHOT_SEED"])
        )
    }

    private static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }
}

// MARK: - Persisted store

private struct UITestStore: Codable, Sendable {
    var user: UserDTO
    var loginEmail: String
    var loginPassword: String
    var isAuthenticated: Bool
    var sessions: [SessionDTO]
    var thoughts: [ThoughtDTO]
    var failureReasons: [String: FailureReasonDTO]
    var nextSessionOrdinal: Int
    var nextThoughtOrdinal: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        user = try container.decode(UserDTO.self, forKey: .user)
        loginEmail = try container.decode(String.self, forKey: .loginEmail)
        loginPassword = try container.decode(String.self, forKey: .loginPassword)
        isAuthenticated = try container.decode(Bool.self, forKey: .isAuthenticated)
        sessions = try container.decode([SessionDTO].self, forKey: .sessions)
        thoughts = try container.decode([ThoughtDTO].self, forKey: .thoughts)
        failureReasons =
            try container.decodeIfPresent([String: FailureReasonDTO].self, forKey: .failureReasons) ?? [:]
        nextSessionOrdinal = try container.decode(Int.self, forKey: .nextSessionOrdinal)
        nextThoughtOrdinal = try container.decode(Int.self, forKey: .nextThoughtOrdinal)
    }

    init(
        user: UserDTO,
        loginEmail: String,
        loginPassword: String,
        isAuthenticated: Bool,
        sessions: [SessionDTO],
        thoughts: [ThoughtDTO],
        failureReasons: [String: FailureReasonDTO],
        nextSessionOrdinal: Int,
        nextThoughtOrdinal: Int
    ) {
        self.user = user
        self.loginEmail = loginEmail
        self.loginPassword = loginPassword
        self.isAuthenticated = isAuthenticated
        self.sessions = sessions
        self.thoughts = thoughts
        self.failureReasons = failureReasons
        self.nextSessionOrdinal = nextSessionOrdinal
        self.nextThoughtOrdinal = nextThoughtOrdinal
    }

    static func makeDefault(seedAuthenticated: Bool) -> UITestStore {
        let fixtureUser = UserDTO(
            id: "ui-user-1",
            email: "ios.fixture@stillpoint.test",
            username: "ios_fixture",
            isPublic: false,
            currentDay: 1
        )
        return UITestStore(
            user: fixtureUser,
            loginEmail: fixtureUser.email,
            loginPassword: "stillpoint-pass",
            isAuthenticated: seedAuthenticated,
            sessions: [],
            thoughts: [],
            failureReasons: [:],
            nextSessionOrdinal: 1,
            nextThoughtOrdinal: 1
        )
    }

    /// Rich canned history, journal rows, and board-relevant profile for Fastlane screenshots.
    static func makeSnapshot(seedAuthenticated: Bool) -> UITestStore {
        let fixtureUser = UserDTO(
            id: "snapshot-user-1",
            email: "snapshot@stillpoint.test",
            username: "still_snapshot",
            isPublic: true,
            currentDay: 9,
            aphorismsEnabled: true
        )

        let sessions: [SessionDTO] = [
            SessionDTO(
                id: "snap-sess-1",
                dayNumber: 4,
                sessionType: .standard,
                duration: 120,
                bonusSeconds: 60,
                completed: true,
                actualTime: 125,
                clearPercent: 74,
                thoughtCount: 2,
                mindStateLog: [],
                sessionDate: "2026-01-05",
                createdAt: "2026-01-05T08:30:00Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "snap-sess-2",
                dayNumber: 4,
                sessionType: .standard,
                duration: 120,
                bonusSeconds: nil,
                completed: true,
                actualTime: 118,
                clearPercent: 81,
                thoughtCount: 1,
                mindStateLog: [],
                sessionDate: "2026-01-05",
                createdAt: "2026-01-05T19:15:00Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "snap-sess-3",
                dayNumber: 5,
                sessionType: .standard,
                duration: 130,
                bonusSeconds: 300,
                completed: true,
                actualTime: 400,
                clearPercent: 69,
                thoughtCount: 4,
                mindStateLog: [],
                sessionDate: "2026-01-06",
                createdAt: "2026-01-06T07:00:00Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "snap-sess-4",
                dayNumber: 6,
                sessionType: .standard,
                duration: 140,
                bonusSeconds: nil,
                completed: true,
                actualTime: 140,
                clearPercent: 88,
                thoughtCount: 0,
                mindStateLog: [],
                sessionDate: "2026-01-07",
                createdAt: "2026-01-07T12:20:00Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "snap-sess-5",
                dayNumber: 7,
                sessionType: .standard,
                duration: 150,
                bonusSeconds: nil,
                completed: true,
                actualTime: 150,
                clearPercent: 72,
                thoughtCount: 3,
                mindStateLog: [],
                sessionDate: "2026-01-08",
                createdAt: "2026-01-08T06:45:00Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "snap-sess-6",
                dayNumber: 8,
                sessionType: .standard,
                duration: 160,
                bonusSeconds: 120,
                completed: true,
                actualTime: 265,
                clearPercent: 79,
                thoughtCount: 2,
                mindStateLog: [],
                sessionDate: "2026-01-09",
                createdAt: "2026-01-09T21:05:00Z",
                buddySessionId: nil
            ),
            SessionDTO(
                id: "snap-quick-1",
                dayNumber: 8,
                sessionType: .quick,
                duration: StillPoint.quickDuration,
                bonusSeconds: nil,
                completed: true,
                actualTime: StillPoint.quickDuration,
                clearPercent: 62,
                thoughtCount: 1,
                mindStateLog: [],
                sessionDate: "2026-01-09",
                createdAt: "2026-01-09T08:10:00Z",
                buddySessionId: nil
            ),
        ]

        let thoughts: [ThoughtDTO] = [
            ThoughtDTO(id: "snap-th-1", sessionId: "snap-sess-1", dayNumber: 4, timeInSession: 42, text: "Planning the week instead of watching the timer."),
            ThoughtDTO(id: "snap-th-2", sessionId: "snap-sess-1", dayNumber: 4, timeInSession: 96, text: "Sound of traffic — came back to the breath."),
            ThoughtDTO(id: "snap-th-3", sessionId: "snap-sess-3", dayNumber: 5, timeInSession: 55, text: "Should I adjust tomorrow's sit length?"),
            ThoughtDTO(id: "snap-th-4", sessionId: "snap-sess-3", dayNumber: 5, timeInSession: 200, text: "Lost thread for a moment; noticed and returned."),
            ThoughtDTO(id: "snap-th-5", sessionId: "snap-sess-5", dayNumber: 7, timeInSession: 22, text: "Flash of an old conversation."),
            ThoughtDTO(id: "snap-th-6", sessionId: "snap-sess-6", dayNumber: 8, timeInSession: 140, text: "Room felt quieter toward the end."),
            ThoughtDTO(id: "snap-th-7", sessionId: "snap-quick-1", dayNumber: 8, timeInSession: 12, text: "Quick reset between meetings."),
        ]

        return UITestStore(
            user: fixtureUser,
            loginEmail: fixtureUser.email,
            loginPassword: "snapshot-pass",
            isAuthenticated: seedAuthenticated,
            sessions: sessions,
            thoughts: thoughts,
            failureReasons: [:],
            nextSessionOrdinal: 100,
            nextThoughtOrdinal: 100
        )
    }
}
