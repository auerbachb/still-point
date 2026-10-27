/// #989: the single-flight rule for buddy-invite consumes, with an owner per attempt.
///
/// `AppViewModel.consumePendingBuddyInviteIfNeeded` holds the invite token pending for
/// the whole join request, so a second consume must not start while one is in flight or
/// it would POST the same token twice (#756). That used to be one `Bool`, raised by the
/// consume and lowered in its `defer`. Nothing else lowered it, so a join the previous
/// account started (`returnHome()`'s, or `checkAuth()`'s, neither of which a sign-out
/// cancels) kept it raised until its request returned. The next account's first
/// consume, `didLogin`'s catch-up, met the raised flag and returned, and the invite
/// waited for some later auth point.
///
/// Lowering the flag at sign-out would not have fixed it. The stale join's `defer` would
/// then lower it again while the next account's join is in flight, which reopens the
/// double-POST window. So each consume takes an attempt here and releases only that
/// attempt, and an attempt blocks a new one only when either
///
/// - it belongs to the live identity generation. Same account, same flow: one join at a
///   time, as before. Or
/// - it is posting the same token. A sign-out through `applySignedOut` keeps the pending
///   token, and the stale join drops it when it returns. The next account must not POST
///   it again in the meantime, so the token blocks across a generation change.
///
/// A sign-out or a different-account adoption therefore needs no reset here: bumping
/// `authGeneration` is what expires the old attempt for every other token. A teardown
/// (Issue #916's different-account adoption included) must not clear the gate, because
/// that would drop the same-token protection while the stale request is still out.
///
/// The generation half is ``GenerationOwnedGate``'s rule for the breath-save gate
/// (#854). That gate cannot be reused as is: a breath save carries nothing that the
/// next account could send again, while a kept invite token can, so this one also
/// remembers what each attempt is posting.
///
/// Not thread-safe by itself: the app holds it on the `@MainActor` view model.
public struct BuddyInviteConsumeGate: Sendable, Equatable {
    /// One consume that has started its join and not yet released.
    public struct Attempt: Sendable, Equatable {
        public let id: Int
        public let generation: Int
        public let token: String
    }

    private var nextID = 0
    public private(set) var inFlight: [Attempt] = []

    public init() {}

    /// Whether a consume of `token` must not start now, under `generation`.
    /// A `nil` token blocks on the generation alone, for callers that check before
    /// reading the token.
    public func blocks(generation: Int, token: String?) -> Bool {
        inFlight.contains { attempt in
            attempt.generation == generation || (token != nil && attempt.token == token)
        }
    }

    /// Whether any attempt of the live generation is in flight.
    public func isHeld(liveGeneration: Int) -> Bool {
        blocks(generation: liveGeneration, token: nil)
    }

    /// Starts an attempt, or returns `nil` when ``blocks(generation:token:)`` says no.
    public mutating func acquire(generation: Int, token: String) -> Attempt? {
        guard !blocks(generation: generation, token: token) else { return nil }
        nextID &+= 1
        let attempt = Attempt(id: nextID, generation: generation, token: token)
        inFlight.append(attempt)
        return attempt
    }

    /// Ends `attempt`. Releasing one already released is a no-op, so the consume's
    /// early release and its `defer` can both run. It never touches another attempt.
    public mutating func release(_ attempt: Attempt) {
        inFlight.removeAll { $0.id == attempt.id }
    }
}
