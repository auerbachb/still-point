import SwiftUI
import SwiftData
import StillPointShared

/// The root view model for a scene, owned by `RootView` (each `WindowGroup` scene
/// builds its own).
///
/// This file holds the stored state and the identity transitions, the only code
/// that bumps `authGeneration`. Behavior is split by concern across
/// `AppViewModel+*.swift` (#700): Auth, Settings, PracticeDay, Widget, DeepLinks,
/// Navigation and UITestSeeds. An extension cannot add stored properties, so the
/// state each concern owns is still declared here. Members stay `private` where
/// every use is in one file; the ones these files share are internal for that
/// reason alone and are not entry points for views.
@Observable
@MainActor
final class AppViewModel {
    var currentView: AppView = .auth
    /// Selected tab in `MainTabView`, lifted here so non-tab views (e.g. the Home
    /// app-gate pill) can navigate to a tab. Holds a `MainTab` raw value, which is
    /// the `TabView` selection tag.
    var selectedTab: Int = AppViewModel.defaultSelectedTab()
    var currentUser: UserDTO?
    /// #665: true while the app is running from its local copy of identity and
    /// state because the server could not be reached. Drives the offline
    /// indicator; any successful `me()` clears it.
    var isOfflineMode = false
    /// #703: a local save has failed on this device and has not since succeeded.
    /// Withdraws the offline indicator's "sits are saved and upload when you
    /// reconnect" promise, which is false for as long as storage refuses writes.
    /// A later successful save clears it — that is the proof storage works again.
    var localSaveFailed = false
    /// #665/#703/#717: what the offline strip has to say right now, or `nil` when
    /// it has nothing — connected, with the sit safely on the device. A failed
    /// local write raises it whether or not the app is offline: that failure is
    /// not a connectivity failure, and a breath sit has no completion screen to
    /// surface it on. The rule lives in the shared `OfflineIndicatorCopy` so the
    /// web strip raises and lowers on exactly the same conditions.
    ///
    /// #749: the one place the strip's inputs are combined. `MainTabView` reads
    /// only this, so a new cross-tab banner input is added here, not in the view.
    var offlineIndicatorState: OfflineIndicatorCopy.State? {
        OfflineIndicatorCopy.state(offline: isOfflineMode, sitNotStored: localSaveFailed)
    }
    var isLoading = true
    var authStatusMessage: String?
    var lastColdStartAuthCheckMs: Int?
    var buddyInviteError: String?
    /// Guards `completeBreathSession` against re-entrant End taps creating duplicate rows.
    /// Owned by the identity generation whose End took it, so a save still running for a
    /// previous account can neither swallow the next account's End nor free its gate (#854).
    var breathSaveGate = GenerationOwnedGate()
    /// The same guard for `completeFocusSession` (#840).
    var focusSaveGate = GenerationOwnedGate()
    /// #526: client-local progressive-unlock + hide preference for the hold-cluster controls.
    /// #1014: the snapshot seed gets an unlocked manager; see `launchTrackingControlPrefsManager`.
    var trackingControlPrefsManager = AppViewModel.launchTrackingControlPrefsManager()
    private var appBlockingManagerStorage: AppBlockingManager?
    var appBlockingManager: AppBlockingManager {
        if let appBlockingManagerStorage {
            return appBlockingManagerStorage
        }
        let manager = AppBlockingManager()
        appBlockingManagerStorage = manager
        return manager
    }
    var pendingBuddyInviteToken: String?
    var pendingSessionDeepLink: SessionType?
    var pendingLogReasonDate: String?

