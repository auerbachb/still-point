/// #854: work that may only finish for the identity generation that started it.
///
/// A sit save awaits the server flush (`SessionSyncCoordinator.saveCompletedSession`),
/// so it can take as long as the network does. A sign-out and a sign-in as someone
/// else can land in that window, and whatever runs after the `await` then runs
/// against the next account: it opens the previous account's completion screen,
/// ends the next account's breath sit, credits the sit to the next account's widget
/// day, and raises or clears the next account's not-saved warning.
///
/// `run` holds the rule at the suspension point itself. It awaits the operation,
/// then reads the live generation, and only if that still matches the one captured
/// before the save does it hand the result to `apply`. The rule is the same for a
/// failed result as for a successful one, since each writes state that belongs to
/// one account. Signing out and back in as the *same* account moves the generation
/// too, so a save that spans it is discarded as well.
///
/// The operation itself always runs to the end, so discarding a result never undoes
/// the save: a sit that reached the queue stays there and syncs under the account
/// that sat it. Only what the result would have changed on screen is dropped.
///
/// ```swift
/// let generation = authGeneration
/// await GenerationScopedWork.run(startedAt: generation, liveGeneration: { authGeneration }) {
///     await save()
/// } apply: { outcome in
///     show(outcome)
/// }
/// ```
///
/// Web parity: the `sessionGeneration` checks in `src/lib/useSessionSaveLifecycle.ts`
/// (`handleSessionComplete`, #666; `handleBreathEnd`, #833).
public enum GenerationScopedWork {
    /// What became of the result.
    public enum Outcome: Equatable, Sendable {
        /// The generation still matched, so `apply` ran.
        case applied

        /// The generation moved while the operation was in flight, so `apply` did not
        /// run.
        case discarded
    }

    /// Awaits `operation`, then hands its result to `apply` only while `generation`
    /// is still live.
    ///
    /// Main-actor isolated, like the state both callers guard, so nothing can land
    /// between the generation check and `apply`.
    ///
    /// - Parameter generation: the identity generation, captured before the `await`.
    /// - Parameter liveGeneration: reads the identity generation now. Called once,
    ///   after `operation` settles.
    /// - Parameter operation: the work to wait for. It does not throw: a caller turns
    ///   a failure into a value, so a failed result is scoped the same way as a
    ///   successful one.
    /// - Parameter apply: everything that depends on the result. Runs at most once.
    @MainActor
    @discardableResult
    public static func run<Value>(
        startedAt generation: Int,
        liveGeneration: () -> Int,
        operation: () async -> Value,
        apply: (Value) -> Void
    ) async -> Outcome {
        let value = await operation()
        // Read only now. The operation is the suspension point, so the generation it
        // started under says nothing about the one that is live when it settles.
        guard liveGeneration() == generation else { return .discarded }
        apply(value)
        return .applied
    }
}
