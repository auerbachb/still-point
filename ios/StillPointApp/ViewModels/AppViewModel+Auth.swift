import Foundation
import StillPointShared
import os

/// Auth checks and server reads of the account: the cold-start and scene-activation
/// `checkAuth()`, the reconnect refresh, sign-in, and the `me()` reads that run from
/// the settings queue.
///
/// The identity transitions these end in (adopt, offline-adopt, sign-out) live in
/// `AppViewModel.swift`, the only file that may bump `authGeneration`.
extension AppViewModel {
    /// Diagnostic logger for `[E2E-DIAG]` lines. os_log is used (not `print`)
    /// so the lines reach the xcresult bundle in CI. Issue #276.
    private static let diagLog = Logger(subsystem: "com.brettonauerbach.stillpoint", category: "e2e-diag")

    func checkAuth() async {
        let startedAt = Date()
        // Not only the cold-start path: `RootView` also runs this on every
        // `scenePhase == .active`, so it re-validates an *existing* session as
        // often as it establishes a new one. A sign-out landing while `me()` is
        // suspended would otherwise let the late response re-adopt the old account
        // and route back into the authenticated UI (#665).
        let generation = authGeneration
        // Overlapping checks are possible (cold start immediately followed by a
        // scene activation). Only the newest may drop the overlay: an older check
        // finishing first would otherwise clear it while the newest is still
        // awaiting `me()`, briefly exposing an intermediate or stale route.
        activeAuthCheckID &+= 1
        let checkID = activeAuthCheckID
        // Raised inside the operation rather than here. Waiting for a place in line is
        // an `await` of unbounded length — a queued save may be sitting on a camera or
        // microphone prompt — and this overlay is opaque and full-screen
        // (`RootView.swift`), so raising it now would hide the whole app for someone
        // else's save on top of this check's own `me()`. Cleared here either way: the
        // `defer` below is what pairs with it, so the overlay covers the follow-up work
        // at the end of this function exactly as it did before the read was queued.
        defer {
            if checkID == activeAuthCheckID {
                isLoading = false
                // #856: the newest check can end without its route reset — the offline
                // fallback, a sign-out, an account change — and a late invite join must
                // not wait on a reset that is no longer coming. After a reset it is
                // already down.
                isAuthCheckRouteResetPending = false
            }
            // Diagnostic for issue #266 / #276. Gated on UI-test mode so we
            // don't leak PII in production logs. Switched to os_log
            // (Logger.notice) because `print()` from the app process is not
            // captured by Xcode UI test xcresult bundles — that's why the
            // prior diagnostic from PR #261 never showed up in CI.
            if ProcessInfo.processInfo.environment["SP_UI_TEST_MODE"] == "1" {
                let elapsedMs = Self.elapsedMs(since: startedAt)
                Self.diagLog.notice("[E2E-DIAG] checkAuth.done currentView=\(self.viewSlug(self.currentView), privacy: .public) currentUser=\(self.currentUser?.email ?? "nil", privacy: .public) elapsedMs=\(elapsedMs, privacy: .public)")
            }
        }
        // Unlike the overlay, raised here (#856): the route reset below is owed from the
        // moment this check exists, however long the queue wait. A buddy-invite join that
        // routed before it would have its screen replaced with the invite already spent,
        // so one that returns while this is up leaves the invite pending for the consume
        // after the reset.
        isAuthCheckRouteResetPending = true

        // Enqueued rather than run outright: this read adopts a whole `UserDTO`, so a
        // settings save whose PATCH left first would otherwise supersede it and put
        // that save's response — which may predate today's sit — into `currentUser`
        // and the offline cache (#697). Awaited, because the routing below and the
        // overlay's own lifetime both depend on the answer.
        //
        // Only the read and its adoption are queued. Everything below needs the account
        // but cannot contradict a settings `UserDTO` — the per-track badge query hits a
        // different endpoint, and the invite/deep-link consumptions are not account
        // writes at all — so holding the line through them would make every later
        // toggle, `enableDualTrack()` and `returnHome()`'s post-sit read wait on network
        // work that was never racing them. Same shape as `returnHome()`.
        let check: Task<Int?, Never> = enqueueSettingsRead { [weak self] in
            guard let self else { return nil }
            return await self.performAuthCheck(startedAt: startedAt, generation: generation, checkID: checkID)
        }
        // `nil` covers every outcome that is not an adoption — a superseded check, no
        // session, or the offline fallback — each of which finished its own work inside
        // the operation and leaves nothing here to run.
        guard let adopted = await check.value else { return }
        // Re-checked because giving the queue turn back is itself a suspension point:
        // a newer `checkAuth()` can have started while this one was resuming. Adopting
        // the user is idempotent, but the route reset and the badge reset below are not
        // — the reason the operation guards them on the check ID before adopting — and
        // that guard cannot cover a change that lands after the operation returns.
        guard isCurrentAuthCheck(checkID, adoptedAt: adopted) else { return }
        // #852: this runs on every scene activation, so it is reached mid-sit whenever
        // the app comes back to the foreground. Same rule as `enterOfflineMode`: while a
        // session is running, the route and the badge reset that goes with it are left
        // alone, unless the adoption switched accounts, since the sit on screen belongs
        // to the previous one. See `ForegroundAuthRoutePolicy`. The badge refresh below
        // still runs either way, so #699's reset-before-refresh order holds whenever the
        // reset does.
        if ForegroundAuthRoutePolicy.shouldResetRoute(
            isInSession: isInSession,
            identityChanged: adopted != generation
        ) {
            resetTrackCompletionBadges()
            currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
        }
        // #856: the reset has landed (or was skipped for a running session, whose
        // screen nothing here replaces), and nothing later in this check replaces a buddy
        // session, so a join that returns from here on may route. One still in flight
        // makes this check's own consume below return early, and routes when it lands.
        isAuthCheckRouteResetPending = false
        authStatusMessage = nil
        lastColdStartAuthCheckMs = Self.elapsedMs(since: startedAt)
        PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
        hydrateNotificationSuppressionPreference()
        await refreshTracksDoneToday()
        // The guard above only covered the route reset. The refresh is another
        // suspension point, and everything below it is an identity-scoped side effect —
        // the widget snapshot and three non-idempotent deep-link/invite consumptions —
        // so none of it may run for a session that has since been replaced, nor for a
        // check that a newer one has since superseded. The second case matters for the
        // same account too: a superseded check that got past here would open a pending
        // link just before the newer check's route reset sent the user back to the
        // initial view (#827). Stopping here loses nothing. The links stay pending for
        // the newest check, which consumes them after its own route reset — or, if it
        // ends without adopting, the offline fallback opens the local ones and a sign-out
        // keeps all three for the next sign-in. Every path the newest check can end on
        // writes the widget snapshot, so skipping it here costs nothing either.
        guard isCurrentAuthCheck(checkID, adoptedAt: adopted) else { return }
        syncWidgetData()
        await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        // The invite join is the last suspension point here, and a newer check can start
        // while it is in flight. Same rule as above for the two local links. Neither
        // consumer suspends, so no check is needed between them.
        guard isCurrentAuthCheck(checkID, adoptedAt: adopted) else { return }
        await consumePendingSessionDeepLinkIfNeeded()
        await consumePendingLogReasonIfNeeded()
    }

