import Foundation
import StillPointShared

/// Route changes the views ask for: into and out of sits (solo, breath, buddy), the
/// buddy hub and calendar, and the trip home after a sit, with the saving and syncing
/// that ride on them.
extension AppViewModel {
    func beginSession(type: SessionType = .standard, track: Track = .primary) {
        currentView = .session(type: type, track: track)
    }

    func beginBreathCounting() {
        currentView = .breathCounting
    }

    /// Save a completed breath session and return to home.
    ///
    /// Local-first via the offline write queue (#557); non-fatal API failures no longer drop data.
    ///
    /// - Parameter generation: `authGeneration`, read by the End tap itself. This runs
    ///   from a task that starts a main-actor turn after the tap, so a read taken here
    ///   would belong to whoever is signed in by then (#854).
    func completeBreathSession(
        elapsedSeconds: Int,
        breathCount: Int,
        startedAtGeneration generation: Int
    ) async {
        // #854: an identity transition that landed between the tap and this task has
        // made the screen another account's. The owner, day and credited date read
        // below would be that account's too, so nothing is saved and its route is
        // left alone.
        guard generation == authGeneration else { return }
        guard elapsedSeconds > 0 || breathCount > 0 else {
            currentView = .home
            scheduleBuddyInviteConsume()
            return
        }
        // #854: the save below waits on the server flush, so a sign-out and a sign-in
        // as someone else can land before it settles. The gate belongs to the account
        // that tapped End, so a save still running for a previous account neither
        // swallows this End nor frees this one's gate.
        guard breathSaveGate.acquire(for: generation) else { return }
        defer { breathSaveGate.release(for: generation) }
        guard let ownerUserId = currentUser?.id else { return }
        applyAppGateAfterSessionCompletion(unlock: true)
        // #526: breath sessions always complete naturally; unlock if duration qualifies.
        trackingControlPrefsManager.markTrackingUnlockIfQualifying(completed: true, duration: max(elapsedSeconds, 1))

        let clientSessionId = UUID()

        let request = CreateSessionRequest(
            dayNumber: currentDay,
            sessionType: .breath,
            duration: max(elapsedSeconds, 1),
            bonusSeconds: 0,
            completed: true,
            actualTime: elapsedSeconds,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: creditedSessionDate(),
            breathCount: breathCount,
            clientSessionId: clientSessionId
        )

        // #854: everything after the save is for the account that sat: the widget
        // credit, the #703 flag, the trip home and the invite retry. A save that
        // settles under another generation changes none of it. The save itself is
        // never undone: a sit that reached the queue stays there under `ownerUserId`.
        await GenerationScopedWork.run(
            startedAt: generation,
            liveGeneration: { authGeneration }
        ) { () async -> SessionCompletionLogic.SaveOutcome in
            do {
                _ = try await SessionSyncCoordinator.shared.saveCompletedSession(
                    request: request,
                    clientSessionId: clientSessionId,
                    ownerUserId: ownerUserId,
                    thoughts: []
                )
                return .stored
            } catch {
                print("Failed to persist breath session locally: \(error)")
                return .notStored
            }
        } apply: { outcome in
            if outcome == .stored {
                markPracticeDoneToday(sessionType: .breath, track: .primary)
            }
            // #703: a breath sit has no completion screen to say a failed save on, so
            // the offline indicator is the only place the loss can surface. Same flag
            // rule as the standard sit (#724), but no alert: either way the sit
            // returns home.
            if let failed = SessionCompletionLogic.localSaveFailed(after: outcome) {
                localSaveFailed = failed
            }
            currentView = .home
            // Breath exits skip `returnHome()`, so an invite held back by the
            // `isInSession` guard during the sit is retried here.
            scheduleBuddyInviteConsume()
        }
    }

    // MARK: - #840 Focus activity

    /// Home's "Focus activity" button: choose a category first.
    func beginFocusActivity() {
        currentView = .focusPicker
    }

    /// A picker card: the timer starts on the goal counter as it stands now.
    ///
    /// Only from the picker. A second card tapped while the picker fades out would
    /// otherwise swap the category under a session that has already started.
    func startFocusSession(category: FocusCategory) {
        guard currentView == .focusPicker else { return }
        currentView = .focusActivity(category: category, focusActivityDay: focusActivityDay)
    }

    /// The picker's Cancel. Retries an invite held back while it was up, as the
    /// breath exits do. Only from the picker, for the same reason as above.
    func cancelFocusActivity() {
        guard currentView == .focusPicker else { return }
        currentView = .home
        scheduleBuddyInviteConsume()
    }

