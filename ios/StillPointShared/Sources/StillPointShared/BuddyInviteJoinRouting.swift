/// #856: where a buddy-invite join the server accepted may take the user.
///
/// `AppViewModel.consumePendingBuddyInviteIfNeeded` decides whether to *start* a join
/// before the request: someone signed in, an invite pending, no sit running. The request
/// is a suspension point, so the screen that decision was made for can be gone by the
/// time the server answers. The join used to re-check only the identity generation, then
/// route to the buddy session and spend the invite. Two other changes went unchecked:
///
/// - A sit started during the request. Routing would tear the sit's screen down. The
///   invite waits for the sit to end instead, as it does when it arrives during one.
/// - A newer `checkAuth()` started, and its route reset has not landed yet. That reset
///   replaces whatever is on screen with the initial view, so a join that routes first
///   is spent on a screen the user never keeps. The invite waits for that check, which
///   consumes it after the reset. A check that ends without one leaves it for the next
///   consume.
///
/// A deferral leaves the route alone and the invite pending. The server already counts
/// the user as a participant and accepts a later join with the same token as a rejoin,
/// so the retry costs one request. A session that ended in between answers `409`, which
/// spends the invite as ``BuddyInviteJoinFailure`` already decides. With both reasons at
/// once, the sit is the one reported. The app treats the two deferrals the same.
///
/// A moved generation outranks both deferrals. The join then belongs to an account that
/// is no longer the live one, and it is stale exactly as before (#665).
public enum BuddyInviteJoinRouting {
    public enum Decision: Sendable, Equatable {
        /// Open the buddy session. The invite is spent.
        case route
        /// The account that started the join is no longer the live one. Nothing routes.
        case stale
        /// A sit, a breath sit, a completion screen or another buddy session is up. The
        /// invite stays pending until it ends.
        case deferForSession
        /// The newest auth check has yet to reset the route. The invite stays pending for
        /// that check to consume after its reset.
        case deferForRouteReset
    }

    /// - Parameter generation: the identity generation the join started under.
    /// - Parameter liveGeneration: the identity generation now, read after the join.
    /// - Parameter isInSession: whether a session screen is up now
    ///   (`AppViewModel.isInSession`).
    /// - Parameter routeResetPending: whether the newest `checkAuth()` has started and has
    ///   neither reset the route nor ended.
    public static func decision(
        startedAtGeneration generation: Int,
        liveGeneration: Int,
        isInSession: Bool,
        routeResetPending: Bool
    ) -> Decision {
        guard generation == liveGeneration else { return .stale }
        if isInSession { return .deferForSession }
        if routeResetPending { return .deferForRouteReset }
        return .route
    }
}
