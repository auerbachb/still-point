import Foundation

/// #887: how the app learns that `UITestAPIStore` received a Settings request.
///
/// The store posts `didRecord` on the main actor each time `PATCH /api/settings`
/// reaches it, with the number received since launch under `countKey`. `RootView`
/// shows that number on a UI-test-only accessibility marker, so a UI test can check
/// that a save was or was not sent. Posted only in UI-test mode, since the store
/// exists only then.
public enum UITestSettingsRequests {
    public static let didRecord = Notification.Name("StillPoint.UITest.settingsRequestRecorded")
    public static let countKey = "count"
}

/// UI-test infrastructure extracted out of `APIClient` (issue #416).
///
/// When the app launches with `SP_UI_TEST_MODE` set, `APIClient` builds one of
/// these actors and delegates every request to it instead of hitting the
/// network. It owns the in-memory + `UserDefaults`-persisted fake backend
/// (`UITestStore`, in `UITestStore.swift`) plus the launch config (`UITestConfig`,
/// in `UITestConfig.swift`).
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
    /// #887: set when the scene goes to the background with a hold configured, and
    /// spent by the next `me()`, which is then held. See `armHeldMeRead()`.
    private var isHeldMeReadArmed = false
    /// #887: Settings requests received since launch. In memory only, so each launch
    /// counts from zero.
    private var settingsRequestCount = 0
    /// #957: set by the first `getSessions` call under `SP_UI_TEST_FORCE_SESSIONS_FAILURE=once`,
    /// which is the one that fails. In memory only, so each launch fails its first
    /// History load again.
    private var isSessionsFailureSpent = false

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
        self.notificationPreferences = Self.defaultNotificationPreferences()
    }

    /// Notification preferences a fresh launch starts with. Kept in memory only, so
    /// every launch starts from these.
    private static func defaultNotificationPreferences() -> NotificationPreferencesDTO {
        NotificationPreferencesDTO(
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

    // MARK: - Construction

    /// Builds the store from `SP_UI_TEST_*` env vars, or returns `nil` when the
    /// app is not running in UI-test mode. Emits the same `[E2E-DIAG]` lines the
    /// original `APIClient.init` did so CI xcresult logs are unchanged.
    static func fromProcessInfo(defaultsKey: String = "StillPoint.UITest.Store") -> UITestAPIStore? {
        make(environment: ProcessInfo.processInfo.environment, defaultsKey: defaultsKey)
    }

    /// Builds the store from the given `SP_UI_TEST_*` environment. `fromProcessInfo`
    /// passes the process environment; unit tests pass their own (#957).
    static func make(environment: [String: String], defaultsKey: String) -> UITestAPIStore? {
        guard let config = UITestConfig.from(environment: environment) else {
            APIClient.diagLog.notice("[E2E-DIAG] APIClient.init uiTestMode=NO")
            return nil
        }

        if config.resetStore {
            resetPersistedState(defaultsKey: defaultsKey)
        }

        let resolvedStore = resolveStore(config: config, defaultsKey: defaultsKey)

        // Diagnostic for issue #266 / #276. Use os_log so the line lands
        // in the xcresult bundle — `print()` from the app process is not
        // captured by Xcode UI test runs, which is why the prior
        // [E2E-DIAG] prints from PR #261 never showed up in CI logs.
        APIClient.diagLog.notice("[E2E-DIAG] APIClient.init uiTestMode=YES seedAuth=\(config.seedAuthenticated, privacy: .public) resetStore=\(config.resetStore, privacy: .public) forceOffline=\(config.forceLaunchOffline, privacy: .public) forceTokenExpired=\(config.forceTokenExpired, privacy: .public) forceCreateSessionFailure=\(config.forceCreateSessionFailure, privacy: .public) finalIsAuthenticated=\(resolvedStore.isAuthenticated, privacy: .public)")

        return UITestAPIStore(config: config, store: resolvedStore, defaultsKey: defaultsKey)
    }

    /// #896: a signed-in store holding `user` and no sessions, with every forced
    /// failure off, for the package's unit tests of the fake server's rules. It
    /// persists under `defaultsKey`, so a test passes its own key and removes it.
    static func makeForUnitTests(user: UserDTO, defaultsKey: String) -> UITestAPIStore {
        var store = UITestStore.makeDefault(seedAuthenticated: true)
        store.user = user
        return UITestAPIStore(config: .unitTest, store: store, defaultsKey: defaultsKey)
    }

    /// Wipes ALL persisted state, not just the UI-test store. State that bled
    /// across tests previously: Keychain auth tokens, cookies, URL credentials,
    /// AudioEngine sound prefs. Issue #266 surfaced this when the runner script
    /// started actually running tests after the silent-skip fix from issue #253.
    ///
    /// Note: the SwiftData store is wiped earlier in `StillPointApp.init()`, before
    /// `.modelContainer(...)` opens its SQLite files (issue #276). The offline write
    /// queue (#557) is stored separately and cleared here on UI-test reset.
    private static func resetPersistedState(defaultsKey: String) {
        let defaults = UserDefaults.standard
        OfflineSessionQueue.removePersistedQueue()
        defaults.removeObject(forKey: defaultsKey)
        AudioEngine.resetPersistedPrefs()
        SessionIntroPrefs.resetPersistedPrefs()
        // #669: a leftover minimal-view preference would start every subsequent
        // UI test with the session chrome collapsed to the countdown alone.
        MinimalSessionViewPrefs.resetPersistedPrefs()
        // #730: clearing the key restores the opt-out default (on), so a test that
        // toggled the wake lock off cannot leave later runs starting opted out.
        WakeLockPrefs.resetPersistedPrefs()
        LastAuthProvider.resetPersisted()
        // Flush the in-memory cache to cfprefsd so the immediately
        // following read sees the cleared state. Issue #266 follow-up.
        defaults.synchronize()
    }

    /// The store this launch starts from: the snapshot seed when requested, else the
    /// persisted store, else a fresh default. A seeded or fresh store is persisted
    /// at once.
    private static func resolveStore(config: UITestConfig, defaultsKey: String) -> UITestStore {
        if config.snapshotSeed {
            let snapshot = UITestStore.makeSnapshot(seedAuthenticated: config.seedAuthenticated)
            snapshot.persist(key: defaultsKey)
            return snapshot
        }
        if let persisted = UITestStore.load(key: defaultsKey) {
            return persisted
        }
        let fresh = UITestStore.makeDefault(seedAuthenticated: config.seedAuthenticated)
        fresh.persist(key: defaultsKey)
        return fresh
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

    /// #887: arms the held `me()` read, when `SP_UI_TEST_HOLD_ME_SECONDS` is set.
    ///
    /// `APIClient.uiTestSceneDidEnterBackground()` calls this when the scene goes to
    /// the background. The next `me()` is the scene-activation `checkAuth()` read
    /// when the app comes back, and that one is held: it waits the configured time
    /// before answering, holding the app's settings queue, so a Settings save made in
    /// that window waits behind it. With `SP_UI_TEST_SECOND_ACCOUNT` set too, the
    /// held read answers as the second account, so the app adopts a different
    /// account while Settings stays on screen.
    ///
    /// Armed by the background rather than by a call count, because the launch makes
    /// one or two `me()` reads depending on whether the scene-activation check fires,
    /// and both of those must answer as the first account.
    func armHeldMeRead() {
        guard config.holdMeSeconds != nil else { return }
        isHeldMeReadArmed = true
    }

    func me(today: String? = nil) async throws -> UserDTO? {
        await waitOutHeldMeReadIfArmed()

        if config.forceLaunchOffline {
            throw Self.offlineError
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

        guard store.isAuthenticated else { return nil }

        startMissedDayRecoveryIfNeeded(today: today)
        return store.user
    }

    /// #887: spends an armed hold, waiting the configured time and then, with a
    /// second account configured, switching to it.
    private func waitOutHeldMeReadIfArmed() async {
        guard isHeldMeReadArmed, let holdSeconds = config.holdMeSeconds else { return }
        isHeldMeReadArmed = false
        // An actor suspension, so every other request still reaches the store
        // while this one waits: a Settings save the app wrongly sent beside the
        // read would be counted, not blocked.
        try? await Task.sleep(nanoseconds: UInt64(holdSeconds * 1_000_000_000))
        if config.secondAccount, store.isAuthenticated {
            switchToSecondAccount()
        }
    }

    /// Starts a recovery ramp when no ramp is active and a missed-day gap separates
    /// the last completed primary sit from `today`, as `/api/auth/me` does. An
    /// invalid or missing `today` falls back to the local calendar day.
    private func startMissedDayRecoveryIfNeeded(today: String?) {
        guard DurationRecovery.activeRecovery(DurationRecovery.recoveryFields(from: store.user)) == nil else {
            return
        }

        let todayIso: String
        if let today, SessionCalendar.isValidSessionCalendarDate(today) {
            todayIso = today
        } else {
            todayIso = SessionCalendar.localTodayIsoDate()
        }

        let lastPrimary = store.sessions
            .filter { $0.completed && $0.sessionType == .standard && ($0.track ?? .primary) == .primary }
            .max(by: { $0.sessionDate < $1.sessionDate })

        guard let recovery = DurationRecovery.detectMissedDayGap(
            lastCompletedSessionDate: lastPrimary?.sessionDate,
            todayIso: todayIso,
            currentDay: store.user.currentDay,
            recovery: DurationRecovery.recoveryFields(from: store.user)
        ) else { return }

        store.user = store.user.updatingRecovery(
            targetDay: recovery.recoveryTargetDay,
            currentStep: recovery.recoveryCurrentStep,
            totalSteps: recovery.recoveryTotalSteps
        )
        persist()
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
        try failSessionsLoadIfForced()

        let sortedSessions = store.sessions.sorted { $0.sessionDate < $1.sessionDate }
        let todayIso: String
        if let today, !today.isEmpty {
            todayIso = today
        } else {
            todayIso = SessionCalendar.localTodayIsoDate()
        }
        return (sortedSessions, Self.stats(for: sortedSessions, todayIso: todayIso))
    }

    /// The History stats block, computed from `sortedSessions` as `/api/sessions` does.
    private static func stats(for sortedSessions: [SessionDTO], todayIso: String) -> StatsDTO {
        let base = SessionStatistics.calculateStats(for: sortedSessions)
        let period = HistoryStats.calculatePeriodStats(sessions: sortedSessions, todayIso: todayIso)
        let trends = HistoryMindStateTrends.calculateTrendStats(sessions: sortedSessions, todayIso: todayIso)
        return StatsDTO(
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
    }

    /// Throws the forced sessions failure: on every call in the always mode, and on
    /// the first call only in the once mode (#957). The check and the update run in
    /// one synchronous actor-isolated step, so two loads cannot both take the one
    /// failure.
    private func failSessionsLoadIfForced() throws {
        switch config.sessionsFailureMode {
        case .none:
            return
        case .always:
            throw Self.sessionsFailure
        case .once:
            guard !isSessionsFailureSpent else { return }
            isSessionsFailureSpent = true
            throw Self.sessionsFailure
        }
    }

    func getTracksDoneToday(date: String) throws -> TracksDoneTodayDTO {
        try ensureAuthenticated()

        // #957: only the always mode fails this endpoint. The once mode is for the
        // History load alone, so the track refresh at launch cannot spend its failure.
        if config.sessionsFailureMode == .always {
            throw Self.sessionsFailure
        }

        var primary = false
        var second = false
        for session in store.sessions where session.completed
            && session.sessionType == .standard
            && session.sessionDate == date {
            // #896: as `/api/track/done-today` does (#890), a combined sit is one
            // primary row that counts for both tracks.
            let credited = CombinedSit.tracksCredited(session)
            if credited.primary { primary = true }
            if credited.second { second = true }
        }
        return TracksDoneTodayDTO(primary: primary, second: second)
    }

    func createSession(_ data: CreateSessionRequest) throws -> SessionDTO {
        try ensureAuthenticated()

        // #875: fail as a dead network does. Status 0 is never a rejection
        // (`SessionSyncCoordinator.rejectsTheSit`), so the sit stays queued and
        // pending sync instead of being parked.
        if config.forceCreateSessionFailure {
            throw Self.offlineError
        }

        // #896: as `POST /api/sessions` does (#769), a combined sit must be a
        // standard sit on the primary track; anything else is a 400.
        if data.combined && (data.sessionType != .standard || data.track != .primary) {
            throw APIError(status: 400, message: "Invalid combined session")
        }

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
            // #839: as `POST /api/sessions` does, a category is kept only on a focus session.
            focusCategory: data.sessionType == .focus ? data.focusCategory : nil,
            track: data.track,
            combined: data.combined
        )
        store.nextSessionOrdinal += 1
        store.sessions.append(session)

        if data.completed && data.sessionType == .standard {
            advanceTrackProgression(after: data)
        }
        advanceFocusDayIfNeeded(after: data)

        persist()
        return session
    }

    /// Moves the counters a completed standard sit advances. Callers persist.
    private func advanceTrackProgression(after data: CreateSessionRequest) {
        // #240: a `second`-track sit advances the second-track counter (only when
        // opted in); a `primary` sit advances currentDay / recovery ramp (#238).
        if data.track == .second {
            advanceSecondTrackDayIfOptedIn(after: data)
            return
        }

        let next = DurationRecovery.advanceProgression(
            sessionType: data.sessionType,
            completed: data.completed,
            state: DurationRecovery.ProgressionState(
                currentDay: store.user.currentDay,
                recovery: DurationRecovery.recoveryFields(from: store.user)
            )
        )
        store.user = store.user.updatingProgression(next)
        // #896: as the server's `progressionUpdateSql` does (#890), a completed
        // combined sit also moves Track Two on a day (only when opted in). One
        // ended early never reaches this method, so it moves neither.
        if data.combined {
            advanceSecondTrackDayIfOptedIn(after: data)
        }
    }

    /// #240: Track Two moves only for a user who opted into the dual-track fork.
    private func advanceSecondTrackDayIfOptedIn(after data: CreateSessionRequest) {
        guard store.user.dualTrackEnabled else { return }
        store.user = store.user.updating(secondTrackDay: StillPoint.advanceSecondTrackDay(
            sessionType: data.sessionType,
            completed: data.completed,
            secondTrackDay: store.user.secondTrackDay
        ))
    }

    /// #839: the server's `focus_activity_day` step: only a completed focus
    /// session moves the focus goal, by one. `advanceTrackProgression` never runs
    /// for one. Callers persist.
    private func advanceFocusDayIfNeeded(after data: CreateSessionRequest) {
        guard StillPoint.shouldAdvanceFocusDay(sessionType: data.sessionType, completed: data.completed) else {
            return
        }
        store.user = store.user.updating(focusActivityDay: StillPoint.advanceFocusActivityDay(
            sessionType: data.sessionType,
            completed: data.completed,
            focusActivityDay: store.user.focusActivityDay
        ))
    }

    /// #240: opt into the dual-track fork (enable a second daily track).
    func enableDualTrack() throws -> UserDTO {
        try ensureAuthenticated()
        store.user = store.user.updating(dualTrackEnabled: true)
        persist()
        return store.user
    }

    func getSession(sessionId: String) throws -> (session: SessionDTO, thoughts: [ThoughtDTO]) {
        try ensureAuthenticated()

        guard let session = store.sessions.first(where: { $0.id == sessionId }) else {
            throw Self.sessionNotFound
        }

        let thoughts = store.thoughts.filter { $0.sessionId == session.id }
            .sorted { $0.timeInSession < $1.timeInSession }
        return (session, thoughts)
    }

    /// #635: merge mood matrix rows (mirrors PATCH /api/sessions/by-session/{id} merge semantics).
    /// #792: a clear patch empties the matrix, and an all-nil row deletes that row.
    func updateSessionMoodMatrix(sessionId: String, patch: MoodMatrixPatch) throws -> SessionDTO {
        try ensureAuthenticated()

        guard let idx = store.sessions.firstIndex(where: { $0.id == sessionId }) else {
            throw Self.sessionNotFound
        }

        let existing = store.sessions[idx]
        var merged: [String: MoodMatrixEntry] = patch.clearsMatrix ? [:] : existing.moodMatrix ?? [:]
        for (key, entry) in patch.entries {
            if entry.before == nil && entry.after == nil {
                merged.removeValue(forKey: key)
            } else {
                merged[key] = entry
            }
        }
        let updated = existing.replacingMoodMatrix(merged.isEmpty ? nil : merged)
        store.sessions[idx] = updated
        persist()
        return updated
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

        // Mirrors POST /api/thoughts/batch (#792): a new completion note or an
        // explicit clear replaces the session's stored one.
        if data.clearCompletionNote == true || data.thoughts.contains(where: { $0.timeInSession == -1 }) {
            store.thoughts.removeAll { $0.sessionId == data.sessionId && $0.timeInSession == -1 }
        }

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

    /// Each `nil` argument leaves that field as it is.
    func updateSettings(
        isPublic: Bool?,
        username: String?,
        aphorismsEnabled: Bool?,
        attentionTrackingEnabled: Bool?,
        ambientSoundEnabled: Bool?,
        longSessionPeriod: SessionPeriod? = nil
    ) throws -> UserDTO {
        // #887: counted before anything can reject it, since the question a UI test
        // asks is whether the app sent the request at all.
        recordSettingsRequest()
        try ensureAuthenticated()

        var validatedUsername: String?
        if let username {
            let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
            if config.forceUsernameConflict {
                throw APIError(status: 409, message: "Username already taken")
            }
            guard UsernameValidation.isValid(trimmed) else {
                throw APIError(status: 400, message: UsernameValidation.errorMessage)
            }
            validatedUsername = trimmed
        }

        store.user = store.user.updating(
            username: validatedUsername,
            isPublic: isPublic,
            aphorismsEnabled: aphorismsEnabled,
            attentionTrackingEnabled: attentionTrackingEnabled,
            longSessionPeriod: longSessionPeriod,
            ambientSoundEnabled: ambientSoundEnabled
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
        let quietStart = Self.applying(patch.quietHoursStart, to: current.quietHoursStart)
        let quietEnd = Self.applying(patch.quietHoursEnd, to: current.quietHoursEnd)
        let callPhone = Self.applying(patch.callPhoneNumber, to: current.callPhoneNumber)
        let callWindowStart = Self.applying(patch.callWindowStart, to: current.callWindowStart)
        let callWindowStop = Self.applying(patch.callWindowStop, to: current.callWindowStop)

        let nextCallOptIn = patch.callOptIn ?? current.callOptIn
        if nextCallOptIn {
            guard let phone = callPhone,
                  phone.hasPrefix("+"),
                  phone.count >= 8,
                  let start = callWindowStart,
                  let stop = callWindowStop,
                  start != stop else {
                throw Self.validationError("callOptIn requires callPhoneNumber plus callWindowStart and callWindowStop")
            }
        }
        let nextCallConsentAt: String? = {
            if patch.callOptIn == true && !current.callOptIn {
                return Self.nowTimestamp()
            }
            // Opt-out keeps the last grant time. Revocation is an audit event on
            // the server (#674); this test double only mirrors the cache column.
            return current.callConsentAt
        }()

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
            callOptIn: nextCallOptIn,
            callPhoneNumber: callPhone,
            callConsentAt: nextCallConsentAt,
            callWindowStart: callWindowStart,
            callWindowStop: callWindowStop,
            tz: patch.tz ?? current.tz,
            updatedAt: current.updatedAt
        )

        notificationPreferences = next
        return next
    }

    /// Applies one clearable patch field: an absent field (`nil`) keeps `current`,
    /// an explicit null (`.some(nil)`) clears it, and a value replaces it.
    private static func applying(_ patch: String??, to current: String?) -> String? {
        guard let patch else { return current }
        return patch
    }

    // MARK: - Failure reasons

    func getFailureReason(date: String) throws -> FailureReasonLookupDTO {
        try ensureAuthenticated()
        guard SessionCalendar.isValidSessionCalendarDate(date) else {
            throw Self.validationError("date must be YYYY-MM-DD")
        }
        if let row = store.failureReasons[date] {
            return FailureReasonLookupDTO(exists: true, failureReason: row)
        }
        return FailureReasonLookupDTO(exists: false, failureReason: nil)
    }

    func submitFailureReason(_ request: SubmitFailureReasonRequest) throws -> FailureReasonDTO {
        try ensureAuthenticated()
        let trimmed = try Self.validatedFailureReasonText(request)

        let now = Self.nowTimestamp()
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

    /// Checks a failure-reason submission as the server does, in the server's order,
    /// and returns its trimmed text.
    private static func validatedFailureReasonText(_ request: SubmitFailureReasonRequest) throws -> String {
        guard SessionCalendar.isValidSessionCalendarDate(request.reasonDate) else {
            throw validationError("reasonDate must be YYYY-MM-DD")
        }
        let maxAllowedDate = WidgetDataStore.localDayString(Date())
        guard request.reasonDate <= maxAllowedDate else {
            throw validationError("reasonDate cannot be in the future")
        }

        let trimmed = request.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw validationError("text must not be empty")
        }
        guard trimmed.count <= maxFailureReasonLength else {
            throw validationError("text must be at most \(maxFailureReasonLength) characters")
        }
        return trimmed
    }

    // MARK: - Second account (#887)

    /// The second account, `SP_UI_TEST_SECOND_ACCOUNT`. Its id, username and Public
    /// Board differ from the first account's, so the switch is visible on Settings and
    /// moves an account field Settings copies onto its controls. Aphorisms stays off,
    /// as on the first account: a UI test turns Aphorisms on before the switch, so the
    /// value it expects afterwards differs from the one it chose.
    static let secondAccountUser = UserDTO(
        id: "ui-user-2",
        email: "ios.second@stillpoint.test",
        username: "ios_second",
        isPublic: true,
        currentDay: 1,
        aphorismsEnabled: false
    )

    /// Signs the store in as the second account. Sessions, thoughts and failure
    /// reasons stay as they are: the UI tests that use this only look at Settings.
    private func switchToSecondAccount() {
        store.user = Self.secondAccountUser
        store.loginEmail = Self.secondAccountUser.email
        persist()
    }

    // MARK: - Errors

    /// Fails as a dead network does: status 0, which the app never treats as a rejection.
    private static var offlineError: APIError {
        APIError(status: 0, message: "No internet connection")
    }

    private static var sessionsFailure: APIError {
        APIError(status: 503, message: "Failed to load sessions. Check your connection.")
    }

    private static var sessionNotFound: APIError {
        APIError(status: 404, message: "Session not found")
    }

    private static func validationError(_ message: String) -> APIError {
        APIError(status: 400, message: message, code: "VALIDATION_ERROR")
    }

    // MARK: - Helpers

    private func recordSettingsRequest() {
        settingsRequestCount += 1
        let count = settingsRequestCount
        Task { @MainActor in
            NotificationCenter.default.post(
                name: UITestSettingsRequests.didRecord,
                object: nil,
                userInfo: [UITestSettingsRequests.countKey: count]
            )
        }
    }

    private func ensureAuthenticated() throws {
        guard store.isAuthenticated else {
            throw APIError(status: 401, message: "Please log in", code: "UNAUTHORIZED")
        }
    }

    private func persist() {
        store.persist(key: defaultsKey)
    }

    /// The current time as an ISO 8601 timestamp, as the server stamps rows.
    private static func nowTimestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}

private extension SessionDTO {
    /// This session with `moodMatrix` replaced and every other field kept.
    func replacingMoodMatrix(_ moodMatrix: [String: MoodMatrixEntry]?) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: dayNumber,
            sessionType: sessionType,
            duration: duration,
            bonusSeconds: bonusSeconds,
            completed: completed,
            actualTime: actualTime,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            mindStateLog: mindStateLog,
            attentionLog: attentionLog,
            sessionDate: sessionDate,
            createdAt: createdAt,
            buddySessionId: buddySessionId,
            breathCount: breathCount,
            focusCategory: focusCategory,
            track: track,
            ambientSoundSummary: ambientSoundSummary,
            moodMatrix: moodMatrix,
            combined: combined
        )
    }
}