    /// Persisted: keep device screen awake during an active sit when enabled.
    ///
    /// #742: a window onto the shared `WakeLockPreferenceStore` rather than a copy
    /// of it. Each `WindowGroup` scene builds its own `AppViewModel`, and this used
    /// to be a stored property seeded once in `init()` — so a preference changed in
    /// one window left the other's Settings switch rendering its launch-time value.
    /// Reading through the shared `@Observable` store is what re-renders every
    /// scene together; nothing here is re-seeded, so no scene writes the key.
    ///
    /// The setter still goes through `SessionIdleTimerController` so the idle timer
    /// is re-applied on the same call that records the choice. The store itself
    /// declines a set that changes nothing, which is what keeps one tap to one
    /// write and leaves an untouched install's "never set" state untouched (#730).
    var keepScreenAwakeDuringSession: Bool {
        get { WakeLockPreferenceStore.shared.isEnabled }
        set { SessionIdleTimerController.setKeepScreenAwakePreferenceEnabled(newValue) }
    }

    /// The "done today" flags, the day they describe, and what is known about
    /// whether yesterday is finished (the 6:00 grace window). The rules are
    /// `PracticeDayState`'s, in StillPointShared so its tests can drive them (#894);
    /// `AppViewModel+TracksDoneRefresh.swift` runs the server reads around it.
    var practiceDay = PracticeDayState()

    // The flags, read and written by name across these files and by `HomeView`.
    // Each is documented on `PracticeDayState`, which also keeps their stamp.

    /// #240: per-track "completed a standard sit today", drives the Home badges.
    var primaryDoneToday: Bool {
        get { practiceDay.primaryDoneToday }
        set { practiceDay.primaryDoneToday = newValue }
    }
    var secondDoneToday: Bool {
        get { practiceDay.secondDoneToday }
        set { practiceDay.secondDoneToday = newValue }
    }
    /// Any counted Track One practice today, for the widget.
    var practiceDoneToday: Bool {
        get { practiceDay.practiceDoneToday }
        set { practiceDay.practiceDoneToday = newValue }
    }
    /// #684: a second-track standard sit today, for the widget.
    var secondPracticeDoneToday: Bool {
        get { practiceDay.secondPracticeDoneToday }
        set { practiceDay.secondPracticeDoneToday = newValue }
    }
    /// #679: a primary standard sit today, known locally.
    var primaryStandardDoneToday: Bool {
        get { practiceDay.primaryStandardDoneToday }
        set { practiceDay.primaryStandardDoneToday = newValue }
    }

    /// Bumped on every identity transition — adopt, offline-adopt, sign-out,
    /// logout. `@MainActor` serializes these mutations but an `await` is still a
    /// suspension point, so a request that started under one identity can land
    /// after another has taken over. Anything that applies a network result to
    /// identity-scoped state captures this before its `await` and re-checks after,
    /// rather than re-reading `currentUser` (which cannot distinguish "same user
    /// throughout" from "signed out and back in").
    private(set) var authGeneration: Int = 0

    /// Identifies the newest in-flight `checkAuth()`. Separate from
    /// `authGeneration`: this tracks *which check is latest* (so only it may drop
    /// the loading overlay), not *which identity is live*.
    var activeAuthCheckID: Int = 0

    /// #856: true from the moment the newest `checkAuth()` starts until it resets the
    /// route, or ends without doing so. That reset replaces whatever is on screen with
    /// the initial view, so a buddy-invite join that returns in between does not route.
    /// It leaves the invite pending, and the check consumes it after the reset. The rule
    /// is `BuddyInviteJoinRouting`'s.
    var isAuthCheckRouteResetPending = false