    /// Save a finished focus session and return to home (#840).
    ///
    /// Local-first through the offline write queue, like a breath sit (#557). A focus
    /// session is not a meditation sit (#765): it marks no practice day, so the widget
    /// and the streak never see it, and it leaves the app gate and the tracking unlock
    /// alone. It is dated the plain local day (`FocusActivity.sessionRequest`).
    ///
    /// - Parameter end: what the session left behind (`FocusSessionRun.end`).
    /// - Parameter category: what the picker chose.
    /// - Parameter focusActivityDay: the goal counter the session ran on, from its route.
    /// - Parameter generation: `authGeneration`, read by the End tap or the expiry tick
    ///   itself, as for `completeBreathSession` (#854).
    func completeFocusSession(
        _ end: FocusSessionEnd,
        category: FocusCategory,
        focusActivityDay: Int,
        startedAtGeneration generation: Int
    ) async {
        // #854: an identity transition between the end and this task made the screen
        // another account's. Nothing is saved and its route is left alone.
        guard generation == authGeneration else { return }
        guard case .save(let result) = end else {
            // Ended before a whole second had passed: nothing to save.
            currentView = .home
            scheduleBuddyInviteConsume()
            return
        }
        // The session view reports its end once (`FocusSessionRun`). This holds the
        // line for the whole save as well, as for breath, and belongs to the account
        // that ended the session (#854).
        guard focusSaveGate.acquire(for: generation) else { return }
        defer { focusSaveGate.release(for: generation) }
        guard let ownerUserId = currentUser?.id else { return }

        let clientSessionId = UUID()
        let request = FocusActivity.sessionRequest(
            result: result,
            category: category,
            focusActivityDay: focusActivityDay,
            endedAt: Date(),
            clientSessionId: clientSessionId
        )

        // #854: what follows the save is for the account that ran the session: the
        // goal step, the #703 flag, the trip home and the invite retry. A save that
        // settles under another generation changes none of it, and is never undone.
        await GenerationScopedWork.run(
            startedAt: generation,
            liveGeneration: { authGeneration }
        ) { () async -> SessionSyncCoordinator.SaveResult? in
            do {
                return try await SessionSyncCoordinator.shared.saveCompletedSession(
                    request: request,
                    clientSessionId: clientSessionId,
                    ownerUserId: ownerUserId,
                    thoughts: []
                )
            } catch {
                print("Failed to persist focus session locally: \(error)")
                // The local write was refused, so the session is nowhere.
                return nil
            }
        } apply: { saved in
            if let saved, result.completed {
                recordCompletedFocusSession(onDay: focusActivityDay)
                // Web re-reads the account after a synced focus save, which also
                // catches a session finished on another device since the last read.
                // A queued one is re-read once the queue flush uploads it.
                if !saved.isPendingSync {
                    refreshUserAfterSync()
                }
            }
            // #703: no completion screen, so the offline indicator says a failed save.
            if let failed = SessionCompletionLogic.localSaveFailed(after: saved == nil ? .notStored : .stored) {
                localSaveFailed = failed
            }
            currentView = .home
            // Focus exits skip `returnHome()`, so an invite held back by the
            // `isInSession` guard during the session is retried here.
            scheduleBuddyInviteConsume()
        }
    }

    /// Steps the focus goal on the account on screen once a completed focus session
    /// is stored, synced or queued (#840): the server steps it by one for each one
    /// (#835), so Home shows the next goal without waiting for a `me()`. Saved to the
    /// cached identity too, so an offline launch shows it as well.
    ///
    /// A merge of one field, not an adoption: it moves neither `authGeneration` nor
    /// `isOfflineMode`.
    private func recordCompletedFocusSession(onDay sessionDay: Int) {
        guard let user = currentUser else { return }
        let next = FocusActivity.focusActivityDayAfterCompletedSave(
            currentDay: user.focusActivityDay,
            sessionDay: sessionDay
        )
        guard next != user.focusActivityDay else { return }
        let updated = user.updating(focusActivityDay: next)
        currentUser = updated
        CachedIdentityStore.save(updated)
    }

    func beginBuddySession() {
        buddyInviteError = nil
        currentView = .buddyHub
    }

    func openBuddyCalendar() {
        currentView = .buddyCalendar
    }

    func openBuddyCalendarForBuddy(buddyId: String, username: String) {
        currentView = .buddyCalendarWithBuddy(buddyId: buddyId, buddyUsername: username)
    }

    func closeBuddyCalendar() {
        currentView = .buddyHub
    }

    func enterBuddySession(sessionId: String) {
        buddyInviteError = nil
        currentView = .buddySession(sessionId: sessionId)
    }

    func leaveBuddySession() {
        currentView = .home
        scheduleBuddyInviteConsume()
    }

    /// Shared app-gate side effect for any local session completion path (#590).
    /// Keeps standard/quick (`completeSession`), breath (`completeBreathSession`), and
    /// future completion handlers (#589 widget sync, etc.) aligned on one call site.
    private func applyAppGateAfterSessionCompletion(unlock: Bool) {
        if unlock {
            appBlockingManager.unlockAfterCompletedSession()
        } else {
            appBlockingManager.prepareForSession()
        }
    }

