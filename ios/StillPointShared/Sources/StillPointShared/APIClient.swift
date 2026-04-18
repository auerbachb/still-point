import Foundation

/// Network client for the Still Point web API.
/// Uses cookie auth where available and bearer token auth for native reliability.
public actor APIClient {
    public static let shared = APIClient()

    // Default to the deployed web app; override for local dev
    private var baseURL: URL

    private let session: URLSession

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
    }

    public func setBaseURL(_ url: URL) {
        self.baseURL = url
    }

    // MARK: - Auth

    public func signup(email: String, username: String, password: String) async throws -> UserDTO {
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

    public func logout() async throws {
        defer { clearLocalSessionArtifacts() }
        let _: [String: Bool] = try await post("/api/auth/logout", body: Optional<String>.none)
    }

    public func deleteAccount() async throws {
        try await delete("/api/account")
        clearLocalSessionArtifacts()
    }

    public func me() async throws -> UserDTO? {
        do {
            let response: UserResponse = try await get("/api/auth/me")
            return response.user
        } catch let error as APIError where error.status == 401 {
            return nil
        }
    }

    // MARK: - Sessions

    public func getSessions() async throws -> (sessions: [SessionDTO], stats: StatsDTO) {
        let response: SessionsResponse = try await get("/api/sessions")
        return (response.sessions, response.stats)
    }

    public func createSession(_ data: CreateSessionRequest) async throws -> SessionDTO {
        let response: SessionResponse = try await post("/api/sessions", body: data)
        return response.session
    }

    public func getSession(dayNumber: Int) async throws -> (session: SessionDTO, thoughts: [ThoughtDTO]) {
        let response: SessionDetailResponse = try await get("/api/sessions/\(dayNumber)")
        return (response.session, response.thoughts)
    }

    // MARK: - Thoughts

    public func getThoughts() async throws -> [ThoughtDTO] {
        let response: ThoughtsResponse = try await get("/api/thoughts")
        return response.thoughts
    }

    public func batchThoughts(_ data: BatchThoughtsRequest) async throws -> [ThoughtDTO] {
        let response: ThoughtsResponse = try await post("/api/thoughts/batch", body: data)
        return response.thoughts
    }

    // MARK: - Board

    public func getBoard() async throws -> [BoardEntryDTO] {
        let response: BoardResponse = try await get("/api/board")
        return response.board
    }

    // MARK: - Settings

    public func updateSettings(isPublic: Bool) async throws -> UserDTO {
        let body = ["isPublic": isPublic]
        let response: UserResponse = try await patch("/api/settings", body: body)
        return response.user
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
                message: errorBody?.error ?? "Request failed"
            )
        }
        return (data, httpResponse)
    }

    private func clearLocalSessionArtifacts() {
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
}

// MARK: - Error Types

public struct APIError: Error, LocalizedError {
    public let status: Int
    public let message: String

    public var errorDescription: String? { message }
}

private struct ErrorResponse: Codable {
    let error: String
}
