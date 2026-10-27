import Foundation
import Testing
@testable import StillPointShared

/// How the yesterday lookup settles once the test lets it.
private enum LookupResult: Sendable {
    case answered(primary: Bool, second: Bool)
    /// A genuine failure: the server or the network said no.
    case failed
    /// The request was called off (`CancellationError`).
    case cancelled
}

private struct LookupFailure: Error {}

/// The order `refreshTracksDoneToday()` works in, cut down to what #1106 is about:
/// the identity generation, the practice-day state, the yesterday lookup the tests
/// hold open, and the stored-widget-snapshot rollover the refresh runs once the
/// lookup lets it go on. Main-actor isolated, like `AppViewModel`.
@MainActor
private final class RefreshScreen {
    private(set) var generation = 1
    var state = PracticeDayState()
    let calendar: Calendar
    /// How many refreshes reached `rollOverFromStoredSnapshotIfNeeded(now:)`.
    private(set) var storedSnapshotRollovers = 0

    init(calendar: Calendar) {
        self.calendar = calendar
        // A launch: `resetTrackCompletionBadges()`, nothing rolled over since.
        state.reset()
    }

    /// `applySignedOut` / `didLogout`: the generation moves. `applySignedOut` does
    /// not reset the practice day, so the lookup's ticket is still current.
    func signOut() { generation += 1 }

    /// `applyAuthenticatedUser` followed by the badge reset `checkAuth()` runs.
    func signIn() {
        generation += 1
        state.reset()
    }

    /// `refreshTracksDoneToday()` up to and including the stored-snapshot rollover.
    /// The generation is captured before the lookup, as the refresh captures it
    /// before its first `await`.
    func refresh(at now: Date, lookup: HeldSave<LookupResult>) -> Task<PreviousDayLookup.Outcome, Never> {
        let generation = generation
        return Task {
            let outcome = await PreviousDayLookup.run(
                startedAt: generation,
                liveGeneration: { self.generation },
                begin: { self.state.beginPreviousDayRead(now: now, calendar: self.calendar) },
                fetch: {
                    switch await lookup.perform() {
                    case let .answered(primary, second):
                        return TracksDoneTodayDTO(primary: primary, second: second)
                    case .failed:
                        throw LookupFailure()
                    case .cancelled:
                        throw CancellationError()
                    }
                },
                isCancellation: { RequestCancellation.isCancellation($0, taskIsCancelled: Task.isCancelled) },
                applyAnswer: { tracks, ticket in
                    self.state.applyPreviousDayAnswer(
                        tracks, ticket: ticket, now: now, dualTrack: false, calendar: self.calendar
                    )
                },
                applyFailure: { ticket in
                    self.state.applyFailedPreviousDayRead(
                        ticket: ticket, now: now, dualTrack: false, calendar: self.calendar
                    )
                }
            )
            guard outcome.refreshMayContinue else { return outcome }
            // `rollOverFromStoredSnapshotIfNeeded(now:)` with a stored snapshot from
            // an earlier day the grace window no longer keeps open: it lowers the
            // flags of whoever is signed in.
            storedSnapshotRollovers += 1
            state.practiceDoneToday = false
            state.secondPracticeDoneToday = false
            state.primaryStandardDoneToday = false
            return outcome
        }
    }
}

