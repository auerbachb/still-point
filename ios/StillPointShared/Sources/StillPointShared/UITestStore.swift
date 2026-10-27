import Foundation

/// The fake backend's persisted state, held by `UITestAPIStore` and written to
/// `UserDefaults` after every change. Split out of `UITestAPIStore.swift` (issue
/// #1052); the snapshot seed lives in `UITestStore+Snapshot.swift`.
struct UITestStore: Codable, Sendable {
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

    // MARK: - Persistence

    /// Reads the store saved under `key`, or `nil` when none is saved or it no
    /// longer decodes.
    static func load(key: String) -> UITestStore? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(UITestStore.self, from: data)
    }

    /// Saves the store under `key`. An encoding failure leaves the saved copy as it was.
    func persist(key: String) {
        guard let encoded = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(encoded, forKey: key)
    }
}
