import Foundation
import StillPointShared
import SwiftUI

/// Ordering for settings mutations and the whole-account reads that race them (#697),
/// the save round trip the Settings controls share, and the dual-track opt-in, which
/// is one of those mutations.
///
/// The queue and its ticket guard (`settingsWrites`, `settingsOrdering`) are stored
/// properties, so they are declared with the rest of the state in `AppViewModel.swift`.
extension AppViewModel {
    // MARK: - Identity and ordering

    /// Snapshot of the live identity, taken by a caller that will apply a response
    /// later. Capture this *before* an `await`, hand it back to
    /// `applySettingsUser(_:startedAtGeneration:requestTicket:)`.
    var identityGeneration: Int { authGeneration }

    /// Whether the identity captured as `generation` is still the live one. The
    /// re-check every settings round trip makes after each `await`, before it sends
    /// or adopts anything (#665).
    private func isIdentityLive(_ generation: Int) -> Bool {
        generation == identityGeneration
    }

    /// Runs a settings mutation once every mutation enqueued before it has finished.
    ///
    /// Call this at the moment the user acts and put the *whole* round trip inside —
    /// every `await` the mutation needs, including a permission prompt, and the
    /// `applySettingsUser` that adopts its response. Enqueuing is what records the
    /// order the user expressed their intent in; taking the ticket, prompting, or
    /// sending outside the operation would let a later intent overtake an earlier
    /// one, which is the inversion #697 exists to stop.
    /// - Returns: the operation's task, for a caller that must not finish before its
    ///   own save has. Discardable — a toggle reports progress through its own state
    ///   instead.
    @discardableResult
    func enqueueSettingsWrite(_ operation: @escaping @Sendable @MainActor () async -> Void) -> Task<Void, Never> {
        settingsWrites.enqueue(operation)
    }

    /// Runs a whole-account `me()` read on the same queue as the mutations (#697).
    ///
    /// The three reads that adopt a whole `UserDTO` — `checkAuth()`,
    /// `refreshAfterReconnect()` and `returnHome()` — are enqueued rather than left to
    /// overlap, because a ticket cannot settle a write that left *before* the read: no
    /// number says whether that write committed before or after the read's snapshot,
    /// so `StaleResponseGuard` breaks the tie in the write's favour and adopts its
    /// whole response, dropping the server-derived fields (`currentDay`, the recovery
    /// ramp, `secondTrackDay`) the read existed to refresh. Waiting for the queue
    /// removes the tie instead of deciding it.
    ///
    /// The wait is an `await` like any other, so re-check the identity generation as
    /// the operation's first statement: a queue turn can arrive under the account that
    /// replaced the one that asked.
    @discardableResult
    func enqueueSettingsRead<T: Sendable>(_ operation: @escaping @Sendable @MainActor () async -> T) -> Task<T, Never> {
        settingsWrites.enqueue(operation)
    }

    /// Ticket ranking one settings request against the `me()` reads racing it (#697,
    /// #709).
    ///
    /// Take it immediately before the request's own `await`, so it records when the
    /// request left. Ordering is `enqueueSettingsWrite`/`enqueueSettingsRead`'s job,
    /// not this one's: the queue lets only one settings request be in flight at a
    /// time, reads included, so every response is already the newest word when it
    /// lands. The ticket stays as the backstop for any future caller that reads the
    /// account without taking a place in line.
    ///
    /// A ticket whose request never returns (a permission denial that bails out
    /// before the PATCH) is simply never handed back; it leaves a gap and nothing
    /// else, since the guard only ever compares tickets for rank.
    func nextSettingsRequestTicket() -> Int {
        settingsOrdering.nextTicket()
    }

    // MARK: - Adopting responses

    /// Why a settings response was or was not adopted.
    ///
    /// Three-way rather than a Bool because the two rejections call for opposite
    /// UI. A *superseded* response was accepted by the server and merely lost the
    /// race to describe the account, so reverting the control the user just touched
    /// would show them their own change being undone when in fact it took. A
    /// *discarded* one belongs to a session that no longer exists, and reverting is
    /// the honest answer there.
    enum SettingsApplyOutcome {
        /// Adopted into `currentUser` and the offline cache: this is the newest
        /// word on the account.
        case applied