    /// Orders the settings mutations against each other (#697): `SettingsView`'s
    /// four toggles, `UsernameEditView`'s rename, and `enableDualTrack()`. Each
    /// launches its own unstructured task and each response carries a *whole*
    /// `UserDTO`, so without this an older PATCH landing last reinstates every
    /// field as it stood when that request left — reverting a newer setting in
    /// `currentUser` and, because #665 made the cached identity the offline source
    /// of truth, in `CachedIdentityStore` too, where it survives a cold start.
    ///
    /// Deliberately separate from `authGeneration` and `activeAuthCheckID`. The
    /// three answer different questions — "is this still the same account?", "is
    /// this still the newest auth check?", and "is this still the newest word on
    /// the user's settings?" — and the first two cannot express this one: every
    /// site here is the *same* account throughout, which is exactly the case
    /// `applyAuthenticatedUser` deliberately does not bump the generation for.
    ///
    /// Not scoped to writes. `checkAuth()` and `refreshAfterReconnect()` order their
    /// `me()` responses through this too, as `.read`s, whenever they are merely
    /// *re-confirming* the account already adopted. Both run on a scene activation,
    /// so both can overlap a save in flight, and both adopt a whole `UserDTO` into
    /// the same cached identity — an older read landing after a newer PATCH reverts
    /// the setting with the identical blast radius, which makes it this race and not
    /// a separate one. The read/write asymmetry is what makes sharing the guard safe:
    /// a read describes the account only as of the moment it left, so a save the user
    /// makes while it is in flight still wins.
    ///
    /// Adoption proper — a cold start, or any response naming a *different* account —
    /// stays on `applyAuthenticatedUser`. There is nothing to order it against, and
    /// routing it here would read as `.discarded`, which cannot distinguish "nothing
    /// adopted yet" from "that session is gone" (#665).
    var settingsOrdering = StaleResponseGuard()

    /// Orders the `getTracksDoneToday` responses against each other (#699).
    ///
    /// Six callers reach `refreshTracksDoneToday()` — `checkAuth()`,
    /// `refreshAfterReconnect()`, `returnHome()`, `performEnableDualTrack()`, and
    /// the offline and login catch-up tasks — and nothing serializes them. The
    /// three task-backed ones cancel only their *own* predecessor, the other three
    /// are awaited inline with no handle at all, and the query is deliberately left
    /// outside the settings queue because it hits a different endpoint. So two
    /// refreshes for the same account and the same local day overlap routinely, and
    /// the one that returns second is not the one that left second.
    ///
    /// A superseded response then writes twice over: it *assigns* the Home badges,
    /// so `primaryDoneToday` / `secondDoneToday` go true -> false and un-check a
    /// card the user has already earned, and it persists that view to the widget
    /// snapshot. Its failure path is worse — it clears both badges to fail closed,
    /// on top of a newer success.
    ///
    /// Its own guard rather than `settingsOrdering`: that one orders whole-`UserDTO`
    /// adoptions, and a guard is per *subject*, so sharing it would let a Settings
    /// PATCH bar a badge refresh and a badge refresh bar a PATCH.
    ///
    /// Neither existing generation covers this. `authGeneration` answers "is this
    /// still the same account?", and every refresh racing here is the same account.
    /// `WidgetData.writeGeneration` (#678) orders *store writes* across an await —
    /// which is why `refreshWidgetWeekHistory()` uses it — but the Home badges are
    /// in-memory state the store cannot see, and `syncWidgetData()` re-reads the
    /// stored snapshot synchronously anyway, so nothing there is stale to merge
    /// against. The staleness starts a layer above the store and has to stop there.
    ///
    /// Always a `.read`: the query observes today's completions and commits
    /// nothing, so it is authoritative for the moment it left and nothing later.
    ///
    /// Only a *response* records itself here. The failure path ranks its ticket
    /// with `isSuperseded(ticket:)` instead, so a request that threw cannot consume
    /// the barrier against an earlier one still in flight — see the comment on that
    /// guard for the sit-then-network-drop case it otherwise loses.
    var tracksDoneOrdering = StaleResponseGuard()

