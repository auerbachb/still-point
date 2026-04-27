import Foundation

/// Network client for the Still Point web API.
/// Uses cookie auth where available and bearer token auth for native reliability.
public actor APIClient {
    public static let shared = APIClient()

    // Default to the deployed web app; override for local dev
    private var baseURL: URL

    private let session: URLSession
    private let uiTestConfig: UITestConfig?
    private var uiTestStore: UITestStore?
    private let uiTestStoreDefaultsKey = "StillPoint.UITest.Store"

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
                defaults.removeObject(forKey: uiTestStoreDefaultsKey)
                AudioEngine.resetPersistedPrefs()
                Self.clearPersistedSessionArtifacts(session: session)
            }

            if let persistedData = defaults.data(forKey: uiTestStoreDefaultsKey),
               let persistedStore = try? JSONDecoder().decode(UITestStore.self, from: persistedData) {
                self.uiTestStore = persistedStore
            } else {
                self.uiTestStore = UITestStore.makeDefault(seedAuthenticated: parsedUITestConfig.seedAuthenticated)
                persistUITestStore()
            }
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

    public func getSession(dayNumber: Int) async throws -> (session: SessionDTO, thoughts: [ThoughtDTO]) {
        if let uiTestResult = try uiTestGetSession(dayNumber: dayNumber) {
            return uiTestResult
        }
        let response: SessionDetailResponse = try await get("/api/sessions/\(dayNumber)")
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
            return []
        }
        let response: BoardResponse = try await get("/api/board")
        return response.board
    }

    // MARK: - Settings

    public func updateSettings(isPublic: Bool) async throws -> UserDTO {
        if let user = try uiTestUpdateSettings(isPublic: isPublic) {
            return user
        }
        let body = ["isPublic": isPublic]
        let response: UserResponse = try await patch("/api/settings", body: body)
        return response.user
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
        let url = baseURL.appendingPathComponent(path)
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
        return (sortedSessions, Self.makeUITestStats(for: sortedSessions))
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
            duration: data.duration,
            completed: data.completed,
            actualTime: data.actualTime,
            clearPercent: data.clearPercent,
            thoughtCount: data.thoughtCount,
            mindStateLog: data.mindStateLog,
            sessionDate: data.sessionDate,
            buddySessionId: nil
        )
        store.nextSessionOrdinal += 1
        store.sessions.append(session)

        if data.completed {
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

    private func uiTestGetSession(dayNumber: Int) throws -> (session: SessionDTO, thoughts: [ThoughtDTO])? {
        guard uiTestConfig != nil else { return nil }
        guard let store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)

        guard let session = store.sessions.last(where: { $0.dayNumber == dayNumber }) else {
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

    private func uiTestUpdateSettings(isPublic: Bool) throws -> UserDTO? {
        guard uiTestConfig != nil else { return nil }
        guard var store = uiTestStore else {
            throw APIError(status: 0, message: "UI test store is unavailable")
        }
        try ensureUITestAuthenticated(store: store)
        store.user = UserDTO(
            id: store.user.id,
            email: store.user.email,
            username: store.user.username,
            isPublic: isPublic,
            currentDay: store.user.currentDay
        )
        uiTestStore = store
        persistUITestStore()
        return store.user
    }

    private func ensureUITestAuthenticated(store: UITestStore) throws {
        guard store.isAuthenticated else {
            throw APIError(status: 401, message: "Please log in", code: "UNAUTHORIZED")
        }
    }

    private func persistUITestStore() {
        guard let uiTestStore else { return }
        guard let encoded = try? JSONEncoder().encode(uiTestStore) else { return }
        UserDefaults.standard.set(encoded, forKey: uiTestStoreDefaultsKey)
    }

    private static func makeUITestStats(for sessions: [SessionDTO]) -> StatsDTO {
        guard !sessions.isEmpty else {
            return StatsDTO(streak: 0, avgClearPercent: 0, avgThoughtsPerSession: 0, avgThoughtsPerMinute: 0)
        }

        let completedSessions = sessions.filter(\.completed)
        let streak = completedSessions.count
        let totalClear = sessions.reduce(0) { $0 + $1.clearPercent }
        let totalThoughts = sessions.reduce(0) { $0 + $1.thoughtCount }
        let totalMinutes = sessions.reduce(0.0) { partial, session in
            let duration = Double(max(session.actualTime ?? session.duration, 1))
            return partial + (duration / 60.0)
        }
        let avgClearPercent = totalClear / sessions.count
        let avgThoughtsPerSession = Double(totalThoughts) / Double(sessions.count)
        let avgThoughtsPerMinute = totalMinutes > 0 ? Double(totalThoughts) / totalMinutes : 0
        return StatsDTO(
            streak: streak,
            avgClearPercent: avgClearPercent,
            avgThoughtsPerSession: avgThoughtsPerSession,
            avgThoughtsPerMinute: avgThoughtsPerMinute
        )
    }
}

private struct UITestConfig: Sendable {
    let seedAuthenticated: Bool
    let resetStore: Bool
    let forceLaunchOffline: Bool
    let forceTokenExpired: Bool
    let forceSessionsFailure: Bool

    static func fromProcessInfo() -> UITestConfig? {
        let env = ProcessInfo.processInfo.environment
        guard truthy(env["SP_UI_TEST_MODE"]) else { return nil }
        return UITestConfig(
            seedAuthenticated: truthy(env["SP_UI_TEST_SEED_AUTH"]),
            resetStore: truthy(env["SP_UI_TEST_RESET_STORE"]),
            forceLaunchOffline: truthy(env["SP_UI_TEST_FORCE_LAUNCH_OFFLINE"]),
            forceTokenExpired: truthy(env["SP_UI_TEST_FORCE_TOKEN_EXPIRED"]),
            forceSessionsFailure: truthy(env["SP_UI_TEST_FORCE_SESSIONS_FAILURE"])
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