        /// A newer settings response has already been applied, so this one is no
        /// longer the newest word. Nothing is reverted and nothing is reported as
        /// failed — where this is a write, the server did commit it.
        ///
        /// Not reachable from any current caller: `enqueueSettingsWrite` and
        /// `enqueueSettingsRead` share one queue, so a settings request — read or
        /// write — never overlaps another and always outranks everything applied
        /// before it. Kept because it is the honest answer for a caller that reads the
        /// account without taking a place in line, and because the two rejections
        /// still call for opposite UI if one ever appears.
        case superseded

        /// The response belongs to a session that is gone — signed out, or another
        /// account signed in. None of it is safe to apply.
        case discarded
    }

    /// - Parameter generation: `identityGeneration` as it was when the request
    ///   started. Required rather than defaulted so a new call site cannot forget
    ///   it and silently reintroduce the cross-session write (#665).
    /// - Parameter ticket: `nextSettingsRequestTicket()` as taken when the request
    ///   started. Also required, and for the same reason (#697).
    /// - Returns: see ``SettingsApplyOutcome``. Callers that show success UI or
    ///   revert a control must branch on this — a silently dropped response would
    ///   otherwise be reported to the user as a saved change.
    @discardableResult
    func applySettingsUser(
        _ user: UserDTO,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int
    ) -> SettingsApplyOutcome {
        // `.write`: a PATCH response is server truth as of a commit, so it outranks
        // every `me()` read still outstanding beside it.
        //
        // No repair follows it, because `enqueueSettingsWrite` leaves nothing to
        // repair. The two ways a response could contradict a committed save both
        // required a second write in flight — one whose response is the only carrier
        // of its field (so dropping it stales `currentUser` and the cache #665 reads
        // on the next offline launch), or one serialized before this save committed
        // and adopted after it (so it carries the pre-save value). Serializing the
        // writes makes both unreachable: this request left only after every earlier
        // mutation had committed *and* been adopted, so its `UserDTO` carries all of
        // them and nothing older can follow it.
        return applySettingsResponse(
            user,
            startedAtGeneration: generation,
            requestTicket: ticket,
            responseKind: .write
        )
    }

    /// Shared body of the settings-apply path. Split out so the `me()` reads that
    /// race a save can reuse the identity guards while entering the ordering as a
    /// `.read`.
    @discardableResult
    func applySettingsResponse(
        _ user: UserDTO,
        startedAtGeneration generation: Int,
        requestTicket ticket: Int,
        responseKind kind: StaleResponseGuard.ResponseKind
    ) -> SettingsApplyOutcome {
        // The id check below cannot tell "same account throughout" from "signed out
        // and signed back in as the same account" — and in the second case a
        // response from the previous session would overwrite newer local fields,
        // clear offline mode, and persist stale data to the cache. That is the case
        // this generation check exists for (#665).
        guard isIdentityLive(generation) else { return .discarded }
        guard currentView != .auth, let existing = currentUser, existing.id == user.id else { return .discarded }
        // Same account throughout, so the question left is which response is the
        // newest word. Checked after the identity guards, not before: a response
        // from a session that is gone must not consume a ticket on the live
        // account's behalf and bar its genuine saves.
        guard settingsOrdering.shouldApply(ticket: ticket, from: kind) else { return .superseded }
        // Server-confirmed (a settings PATCH round-tripped), so the local copy is
        // refreshed too — otherwise a rename or track opt-in would vanish on the
        // next offline launch (#665).
        applyAuthenticatedUser(user)
        // #708: the widget orders and labels its rows by this period, so a change
        // must reach the stored snapshot now rather than at the next sit.
        if existing.longSessionPeriod != user.longSessionPeriod {
            syncWidgetData()
        }
        return .applied
    }

    // MARK: - Settings control save

