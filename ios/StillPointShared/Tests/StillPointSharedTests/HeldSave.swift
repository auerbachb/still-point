/// #854: a save held open until the test lets it settle, which is the window a
/// sign-out can land in. Built on `AsyncStream`, like the held upload in
/// `SessionSyncCoordinatorEndNoteClearTests`, so nothing here sleeps.
///
/// Shared by `GenerationScopedWorkTests` and `GenerationOwnedGateTests`, and by
/// `AuthCheckOwnershipLocalLinksTests` and `BuddyInviteJoinRoutingTests`, where it holds
/// a buddy-invite join open (#857, #856).
struct HeldSave<Value: Sendable>: Sendable {
    private let value: Value
    private let started: AsyncStream<Void>
    private let markStarted: AsyncStream<Void>.Continuation
    private let released: AsyncStream<Void>
    private let release: AsyncStream<Void>.Continuation

    /// - Parameter value: what the save returns once it settles.
    init(settlingWith value: Value) {
        self.value = value
        (started, markStarted) = AsyncStream<Void>.makeStream()
        (released, release) = AsyncStream<Void>.makeStream()
    }

    /// The save itself. Waits for ``settle()``, then returns the value it was built
    /// with. Call it once.
    func perform() async -> Value {
        markStarted.yield()
        for await _ in released { break }
        return value
    }

    /// Returns once ``perform()`` has started and is waiting.
    func untilStarted() async {
        for await _ in started { break }
    }

    /// Lets ``perform()`` return. Buffered, so it may come before the save starts.
    func settle() {
        release.yield()
    }
}
