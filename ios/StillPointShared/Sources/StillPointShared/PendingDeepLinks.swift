/// #1061: the links an incoming URL leaves for later, and the rules for when each one
/// is held, opened, or dropped. `DeepLinkCoordinator` (app target) holds one of these
/// and applies its answers; the rules live here so `swift test` drives them.
///
/// Three slots, one value each. They are not queues: a newer link of the same kind
/// replaces an older one, because the user has since moved past it.
///
/// - A session link or log-reason link is held while nobody is signed in, opened at
///   once when someone is signed in and not in a session, and ignored during a
///   session. An ignored link leaves an earlier queued one in place.
/// - A buddy invite token is always stored. A consume is scheduled only when
///   someone is signed in and not in a session; otherwise it waits for the next
///   auth point, return-home, or leave-session.
///
/// Sign-out semantics: an explicit logout (`didLogout()`) calls ``clearAll()``. An
/// automatic sign-out (`applySignedOut(cause:message:)`, an expired or rejected
/// session) does not, so the links stay for the next sign-in on purpose
/// (`AuthCheckOwnershipLocalLinksTests`).
///
/// Home and friends notification routes navigate or do nothing; they have no slot.
///
/// Not thread-safe by itself: the app holds it on a `@MainActor` coordinator.
public struct PendingDeepLinks: Sendable, Equatable {
    /// What a session or log-reason link should do now.
    public enum Receipt<Value: Sendable & Equatable>: Sendable, Equatable {
        /// Signed in and not in a session: open it now. The slot is untouched.
        case open(Value)
        /// Nobody is signed in: the slot now holds this link.
        case queued
        /// In a session: dropped. Any earlier queued link of this kind is kept.
        case ignored
    }

    /// What a buddy invite should do now. The token is stored either way.
    public enum BuddyInviteReceipt: Sendable, Equatable {
        /// Signed in and not in a session: schedule a consume.
        case scheduleConsume
        /// Signed out or in a session: wait for a later consume point.
        case held
    }

    public private(set) var sessionType: SessionType?
    public private(set) var logReasonDate: String?
    public private(set) var buddyInviteToken: String?

    public init(sessionType: SessionType? = nil, logReasonDate: String? = nil, buddyInviteToken: String? = nil) {
        self.sessionType = sessionType
        self.logReasonDate = logReasonDate
        self.buddyInviteToken = buddyInviteToken
    }

    /// Whether every slot is empty.
    public var isEmpty: Bool {
        sessionType == nil && logReasonDate == nil && buddyInviteToken == nil
    }

    // MARK: - Session link

    public mutating func receiveSession(
        _ type: SessionType,
        isSignedIn: Bool,
        isInSession: Bool
    ) -> Receipt<SessionType> {
        Self.receive(type, into: &sessionType, isSignedIn: isSignedIn, isInSession: isInSession)
    }

    /// The queued session link, cleared, when it may open now. `nil` keeps the slot.
    public mutating func takeSession(isSignedIn: Bool, isInSession: Bool) -> SessionType? {
        Self.take(from: &sessionType, isSignedIn: isSignedIn, isInSession: isInSession)
    }

    // MARK: - Log-reason link

    public mutating func receiveLogReason(
        date: String,
        isSignedIn: Bool,
        isInSession: Bool
    ) -> Receipt<String> {
        Self.receive(date, into: &logReasonDate, isSignedIn: isSignedIn, isInSession: isInSession)
    }

    /// The queued log-reason date, cleared, when it may open now. `nil` keeps the slot.
    public mutating func takeLogReason(isSignedIn: Bool, isInSession: Bool) -> String? {
        Self.take(from: &logReasonDate, isSignedIn: isSignedIn, isInSession: isInSession)
    }

    // MARK: - Buddy invite

    /// Stores `token`, replacing any older one (#756). A consume already waiting on
    /// the server clears only the token it captured, and picks this one up after.
    public mutating func receiveBuddyInvite(
        token: String,
        isSignedIn: Bool,
        isInSession: Bool
    ) -> BuddyInviteReceipt {
        buddyInviteToken = token
        return isSignedIn && !isInSession ? .scheduleConsume : .held
    }

    /// Clears the buddy token only while it is still `token`. A consume that spent, or
    /// lost, its own token must not clear a newer invite stored during its request.
    public mutating func clearBuddyInviteToken(ifEqualTo token: String) {
        if buddyInviteToken == token { buddyInviteToken = nil }
    }

    // MARK: - Sign-out

    /// Explicit logout: drops every pending link. Automatic sign-out does not call it.
    public mutating func clearAll() {
        sessionType = nil
        logReasonDate = nil
        buddyInviteToken = nil
    }

    // MARK: - Shared rules

    private static func receive<Value: Sendable & Equatable>(
        _ value: Value,
        into slot: inout Value?,
        isSignedIn: Bool,
        isInSession: Bool
    ) -> Receipt<Value> {
        if !isSignedIn {
            slot = value
            return .queued
        }
        if isInSession { return .ignored }
        return .open(value)
    }

    private static func take<Value>(from slot: inout Value?, isSignedIn: Bool, isInSession: Bool) -> Value? {
        guard isSignedIn, let value = slot, !isInSession else { return nil }
        slot = nil
        return value
    }
}