    /// Saves one Settings control's new value — the round trip every account-backed
    /// control on the Settings screen shares: Public Board, Aphorisms, gaze tracking,
    /// ambient sound, and the long-session picker (#757).
    ///
    /// Call it from the control's change handler, synchronously with the user's
    /// action, once that handler has decided the change needs saving: the identity
    /// capture and the place in line below are both bound to the moment of the call.
    ///
    /// - Parameters:
    ///   - saving: the control's in-flight flag. Raised before this returns and
    ///     lowered when the save ends, however it ends. Settings disables the control
    ///     on it and skips the control when copying the account onto the screen, so it
    ///     has to be live for exactly as long as the save is.
    ///   - authorize: runs inside the queued operation before anything is sent and
    ///     says whether to go on — a permission prompt goes here. Returning `false`
    ///     abandons the save; the gate puts the control back and tells the user why
    ///     itself. If the account changed while its prompt was up, the gate leaves the
    ///     control alone instead, and the save re-syncs it as for any other identity
    ///     change (#888). Not run at all when the account changed while the save waited
    ///     its turn. `nil` for a control that needs no permission.
    ///   - send: the PATCH carrying this control's field.
    ///   - revert: puts the control back to what it showed before the change. Called
    ///     when the request throws, or when its response belongs to a session that is
    ///     gone.
    ///   - resync: copies this control's field of the account it is handed onto the
    ///     control. Called instead of `revert` when the account changed before the
    ///     request left, so nothing was sent and the control still shows a change made
    ///     on the previous account. `revert` would put back that account's value, and
    ///     the account now on screen can differ (#851).
    func saveSettingsControl(
        saving: Binding<Bool>,
        authorize: (@Sendable @MainActor () async -> Bool)? = nil,
        send: @escaping @Sendable @MainActor () async throws -> UserDTO,
        revert: @escaping @Sendable @MainActor () -> Void,
        resync: @escaping @Sendable @MainActor (UserDTO) -> Void
    ) {
        saving.wrappedValue = true
        // Captured synchronously with the user's action rather than inside the
        // operation: that runs on a later main-actor turn, so reading the generation
        // there could pick up an account that replaced this one in the gap and apply
        // this change to them. Binding it here binds it to the identity that was live
        // when the control changed, and still covers every later await — including a
        // permission prompt (#665).
        let identityAtStart = identityGeneration
        // Enqueued here for the matching reason: bound to the moment the user made the
        // change, so the mutations are sent in the order the changes were made rather
        // than racing each other. A permission prompt adds one more: it is an await of
        // unbounded length, and taking this save's place in line *after* it would rank
        // the save behind a rename the user made while the prompt was up, so the
        // opt-in's slower response could then revert that rename (#697).
        enqueueSettingsWrite { [self] in
            let ending = await runSettingsControlSave(
                startedAtGeneration: identityAtStart,
                authorize: authorize,
                send: send
            )
            // The account is only ever copied onto a control that is out of flight, which
            // is the rule Settings' own copy follows, so a resync waits for the flag. It
            // still runs in this main-actor turn, not a `Task` of its own, so no frame
            // shows the control enabled with the previous account's change on it (#851).
            switch SettingsControlSave.recovery(after: ending, accountOnScreen: currentUser) {
            case .keep:
                saving.wrappedValue = false
            case .revert:
                revert()
                saving.wrappedValue = false
            case .resync(let account):
                saving.wrappedValue = false
                resync(account)
            }
        }
    }

