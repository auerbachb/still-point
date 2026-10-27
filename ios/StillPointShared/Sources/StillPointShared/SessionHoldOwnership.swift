/// #1058: which account a scene's sit belongs to, for the server-side notification hold.
///
/// `SessionNotificationSuppressionController` is device-global, and an auth boundary
/// clears its keys but not each scene's sitting flags. On iPad a scene can still be in
/// a sit for account A after the device's credentials become account B. Without an
/// owner, the next preference hydration mints a fresh key for that sit and reports it
/// under B's credentials, which silences B's notifications for one hold TTL.
///
/// The owner is the scene's account at the moment the aggregate sit starts
/// (`sitting` goes false→true). It is kept for as long as the sit runs and cleared when
/// it ends. A repeated `true` update, a preference change or a hydration never
/// reassigns it, so an uninterrupted A sit cannot move to B.
///
/// Not thread-safe by itself: hold it on an actor or, as the app does, on a
/// `@MainActor` type.
public struct SessionHoldOwnership: Sendable, Equatable {
    /// The account that started the running sit, or `nil` when no sit runs or the
    /// scene had no account when it started.
    public private(set) var ownerAccountId: String?
    /// The aggregate `sitting` value last passed to ``update(sitting:sceneAccountId:)``.
    public private(set) var sitting = false

    public init() {}

    /// Records the scene's new aggregate `sitting` value.
    ///
    /// - Parameter sceneAccountId: the scene's account right now. Read only when the
    ///   sit starts (false→true); ignored while the sit keeps running.
    public mutating func update(sitting newSitting: Bool, sceneAccountId: String?) {
        switch (sitting, newSitting) {
        case (false, true):
            ownerAccountId = sceneAccountId
        case (true, false):
            ownerAccountId = nil
        default:
            break
        }
        sitting = newSitting
    }

    /// Whether this sit may be reported or refreshed under the credentials of
    /// `credentialOwnerAccountId`. Requires a running sit whose owner is known and
    /// equal to the credential owner; an unknown owner on either side never matches.
    /// (A release for a sit that has ended is checked against the owner its session
    /// key was minted for, which the controller keeps beside the key.)
    public func isReportable(forCredentialOwner credentialOwnerAccountId: String?) -> Bool {
        guard sitting, let ownerAccountId, let credentialOwnerAccountId else { return false }
        return ownerAccountId == credentialOwnerAccountId
    }
}
