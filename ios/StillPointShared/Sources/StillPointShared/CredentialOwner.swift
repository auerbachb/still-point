import Foundation

/// #1058: the account that owns the device's shared credentials right now.
///
/// `SessionNotificationSuppressionController` is device-global and a scene's
/// `currentUser` can lag the shared token: on iPad, scene 1 can still show account A
/// after scene 2 signed in as B. Only the credential boundary in `APIClient` knows
/// which account a request will authenticate as, so it publishes that account here:
///
/// - ``invalidate()`` before the token is installed, replaced or cleared;
/// - ``publish(accountId:)`` once a sign-in installed the new account's credentials;
/// - ``confirm(accountId:ifStillCurrent:)`` when `/me` names the account behind the
///   token already installed (cold start, reconnect), unless a newer change landed.
///
/// Every change advances ``Snapshot/generation``, so a caller that read a snapshot
/// can tell whether the owner changed since, even when it changed back.
///
/// Kept in memory only: after a cold start the owner is unknown until `/me`
/// confirms it, and nothing reports a session hold under an unknown owner.
public final class CredentialOwner: @unchecked Sendable {
    public struct Snapshot: Sendable, Equatable {
        /// The account that owns the credentials, or `nil` while unknown or signed out.
        public let accountId: String?
        /// Advances on every change to `accountId`.
        public let generation: Int
    }

    public static let shared = CredentialOwner()

    private let lock = NSLock()
    private var accountId: String?
    private var generation = 0

    public init() {}

    /// The owner and its generation, read together.
    public var snapshot: Snapshot {
        lock.lock()
        defer { lock.unlock() }
        return Snapshot(accountId: accountId, generation: generation)
    }

    /// Whether nothing changed the owner since `snapshot` was taken.
    public func isCurrent(_ snapshot: Snapshot) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return snapshot.generation == generation
    }

    /// Marks the owner unknown. Call before the credentials are replaced or cleared,
    /// so a reader never pairs the outgoing account with the incoming token.
    public func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        accountId = nil
        generation += 1
    }

    /// Records `accountId` as the owner of credentials just installed.
    public func publish(accountId newAccountId: String) {
        lock.lock()
        defer { lock.unlock() }
        accountId = newAccountId
        generation += 1
    }

    /// Records `accountId` as the owner of the credentials that were installed when
    /// `snapshot` was taken — but only if nothing changed the owner since, so a slow
    /// `/me` from before a sign-in never overwrites the account that signed in.
    ///
    /// - Returns: whether the owner is now `accountId`.
    @discardableResult
    public func confirm(accountId newAccountId: String, ifStillCurrent snapshot: Snapshot) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard snapshot.generation == generation else { return false }
        // Re-confirming the same account changes nothing, so it keeps the
        // generation: a routine `/me` must not look like an account change.
        if accountId != newAccountId {
            accountId = newAccountId
            generation += 1
        }
        return true
    }
}
