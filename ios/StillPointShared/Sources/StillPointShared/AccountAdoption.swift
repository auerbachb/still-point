/// #916: what adopting a server-confirmed account does to the account already on screen.
///
/// On iPad each `WindowGroup` scene builds its own `AppViewModel` over one signed-in
/// session and one `CachedIdentityStore`. When one window signs out and signs in as
/// someone else, another window's next `checkAuth()`, reconnect refresh or cached
/// identity read hands it that account while its own state still belongs to the
/// previous one: the open sit, completion or breath screen, the background tasks, the
/// tracking unlock, the suppression preference, the Home badges and the not-saved
/// warning. Before #916 the adoption only moved the generation, so in-flight work was
/// rejected but none of that state was torn down.
///
/// Three cases, and only one of them tears anything down:
///
/// - ``firstUser``: nothing on screen. There is no previous account to tear down.
/// - ``sameAccount``: the account already on screen, re-confirmed. Not a transition,
///   so neither the generation nor the state moves.
/// - ``differentAccount``: another account replaces the one on screen. The generation
///   moves and the previous account's local state is torn down before the new one is
///   installed.
///
/// ``adopt(current:incoming:advanceGeneration:tearDown:install:)`` runs the effects in
/// one fixed order — generation, then teardown, then install — the order web's
/// `adoptUser` uses (Issue #868 / PR #903): the generation is invalidated first, so
/// nothing the teardown cancels or clears can be written back by a late response for
/// the old account, and the teardown runs while the old identity is still installed.
///
/// A first adoption still moves the generation, unlike web, as iOS always has: the
/// callers re-capture the generation after adopting, and #916 asks only that a first
/// adoption tear nothing down.
public enum AccountAdoption: Equatable, Sendable {
    /// No account was on screen.
    case firstUser

    /// The account on screen, re-confirmed.
    case sameAccount

    /// A different account replaces the one on screen.
    case differentAccount

    /// Classifies adopting `incoming` while `current` is on screen.
    ///
    /// - Parameter current: the ID of the account on screen, or `nil` when none is.
    /// - Parameter incoming: the ID of the account being adopted.
    public static func classify<ID: Equatable>(current: ID?, incoming: ID) -> AccountAdoption {
        guard let current else { return .firstUser }
        return current == incoming ? .sameAccount : .differentAccount
    }

    /// Whether this adoption invalidates in-flight identity-scoped work.
    public var advancesGeneration: Bool {
        self != .sameAccount
    }

    /// Whether this adoption tears down the previous account's local state.
    public var requiresTeardown: Bool {
        self == .differentAccount
    }

    /// Classifies the adoption, then runs its effects in order: `advanceGeneration`
    /// when the generation moves, `tearDown` when a previous account is replaced, and
    /// `install` always.
    ///
    /// Main-actor isolated, like the state the effects change, so nothing can land
    /// between them.
    ///
    /// - Parameter current: the ID of the account on screen, or `nil` when none is.
    /// - Parameter incoming: the ID of the account being adopted.
    /// - Parameter advanceGeneration: invalidates in-flight identity-scoped work.
    /// - Parameter tearDown: removes the previous account's local state. Runs with the
    ///   previous account still installed.
    /// - Parameter install: installs the incoming account.
    /// - Returns: the classification, so a caller can act on what it replaced.
    @MainActor
    @discardableResult
    public static func adopt<ID: Equatable>(
        current: ID?,
        incoming: ID,
        advanceGeneration: () -> Void,
        tearDown: () -> Void,
        install: () -> Void
    ) -> AccountAdoption {
        let adoption = classify(current: current, incoming: incoming)
        if adoption.advancesGeneration { advanceGeneration() }
        if adoption.requiresTeardown { tearDown() }
        install()
        return adoption
    }
}
