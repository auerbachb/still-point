import Foundation
import StillPointShared

/// Incoming URLs (session, log-reason and notification links, and buddy invites) and
/// the pending copies held until a signed-in user can act on them.
///
/// #1061: the state and the routing are `DeepLinkCoordinator`'s, owned by this view
/// model as `deepLinks` (declared in `AppViewModel.swift`). These forwarders keep the
/// names the views and the other `AppViewModel+*.swift` files call.
///
/// #1087: every `deepLinks` forwarder lives here, grouped in the coordinator's own
/// section order. A new link kind adds its forwarder to the matching section below
/// rather than to `AppViewModel.swift`; a coordinator method nothing outside the
/// coordinator calls gets no forwarder.
extension AppViewModel {
    // MARK: - Incoming URLs

    func handleIncomingURL(_ url: URL) {
        deepLinks.handleIncomingURL(url)
    }

    /// The push-notification entry point (wired once, in `RootView`). It takes the
    /// same path as `handleIncomingURL` but stays a distinct seam for push-specific
    /// handling.
    func handlePushDeepLink(_ url: URL) {
        handleIncomingURL(url)
    }

    // MARK: - Pending session and log-reason links

    func consumePendingSessionDeepLinkIfNeeded() async {
        deepLinks.consumePendingSessionDeepLinkIfNeeded()
    }

    func openLogReason(date: String) {
        deepLinks.openLogReason(date: date)
    }

    func consumePendingLogReasonIfNeeded() async {
        deepLinks.consumePendingLogReasonIfNeeded()
    }

    // MARK: - Buddy invite consume

    /// The last buddy-invite failure, shown by `HomeView` and `BuddySessionHubView`.
    /// #1061: stored on `deepLinks`, which is `@Observable`, so a view reading this
    /// still re-renders when it changes.
    var buddyInviteError: String? {
        get { deepLinks.buddyInviteError }
        set { deepLinks.buddyInviteError = newValue }
    }

    /// See `DeepLinkCoordinator.scheduleBuddyInviteConsume()`.
    func scheduleBuddyInviteConsume() {
        deepLinks.scheduleBuddyInviteConsume()
    }

    /// - Parameter generation: `authGeneration` as it was when the caller decided
    ///   to consume the invite, threaded through to the join so the network result
    ///   is checked against the identity that asked for it.
    func consumePendingBuddyInviteIfNeeded(startedAtGeneration generation: Int) async {
        await deepLinks.consumePendingBuddyInviteIfNeeded(startedAtGeneration: generation)
    }
}
