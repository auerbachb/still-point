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
    func completeBreathSession(elapsedSeconds: Int, breathCount: Int) async {
        guard elapsedSeconds > 0 || breathCount > 0 else {
            currentView = .home
            scheduleBuddyInviteConsume()
            return
        }
        guard !isSavingBreathSession else { return }
        guard let ownerUserId = currentUser?.id else { return }
        applyAppGateAfterSessionCompletion(unlock: true)
        // #526: breath sessions always complete naturally; unlock if duration qualifies.
        trackingControlPrefsManager.markTrackingUnlockIfQualifying(completed: true, duration: max(elapsedSeconds, 1))
        isSavingBreathSession = true
        defer { isSavingBreathSession = false }

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

        do {
            _ = try await SessionSyncCoordinator.shared.saveCompletedSession(
                request: request,
                clientSessionId: clientSessionId,
                ownerUserId: ownerUserId,
                thoughts: []
            )
            markPracticeDoneToday(sessionType: .breath, track: .primary)
            localSaveFailed = false
            currentView = .home
        } catch {
            print("Failed to persist breath session locally: \(error)")
            // #703: a breath sit has no completion screen to say this on, so the
            // offline indicator is the only place the loss can surface.
            localSaveFailed = true
            currentView = .home
        }
        // Breath exits skip `returnHome()`, so an invite held back by the
        // `isInSession` guard during the sit is retried here.
        scheduleBuddyInviteConsume()
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
        await consumePendingLogReasonIfNeeded()
    }
}
