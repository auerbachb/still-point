import Foundation
import os

/// Network client for the Still Point web API.
/// Uses cookie auth where available and bearer token auth for native reliability.
public actor APIClient {
    public static let shared = APIClient()

    /// Diagnostic logger. Used for the `[E2E-DIAG]` lines so they reach the
    /// xcresult log (`print()` from the app process is not captured).
    /// Subsystem matches the bundle id; category lets us filter in Console.
    nonisolated static let diagLog = Logger(subsystem: "com.brettonauerbach.stillpoint", category: "e2e-diag")

    // Default to the deployed web app; override for local dev
    private var baseURL: URL

    private let session: URLSession
    private let uiTestConfig: UITestConfig?
    private var uiTestStore: UITestStore?
    private let uiTestStoreDefaultsKey = "StillPoint.UITest.Store"
    private var uiTestNotificationPreferences = NotificationPreferencesDTO(
        pushEnabled: false,
        dailyReminderEnabled: false,
        missADayEnabled: false,
        friendRequestNotificationsEnabled: true,
        dailyReminderTime: "09:00",
        dailyReminderFrequency: .daily,
        quietHoursStart: nil,
        quietHoursEnd: nil,
        tz: TimeZone.current.identifier
    )

    private init() {
        #if DEBUG
        self.baseURL = URL(string: "https://still-point.me")!
        #else
        self.baseURL = URL(string: "https://still-point.me")!
        #endif

        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = .shared
        self.session = URLSession(configuration: config)

        let parsedUITestConfig = UITestConfig.fromProcessInfo()
        self.uiTestConfig = parsedUITestConfig
        if let parsedUITestConfig {
            let defaults = UserDefaults.standard
            if parsedUITestConfig.resetStore {
                // Wipe ALL persisted state, not just the UI-test store. State that
                // bled across tests previously: Keychain auth tokens, cookies, URL
                // credentials, AudioEngine sound prefs. Issue #266 surfaced this
                // when the runner script started actually running tests after the
                // silent-skip fix from issue #253.
                // Note: the SwiftData store is wiped earlier in
                // `StillPointApp.init()`, before `.modelContainer(...)` opens
                // its SQLite files (issue #276 — APIClient.init runs lazily
                // from RootView's .task, which is too late to delete an
                // already-open store).
                defaults.removeObject(forKey: uiTestStoreDefaultsKey)
                AudioEngine.resetPersistedPrefs()
                Self.clearPersistedSessionArtifacts(session: session)
                // Flush the in-memory cache to cfprefsd so the immediately
                // following read sees the cleared state. Issue #266 follow-up.
                defaults.synchronize()
            }

            let resolvedStore: UITestStore
            if parsedUITestConfig.snapshotSeed {
                resolvedStore = UITestStore.makeSnapshot(seedAuthenticated: parsedUITestConfig.seedAuthenticated)
                Self.persist(store: resolvedStore, key: uiTestStoreDefaultsKey)
            } else if let persistedData = defaults.data(forKey: uiTestStoreDefaultsKey),
                      let persistedStore = try? JSONDecoder().decode(UITestStore.self, from: persistedData) {
                resolvedStore = persistedStore
            } else {
                resolvedStore = UITestStore.makeDefault(seedAuthenticated: parsedUITestConfig.seedAuthenticated)
                Self.persist(store: resolvedStore, key: uiTestStoreDefaultsKey)
            }
            self.uiTestStore = resolvedStore

            // Diagnostic for issue #266 / #276. Use os_log so the line lands
            // in the xcresult bundle — `print()` from the app process is not
            // captured by Xcode UI test runs, which is why the prior
            // [E2E-DIAG] prints from PR #261 never showed up in CI logs.
            Self.diagLog.notice("[E2E-DIAG] APIClient.init uiTestMode=YES seedAuth=\(parsedUITestConfig.seedAuthenticated, privacy: .public) resetStore=\(parsedUITestConfig.resetStore, privacy: .public) forceOffline=\(parsedUITestConfig.forceLaunchOffline, privacy: .public) forceTokenExpired=\(parsedUITestConfig.forceTokenExpired, privacy: .public) finalIsAuthenticated=\(resolvedStore.isAuthenticated, privacy: .public)")
        } else {
            Self.diagLog.notice("[E2E-DIAG] APIClient.init uiTestMode=NO")
        }
    }

    /// Static analog of `clearLocalSessionArtifacts()` for use during init,
    /// when the actor's instance methods are not yet available.
    private static func clearPersistedSessionArtifacts(session: URLSession) {
        _ = AuthTokenStore.clear()

        let cookieStorage = session.configuration.httpCookieStorage ?? .shared
        for cookie in cookieStorage.cookies ?? [] {
            cookieStorage.deleteCookie(cookie)
        }

        let credentialStorage = URLCredentialStorage.shared
        for (protectionSpace, credentialsByUser) in credentialStorage.allCredentials {
            for credential in credentialsByUser.values {
                credentialStorage.remove(credential, for: protectionSpace)
            }
        }
    }

    public func setBaseURL(_ url: URL) {
        self.baseURL = url
    }

    // MARK: - Auth

    public func signup(email: String, username: String, password: String) async throws -> UserDTO {
        if let user = try uiTestSignup(email: email, username: username, password: password) {
            return user
        }
        let body: [String: String] = ["email": email, "username": username, "password": password]
        let response: UserResponse = try await post("/api/auth/signup", body: body)
        if let token = response.token, !token.isEmpty {
            guard AuthTokenStore.save(token) else {
                throw APIError(status: 0, message: "Unable to securely save auth token")
            }
        } else {
            _ = AuthTokenStore.clear()
        }
        return response.user
    }

    public func login(email: String, password: String) async throws -> UserDTO {
        if let user = try uiTestLogin(email: email, password: password) {
            return user
        }
        // Web app sends username too but only uses email+password for login
        let body: [String: String] = ["email": email, "username": "", "password": password]
        let response: UserResponse = try await post("/api/auth/login", body: body)
        if let token = response.token, !token.isEmpty {
            guard AuthTokenStore.save(token) else {
                throw APIError(status: 0, message: "Unable to securely save auth token")
            }
        } else {
            _ = AuthTokenStore.clear()
        }
        return response.user
    }

    /// Native Sign in with Apple → server verifies JWT and returns `user` + `token` (same as login with ios header).
    public func signInWithApple(_ request: AppleNativeSignInRequest) async throws -> UserDTO {
        if uiTestConfig != nil {
            throw APIError(status: 0, message: "Apple sign-in is not available in UI test mode")
        }
        let response: UserResponse = try await post("/api/auth/apple-native", body: request)
        if let token = response.token, !token.isEmpty {
            guard AuthTokenStore.save(token) else {
                throw APIError(status: 0, message: "Unable to securely save auth token")
            }
        } else {
            _ = AuthTokenStore.clear()
        }
        return response.user
    }

    /// Native Sign in with Google → server verifies the Google ID token and returns `user` + `token` (same as login with ios header).
    public func signInWithGoogle(_ request: GoogleNativeSignInRequest) async throws -> UserDTO {
        if uiTestConfig != nil {
            throw APIError(status: 0, message: "Google sign-in is not available in UI test mode")
        }
        let response: UserResponse = try await post("/api/auth/google-native", body: request)
        if let token = response.token, !token.isEmpty {
            guard AuthTokenStore.save(token) else {
                throw APIError(status: 0, message: "Unable to securely save auth token")
            }
        } else {
            _ = AuthTokenStore.clear()
        }
        return response.user
    }

    public func requestPasswordReset(email: String) async throws -> String {
        if let message = try uiTestRequestPasswordReset(email: email) {
            return message
        }
        let body: [String: String] = ["email": email]
        let response: PasswordResetRequestResponse = try await post("/api/auth/password-reset/request", body: body)
        return response.message
    }

    public func logout() async throws {
        if uiTestLogout() {
            return
        }
        defer { clearLocalSessionArtifacts() }
        let _: [String: Bool] = try await post("/api/auth/logout", body: Optional<String>.none)
    }

    public func deleteAccount() async throws {
        if uiTestDeleteAccount() {
            return
        }
        try await delete("/api/account")
        clearLocalSessionArtifacts()
    }

    public func me() async throws -> UserDTO? {
        if let uiTestResult = try uiTestMe() {
            return uiTestResult
        }
        do {
            let response: UserResponse = try await get("/api/auth/me")
            return response.user
        } catch let error as APIError where error.status == 401 && error.code != "TOKEN_EXPIRED" {
            return nil
        }
    }

    // MARK: - Device Tokens

    public func registerDeviceToken(_ request: DeviceTokenRegistrationRequest) async throws -> DeviceTokenResponse.RegisteredDeviceToken {
        if uiTestConfig != nil {
            return DeviceTokenResponse.RegisteredDeviceToken(
                id: "ui-device-token",
                platform: request.platform,
                apnsEnvironment: request.apnsEnvironment
            )
        }
        let response: DeviceTokenResponse = try await post("/api/device-token", body: request)
        return response.deviceToken
    }

    public func unregisterDeviceToken(_ request: DeviceTokenRegistrationRequest) async throws {
        if uiTestConfig != nil {
            return
        }
        var urlRequest = makeRequest(method: "DELETE", path: "/api/device-token")
        urlRequest.httpBody = try JSONEncoder().encode(request)
        _ = try await executeRaw(urlRequest)
    }

    // MARK: - Sessions

    public func getSessions() async throws -> (sessions: [SessionDTO], stats: StatsDTO) {
        if let uiTestResult = try uiTestGetSessions() {
            return uiTestResult
        }
        let response: SessionsResponse = try await get("/api/sessions")
        return (response.sessions, response.stats)
    }

    public func createSession(_ data: CreateSessionRequest) async throws -> SessionDTO {
        if let session = try uiTestCreateSession(data) {
            return session
        }
        let response: SessionResponse = try await post("/api/sessions", body: data)
        return response.session
    }

    public func getSessionBySessionId(_ sessionId: String) async throws -> (session: SessionDTO, thoughts: [ThoughtDTO]) {
        if let uiTestResult = try uiTestGetSession(sessionId: sessionId) {
            return uiTestResult
        }
        let response: SessionDetailResponse = try await get("/api/sessions/by-session/\(sessionId)")
        return (response.session, response.thoughts)
    }

    // MARK: - Thoughts

    public func getThoughts() async throws -> [ThoughtDTO] {
        if let thoughts = try uiTestGetThoughts() {
            return thoughts
        }
        let response: ThoughtsResponse = try await get("/api/thoughts")
        return response.thoughts
    }

    public func batchThoughts(_ data: BatchThoughtsRequest) async throws -> [ThoughtDTO] {
        if let thoughts = try uiTestBatchThoughts(data) {
            return thoughts
        }
        let response: ThoughtsResponse = try await post("/api/thoughts/batch", body: data)
        return response.thoughts
    }

    // MARK: - Board

    public func getBoard() async throws -> [BoardEntryDTO] {
        if uiTestConfig != nil {
            return uiTestGetBoard()
        }
        let response: BoardResponse = try await get("/api/board")
        return response.board
    }

    // MARK: - Settings

    public func updateSettings(isPublic: Bool) async throws -> UserDTO {
        try await updateSettings(body: SettingsPatchBody(isPublic: isPublic, username: nil))
    }

    public func updateSettings(username: String) async throws -> UserDTO {
        try await updateSettings(body: SettingsPatchBody(isPublic: nil, username: username))
    }

    private func updateSettings(body: SettingsPatchBody) async throws -> UserDTO {
        if let user = try uiTestUpdateSettings(body: body) {
            return user
        }
        let response: UserResponse = try await patch("/api/settings", body: body)
        return response.user
    }

    // MARK: - Notification preferences

    public func getNotificationPreferences() async throws -> NotificationPreferencesDTO {
        if uiTestConfig != nil {
            return uiTestNotificationPreferences
        }
        let response: NotificationPreferencesResponse = try await get("/api/notifications/preferences")
        return response.preferences
    }

    public func updateNotificationPreferences(_ preferencesPatch: NotificationPreferencesPatch) async throws -> NotificationPreferencesDTO {
        if let updated = try uiTestUpdateNotificationPreferences(preferencesPatch) {
            return updated
        }
        let response: NotificationPreferencesResponse = try await patch(
            "/api/notifications/preferences",
            body: preferencesPatch
        )
        return response.preferences
    }

    // MARK: - Buddy Sessions

    public func createBuddySession() async throws -> BuddySessionCreatedDTO {
        let response: CreateBuddySessionResponse = try await post("/api/buddy/sessions", body: Optional<String>.none)
        return response.session
    }

    public func joinBuddySession(token: String) async throws -> String {
        let response: JoinBuddySessionResponse = try await post(
            "/api/buddy/sessions/join",
            body: JoinBuddySessionRequest(token: token)
        )
        return response.sessionId
    }

    public func getBuddySnapshot(sessionId: String) async throws -> BuddySnapshotDTO {
        let response: BuddySnapshotResponse = try await get("/api/buddy/sessions/\(sessionId)")
        return response.snapshot
    }

    public func getBuddyMeetingToken(sessionId: String) async throws -> String {
        let response: BuddyMeetingTokenResponse = try await post(
            "/api/buddy/sessions/\(sessionId)/meeting-token",
            body: Optional<String>.none
        )
        return response.token
    }

    public func setBuddyReady(sessionId: String, ready: Bool) async throws {
        _ = try await patch(
            "/api/buddy/sessions/\(sessionId)/ready",
            body: SetBuddyReadyRequest(ready: ready)
        ) as BuddyBooleanResponse
    }

    public func startBuddySession(sessionId: String) async throws {
        _ = try await post(
            "/api/buddy/sessions/\(sessionId)/start",
            body: Optional<String>.none
        ) as StartBuddySessionResponse
    }

    public func leaveBuddySession(sessionId: String) async throws {
        _ = try await post(
            "/api/buddy/sessions/\(sessionId)/leave",
            body: Optional<String>.none
        ) as BuddyBooleanResponse
    }

    public func cancelBuddySession(sessionId: String) async throws {
        _ = try await post(
            "/api/buddy/sessions/\(sessionId)/cancel",
            body: Optional<String>.none
        ) as BuddyBooleanResponse
    }

    public func recordBuddyPersonalSession(
        sessionId: String,
        request: RecordBuddyPersonalSessionRequest
    ) async throws -> SessionDTO {
        let response: RecordBuddyPersonalSessionResponse = try await post(
            "/api/buddy/sessions/\(sessionId)/record-personal-session",
            body: request
        )
        return response.session
    }

    /// Unified multi-buddy calendar (`GET /api/buddy/sessions/calendar`).
    public func getBuddyCalendar(
        from: String? = nil,
        to: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) async throws -> BuddyCalendarListResponse {
        try await get(buddyCalendarPath("/api/buddy/sessions/calendar", from: from, to: to, limit: limit, offset: offset))
    }

    /// Per-buddy shared calendar (`GET /api/buddy/sessions/calendar/{buddyId}`).
    public func getBuddyCalendarForBuddy(
        buddyId: String,
        from: String? = nil,
        to: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) async throws -> BuddyCalendarListResponse {
        try await get(
            buddyCalendarPath(
                "/api/buddy/sessions/calendar/\(buddyId)",
                from: from,
                to: to,
                limit: limit,
                offset: offset
            )
        )
    }

    private func buddyCalendarPath(
        _ base: String,
        from: String?,
        to: String?,
        limit: Int?,
        offset: Int?
    ) -> String {
        var parts: [String] = []
        if let from { parts.append("from=\(from.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? from)") }
        if let to { parts.append("to=\(to.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? to)") }
        if let limit { parts.append("limit=\(limit)") }
        if let offset { parts.append("offset=\(offset)") }
        guard !parts.isEmpty else { return base }
        return "\(base)?\(parts.joined(separator: "&"))"
    }

    // MARK: - HTTP Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let request = makeRequest(method: "GET", path: path)
        return try await execute(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B?) async throws -> T {
        var request = makeRequest(method: "POST", path: path)
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }
        return try await execute(request)
    }

    private func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(method: "PATCH", path: path)
        request.httpBody = try JSONEncoder().encode(body)
        return try await execute(request)
    }

    private func delete(_ path: String) async throws {
        let request = makeRequest(method: "DELETE", path: path)
        _ = try await executeRaw(request)
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, _) = try await executeRaw(request)
        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    private func executeRaw(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError(status: 0, message: "Invalid response")
        }
        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let errorBody = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError(
                status: httpResponse.statusCode,
                message: errorBody?.error ?? "Request failed",
                code: errorBody?.code
            )
        }
        return (data, httpResponse)
    }

    private func clearLocalSessionArtifacts() {
        Self.clearPersistedSessionArtifacts(session: session)
    }

    private func applyAuthorizationHeader(to request: inout URLRequest) {
        guard let token = AuthTokenStore.load(), !token.isEmpty else { return }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func makeRequest(method: String, path: String) -> URLRequest {
        // Use URL(string:relativeTo:) instead of appendingPathComponent so query strings
        // in `path` (e.g. "/api/foo?offset=0") are preserved rather than percent-encoded.
        let url = URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("ios", forHTTPHeaderField: "X-Still-Point-Client")
        applyAuthorizationHeader(to: &request)
        return request
    }

    // MARK: - UI Test Overrides

    /// Returns a handled value in UI test mode, or `nil` when normal network flow should continue.
    private func uiTestMe() throws -> UserDTO?? {
        guard let uiTestConfig else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }

        if uiTestConfig.forceLaunchOffline {
            throw APIError(status: 0, message: "No internet connection")
        }

        if uiTestConfig.forceTokenExpired {
            if store.isAuthenticated {
                store.isAuthenticated = false
                uiTestStore = store
                persistUITestStore()
            }
            throw APIError(
                status: 401,
                message: "Session expired. Please log in again.",
                code: "TOKEN_EXPIRED"
            )
        }

        return store.isAuthenticated ? store.user : .some(nil)
    }

    private func uiTestSignup(email: String, username: String, password: String) throws -> UserDTO? {
        guard uiTestConfig != nil else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }

        store.user = UserDTO(
            id: store.user.id,
            email: email,
            username: username,
            isPublic: store.user.isPublic,
            currentDay: max(store.user.currentDay, 1)
        )
        store.loginEmail = email
        store.loginPassword = password
        store.isAuthenticated = true
        uiTestStore = store
        persistUITestStore()
        return store.user
    }

    private func uiTestLogin(email: String, password: String) throws -> UserDTO? {
        guard uiTestConfig != nil else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }

        guard email.lowercased() == store.loginEmail.lowercased(),
              password == store.loginPassword else {
            throw APIError(status: 401, message: "Invalid email or password")
        }

        store.isAuthenticated = true
        uiTestStore = store
        persistUITestStore()
        return store.user
    }

    private func uiTestRequestPasswordReset(email: String) throws -> String? {
        guard uiTestConfig != nil else { return nil }
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw APIError(status: 400, message: "Email required")
        }
        return "If an account exists for that email, a reset link will arrive shortly."
    }

    private func uiTestLogout() -> Bool {
        guard uiTestConfig != nil else { return false }
        guard var store = uiTestStore else { return true }
        store.isAuthenticated = false
        uiTestStore = store
        persistUITestStore()
        clearLocalSessionArtifacts()
        return true
    }

    private func uiTestDeleteAccount() -> Bool {
        guard uiTestConfig != nil else { return false }
        guard var store = uiTestStore else { return true }
        store.isAuthenticated = false
        store.sessions = []
        store.thoughts = []
        uiTestStore = store
        persistUITestStore()
        clearLocalSessionArtifacts()
        return true
    }

    private func uiTestGetSessions() throws -> (sessions: [SessionDTO], stats: StatsDTO)? {
        guard let uiTestConfig else { return nil }
        guard let store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

        if uiTestConfig.forceSessionsFailure {
            throw APIError(status: 503, message: "Failed to load sessions. Check your connection.")
        }

        let sortedSessions = store.sessions.sorted { $0.sessionDate < $1.sessionDate }
        return (sortedSessions, SessionStatistics.calculateStats(for: sortedSessions))
    }

    private func uiTestCreateSession(_ data: CreateSessionRequest) throws -> SessionDTO? {
        guard uiTestConfig != nil else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

        let nextOrdinal = store.nextSessionOrdinal
        let session = SessionDTO(
            id: "ui-session-\(nextOrdinal)",
            dayNumber: data.dayNumber,
            sessionType: data.sessionType,
            duration: data.duration,
            bonusSeconds: data.bonusSeconds == 0 ? nil : data.bonusSeconds,
            completed: data.completed,
            actualTime: data.actualTime,
            clearPercent: data.clearPercent,
            thoughtCount: data.thoughtCount,
            mindStateLog: data.mindStateLog,
            sessionDate: data.sessionDate,
            createdAt: nil,
            buddySessionId: nil
        )
        store.nextSessionOrdinal += 1
        store.sessions.append(session)

        if data.completed && data.sessionType == .standard {
            store.user = UserDTO(
                id: store.user.id,
                email: store.user.email,
                username: store.user.username,
                isPublic: store.user.isPublic,
                currentDay: max(store.user.currentDay, data.dayNumber + 1)
            )
        }

        uiTestStore = store
        persistUITestStore()
        return session
    }

    private func uiTestGetSession(sessionId: String) throws -> (session: SessionDTO, thoughts: [ThoughtDTO])? {
        guard uiTestConfig != nil else { return nil }
        guard let store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

        guard let session = store.sessions.first(where: { $0.id == sessionId }) else {
            throw APIError(status: 404, message: "Session not found")
        }

        let thoughts = store.thoughts.filter { $0.sessionId == session.id }
            .sorted { $0.timeInSession < $1.timeInSession }
        return (session, thoughts)
    }

    private func uiTestGetThoughts() throws -> [ThoughtDTO]? {
        guard uiTestConfig != nil else { return nil }
        guard let store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)
        return store.thoughts
            .sorted {
                if $0.dayNumber == $1.dayNumber {
                    return $0.timeInSession < $1.timeInSession
                }
                return $0.dayNumber > $1.dayNumber
            }
    }

    private func uiTestBatchThoughts(_ data: BatchThoughtsRequest) throws -> [ThoughtDTO]? {
        guard uiTestConfig != nil else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

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
        uiTestStore = store
        persistUITestStore()
        return createdThoughts
    }

    /// Board data in UI test mode: empty unless snapshot seed is enabled (marketing screenshots).
    private func uiTestGetBoard() -> [BoardEntryDTO] {
        guard let uiTestConfig, uiTestConfig.snapshotSeed else { return [] }
        guard let store = uiTestStore, store.isAuthenticated else { return [] }
        let me = store.user.username
        return [
            BoardEntryDTO(username: "quietledger", currentDay: 24, streak: 18, avgClear: 84, totalSessions: 52),
            BoardEntryDTO(username: me, currentDay: store.user.currentDay, streak: 6, avgClear: 77, totalSessions: 22),
            BoardEntryDTO(username: "morningstill", currentDay: 11, streak: 9, avgClear: 71, totalSessions: 30),
            BoardEntryDTO(username: "deepamber", currentDay: 9, streak: 4, avgClear: 68, totalSessions: 17),
        ]
    }

    private func uiTestUpdateSettings(body: SettingsPatchBody) throws -> UserDTO? {
        guard let uiTestConfig else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

        var nextUsername = store.user.username
        var nextIsPublic = store.user.isPublic

        if let usernamePatch = body.username {
            let trimmed = usernamePatch.trimmingCharacters(in: .whitespacesAndNewlines)
            if uiTestConfig.forceUsernameConflict {
                throw APIError(status: 409, message: "Username already taken")
            }
            guard UsernameValidation.isValid(trimmed) else {
                throw APIError(status: 400, message: UsernameValidation.errorMessage)
            }
            nextUsername = trimmed
        }

        if let isPublicPatch = body.isPublic {
            nextIsPublic = isPublicPatch
        }

        store.user = UserDTO(
            id: store.user.id,
            email: store.user.email,
            username: nextUsername,
            isPublic: nextIsPublic,
            currentDay: store.user.currentDay
        )
        uiTestStore = store
        persistUITestStore()
        return store.user
    }

    private func uiTestUpdateNotificationPreferences(
        _ patch: NotificationPreferencesPatch
    ) throws -> NotificationPreferencesDTO? {
        guard uiTestConfig != nil else { return nil }
        guard let store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

        let current = uiTestNotificationPreferences
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
            dailyReminderTime: patch.dailyReminderTime ?? current.dailyReminderTime,
            dailyReminderFrequency: patch.dailyReminderFrequency ?? current.dailyReminderFrequency,
            quietHoursStart: quietStart,
            quietHoursEnd: quietEnd,
            tz: patch.tz ?? current.tz,
            updatedAt: current.updatedAt
        )

        uiTestNotificationPreferences = next
        return next
    }

    private func ensureUITestAuthenticated(store: UITestStore) throws {
        guard store.isAuthenticated else {
            throw APIError(status: 401, message: "Please log in", code: "UNAUTHORIZED")
        }
    }

    private func persistUITestStore() {
        guard let uiTestStore else { return }
        Self.persist(store: uiTestStore, key: uiTestStoreDefaultsKey)
    }

    /// Nonisolated static analog of `persistUITestStore()`. Used during
    /// `init` (which is nonisolated) so we don't trip Swift 6 actor-isolation
    /// errors by calling an actor-isolated instance method from there.
    private static func persist(store: UITestStore, key: String) {
        guard let encoded = try? JSONEncoder().encode(store) else { return }
        UserDefaults.standard.set(encoded, forKey: key)
    }
}

private struct SettingsPatchBody: Encodable {
    let isPublic: Bool?
    let username: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let isPublic { try c.encode(isPublic, forKey: .isPublic) }
        if let username { try c.encode(username, forKey: .username) }
    }

    private enum CodingKeys: String, CodingKey {
        case isPublic
        case username
    }
}

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

private struct UITestStore: Codable, Sendable {
    var user: UserDTO
    var loginEmail: String
    var loginPassword: String
    var isAuthenticated: Bool
    var sessions: [SessionDTO]
    var thoughts: [ThoughtDTO]
    var nextSessionOrdinal: Int
    var nextThoughtOrdinal: Int

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
            currentDay: 9
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
            nextSessionOrdinal: 100,
            nextThoughtOrdinal: 100
        )
    }
}

// MARK: - Error Types

public struct APIError: Error, LocalizedError {
    public let status: Int
    public let message: String
    public let code: String?

    public init(status: Int, message: String, code: String? = nil) {
        self.status = status
        self.message = message
        self.code = code
    }

    public var errorDescription: String? { message }
}

private struct ErrorResponse: Codable {
    let error: String
    let code: String?
}
