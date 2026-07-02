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

    /// The single UI-test seam. Non-nil only when the app launches in UI-test
    /// mode (`SP_UI_TEST_MODE`); every request checks this and delegates to the
    /// fake backend instead of hitting the network (issue #416).
    private let uiTestAPIStore: UITestAPIStore?

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

        let store = UITestAPIStore.fromProcessInfo()
        self.uiTestAPIStore = store

        // The UI-test store owns wiping the UITest/AudioEngine defaults on a
        // reset launch, but the session artifacts (auth token, cookies, URL
        // credentials) live here on the client — so clear them too when a
        // reset was requested. See issue #266 for why a full wipe is needed.
        if let store, store.resetStore {
            Self.clearPersistedSessionArtifacts(session: session)
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
        if let uiTestAPIStore {
            return await uiTestAPIStore.signup(email: email, username: username, password: password)
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
        if let uiTestAPIStore {
            return try await uiTestAPIStore.login(email: email, password: password)
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
        if let uiTestAPIStore {
            return try await uiTestAPIStore.signInWithApple()
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
        if let uiTestAPIStore {
            return try await uiTestAPIStore.signInWithGoogle()
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
        if let uiTestAPIStore {
            return try await uiTestAPIStore.requestPasswordReset(email: email)
        }
        let body: [String: String] = ["email": email]
        let response: PasswordResetRequestResponse = try await post("/api/auth/password-reset/request", body: body)
        return response.message
    }

    public func logout() async throws {
        if let uiTestAPIStore {
            if await uiTestAPIStore.logout() {
                clearLocalSessionArtifacts()
            }
            return
        }
        defer { clearLocalSessionArtifacts() }
        let _: [String: Bool] = try await post("/api/auth/logout", body: Optional<String>.none)
    }

    public func deleteAccount() async throws {
        if let uiTestAPIStore {
            if await uiTestAPIStore.deleteAccount() {
                clearLocalSessionArtifacts()
            }
            return
        }
        try await delete("/api/account")
        clearLocalSessionArtifacts()
    }

    public func me() async throws -> UserDTO? {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.me()
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
        if let uiTestAPIStore {
            return await uiTestAPIStore.registerDeviceToken(request)
        }
        let response: DeviceTokenResponse = try await post("/api/device-token", body: request)
        return response.deviceToken
    }

    public func unregisterDeviceToken(_ request: DeviceTokenRegistrationRequest) async throws {
        if uiTestAPIStore != nil {
            return
        }
        var urlRequest = makeRequest(method: "DELETE", path: "/api/device-token")
        urlRequest.httpBody = try JSONEncoder().encode(request)
        _ = try await executeRaw(urlRequest)
    }

    // MARK: - Sessions

    public func getSessions() async throws -> (sessions: [SessionDTO], stats: StatsDTO) {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.getSessions()
        }
        let response: SessionsResponse = try await get("/api/sessions")
        return (response.sessions, response.stats)
    }

    public func getTracksDoneToday(date: String) async throws -> TracksDoneTodayDTO {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.getTracksDoneToday(date: date)
        }
        let encodedDate = date.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? date
        let response: TracksDoneTodayResponse = try await get("/api/track/done-today?date=\(encodedDate)")
        return response.tracksDoneToday
    }

    public func createSession(_ data: CreateSessionRequest) async throws -> SessionDTO {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.createSession(data)
        }
        let response: SessionResponse = try await post("/api/sessions", body: data)
        return response.session
    }

    public func getSessionBySessionId(_ sessionId: String) async throws -> (session: SessionDTO, thoughts: [ThoughtDTO]) {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.getSession(sessionId: sessionId)
        }
        let response: SessionDetailResponse = try await get("/api/sessions/by-session/\(sessionId)")
        return (response.session, response.thoughts)
    }

    // MARK: - Thoughts

    public func getThoughts() async throws -> [ThoughtDTO] {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.getThoughts()
        }
        let response: ThoughtsResponse = try await get("/api/thoughts")
        return response.thoughts
    }

    public func batchThoughts(_ data: BatchThoughtsRequest) async throws -> [ThoughtDTO] {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.batchThoughts(data)
        }
        let response: ThoughtsResponse = try await post("/api/thoughts/batch", body: data)
        return response.thoughts
    }

    // MARK: - Board

    public func getBoard() async throws -> [BoardEntryDTO] {
        if let uiTestAPIStore {
            return await uiTestAPIStore.getBoard()
        }
        let response: BoardResponse = try await get("/api/board")
        return response.board
    }

    // MARK: - Settings

    public func updateSettings(isPublic: Bool) async throws -> UserDTO {
        try await updateSettings(body: SettingsPatchBody(isPublic: isPublic))
    }

    public func updateSettings(username: String) async throws -> UserDTO {
        try await updateSettings(body: SettingsPatchBody(username: username))
    }

    /// #88: opt-in pre-session aphorism toggle.
    public func updateSettings(aphorismsEnabled: Bool) async throws -> UserDTO {
        try await updateSettings(body: SettingsPatchBody(aphorismsEnabled: aphorismsEnabled))
    }

    /// #113: opt-in ARKit gaze attention tracking during sessions.
    public func updateSettings(attentionTrackingEnabled: Bool) async throws -> UserDTO {
        try await updateSettings(body: SettingsPatchBody(attentionTrackingEnabled: attentionTrackingEnabled))
    }

    private func updateSettings(body: SettingsPatchBody) async throws -> UserDTO {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.updateSettings(
                isPublic: body.isPublic,
                username: body.username,
                aphorismsEnabled: body.aphorismsEnabled,
                attentionTrackingEnabled: body.attentionTrackingEnabled
            )
        }
        let response: UserResponse = try await patch("/api/settings", body: body)
        return response.user
    }

    /// #240: opt into the dual-track fork (enable a second daily track).
    public func enableDualTrack() async throws -> UserDTO {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.enableDualTrack()
        }
        let response: UserResponse = try await post("/api/track", body: Optional<String>.none)
        return response.user
    }

    // MARK: - Notification preferences

    public func getNotificationPreferences() async throws -> NotificationPreferencesDTO {
        if let uiTestAPIStore {
            return await uiTestAPIStore.getNotificationPreferences()
        }
        let response: NotificationPreferencesResponse = try await get("/api/notifications/preferences")
        return response.preferences
    }

    public func updateNotificationPreferences(_ preferencesPatch: NotificationPreferencesPatch) async throws -> NotificationPreferencesDTO {
        if let uiTestAPIStore {
            return try await uiTestAPIStore.updateNotificationPreferences(preferencesPatch)
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

}

private struct SettingsPatchBody: Encodable {
    let isPublic: Bool?
    let username: String?
    let aphorismsEnabled: Bool?
    let attentionTrackingEnabled: Bool?

    init(
        isPublic: Bool? = nil,
        username: String? = nil,
        aphorismsEnabled: Bool? = nil,
        attentionTrackingEnabled: Bool? = nil
    ) {
        self.isPublic = isPublic
        self.username = username
        self.aphorismsEnabled = aphorismsEnabled
        self.attentionTrackingEnabled = attentionTrackingEnabled
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let isPublic { try c.encode(isPublic, forKey: .isPublic) }
        if let username { try c.encode(username, forKey: .username) }
        if let aphorismsEnabled { try c.encode(aphorismsEnabled, forKey: .aphorismsEnabled) }
        if let attentionTrackingEnabled { try c.encode(attentionTrackingEnabled, forKey: .attentionTrackingEnabled) }
    }

    private enum CodingKeys: String, CodingKey {
        case isPublic
        case username
        case aphorismsEnabled
        case attentionTrackingEnabled
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