    /// In-flight identity-scoped background work, cancelled the moment the session
    /// they were started for ends. The `authGeneration` re-checks are what make a
    /// late result harmless; cancelling is how we stop paying for it at all.
    private var offlineCatchUpTask: Task<Void, Never>?
    var reconnectTask: Task<Void, Never>?
    var loginCatchUpTask: Task<Void, Never>?
    /// Buddy invite join/consume. One property: these are alternative routes into
    /// the same invite flow and never need to run concurrently.
    var buddyInviteTask: Task<Void, Never>?
    /// The invite joins in flight. The token stays pending until the server answers
    /// (#756), so a second consume must not POST it again. Each consume owns its own
    /// attempt and releases only that one, so a previous account's join still in
    /// flight after a sign-out neither blocks the next account's consume nor frees
    /// the gate under it (#989). See ``BuddyInviteConsumeGate``.
    var buddyInviteConsumeGate = BuddyInviteConsumeGate()

    /// Serializes every settings mutation in the app against every other one (#697).
    ///
    /// Issue #697 offers two mechanisms — serialize the writes, or tag each request
    /// and reject a response older than the latest applied mutation. This is the
    /// first, and it is the one that holds: with only one write in flight at a time,
    /// each response describes the account *after* every earlier mutation committed,
    /// so responses are adopted in intent order and are complete by construction.
    /// See ``SettingsWriteQueue``.
    let settingsWrites = SettingsWriteQueue()

    /// This scene's widget history backfill: its in-flight fetch, and the marker
    /// that throttles the next one (#663). The background refresh runs the same
    /// backfill with one of its own (`BackgroundRefreshScheduler`).
    let widgetHistory = WidgetHistoryRefresher()

    var currentDay: Int {
        StillPoint.clampedCurrentDay(for: currentUser)
    }

    var recoveryFields: DurationRecovery.RecoveryFields {
        DurationRecovery.recoveryFields(from: currentUser)
    }

    var activeRecovery: DurationRecovery.ActiveRecovery? {
        DurationRecovery.activeRecovery(recoveryFields)
    }

    var todayDuration: Int {
        DurationRecovery.sessionDurationForUser(
            sessionType: .standard,
            currentDay: currentDay,
            recovery: recoveryFields
        )
    }

    var todayBlockCount: Int {
        StillPoint.blockCount(forDuration: todayDuration)
    }

    // MARK: - #240 Dual-track fork

    /// Whether the user has opted into the second daily track.
    var dualTrackEnabled: Bool {
        currentUser?.dualTrackEnabled ?? false
    }

    /// True once the primary track has passed the 10-minute mark (fork available).
    var dualTrackEligible: Bool {
        StillPoint.isDualTrackEligible(currentDay: currentDay)
    }

    /// Second-track day counter (clamped to >= 1 for defensive upstream data).
    var secondTrackDay: Int {
        max(currentUser?.secondTrackDay ?? 1, 1)
    }

    var secondTrackDuration: Int {
        StillPoint.duration(forDay: secondTrackDay)
    }

    var secondTrackBlockCount: Int {
        StillPoint.blockCount(forDuration: secondTrackDuration)
    }

    // MARK: - #840 Focus activity

    /// The focus goal counter (clamped to >= 1 for defensive upstream data).
    var focusActivityDay: Int {
        max(currentUser?.focusActivityDay ?? 1, 1)
    }

    /// The next focus session's goal, in seconds. One goal for every category.
    var focusGoalSeconds: Int {
        StillPoint.focusDuration(forDay: focusActivityDay)
    }

    var isInSession: Bool {
        if case .session = currentView { return true }
        if case .buddySession = currentView { return true }
        if case .completion = currentView { return true }
        if case .breathCounting = currentView { return true }
        // #840: the picker counts too, so buddy invites and deep links are held back
        // from it and from the session it starts, as during breath counting.
        if case .focusPicker = currentView { return true }
        if case .focusActivity = currentView { return true }
        return false
    }

    // No initializer: the wake-lock preference is the only thing this used to seed,
    // and #742 replaced that snapshot with a read of the shared store. Every other
    // stored property carries its own default.

    // MARK: - Identity transitions

