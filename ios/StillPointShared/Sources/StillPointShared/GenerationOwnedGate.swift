/// #854: a busy gate that belongs to the identity generation that took it.
///
/// `AppViewModel.completeBreathSession` holds a gate for the whole save, so a second
/// End tap cannot write a duplicate row. The save waits on the server flush, so a
/// sign-out and a sign-in as someone else can land before it settles. A `Bool` gate
/// cannot tell whose save is holding it:
///
/// - Left alone, the previous account's save still holds it when the next account
///   taps End, so that End returns without saving the sit.
/// - Lowered on sign-out, it lets that End through, but the old save still lowers
///   it again when it settles. By then the gate is the next account's, so a second
///   End from that account can start a duplicate.
///
/// Storing the owner's generation instead answers both. A hold from an earlier
/// generation is no hold at all for the live one, and only the generation that holds
/// the gate can free it. The same race on web is #833 problem 5.
///
/// Web parity: `breathSavingRef` in `src/lib/useSessionSaveLifecycle.ts`.
///
/// Not thread-safe by itself: hold it on an actor or, as the app does, on a
/// `@MainActor` type.
public struct GenerationOwnedGate: Sendable {
    /// The generation that holds the gate, or `nil` while it is free.
    private var owner: Int?

    public init() {}

    /// Whether `generation` holds the gate. A hold by any other generation does not
    /// count, so a previous account's save never reads as busy to the live account.
    public func isHeld(by generation: Int) -> Bool {
        owner == generation
    }

    /// Takes the gate for `generation`.
    ///
    /// - Returns: `false`, changing nothing, when `generation` already holds it.
    ///   A hold by an earlier generation is replaced: the account that took it is
    ///   gone, and its own ``release(for:)`` leaves this hold alone.
    public mutating func acquire(for generation: Int) -> Bool {
        guard owner != generation else { return false }
        owner = generation
        return true
    }

    /// Frees the gate if `generation` still holds it, and otherwise does nothing.
    /// A save that settles after its account is gone cannot free the gate the next
    /// account's save took.
    public mutating func release(for generation: Int) {
        guard owner == generation else { return }
        owner = nil
    }
}