    /// Whether the check that took `checkID` and adopted the account at `generation`
    /// may still act for it: still the newest check, for an account that is still the
    /// live one. Every step `checkAuth()` takes after the adoption is gated on this; see
    /// `AuthCheckOwnership` for why both halves are needed (#827).
    private func isCurrentAuthCheck(_ checkID: Int, adoptedAt generation: Int) -> Bool {
        AuthCheckOwnership.isCurrent(
            checkID: checkID,
            newestCheckID: activeAuthCheckID,
            generation: generation,
            liveGeneration: authGeneration
        )
    }

    /// The body of `checkAuth()`, run from the settings queue.
    ///
    /// - Parameter startedAt: when the caller began, for the cold-start timing metric.
    /// - Parameter generation: `authGeneration` as it was when the check was asked for.
    /// - Parameter checkID: `activeAuthCheckID` as it was then, so a superseded check
    ///   cannot route or sign out on behalf of a newer one.
    /// - Returns: the generation the rest of `checkAuth()` belongs to, after an
    ///   adoption — or `nil` for every other outcome, each of which is terminal and has
    ///   already done its own work here.
    private func performAuthCheck(startedAt: Date, generation: Int, checkID: Int) async -> Int? {
        // Re-checked now that the queue turn has arrived: waiting for a place in line
        // is an `await` like any other, so a sign-out or account switch can have landed
        // while a slower save ahead of us was still resolving, and neither this read
        // nor the routing under it belongs to the session that replaced ours.
        guard generation == authGeneration, checkID == activeAuthCheckID else { return nil }
        // Raised here rather than at the caller's entry, so the overlay means "this
        // check's `me()` is in flight" again and not "somebody's settings save is".
        // Cleared by the caller's `defer`, which is reached whichever way this returns.
        // #852: raised mid-sit too, but `showsLoadingOverlay` does not draw it over a
        // session, including one that starts while `me()` is in flight. See
        // `ForegroundAuthRoutePolicy`.
        isLoading = true
        // Taken here, immediately before the request, so it records when this read
        // left rather than when it was asked for (#697). Taken unconditionally even
        // though only the re-confirmation branch below spends it — a ticket that goes
        // unused leaves a gap and nothing else.
        let settingsTicket = nextSettingsRequestTicket()

        do {
            if let user = try await APIClient.shared.me(today: creditedSessionDate()) {
                // Paired with the check ID for the same reason as the terminal
                // branches below. Adopting the user is idempotent, but the route
                // reset and the badge reset under it are not: `RootView` starts a
                // check from both `.task` and `scenePhase == .active`, and since
                // re-confirming the same account does not move the generation, an
                // older call landing after the newest one finished would send a
                // user who has since navigated back to the initial view.
                guard generation == authGeneration, checkID == activeAuthCheckID else { return nil }
                // Re-confirming the account already on screen still goes through the
                // settings ordering (#697). The queue turn above is what makes this
                // response the newest word — no settings save can be in flight — so
                // the guard is the backstop rather than the mechanism, and it is kept
                // for the caller that reads the account without queueing. A superseded
                // read would change nothing anyway: a newer settings write already
                // described this account, `isOfflineMode` included, so the side effects
                // below run either way; they are keyed to this being the newest check,
                // not to the adoption. A cold start or an account switch adopts
                // directly instead; see `adoptAccountRead`.
                adoptAccountRead(user, startedAtGeneration: generation, requestTicket: settingsTicket)
                // Re-captured deliberately, and handed back rather than used here.
                // Adopting the user is itself an expected transition on a cold start
                // (nil -> user), so the entry generation is stale from here on *by
                // design* and reusing it would skip the side effects on every launch.
                // The entry capture protects the decision to adopt; this one protects
                // everything the caller runs after it.
                return authGeneration
            }
            // `me()` swallows a 401 that is *not* `TOKEN_EXPIRED` and returns nil:
            // the server answered, and the answer was "no session". Authoritative —
            // but only for the session that asked. `checkAuth()` runs on every scene
            // activation, so an older overlapping call must not sign out the account
            // that has signed in since.
            //
            // The generation alone cannot express that. Re-confirming the *same*
            // account is deliberately not a transition (`applyAuthenticatedUser`),
            // so once a newer check has confirmed this user the generation is
            // unchanged and an older check's "no session" would still pass this
            // guard. `activeAuthCheckID` is the value that distinguishes newest
            // from superseded — the same reason it gates the overlay above — so a
            // stale answer can no longer sign the live account out.
            guard generation == authGeneration, checkID == activeAuthCheckID else { return nil }
            applySignedOut(cause: .signedOut, message: nil)
        } catch {
            // #665: a failed request is not a sign-out. `OfflineAuth` makes that
            // call once, in the taxonomy #676 gave the widget, so the app and the
            // widget can never disagree about what "signed out" means.
            // Same reasoning as the nil branch, including the check-ID half: a
            // transport failure belonging to a superseded call must not drag the
            // current session into offline mode or sign it out, and after a newer
            // check has re-confirmed the same account the generation no longer
            // moves to say so.
            guard generation == authGeneration, checkID == activeAuthCheckID else { return nil }
            let cachedUser = CachedIdentityStore.load()
            let outcome = OfflineAuth.outcome(for: error, hasCachedIdentity: cachedUser != nil)
            // Matching on the pair keeps the cached user's presence and the
            // outcome from drifting apart: without an identity to render there is
            // nothing to fall back to, whatever the outcome says.
            switch (outcome, cachedUser) {
            case let (.offline(cause), .some(user)):
                // Kept inside the operation, unlike the adoption path's follow-up: this
                // is the outcome of the same `me()`, it establishes the offline
                // identity rather than acting on one, and it is deliberately free of
                // network `await`s (its catch-up is detached), so it holds the line for
                // local work only.
                await enterOfflineMode(user: user, cause: cause)
                lastColdStartAuthCheckMs = Self.elapsedMs(since: startedAt)
                return nil
            case (.offline, .none), (.signedOut, _):
                applySignedOut(cause: outcome.cause, message: Self.authStatusMessage(for: error))
            }
        }
        lastColdStartAuthCheckMs = Self.elapsedMs(since: startedAt)
        return nil
    }