    /// Single place a server-confirmed user is adopted — in memory *and* in the
    /// local copy that survives a launch with no network (#665).
    ///
    /// - Returns: what the adoption replaced. `.differentAccount` means the previous
    ///   account's local state was torn down first (#916).
    @discardableResult
    func applyAuthenticatedUser(_ user: UserDTO) -> AccountAdoption {
        // Only an actual *transition* invalidates in-flight work. Re-confirming the
        // same account (a reconnect refresh, a settings PATCH round-trip) is not a
        // transition, and bumping for it was wrong twice over: it made every
        // post-adoption `generation == authGeneration` check unsatisfiable, and it
        // let an unrelated settings save cancel identity work that was still valid.
        // A sign-out sets `currentUser = nil` and bumps, so a sign-out/sign-in cycle
        // on the *same* account still bumps twice and stale work is still rejected.
        //
        // #916: a *different* account also tears the previous one down before it is
        // installed. Another window can sign out and in as someone else, and this
        // window's next check then hands it that account with the old one's sit,
        // tasks and per-account state still in place. Web's `adoptUser` (#868).
        AccountAdoption.adopt(
            current: currentUser?.id,
            incoming: user.id,
            advanceGeneration: { authGeneration &+= 1 },
            tearDown: { tearDownPreviousAccount() },
            install: {
                currentUser = user
                CachedIdentityStore.save(user)
                isOfflineMode = false
            }
        )
    }

    /// Route to sign-in.
    ///
    /// Local state — the cached identity and the per-account tracking unlock — is
    /// torn down only for a cause authoritative enough to prove the session is
    /// over, which is the same predicate guarding the widget's stored week (#676).
    /// Before #665 every failure path ran this teardown, so a dropped connection
    /// wiped state the server never contradicted.
    func applySignedOut(cause: WidgetDataStore.SignedOutCause, message: String?) {
        authGeneration &+= 1
        cancelIdentityScopedTasks()
        currentUser = nil
        isOfflineMode = false
        currentView = .auth
        authStatusMessage = message
        if CachedIdentityStore.clearIfAuthoritative(on: cause) {
            // #526: reset account-scoped unlock so the next sign-in re-qualifies
            // (mirrors the clearOnLogout called by didLogout).
            trackingControlPrefsManager.clearOnLogout()
            // #709: an expired token or a 401 ends the session just as finally as
            // tapping Sign out, but only `didLogout()` was clearing this — so an
            // automatic sign-out left the previous account's "During sessions"
            // choice cached device-globally for whoever signed in next, and left
            // its queued session-state reports free to drain under the new
            // account's credentials and silence *their* notifications for a full
            // TTL. Clearing here also bumps the controller's auth epoch, which is
            // what stops an in-flight preference response from writing the old
            // account's value afterwards.
            //
            // Inside the authoritative branch deliberately: `.serverError` and
            // `.unreachable` say nothing about auth, and discarding a live user's
            // preference because the network dropped is the #665 mistake.
            SessionNotificationSuppressionController.clearSuppressPreference()
        }
        syncWidgetData(signedOutCause: cause)
    }