/// Issue #1106: the yesterday lookup in `refreshTracksDoneToday()` is a suspension
/// point, and an identity change can land in it. Each test holds the lookup open
/// across a sign-out, a sign-in or a cancellation and checks what the late result
/// may still record, and whether the refresh goes on to its rollovers.
@MainActor
struct PreviousDayLookupTests {
    private var newYork: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    /// Before the 6:00 cutoff on 27 October, so the lookup takes a ticket.
    private var beforeCutoff: Date {
        newYork.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 1))!
    }

    // MARK: - Same account

    /// Nothing changes in the window: the answer is recorded and the refresh goes on.
    @Test func testAnAnswerForTheSameAccountIsRecordedAndTheRefreshContinues() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.answered(primary: false, second: false))
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        lookup.settle()

        #expect(await refresh.value == .answered)
        #expect(screen.state.previousDayResolved)
        #expect(!screen.state.previousCalendarDayComplete)
        #expect(screen.storedSnapshotRollovers == 1)
    }

    /// At or after 6:00 nothing is asked, and the refresh goes on.
    @Test func testNoLookupIsNeededAfterTheCutoff() async {
        let screen = RefreshScreen(calendar: newYork)
        let afterCutoff = newYork.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 7))!
        let lookup = HeldSave(settlingWith: LookupResult.failed)

        let outcome = await screen.refresh(at: afterCutoff, lookup: lookup).value

        #expect(outcome == .notNeeded)
        #expect(screen.storedSnapshotRollovers == 1)
    }

    // MARK: - Identity change mid-await

    /// An automatic sign-out (`applySignedOut`) moves the generation but does not
    /// reset the practice day, so the lookup's ticket alone would still accept the
    /// answer. The generation check is what drops it — and ends the refresh before
    /// it rolls anything over.
    @Test func testAnAnswerThatOutlivesASignOutRecordsNothing() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.answered(primary: true, second: true))
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        screen.signOut()
        lookup.settle()

        #expect(await refresh.value == .discarded)
        #expect(!screen.state.previousDayResolved)
        #expect(screen.storedSnapshotRollovers == 0)
    }

    /// The same for a failure: failing closed would record an unknown yesterday in a
    /// practice day that is no longer the account's that asked.
    @Test func testAFailureThatOutlivesASignOutRecordsNothing() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.failed)
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        screen.signOut()
        lookup.settle()

        #expect(await refresh.value == .discarded)
        // `reset()` leaves yesterday assumed finished; a recorded failure before
        // 6:00 would have reopened it.
        #expect(screen.state.previousCalendarDayComplete)
        #expect(screen.storedSnapshotRollovers == 0)
    }

    /// A newer account's lookup fails first, then the older account's answer lands.
    /// The failure stands; the late answer neither records yesterday as finished
    /// nor rolls the new account's flags over.
    @Test func testANewerAccountsFailureIsNotOverwrittenByAnOlderAccountsLateAnswer() async {
        let screen = RefreshScreen(calendar: newYork)
        let olderLookup = HeldSave(settlingWith: LookupResult.answered(primary: true, second: true))
        let olderRefresh = screen.refresh(at: beforeCutoff, lookup: olderLookup)
        await olderLookup.untilStarted()

        screen.signOut()
        screen.signIn()
        let newerLookup = HeldSave(settlingWith: LookupResult.failed)
        let newerRefresh = screen.refresh(at: beforeCutoff, lookup: newerLookup)
        await newerLookup.untilStarted()
        newerLookup.settle()
        #expect(await newerRefresh.value == .failed)

        olderLookup.settle()

        #expect(await olderRefresh.value == .discarded)
        #expect(!screen.state.previousDayResolved)
        #expect(!screen.state.previousCalendarDayComplete)
        #expect(screen.storedSnapshotRollovers == 1)
    }

    /// The other order: the older account's answer lands first, while the newer
    /// account's lookup is still open. It is dropped, and the newer failure that
    /// follows is recorded as the only word on yesterday.
    @Test func testAnOlderAccountsAnswerLandingFirstDoesNotPreemptTheNewerLookup() async {
        let screen = RefreshScreen(calendar: newYork)
        let olderLookup = HeldSave(settlingWith: LookupResult.answered(primary: true, second: true))
        let olderRefresh = screen.refresh(at: beforeCutoff, lookup: olderLookup)
        await olderLookup.untilStarted()

        screen.signOut()
        screen.signIn()
        let newerLookup = HeldSave(settlingWith: LookupResult.failed)
        let newerRefresh = screen.refresh(at: beforeCutoff, lookup: newerLookup)
        await newerLookup.untilStarted()

        olderLookup.settle()
        #expect(await olderRefresh.value == .discarded)
        #expect(!screen.state.previousDayResolved)

        newerLookup.settle()
        #expect(await newerRefresh.value == .failed)
        #expect(!screen.state.previousCalendarDayComplete)
    }

    /// Stored-widget rollover during an identity change: the next account has
    /// already sat when the previous account's lookup settles. That refresh must
    /// not go on to the stored-snapshot rollover, which would lower the flags the
    /// new account just earned.
    @Test func testALookupThatOutlivesAnAccountSwitchSkipsTheStoredSnapshotRollover() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.answered(primary: false, second: false))
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        screen.signOut()
        screen.signIn()
        screen.state.recordCompletion(
            sessionType: .standard, track: .primary, now: beforeCutoff, dualTrack: false, calendar: newYork
        )
        #expect(screen.state.practiceDoneToday)
        lookup.settle()

        #expect(await refresh.value == .discarded)
        #expect(screen.storedSnapshotRollovers == 0)
        #expect(screen.state.practiceDoneToday)
    }

    // MARK: - Cancellation mid-await

    /// A cancelled request that came back with an answer anyway holds real server
    /// data for the live account, so it is recorded, like the badge query's success.
    @Test func testACancelledLookupThatStillAnsweredIsRecorded() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.answered(primary: false, second: false))
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        refresh.cancel()
        lookup.settle()

        #expect(await refresh.value == .answered)
        #expect(screen.state.previousDayResolved)
        #expect(!screen.state.previousCalendarDayComplete)
    }

    /// A cancelled request asked nothing (#759): it records no failure, and the
    /// refresh ends for its replacement to make the same calls.
    @Test func testACancelledLookupRecordsNoFailureAndEndsTheRefresh() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.cancelled)
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        lookup.settle()

        #expect(await refresh.value == .cancelled)
        #expect(screen.state.previousCalendarDayComplete)
        #expect(screen.storedSnapshotRollovers == 0)
    }

    /// An error that is not itself a cancellation, thrown inside a task that was
    /// called off, is still read as one: `Task.isCancelled` is the signal
    /// `RequestCancellation` trusts first, since a transport need not surface the
    /// cancel in its error.
    @Test func testAFailureFromACancelledTaskIsTreatedAsACancellation() async {
        let screen = RefreshScreen(calendar: newYork)
        let lookup = HeldSave(settlingWith: LookupResult.failed)
        let refresh = screen.refresh(at: beforeCutoff, lookup: lookup)
        await lookup.untilStarted()

        refresh.cancel()
        lookup.settle()

        #expect(await refresh.value == .cancelled)
        #expect(screen.state.previousCalendarDayComplete)
        #expect(screen.storedSnapshotRollovers == 0)
    }
}
