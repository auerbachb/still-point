import Foundation
import Observation
import StillPointShared

/// #1061: incoming URLs (session, log-reason and notification links, and buddy
/// invites) and the pending copies held until a signed-in user can act on them.
/// Extracted from `AppViewModel`, which owns one per scene and forwards every
/// view-facing call to it (`AppViewModel+DeepLinks.swift`).
///
/// The slot rules are ``PendingDeepLinks``'s, in StillPointShared so `swift test`
/// drives them. This type applies them to the live app state.
///
/// It reads `currentUser`, `isInSession`, `authGeneration` and
/// `isAuthCheckRouteResetPending` from its owner at each decision point, and again
/// after every await. It never writes `authGeneration` or runs an identity
/// transition: those stay in `AppViewModel.swift`.
///
/// `@Observable` because `HomeView` and `BuddySessionHubView` observe
/// `buddyInviteError`, through `AppViewModel`'s forwarding property.
@Observable
@MainActor
final class DeepLinkCoordinator {
    /// Transient join failure. The token is kept; the next auth point retries it.
    private static let buddyInviteRetryMessage = "Could not reach the server. We will retry your invite."

    /// Weak: `AppViewModel` owns this coordinator.
    @ObservationIgnored private weak var owner: AppViewModel?

    /// The links held for later. See ``PendingDeepLinks``.
    private(set) var pendingLinks = PendingDeepLinks()

    /// The last buddy-invite failure, shown by Home and the buddy hub.
    var buddyInviteError: String?

    /// Buddy invite join/consume. One property: these are alternative routes into
    /// the same invite flow and never need to run concurrently.
    @ObservationIgnored private var buddyInviteTask: Task<Void, Never>?

    /// The invite joins in flight. The token stays pending until the server answers
    /// (#756), so a second consume must not POST it again. Each consume owns its own
    /// attempt and releases only that one, so a previous account's join still in
    /// flight after a sign-out neither blocks the next account's consume nor frees
    /// the gate under it (#989). See ``BuddyInviteConsumeGate``.
    @ObservationIgnored private var buddyInviteConsumeGate = BuddyInviteConsumeGate()

    init(owner: AppViewModel) {
        self.owner = owner
    }

    // MARK: - Identity hooks (called from `AppViewModel.swift`)

    /// Part of the identity-scoped teardown. Pending links are left alone: an
    /// automatic sign-out keeps them for the next sign-in.
    func cancelBuddyInviteTask() {
        buddyInviteTask?.cancel()
        buddyInviteTask = nil
    }

    /// Explicit logout: drops every pending link and the invite error.
    func clearForLogout() {
        pendingLinks.clearAll()
        buddyInviteError = nil
    }

    // MARK: - Incoming URLs

    func handleIncomingURL(_ url: URL) {
        if let sessionType = SessionDeepLinkParser.sessionType(from: url) {
            openSessionDeepLink(sessionType)
            return
        }
        if handleNotificationDeepLink(url) {
            return
        }
        guard let token = BuddyInviteTokenParser.token(from: url), let owner else { return }
        // The newest link replaces an older pending one, so a later retry never
        // joins an invite the user has since moved past (#756). Signed out or in a
        // session, it is only queued, preserving in-progress local session state.
        // If a consume is already waiting on the server, it only clears the token it
        // captured and picks this one up when it finishes.
        switch pendingLinks.receiveBuddyInvite(
            token: token,
            isSignedIn: owner.currentUser != nil,
            isInSession: owner.isInSession
        ) {
        case .scheduleConsume:
            scheduleBuddyInviteConsume()
        case .held:
            break
        }
    }

    private func openSessionDeepLink(_ sessionType: SessionType) {
        guard let owner else { return }
        switch pendingLinks.receiveSession(
            sessionType,
            isSignedIn: owner.currentUser != nil,
            isInSession: owner.isInSession
        ) {
        case .open(let type):
            owner.beginSession(type: type)
        case .queued, .ignored:
            break
        }
    }