    /// #665: run the app from what the device already knows.
    ///
    /// Mirrors the success path minus the parts that need the server to be
    /// believed. `refreshTracksDoneToday()` is still called: it fails closed on its
    /// own, and it is what pushes a fresh widget snapshot. Push registration and
    /// the buddy-invite handoff are deliberately skipped — both are doomed without
    /// a network, and consuming a pending invite here would burn the token on a
    /// request that cannot succeed. `refreshAfterReconnect()` picks both up.
    func enterOfflineMode(user: UserDTO, cause: WidgetDataStore.SignedOutCause) async {
        // Transition-only, matching `applyAuthenticatedUser`, and a cached identity
        // naming a different account tears the previous one down first (#916): the
        // cache is shared by every window, so another window's sign-in as someone
        // else is what this reads back on a bad connection. The teardown resets the
        // route even mid-sit — that sit belongs to the account being replaced — and
        // cancels the old `offlineCatchUpTask`, which is started fresh below.
        AccountAdoption.adopt(
            current: currentUser?.id,
            incoming: user.id,
            advanceGeneration: { authGeneration &+= 1 },
            tearDown: { tearDownPreviousAccount() },
            install: {
                currentUser = user
                isOfflineMode = true
            }
        )
        // `checkAuth()` runs on every scene activation, so this path is reached
        // mid-sit whenever the app is foregrounded on a bad connection. Routing to
        // the initial authenticated view there would eject the user from a session
        // in progress, so the route — and the badge reset that goes with it — is
        // preserved while one is running. Matches `refreshAfterReconnect()`, which
        // never touches the route, and the `isInSession` checks the deep-link entry
        // points already make. Going offline is still recorded either way: the
        // identity, the offline flag, and the status line below are unconditional.
        if !isInSession {
            resetTrackCompletionBadges()
            currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
        }
        // Not an error the user must act on — the offline indicator says it instead.
        authStatusMessage = nil
        // Paint from local state immediately. Nothing here may `await` a request we
        // already know is failing: `checkAuth`'s `defer` only drops the cold-start
        // overlay once this returns, so on flaky wifi (as opposed to Airplane Mode,
        // which fails instantly) a blocking call would hold the launch for a full
        // URLSession timeout — the offline launch has to be fast, not just correct.
        //
        // We are signed in, so this saves rather than clears — but the real cause is
        // passed rather than the `.signedOut` default so that if the snapshot ever
        // did come back logged-out, it could not wipe the widget's week on a failure
        // the server never confirmed (#676).
        syncWidgetData(signedOutCause: cause)
        // Local-only deep links still route; the buddy invite is network-bound.
        await consumePendingSessionDeepLinkIfNeeded()
        await consumePendingLogReasonIfNeeded()
        // Detached from the launch path: if connectivity is actually back by the
        // time this runs, the Home badges and widget history catch up on their own;
        // if not, it fails closed without having delayed anything. Retained (not
        // fire-and-forget) so sign-out can cancel it, and `refreshTracksDoneToday()`
        // re-checks `authGeneration` after its await so a late response can never
        // write another account's badges or widget snapshot.
        offlineCatchUpTask?.cancel()
        offlineCatchUpTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshTracksDoneToday()
        }
    }

    private func cancelIdentityScopedTasks() {
        cancelReplacedAccountTasks()
        reconnectTask?.cancel()
        reconnectTask = nil
        loginCatchUpTask?.cancel()
        loginCatchUpTask = nil
    }

    /// The identity-scoped tasks that never host an adoption, so replacing the account
    /// can cancel them from inside one (#916).
    ///
    /// `reconnectTask` and `loginCatchUpTask` are left to `cancelIdentityScopedTasks()`.
    /// Either can be the very task adopting the new account — each awaits the queued
    /// `me()` read that calls `applyAuthenticatedUser` — and cancelling it there would
    /// cancel the new account's badge refresh, widget sync and link consumption behind
    /// it. One still running for the old account is harmless: the generation moved
    /// before the teardown, and every step after its awaits re-checks it.
    private func cancelReplacedAccountTasks() {
        offlineCatchUpTask?.cancel()
        offlineCatchUpTask = nil
        buddyInviteTask?.cancel()
        buddyInviteTask = nil
        // The widget history backfill is identity-scoped too. Its own key check is
        // `"userId|localDay"`, which a sign-out and sign-in on the *same* account
        // within the same day would satisfy — so a late response could land in the
        // freshly rebuilt snapshot. Clearing the key also forces a re-backfill
        // rather than leaving the row blank. `didLogout` cancelled this already;
        // `applySignedOut` did not, which is the gap this closes.
        widgetHistory.cancel()
    }

    /// #916: removes the previous account's local state when a different account
    /// replaces it, with the previous account still installed. Web's
    /// `clearAccountScopedLocalState`, run by `adoptUser` (#868 / PR #903).
    ///
    /// The account-scoped half of `didLogout()`, without the parts only a sign-out
    /// may do: the cached identity is replaced by the install that follows rather than
    /// cleared, the last-used sign-in tag and the pending links stay for whoever is
    /// signed in, and the old account's queued sits stay queued — they are
    /// owner-scoped and still upload under that account.
    ///
    /// Resetting the route closes the previous account's sit, breath or completion
    /// screen, buddy room, or any other screen, and their own `onDisappear` cleanup
    /// runs. Late saves for a sit already saving are #854's, and stay its own.
    private func tearDownPreviousAccount() {
        cancelReplacedAccountTasks()
        // #526: the tracking unlock is the previous account's.
        trackingControlPrefsManager.clearOnLogout()
        // #709: the "During sessions" choice and its queued reports are too. Clearing
        // also bumps the controller's epoch, so a preference read still in flight for
        // the old account cannot write it back; the caller hydrates the new one.
        SessionNotificationSuppressionController.clearSuppressPreference()
        // #703: a failed local save of the previous account's sit.
        localSaveFailed = false
        resetTrackCompletionBadges()
        buddyInviteError = nil
        selectedTab = MainTab.home.rawValue
        currentView = Self.initialAuthenticatedView(from: ProcessInfo.processInfo.environment)
    }

    func didLogout() {
        // Invalidate in-flight identity-scoped work synchronously, before the
        // `clearQueue()` await below — the moment sign-out is known is the moment a
        // response for the old session stops being allowed to write anything (#665).
        authGeneration &+= 1
        // Cancels the widget history backfill and clears its key too.
        cancelIdentityScopedTasks()
        // Captured before the teardown clears it. The queue cleanup below is scoped
        // to this account *and* to this moment: once `currentUser` is nil there is
        // nothing left to scope it by, and signing back in as the same account would
        // otherwise let the deferred delete take the new session's sits with it.
        let signedOutUserId = currentUser?.id
        let logoutBoundary = Date()
        // The teardown is synchronous for the same reason. Deferring it until after
        // the `clearQueue()` await left `currentUser` set across a suspension point,
        // so a `checkAuth()` starting inside that window (scene activation) could
        // re-adopt the account and route back into the authenticated UI — and the
        // deferred teardown would then wipe *that* session's state. A generation
        // guard inside the task would not have closed it: re-adopting the same
        // account is deliberately not a transition, so the generation would not have
        // moved. Signing out is local truth and needs nothing from the queue flush,
        // so it lands now and the flush follows on its own.
        currentUser = nil
        isOfflineMode = false
        // #665: a real sign-out is the one thing that must take the local copy
        // of identity with it. `APIClient.logout()` also clears it (in a
        // `defer`, so an offline sign-out still does), but didLogout is reachable
        // on its own — belt and braces rather than a single fragile path.
        CachedIdentityStore.clear()
        pendingBuddyInviteToken = nil
        pendingSessionDeepLink = nil
        pendingLogReasonDate = nil
        buddyInviteError = nil
        authStatusMessage = nil
        // #703: the not-stored warning is about one account's sit. Left set, the
        // next user to go offline on this device sees a red strip for a failure
        // that was never theirs. Mirrored by `clearAccountScopedLocalState` on web.
        localSaveFailed = false
        resetTrackCompletionBadges()
        LastAuthProvider.resetPersisted()
        currentView = .auth
        SessionNotificationSuppressionController.clearSuppressPreference()
        // #526: reset account-scoped tracking unlock so the next sign-in re-qualifies.
        trackingControlPrefsManager.clearOnLogout()
        syncWidgetData()
        if let signedOutUserId {
            Task { @MainActor in
                try? await SessionSyncCoordinator.shared.clearQueue(
                    ownerUserId: signedOutUserId,
                    enqueuedBefore: logoutBoundary
                )
            }
        }
    }
}