    /// Status line for a route to sign-in. Unchanged from the pre-#665 behavior:
    /// whatever the server said, else the generic connection copy.
    private static func authStatusMessage(for error: Error) -> String? {
        (error as? APIError)?.message ?? "Connection failed. Please try again."
    }

    /// #665: non-`async` entry point for the reconnect refresh so the view layer
    /// hands ownership of the task to the view model instead of spawning an
    /// unstructured one it cannot cancel.
    func refreshAfterReconnectInBackground() {
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshAfterReconnect()
        }
    }

    /// #665: reconcile with the server once connectivity returns.
    ///
    /// Deliberately narrow. It refreshes identity and today's state *in place* and
    /// never re-routes on success — re-running `checkAuth()` here would flash the
    /// cold-start overlay and send the user back to Home, which is exactly the
    /// user-visible reset offline-first exists to avoid (and would eject someone
    /// mid-sit). Only an authoritative rejection moves anyone to sign-in.
    ///
    /// The queued-sit upload is the other half and already exists (#557):
    /// `NetworkReachabilityMonitor` flushes the write queue on the same transition.
    func refreshAfterReconnect() async {
        guard currentUser != nil, currentView != .auth else { return }
        // Captured before the await: signing out (or switching accounts) while
        // `me()` is in flight must not let the response reinstate the old session.
        // Applying it would resurrect a signed-out account *and* re-save the cached
        // identity `applySignedOut` just tore down via `clearIfAuthoritative` (#676).
        let generation = authGeneration
        // Enqueued for the same reason as `checkAuth()`: this read adopts a whole
        // `UserDTO`, and a settings save whose PATCH left first would otherwise
        // supersede it wholesale (#697). And, as there, only the read and its adoption
        // are queued — the badge refresh and the invite join below need the account but
        // cannot contradict a settings `UserDTO`, so holding the line through them would
        // park every later settings write behind network work that was never racing it.
        let refresh: Task<Int?, Never> = enqueueSettingsRead { [weak self] in
            guard let self else { return nil }
            return await self.performReconnectRefresh(startedAtGeneration: generation)
        }
        // `nil` is every non-adopting outcome — a replaced session, a sign-out, or a
        // request that still could not get through — and none of them has follow-up.
        guard let adopted = await refresh.value else { return }
        // Handing the queue turn back is a suspension point like any other, so the
        // session can end between the adoption and here.
        guard adopted == authGeneration else { return }
        PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
        hydrateNotificationSuppressionPreference()
        await refreshTracksDoneToday()
        // Re-checked again here: `refreshTracksDoneToday()` is itself a suspension
        // point, so the session can end between the check above and this line.
        // Consuming the invite is not idempotent — it burns the token and joins a
        // session — so it must not run for a session that has since been replaced.
        // (`consumePendingBuddyInviteIfNeeded`'s own `currentUser != nil` test cannot
        // tell a new account from the old one.)
        guard adopted == authGeneration else { return }
        await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
    }

    /// The body of `refreshAfterReconnect()`, run from the settings queue.
    ///
    /// - Parameter generation: `authGeneration` as it was when the reconnect fired.
    /// - Returns: the generation the rest of `refreshAfterReconnect()` belongs to, after
    ///   an adoption — or `nil` when nothing was adopted and there is no follow-up.
    private func performReconnectRefresh(startedAtGeneration generation: Int) async -> Int? {
        // Re-checked now that the queue turn has arrived, as in `performAuthCheck`:
        // the wait is an `await`, so the session that asked for this refresh may be
        // gone, and applying the response would resurrect it (#665).
        guard generation == authGeneration else { return nil }
        // Same reasoning as `checkAuth()`: this is a read of an account already
        // adopted, taken immediately before the request so it records when the read
        // left. The queue turn already makes it the newest word; the ticket is the
        // backstop (#697).
        let settingsTicket = nextSettingsRequestTicket()
        do {
            guard let user = try await APIClient.shared.me(today: creditedSessionDate()) else {
                guard generation == authGeneration else { return nil }
                applySignedOut(cause: .signedOut, message: nil)
                return nil
            }
            guard generation == authGeneration else { return nil }
            // Ordered rather than adopted outright. A superseded read leaves
            // `currentUser` on the newer settings response, which already cleared
            // `isOfflineMode` on its way through `applyAuthenticatedUser`, so the
            // reconnect still ends with the app online either way and the refreshes
            // below still belong to this account. A reconnect that returns a
            // *different* account is a legitimate transition and keeps adopting
            // directly, as before — it is not this race, and the guard would read it
            // as `.discarded`.
            adoptAccountRead(user, startedAtGeneration: generation, requestTicket: settingsTicket)
            // Re-captured after adoption and handed back, as in `performAuthCheck()`:
            // if the reconnect ever returns a different account, that adoption is a
            // legitimate transition and the caller's follow-up belongs to the account
            // we just adopted.
            return authGeneration
        } catch let apiError as APIError where apiError.status == 401 {
            // The cached identity outlived the server session — the accepted cost
            // of sitting offline on a stale copy. Sign in again, now, rather than
            // having been signed out back when the network dropped. Generation-
            // guarded like the success path: a 401 for the *previous* session must
            // not sign out an account that has since signed in.
            guard generation == authGeneration else { return nil }
            applySignedOut(cause: .unauthorized, message: apiError.message)
            return nil
        } catch {
            // Still no usable answer: stay on local state, say nothing.
            return nil
        }
    }

    private func viewSlug(_ view: AppView) -> String {
        switch view {
        case .auth: return "auth"
        case .home: return "home"
        case .session: return "session"
        case .buddyHub: return "buddyHub"
        case .buddyCalendar: return "buddyCalendar"
        case .buddyCalendarWithBuddy: return "buddyCalendarWithBuddy"
        case .buddySession: return "buddySession"
        case .completion: return "completion"
        case .breathCounting: return "breathCounting"
        case .focusPicker: return "focusPicker"
        case .focusActivity: return "focusActivity"
        case .logReason: return "logReason"
        case .history: return "history"
        case .journal: return "journal"
        case .board: return "board"
        case .settings: return "settings"
        }
    }

    func didLogin(user: UserDTO) {
        applyAuthenticatedUser(user)
        // Re-captured after adoption, same rule as `checkAuth()`: signing in is
        // itself the transition, so the generation to defend is the one that exists
        // once this user is adopted.
        let adopted = authGeneration
        resetTrackCompletionBadges()
        currentView = .home
        // Reset to Home so a prior session's tab (e.g. Settings) doesn't leak
        // across auth transitions now that selectedTab lives on the view model.
        selectedTab = MainTab.home.rawValue
        authStatusMessage = nil
        PushNotificationCoordinator.shared.registerIfAlreadyAuthorized()
        hydrateNotificationSuppressionPreference()
        // Retained and generation-guarded like the other identity-scoped catch-ups.
        // `refreshTracksDoneToday()` self-guards, but it returns silently either
        // way, so the caller cannot infer from it whether the session survived —
        // hence the explicit re-check before the widget sync and the three
        // non-idempotent consumptions.
        loginCatchUpTask?.cancel()
        loginCatchUpTask = Task { [weak self] in
            guard let self else { return }
            // #664: missed-day gap detection — the thing that *starts* a recovery
            // ramp — runs only in `GET /api/auth/me`, never in the login response.
            // Without this read a returning user who signs in after a gap gets no
            // ramp for the whole visit: no badge, and today's sit at full length
            // rather than the ramped one, until some later foreground happens to
            // call `me()`. Web re-fetches at the same point for the same reason
            // (#238).
            //
            // Enqueued and ticketed like the other whole-`UserDTO` reads: sign-in
            // lands on Home, where a settings write can start while this is in
            // flight, and adopting either response out of order drops the other's
            // fields (#697).
            let refresh: Task<Int?, Never> = self.enqueueSettingsRead { [weak self] in
                guard let self else { return nil }
                return await self.refreshUserFromServer(startedAtGeneration: adopted)
            }
            // `nil` is the session being gone — replaced while the read was in
            // flight, or rejected outright by it; everything below is
            // identity-scoped, and the consumptions below are not idempotent. A read
            // that merely failed returns the entry generation, so a flaky network
            // still leaves the badge refresh and the consumptions to run.
            guard let live = await refresh.value else { return }
            await self.refreshTracksDoneToday()
            guard live == self.authGeneration else { return }
            self.syncWidgetData()
            await self.consumePendingBuddyInviteIfNeeded(startedAtGeneration: live)
            // The invite join is the last suspension point here, and an identity change
            // can land while it is in flight (#857). A sign-out cancels this task and the
            // join with it, but cancelling does not stop the code below, and adopting a
            // different account cancels nothing. Same rule as `checkAuth()` after its
            // join: the two local links stay pending for the account that is live by
            // then. Neither consumer suspends, so no check is needed between them.
            guard AuthCheckOwnership.ownsLocalLinks(
                startedAtGeneration: live,
                liveGeneration: self.authGeneration
            ) else { return }
            await self.consumePendingSessionDeepLinkIfNeeded()
            await self.consumePendingLogReasonIfNeeded()
        }
    }

    /// Fetch the server-synced suppress-during-session opt-in at an auth point so
    /// `PushNotificationCoordinator.willPresent` reflects current server truth
    /// even before the Notifications screen is opened this launch (#431).
    private func hydrateNotificationSuppressionPreference() {
        // Same class as the flagged sites, guarded pre-emptively: this reads a
        // per-account server preference and applies it to a device-global
        // controller, so a response arriving after a sign-out would push the old
        // account's setting onto whoever is signed in next (#665).
        let generation = authGeneration
        let preferenceGeneration = SessionNotificationSuppressionController.preferenceGeneration
        // This is a third independent reader of the same row, alongside the two in
        // `NotificationPreferencesViewModel`, and nothing serializes it against
        // them. Taken here rather than inside the `Task` so it records when the
        // fetch was asked for, not when the task happened to be scheduled — a
        // toggle saved in between must still win (#709).
        let ticket = SessionNotificationSuppressionController.nextPreferenceRequestTicket()
        Task { [weak self] in
            guard let self else { return }
            guard let prefs = try? await APIClient.shared.getNotificationPreferences() else { return }
            guard generation == self.authGeneration else { return }
            SessionNotificationSuppressionController.setSuppressPreferenceEnabled(
                prefs.suppressDuringSession,
                startedAtGeneration: preferenceGeneration,
                requestTicket: ticket,
                responseKind: .read
            )
        }
    }

    /// #840: re-reads the account once a sit this device saved has reached the server,
    /// as web's `onSynced` does (#666). `NetworkReachabilityMonitor` calls it after a
    /// queue flush that uploaded something, and `completeFocusSession` after a
    /// completed focus session saved straight to the server.
    ///
    /// The scene-activation `checkAuth()`, the reconnect refresh and the queue flush
    /// start independently, so a `me()` that wins the race returns the counters as
    /// they stood before the upload, and keeps them until some later read: the
    /// meditation day, and the focus goal `completeFocusSession` had already stepped.
    ///
    /// Queued like the other whole-`UserDTO` reads (#697), so it runs after any read or
    /// settings write enqueued before it. Nothing waits on it: every step of
    /// `refreshUserFromServer` is checked against the generation captured here, so a
    /// read that outlives its session changes nothing.
    func refreshUserAfterSync() {
        guard currentUser != nil, currentView != .auth else { return }
        let generation = authGeneration
        let read: Task<Int?, Never> = enqueueSettingsRead { [weak self] () async -> Int? in
            guard let self else { return nil }
            return await self.refreshUserFromServer(startedAtGeneration: generation)
        }
        // #916: a read naming a different account tore the previous one down — Home
        // badges reset, widget backfill cancelled — and nothing else behind this
        // caller repaints them or the widget, unlike `returnHome()` and the sign-in
        // catch-up. A same-account or failed read returns the entry generation, so
        // only an adoption gets past the guard. Outside the queue turn so the refresh
        // does not hold the line.
        Task { [weak self] in
            guard let live = await read.value, live != generation,
                  let self, live == self.authGeneration else { return }
            await self.refreshTracksDoneToday()
        }
    }

    /// A `me()` read that reconciles the account already on screen, run from the
    /// settings queue. Shared by `returnHome()` (post-sit) and `didLogin` (#664).
    ///
    /// A read that merely *fails* — no network, a 5xx, an undecodable body — is
    /// dropped: neither caller is reacting to it, and the badge refresh and the
    /// consumptions behind it are still worth running. A 401 is not that. It is the
    /// server saying this session is over, and both callers gate non-idempotent work
    /// on the answer — including `consumePendingBuddyInviteIfNeeded`, which joins
    /// with the pending invite — so an authoritative rejection signs out and returns
    /// `nil`, as in `performReconnectRefresh`, rather than letting that join run
    /// against a session that is already gone.
    ///
    /// - Parameter generation: `authGeneration` as it was when the caller decided to
    ///   refresh.
    /// - Returns: the generation the caller's remaining work belongs to — the entry
    ///   capture when the read did not land, or the live one after an adoption, so an
    ///   expected adoption is never mistaken for the session being replaced — or `nil`
    ///   when that session is gone and there is nothing left to finish.
    func refreshUserFromServer(startedAtGeneration generation: Int) async -> Int? {
        // Re-checked now that the queue turn has arrived: waiting for a place in line
        // is an `await` like any other, so a sign-out or account switch may have landed
        // while a save ahead of us was still resolving (#665).
        guard generation == authGeneration else { return nil }
        // Taken immediately before the request, as at every other settings site, so it
        // records when this read left. The queue turn is what makes the response the
        // newest word; the ticket is the backstop (#697).
        let settingsTicket = nextSettingsRequestTicket()
        let user: UserDTO
        do {
            guard let fetched = try await APIClient.shared.me(today: creditedSessionDate()) else {
                // `me()` returns nil for exactly one case: a 401 that is not
                // `TOKEN_EXPIRED`. The server has rejected this session, so the work
                // the caller gates on this answer must not run against it.
                guard generation == authGeneration else { return nil }
                applySignedOut(cause: .signedOut, message: nil)
                return nil
            }
            user = fetched
        } catch let apiError as APIError where apiError.status == 401 || apiError.status == 404 {
            // The thrown authoritative shapes. 401 is `TOKEN_EXPIRED`, which `me()`
            // throws rather than returning. 404 is `GET /api/auth/me`'s "User not
            // found" (`src/app/api/auth/me/route.ts`): the session authenticated but
            // its user row is gone, so the account is deleted, not unreachable.
            // Same generation guard as the success path — a rejection belonging to
            // the *previous* session must not sign out an account that has since
            // signed in.
            guard generation == authGeneration else { return nil }
            applySignedOut(
                cause: apiError.status == 401 ? .unauthorized : .signedOut,
                message: apiError.message
            )
            return nil
        } catch {
            // Everything left is a read that never landed — no network, a 5xx, an
            // undecodable body. Not a reason to skip the badge refresh and the
            // deep-link consumptions, and never was.
            return generation
        }
        guard generation == authGeneration else { return nil }
        // This re-confirms the account already on screen, so it enters the same
        // ordering as the auth-path reads (#697). Adoption proper — a response
        // naming a *different* account — keeps going through `applyAuthenticatedUser`:
        // there is nothing to order it against and the guard would read it as
        // `.discarded`.
        let adoption = adoptAccountRead(user, startedAtGeneration: generation, requestTicket: settingsTicket)
        // #916: a read naming a different account tore the previous one down, and that
        // cleared the suppression preference with it. `checkAuth()` and the reconnect
        // refresh hydrate after every adoption; the callers of this one do not, so the
        // new account's preference is fetched here.
        if adoption == .differentAccount {
            hydrateNotificationSuppressionPreference()
        }
        return authGeneration
    }

    /// Adopts the account a queued `me()` read returned. Shared by `performAuthCheck`,
    /// `performReconnectRefresh` and `refreshUserFromServer`.
    ///
    /// Re-confirming the account already on screen enters the settings ordering as a
    /// `.read` (#697), so a read that a newer settings write superseded leaves that
    /// write's response in place. A response naming a *different* account — a cold
    /// start (nil -> user) or an account switch — is a legitimate transition with
    /// nothing to order it against, and the identity guards inside
    /// `applySettingsResponse` would read it as `.discarded`, so it is adopted directly.
    ///
    /// Callers own the generation guard that precedes this and the re-capture of
    /// `authGeneration` that follows it.
    ///
    /// - Returns: what the adoption replaced (#916). A read of the account on screen is
    ///   `.sameAccount` whether or not the ordering applied it.
    @discardableResult
    private func adoptAccountRead(
        _ user: UserDTO,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int
    ) -> AccountAdoption {
        if currentUser?.id == user.id {
            applySettingsResponse(
                user,
                startedAtGeneration: generation,
                requestTicket: ticket,
                responseKind: .read
            )
            return .sameAccount
        }
        return applyAuthenticatedUser(user)
    }

    /// Whole milliseconds since `start`, for the cold-start timing metric and its
    /// diagnostic line.
    private static func elapsedMs(since start: Date) -> Int {
        Int(Date().timeIntervalSince(start) * 1_000)
    }
}