    func consumePendingSessionDeepLinkIfNeeded() {
        guard let owner,
              let sessionType = pendingLinks.takeSession(
                  isSignedIn: owner.currentUser != nil,
                  isInSession: owner.isInSession
              ) else { return }
        owner.beginSession(type: sessionType)
    }

    func openLogReason(date: String) {
        guard let owner else { return }
        switch pendingLinks.receiveLogReason(
            date: date,
            isSignedIn: owner.currentUser != nil,
            isInSession: owner.isInSession
        ) {
        case .open(let date):
            owner.currentView = .logReason(date: date)
        case .queued, .ignored:
            break
        }
    }

    func consumePendingLogReasonIfNeeded() {
        guard let owner,
              let date = pendingLinks.takeLogReason(
                  isSignedIn: owner.currentUser != nil,
                  isInSession: owner.isInSession
              ) else { return }
        owner.currentView = .logReason(date: date)
    }

    func openHomeFromNotification() {
        guard let owner, owner.currentUser != nil else { return }
        if owner.isInSession {
            return
        }
        owner.currentView = .home
    }

    /// Applies the route `NotificationDeepLinkRoute` decides (#832). `false` means
    /// the URL is not a notification link and `handleIncomingURL` continues to the
    /// next route. `true` claims it, even when navigation is then suppressed.
    private func handleNotificationDeepLink(_ url: URL) -> Bool {
        guard let route = NotificationDeepLinkRoute.route(for: url) else { return false }
        switch route {
        case .home:
            openHomeFromNotification()
        case .friends:
            // Friends management UI is web-only today; land on home until an iOS friends tab ships.
            openHomeFromNotification()
        case .logReason:
            let date = LogReasonDeepLinkParser.date(from: url)
            openLogReason(date: date)
        }
        return true
    }

    // MARK: - Buddy invite consume

    /// Every route into the invite flow joins through `consumePendingBuddyInviteIfNeeded`,
    /// which holds an attempt in `buddyInviteConsumeGate` for the whole request (#756), so two routes
    /// cannot POST the same token. Retained and guarded like the other identity-scoped
    /// work: the task body runs on a later main-actor turn, and consuming an invite is
    /// not idempotent, so a sign-out in between must not let it burn the token against
    /// whoever is signed in next (#665).
    ///
    /// No cancel of the previous task. A consume in flight would lose the server's
    /// answer, and one not started yet would run its join already cancelled while
    /// holding the in-flight flag, so this call would return without joining.
    func scheduleBuddyInviteConsume() {
        guard let adopted = owner?.authGeneration else { return }
        guard !buddyInviteConsumeGate.blocks(generation: adopted, token: pendingLinks.buddyInviteToken) else { return }
        buddyInviteTask = Task { [weak self] in
            guard let self else { return }
            guard adopted == self.owner?.authGeneration else { return }
            await self.consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        }
    }

    /// - Parameter generation: `authGeneration` as it was when the caller decided
    ///   to consume the invite, threaded through to the join so the network result
    ///   is checked against the identity that asked for it.
    func consumePendingBuddyInviteIfNeeded(startedAtGeneration generation: Int) async {
        guard let token = consumableBuddyInviteToken(startedAtGeneration: generation) else { return }
        // The token stays pending for the whole request. Overlapping consumes
        // (a cold start and a scene activation, return-home and leave-session)
        // would otherwise POST it twice. The attempt is this call's own (#989): a
        // previous account's join still in flight blocks only its own token, and its
        // release cannot free the gate for this one.
        guard let attempt = buddyInviteConsumeGate.acquire(generation: generation, token: token) else { return }
        defer { buddyInviteConsumeGate.release(attempt) }

        let outcome = await joinBuddySession(token: token, startedAtGeneration: generation)

        // A newer invite may have replaced this one while the request was in flight.
        // Join that one after this attempt drops the in-flight flag, and only for
        // the session that is still current. A sign-out leaves the replacement
        // alone so the next account does not inherit this call. If this one joined,
        // the `isInSession` guard keeps the newer invite queued instead of replacing
        // the session just opened.
        guard pendingLinks.buddyInviteToken == token else {
            buddyInviteConsumeGate.release(attempt)
            if generation == owner?.authGeneration, pendingLinks.buddyInviteToken != nil {
                await consumePendingBuddyInviteIfNeeded(startedAtGeneration: generation)
            }
            return
        }
        // Sign-out via `didLogout` already cleared the token. `applySignedOut` does
        // not, so a generation change has to drop *this* attempt's token or the next
        // account inherits it. A token stored since (pending != this one) is kept.
        guard generation == owner?.authGeneration else {
            pendingLinks.clearBuddyInviteToken(ifEqualTo: token)
            return
        }
        switch outcome {
        case .joined, .authoritativeRejection:
            // Confirmed join, or the server rejected this invite. Either way it is spent.
            pendingLinks.clearBuddyInviteToken(ifEqualTo: token)
        case .transientFailure, .stale, .deferred:
            break
        }
    }

