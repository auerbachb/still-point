import Foundation
import StillPointShared

/// Incoming URLs (session, log-reason and notification links, and buddy invites) and
/// the pending copies held until a signed-in user can act on them.
///
/// The pending links, the invite task and its in-flight flag are stored properties,
/// declared in `AppViewModel.swift`.
extension AppViewModel {
    /// Transient join failure. The token is kept; the next auth point retries it.
    private static let buddyInviteRetryMessage = "Could not reach the server. We will retry your invite."

    /// Every route into the invite flow joins through `consumePendingBuddyInviteIfNeeded`,
    /// which holds `isConsumingBuddyInvite` for the whole request (#756), so two routes
    /// cannot POST the same token. Retained and guarded like the other identity-scoped
    /// work: the task body runs on a later main-actor turn, and consuming an invite is
    /// not idempotent, so a sign-out in between must not let it burn the token against
    /// whoever is signed in next (#665).
    ///
    /// No cancel of the previous task. A consume in flight would lose the server's
    /// answer, and one not started yet would run its join already cancelled while
    /// holding the in-flight flag, so this call would return without joining.
    func scheduleBuddyInviteConsume() {
        guard !isConsumingBuddyInvite else { return }
        let adopted = authGeneration
        buddyInviteTask = Task { [weak self] in
            guard let self else { return }
            guard adopted == self.authGeneration else { return }
            await self.consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        }
    }

    func handleIncomingURL(_ url: URL) {
        if let sessionType = SessionDeepLinkParser.sessionType(from: url) {
            openSessionDeepLink(sessionType)
            return
        }
        if handleNotificationDeepLink(url) {
            return
        }
        guard let token = extractBuddyToken(from: url) else { return }
        if currentUser == nil {
            pendingBuddyInviteToken = token
            return
        }
        if isInSession {
            // Queue invite while preserving in-progress local session state.
            pendingBuddyInviteToken = token
            return
        }
        // The newest link replaces an older pending one, so a later retry never
        // joins an invite the user has since moved past (#756). If a consume is
        // already waiting on the server, it only clears the token it captured and
        // picks this one up when it finishes.
        pendingBuddyInviteToken = token
        scheduleBuddyInviteConsume()
    }

    func handlePushDeepLink(_ url: URL) {
        handleIncomingURL(url)
    }

    private func openSessionDeepLink(_ sessionType: SessionType) {
        if currentUser == nil {
            pendingSessionDeepLink = sessionType
            return
        }
        if isInSession { return }
        beginSession(type: sessionType)
    }

    func consumePendingSessionDeepLinkIfNeeded() async {
        guard currentUser != nil, let sessionType = pendingSessionDeepLink else { return }
        guard !isInSession else { return }
        pendingSessionDeepLink = nil
        beginSession(type: sessionType)
    }

    func openLogReason(date: String) {
        if currentUser == nil {
            pendingLogReasonDate = date
            return
        }
        if isInSession { return }
        currentView = .logReason(date: date)
    }

    func consumePendingLogReasonIfNeeded() async {
        guard currentUser != nil, let date = pendingLogReasonDate else { return }
        guard !isInSession else { return }
        pendingLogReasonDate = nil
        currentView = .logReason(date: date)
    }

    /// - Parameter generation: `authGeneration` as it was when the caller decided
    ///   to consume the invite, threaded through to the join so the network result
    ///   is checked against the identity that asked for it.
    func consumePendingBuddyInviteIfNeeded(startedAtGeneration generation: Int) async {
        guard generation == authGeneration else { return }
        guard currentUser != nil, let token = pendingBuddyInviteToken else { return }
        // A kept invite must not pull the user out of a sit or a buddy session they
        // started after it failed. It stays queued for return-home or leave-session.
        guard !isInSession else { return }
        // The token stays pending for the whole request. Overlapping consumes
        // (a cold start and a scene activation, return-home and leave-session)
        // would otherwise POST it twice.
        guard !isConsumingBuddyInvite else { return }
        isConsumingBuddyInvite = true
        defer { isConsumingBuddyInvite = false }

        let outcome = await joinBuddySession(token: token, startedAtGeneration: generation)

        // A newer invite may have replaced this one while the request was in flight.
        // Join that one after this attempt drops the in-flight flag, and only for
        // the session that is still current. A sign-out leaves the replacement
        // alone so the next account does not inherit this call. If this one joined,
        // the `isInSession` guard keeps the newer invite queued instead of replacing
        // the session just opened.
        guard pendingBuddyInviteToken == token else {
            isConsumingBuddyInvite = false
            if generation == authGeneration, pendingBuddyInviteToken != nil {
                await consumePendingBuddyInviteIfNeeded(startedAtGeneration: generation)
            }
            return
        }
        // Sign-out via `didLogout` already nils the token. `applySignedOut` does not,
        // so a generation change has to drop *this* attempt's token or the next
        // account inherits it. A token stored since (pending != this one) is kept.
        guard generation == authGeneration else {
            pendingBuddyInviteToken = nil
            return
        }
        switch outcome {
        case .joined, .authoritativeRejection:
            // Confirmed join, or the server rejected this invite. Either way it is spent.
            pendingBuddyInviteToken = nil
        case .transientFailure, .stale:
            break
        }
    }

    private enum BuddyInviteJoinOutcome {
        case joined
        case authoritativeRejection
        case transientFailure
        /// Cancelled, or the session that started the join is gone. Do not spend
        /// the token and do not surface an error for it.
        case stale
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
            // (#665).
            guard generation == authGeneration else { return .stale }
            buddyInviteError = nil
            currentView = .buddySession(sessionId: sessionId)
            return .joined
        } catch is CancellationError {
            // Cancellation is cooperative and does not by itself stop the code
            // after this await. A sign-out's `cancelIdentityScopedTasks` must not
            // surface the previous session's failure on whoever is signed in next.
            return .stale
        } catch let urlError as URLError where urlError.code == .cancelled {
            return .stale
        } catch {
            guard generation == authGeneration else { return .stale }
            switch BuddyInviteJoinFailure.classify(error) {
            case .authoritative:
                // A newer invite may already be queued. Don't paint this rejection
                // over it; the consume that called this spends only this token.
                if pendingBuddyInviteToken == token {
                    if let apiError = error as? APIError {
                        buddyInviteError = apiError.message
                    } else {
                        buddyInviteError = "Could not open buddy invite."
                    }
                }
                return .authoritativeRejection
            case .transient:
                if pendingBuddyInviteToken == token {
                    buddyInviteError = Self.buddyInviteRetryMessage
                }
                return .transientFailure
            }
        }
    }

    func openHomeFromNotification() {
        guard currentUser != nil else { return }
        if isInSession {
            return
        }
        currentView = .home
    }

    private func handleNotificationDeepLink(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        guard scheme == "stillpoint" else { return false }
        let host = (url.host ?? "").lowercased()
        if host == "home" {
            openHomeFromNotification()
            return true
        }
        if host == "friends" {
            // Friends management UI is web-only today; land on home until an iOS friends tab ships.
            openHomeFromNotification()
            return true
        }
        if host == "log-reason" {
            let date = LogReasonDeepLinkParser.date(from: url)
            openLogReason(date: date)
            return true
        }
        return false
    }

    private func extractBuddyToken(from url: URL) -> String? {
        BuddyInviteTokenParser.token(from: url)
    }
}
