/// #852: what an online auth check may do to the screen when it lands mid-sit.
///
/// `AppViewModel.checkAuth()` runs from `RootView`'s `.task` and again on every
/// `scenePhase == .active`, which includes any `.inactive` to `.active` cycle such as
/// pulling down Control Center. Once `me()` re-confirms the account, the check resets
/// the route to the initial authenticated view and clears the per-track badges. Done
/// mid-sit, that reset replaces the session screen with Home.
///
/// The offline fallback, `enterOfflineMode`, already keeps the route and the badges
/// while `isInSession` is true. This rule gives the online path the same behavior,
/// with one difference: if the check adopted a *different* account, the route still
/// resets. A sit that belongs to the previous account must not continue under the new
/// one.
///
/// Every `isInSession` view is protected, because each one holds state that a route
/// change would lose:
///
/// - `.session` and `.buddySession`: the live sit. `SessionView` owns its model as
///   `@State`, so replacing the screen ends the timer, and a buddy session stops
///   polling without leaving.
/// - `.completion`: the note, ratings and mood the screen flushes when it closes.
/// - `.breathCounting`: the count in progress.
/// - `.focusPicker` and `.focusActivity`: the focus flow and the sit it starts (#840).
///
/// The full-screen loading overlay is opaque, so raising it mid-sit would cover the
/// timer for the length of the `me()` request. The session already shows valid
/// content, so the overlay is not raised there.
///
/// The pending session, log-reason and buddy-invite consumers each check
/// `isInSession` already, so they leave their links queued during a sit and
/// `returnHome()` opens them after it. This rule does not change that.
public enum ForegroundAuthRoutePolicy {
    /// `true` when the check should reset the route and the per-track badges after it
    /// adopts the account.
    ///
    /// - Parameter isInSession: whether a session view is on screen when the reset
    ///   would run.
    /// - Parameter identityChanged: whether the adoption moved the identity
    ///   generation, which happens on a cold start (no account to an account) and on
    ///   an account switch, but not on re-confirming the account already signed in.
    public static func shouldResetRoute(isInSession: Bool, identityChanged: Bool) -> Bool {
        !isInSession || identityChanged
    }

    /// `true` when the check should raise the full-screen loading overlay while its
    /// `me()` request is in flight.
    ///
    /// - Parameter isInSession: whether a session view is on screen when the request
    ///   is about to leave.
    public static func shouldRaiseLoadingOverlay(isInSession: Bool) -> Bool {
        !isInSession
    }
}
