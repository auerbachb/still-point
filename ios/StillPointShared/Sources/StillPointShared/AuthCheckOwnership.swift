/// #827: whether an auth check may still act for the account it confirmed.
///
/// `AppViewModel.checkAuth()` runs from `RootView`'s `.task` and again on every
/// `scenePhase == .active`, so two checks for the same account overlap routinely.
/// Once a check has adopted the account it resets the route and, after the badge
/// refresh, consumes the pending session, log-reason and buddy-invite links. Only the
/// newest check may do either. A superseded check that consumes a link routes to it
/// just before the newest check's own route reset replaces that screen with the
/// initial view, so the link is spent on a screen the user never gets to keep.
///
/// Two values answer two different questions, and the answer needs both:
///
/// - The identity generation: is this still the account the check adopted? Signing
///   out or switching accounts moves it.
/// - The check ID: is this still the newest check? Every check takes the next one
///   when it starts.
///
/// The generation alone cannot answer for the check. Re-confirming the account
/// already signed in is deliberately not an identity transition, so a newer check
/// for the same account leaves the generation exactly where the older one found it.
///
/// A superseded check stops and leaves the pending links where they are. That loses
/// nothing: the newest check consumes them after its own route reset, or, if it ends
/// without adopting the account, handles them as a lone check would.
public enum AuthCheckOwnership {
    /// `true` while the check that took `checkID` is still the newest one and the
    /// account it adopted is still the live one.
    ///
    /// - Parameter checkID: the ID the check took when it started.
    /// - Parameter newestCheckID: the ID the newest check took.
    /// - Parameter generation: the identity generation the check adopted.
    /// - Parameter liveGeneration: the identity generation now.
    public static func isCurrent(
        checkID: Int,
        newestCheckID: Int,
        generation: Int,
        liveGeneration: Int
    ) -> Bool {
        checkID == newestCheckID && generation == liveGeneration
    }
}