    /// The round trip `saveSettingsControl` queues, from the permission gate to
    /// adopting the response. Says how it ended and leaves the control to the caller.
    private func runSettingsControlSave(
        startedAtGeneration identityAtStart: Int,
        authorize: (@Sendable @MainActor () async -> Bool)?,
        send: @Sendable @MainActor () async throws -> UserDTO
    ) async -> SettingsControlSave.Ending {
        if let authorize {
            // Checked before the gate as well as after it. A save whose account changed
            // while it waited its turn must not put up a camera or microphone prompt for
            // a change the account now on screen never made, nor let a denial reset the
            // control and raise an alert in place of the resync (#851).
            guard isIdentityLive(identityAtStart) else { return .identityChanged }
            guard await authorize() else {
                // A "no" given after the account changed while the prompt was up ends as
                // an identity change, so the control re-syncs from the account now on
                // screen. The gate asked the same question and left the control and its
                // alert alone. For the account that asked, this is `.notAuthorized` with
                // the gate's reset in place, as before (#888).
                let denial = SettingsControlSave.denial(
                    promptedAt: identityAtStart,
                    answeredAt: identityGeneration
                )
                return denial.ending
            }
        }
        do {
            // Re-checked before issuing the write: sending this would otherwise
            // apply the previous user's intent to the account that replaced them.
            guard isIdentityLive(identityAtStart) else { return .identityChanged }
            // Taken immediately before the request, so it records when this left
            // and outranks the `me()` reads racing it (#697/#709). Ordering against
            // the other settings mutations is the queue's job, not the ticket's.
            let settingsTicket = nextSettingsRequestTicket()
            let updated = try await send()
            // A discarded response means the session changed, so the caller puts the
            // control back rather than leaving it showing an intent that was never
            // applied (mirrors the catch below). Otherwise the response is adopted —
            // nothing else can be in flight to supersede it — so the account now
            // carries what the control shows and Settings' sync from it is a no-op
            // (#697).
            return applySettingsUser(
                updated,
                startedAtGeneration: identityAtStart,
                requestTicket: settingsTicket
            ).controlSaveEnding
        } catch {
            return .failed
        }
    }

    // MARK: - Dual-track opt-in

    /// #240: opt into the dual-track fork, then refresh local user + badges.
    func enableDualTrack() async {
        // Serialized with every other settings mutation (#697). This is a user
        // mutation returning the same whole `UserDTO` as the Settings toggles and the
        // rename, and it races them identically — left outside the queue, a slow
        // opt-in landing last would revert a newer rename in precisely the way the
        // toggles no longer can. It is also the only settings write reachable from
        // outside the Settings screen, so it is exactly the overlap that screen's own
        // `isSavingSettings` gate cannot cover.
        //
        // Awaited rather than fired and forgotten so the caller's `Task` still
        // represents the whole opt-in.
        //
        // The generation is captured *here*, synchronously with the tap, and not
        // inside the operation: waiting for a turn is an await like any other, so a
        // read taken after it would bind this opt-in to whatever account is live when
        // the queue finally reaches it rather than the one the user tapped on. A tap
        // that sat behind a slow Settings save while the session changed would then
        // enable the fork on — and persist the `UserDTO` of — the account that
        // replaced them (#665). Same capture-then-recheck shape as every Settings
        // write.
        let identityAtStart = identityGeneration
        await enqueueSettingsWrite { [weak self] in
            guard let self else { return }
            await self.performEnableDualTrack(startedAtGeneration: identityAtStart)
        }.value
    }

    private func performEnableDualTrack(startedAtGeneration generation: Int) async {
        // Re-checked now that the wait is over and before the request is issued:
        // sending this would otherwise apply the previous user's intent to the
        // account that replaced them.
        guard isIdentityLive(generation) else { return }
        // Taken immediately before the request, so it records when this left and
        // outranks the `me()` reads racing it (#697).
        let ticket = nextSettingsRequestTicket()
        do {
            let updated = try await APIClient.shared.enableDualTrack()
            let outcome = applySettingsUser(
                updated,
                startedAtGeneration: generation,
                requestTicket: ticket
            )
            // `.discarded` means there is no session left to refresh badges for. The
            // opt-in is otherwise adopted — nothing else can be in flight to
            // supersede it — so `currentUser.dualTrackEnabled` is on before the
            // refresh below, and Home's per-track cards, which render only inside
            // that branch, have something to draw into. Ordered before the refresh so
            // the badges it writes and the widget snapshot it persists both see the
            // fork as on.
            guard outcome != .discarded else { return }
            await refreshTracksDoneToday()
        } catch {
            print("Failed to enable dual track: \(error)")
        }
    }
}

private extension AppViewModel.SettingsApplyOutcome {
    /// How a Settings control's save ends once its response has been through
    /// `applySettingsUser`: each outcome maps onto the ending of the same name.
    var controlSaveEnding: SettingsControlSave.Ending {
        switch self {
        case .applied: return .applied
        case .superseded: return .superseded
        case .discarded: return .discarded
        }
    }
}