    func completeSession(
        sessionId: String,
        clientSessionId: UUID,
        clearPercent: Int,
        thoughtCount: Int,
        thoughts: [CapturedThought],
        dayNumber: Int,
        sessionType: SessionType = .standard,
        track: Track,
        duration: Int,
        bonusSeconds: Int = 0,
        unlockAppGate: Bool,
        attentionLog: [AttentionEntry]? = nil,
        attentionElapsed: Double? = nil,
        ambientSoundSummary: AmbientSoundSummary? = nil
    ) {
        // #684: every counted sit now earns widget credit on its own track — a
        // second-track standard sit checks the Track Two row instead of being
        // dropped, so partial two-a-day days are visible immediately.
        // Gated on `unlockAppGate` (== the sit ran to its planned end):
        // `endEarly()` leaves `completedNaturally` false while still setting
        // `isComplete`, so it reaches this call site too. Crediting there would
        // check a weekday row — and extend the streak — for a sit the user cut
        // short.
        if unlockAppGate {
            markPracticeDoneToday(sessionType: sessionType, track: track)
        }
        applyAppGateAfterSessionCompletion(unlock: unlockAppGate)
        // #526: unlock hold-cluster controls if this sit qualifies (completed + ≥ 300 s planned).
        trackingControlPrefsManager.markTrackingUnlockIfQualifying(completed: unlockAppGate, duration: duration)
        currentView = .completion(
            sessionId: sessionId,
            clientSessionId: clientSessionId,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            thoughts: thoughts,
            dayNumber: dayNumber,
            sessionType: sessionType,
            track: track,
            sessionCompleted: unlockAppGate,
            duration: duration,
            bonusSeconds: bonusSeconds,
            attentionLog: attentionLog,
            attentionElapsed: attentionElapsed,
            ambientSoundSummary: ambientSoundSummary
        )
    }

    func returnHome() async {
        currentView = .home
        selectedTab = 0
        // Same hazard as `refreshAfterReconnect` (#665): the queue flush and the
        // `me()` request below are both suspension points, so a sign-out or account
        // switch can land mid-flight and a late response would otherwise restore the
        // previous `currentUser` and re-save its cached identity after the session
        // was invalidated.
        let generation = authGeneration
        if let ownerUserId = currentUser?.id {
            do {
                _ = try await SessionSyncCoordinator.shared.flushPending(ownerUserId: ownerUserId)
                // The flush is a suspension point; don't follow it with a prune for
                // a session that has since been replaced. Both calls are explicitly
                // scoped to the `ownerUserId` captured before the await, so neither
                // can touch another account's rows — this only stops us doing more
                // work on behalf of a session that is over.
                guard generation == authGeneration else { return }
                try await SessionSyncCoordinator.shared.pruneCompletedEntries(ownerUserId: ownerUserId)
            } catch {
                print("Failed to flush offline session queue: \(error)")
            }
        }
        // Enqueued rather than issued straight away. `currentView` is set to `.home`
        // on this function's first line, so the user is interactive on Home for the
        // whole flush above and "Add second track" can start a settings write from
        // there. A ticket cannot settle that: the opt-in's PATCH left *first*, and an
        // accepted `.write` sets `applied = issued` (`StaleResponseGuard`), so its
        // response supersedes this read whichever of the two took the lower number.
        // If that PATCH left before the sit committed, adopting it wholesale drops the
        // post-sit `currentDay` and recovery ramp this `me()` exists to fetch, and
        // `applyAuthenticatedUser` re-saves the stale snapshot to the cache #665 reads
        // on the next offline launch. Taking a place in line removes the ambiguity
        // instead of deciding it: no settings write is outstanding when this read
        // leaves, so its response is the newest word by construction.
        let read: Task<Int?, Never> = enqueueSettingsRead { [weak self] in
            guard let self else { return nil }
            return await self.refreshUserFromServer(startedAtGeneration: generation)
        }
        // `nil` means the session that finished the sit is gone, so none of the
        // identity-scoped work below belongs to this call any more.
        guard let adopted = await read.value else { return }
        await refreshTracksDoneToday()
        // As in `refreshAfterReconnect`: re-checked because the refresh above is a
        // suspension point, and consuming the invite burns a token against whatever
        // session is live when it runs.
        guard adopted == authGeneration else { return }
        await consumePendingBuddyInviteIfNeeded(startedAtGeneration: adopted)
        // Re-checked for the log-reason link, as `checkAuth()` does after its join
        // (#857). The join is a network request, and this runs in a task the calling
        // view started, which a sign-out does not cancel, so a sign-out and a sign-in as
        // someone else can both land before it returns. A link pending by then belongs
        // to that account, and the flow that signed it in opens it in its own order.
        guard AuthCheckOwnership.ownsLocalLinks(
            startedAtGeneration: adopted,
            liveGeneration: authGeneration
        ) else { return }
        await consumePendingLogReasonIfNeeded()
    }
}
