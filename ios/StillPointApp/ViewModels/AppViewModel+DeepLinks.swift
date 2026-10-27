import Foundation
import StillPointShared

/// Incoming URLs (session, log-reason and notification links, and buddy invites) and
/// the pending copies held until a signed-in user can act on them.
///
/// #1061: the state and the routing are `DeepLinkCoordinator`'s, owned by this view
/// model as `deepLinks` (declared in `AppViewModel.swift`). These forwarders keep the
/// names the views and the other `AppViewModel+*.swift` files call.
extension AppViewModel {
    /// See `DeepLinkCoordinator.scheduleBuddyInviteConsume()`.
    func scheduleBuddyInviteConsume() {
        deepLinks.scheduleBuddyInviteConsume()
    }

    func handleIncomingURL(_ url: URL) {
        deepLinks.handleIncomingURL(url)
    }

    func handlePushDeepLink(_ url: URL) {
        handleIncomingURL(url)
    }

    func consumePendingSessionDeepLinkIfNeeded() async {
        deepLinks.consumePendingSessionDeepLinkIfNeeded()
    }

    func openLogReason(date: String) {
        deepLinks.openLogReason(date: date)
    }

    func consumePendingLogReasonIfNeeded() async {
        deepLinks.consumePendingLogReasonIfNeeded()
    }

    /// - Parameter generation: `authGeneration` as it was when the caller decided
    ///   to consume the invite, threaded through to the join so the network result
    ///   is checked against the identity that asked for it.
    func consumePendingBuddyInviteIfNeeded(startedAtGeneration generation: Int) async {
        await deepLinks.consumePendingBuddyInviteIfNeeded(startedAtGeneration: generation)
    }

    func openHomeFromNotification() {
        deepLinks.openHomeFromNotification()
    }
}