    /// The pending token, when a consume started under `generation` may join it now.
    private func consumableBuddyInviteToken(startedAtGeneration generation: Int) -> String? {
        guard let owner, generation == owner.authGeneration else { return nil }
        guard owner.currentUser != nil, let token = pendingLinks.buddyInviteToken else { return nil }
        // A kept invite must not pull the user out of a sit or a buddy session they
        // started after it failed. It stays queued for return-home or leave-session.
        // The join checks again once the server answers, for a sit started while the
        // request was in flight (#856).
        guard !owner.isInSession else { return nil }
        return token
    }

    private enum BuddyInviteJoinOutcome {
        case joined
        case authoritativeRejection
        case transientFailure
        /// Cancelled, or the session that started the join is gone. Do not spend
        /// the token and do not surface an error for it.
        case stale
        /// #856: the server accepted the join, but routing now would replace a sit
        /// started during the request, or be undone by a newer auth check's route
        /// reset. Not spent: a later consume joins again, which the server takes as
        /// a rejoin, and routes then.
        case deferred
    }

    /// - Parameter generation: `authGeneration` at the point the join was decided.
    ///   Required rather than defaulted, matching `applySettingsUser`, so a new
    ///   call site cannot forget it and silently reintroduce the stale-write bug.
    private func joinBuddySession(token: String, startedAtGeneration generation: Int) async -> BuddyInviteJoinOutcome {
        do {
            let sessionId = try await APIClient.shared.joinBuddySession(token: token)
            // The request is a suspension point like every other identity-scoped
            // network call here. The pre-task guards only decided whether to
            // *start* the join; a sign-out or account switch landing while it was
            // in flight must not route the replacement account into this session
            // (#665). Nor may it replace a sit started meanwhile, or route just
            // before a newer `checkAuth()` resets the route to the initial view,
            // which would spend the invite on a screen the user never keeps (#856).
            guard let owner else { return .stale }
            switch BuddyInviteJoinRouting.decision(
                startedAtGeneration: generation,
                liveGeneration: owner.authGeneration,
                isInSession: owner.isInSession,
                routeResetPending: owner.isAuthCheckRouteResetPending
            ) {
            case .stale:
                return .stale
            case .deferForSession, .deferForRouteReset:
                return .deferred
            case .route:
                owner.enterBuddySession(sessionId: sessionId)
                return .joined
            }
        } catch is CancellationError {
            // Cancellation is cooperative and does not by itself stop the code
            // after this await. A sign-out's `cancelIdentityScopedTasks` must not
            // surface the previous session's failure on whoever is signed in next.
            return .stale
        } catch let urlError as URLError where urlError.code == .cancelled {
            return .stale
        } catch {
            guard generation == owner?.authGeneration else { return .stale }
            switch BuddyInviteJoinFailure.classify(error) {
            case .authoritative:
                // A newer invite may already be queued. Don't paint this rejection
                // over it; the consume that called this spends only this token.
                if pendingLinks.buddyInviteToken == token {
                    if let apiError = error as? APIError {
                        buddyInviteError = apiError.message
                    } else {
                        buddyInviteError = "Could not open buddy invite."
                    }
                }
                return .authoritativeRejection
            case .transient:
                if pendingLinks.buddyInviteToken == token {
                    buddyInviteError = Self.buddyInviteRetryMessage
                }
                return .transientFailure
            }
        }
    }
}
