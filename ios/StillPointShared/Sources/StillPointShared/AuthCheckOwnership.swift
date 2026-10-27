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
///
/// #857: `didLogin(user:)`'s catch-up and `returnHome()` end the same way, but they
/// take no check ID, so they ask only the generation question, through
/// ``ownsLocalLinks(startedAtGeneration:liveGeneration:)``.
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

    /// #857: `true` while a tail with no check ID may still open the pending session
    /// and log-reason links, because the account it started under is still the live one
    /// once its buddy-invite join returns.
    ///
    /// `didLogin(user:)`'s catch-up and `returnHome()` each join a pending buddy invite
    /// and then open the local links, as `checkAuth()` does. The join is a network
    /// request, so a sign-out and a sign-in as someone else can both land before it
    /// returns. Whatever is pending when it returns belongs to the account signed in by
    /// then, and the flow that signed that account in opens those links in its own
    /// order. A tail that opened one anyway could spend it on a screen that flow then
    /// replaces, the failure #827 fixed in `checkAuth()`.
    ///
    /// The generation alone is enough here. Neither tail has a check ID, and each
    /// guards its join on the generation already. A sign-out always moves the
    /// generation, so signing back in as the same account ends the tail too.
    /// Re-confirming the account already signed in leaves it where it was, so a lone
    /// tail still opens its links.
    ///
    /// A tail that is no longer current returns and leaves the links pending, the same
    /// as a superseded check.
    ///
    /// - Parameter generation: the identity generation the tail joined the invite under.
    /// - Parameter liveGeneration: the identity generation now, read after the join.
    public static func ownsLocalLinks(
        startedAtGeneration generation: Int,
        liveGeneration: Int
    ) -> Bool {
        generation == liveGeneration
    }
}
