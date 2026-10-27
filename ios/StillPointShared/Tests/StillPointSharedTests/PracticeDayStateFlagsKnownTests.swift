import Foundation
import Testing
@testable import StillPointShared

/// Issue #1071: whether the done-today flags are an answer (web's `tracksDoneTodayKnown`),
/// which `AppViewModel.combineOffered` requires.
///
/// Split out of one `PracticeDayStateTests` (#1129); fixtures in `PracticeDayStateTestSupport`.
@MainActor
struct PracticeDayStateFlagsKnownTests: PracticeDayStateTestSupport {
    // MARK: - Whether the flags are an answer (#1071, web's `tracksDoneTodayKnown`)

    /// A launched state whose newest badge query answered "neither done" at 9:00 today.
    private func answeredNeitherDone() -> PracticeDayState {
        var state = PracticeDayState()
        state.reset()
        state.rollOverIfNeeded(now: october(27, 9), dualTrack: true, calendar: newYork)
        let read = state.beginTracksDoneRead()
        state.applyTracksDoneAnswer(
            TracksDoneTodayDTO(primary: false, second: false),
            creditedDate: today, now: october(27, 9), read: read, calendar: newYork
        )
        return state
    }

    @Test func testTheFlagsAreNotAnAnswerBeforeTheFirstBadgeQueryLands() {
        var state = PracticeDayState()
        #expect(!state.doneTodayFlagsKnown, "a fresh state read as answered")
        state.reset()
        state.rollOverIfNeeded(now: october(27, 9), dualTrack: true, calendar: newYork)
        _ = state.beginTracksDoneRead()
        #expect(!state.doneTodayFlagsKnown, "the flags read as answered while the first query was in flight")
    }

    @Test func testTheNewestAnswerMakesTheFlagsKnown() {
        #expect(answeredNeitherDone().doneTodayFlagsKnown)
    }

    @Test func testANewerQueryInFlightMakesTheFlagsUnknownAndAnOlderAnswerDoesNotRestoreThem() {
        var state = PracticeDayState()
        state.reset()
        state.rollOverIfNeeded(now: october(27, 9), dualTrack: true, calendar: newYork)
        let older = state.beginTracksDoneRead()
        _ = state.beginTracksDoneRead()
        #expect(!state.doneTodayFlagsKnown)

        state.applyTracksDoneAnswer(
            TracksDoneTodayDTO(primary: false, second: false),
            creditedDate: today, now: october(27, 9), read: older, calendar: newYork
        )

        #expect(!state.doneTodayFlagsKnown, "an older answer read as known while a newer query was in flight")
    }

    @Test func testAFailedBadgeQueryLeavesTheFlagsUnknown() {
        var state = answeredNeitherDone()
        _ = state.beginTracksDoneRead()
        state.applyFailedTracksDoneRead(now: october(27, 9, 5), dualTrack: true, calendar: newYork)
        #expect(!state.doneTodayFlagsKnown, "a failed query's local fallback read as an answer")
    }

    @Test func testASignOutOrAccountSwitchMakesTheFlagsUnknown() {
        var state = answeredNeitherDone()
        state.reset()
        #expect(!state.doneTodayFlagsKnown, "the previous account's answer survived a reset")
    }

    @Test func testAnAnswerThatLeftBeforeAResetDoesNotMakeTheFlagsKnown() {
        var state = PracticeDayState()
        state.reset()
        state.rollOverIfNeeded(now: october(27, 9), dualTrack: true, calendar: newYork)
        let read = state.beginTracksDoneRead()
        state.reset()
        state.applyTracksDoneAnswer(
            TracksDoneTodayDTO(primary: false, second: false),
            creditedDate: today, now: october(27, 9), read: read, calendar: newYork
        )
        #expect(!state.doneTodayFlagsKnown, "an answer from before the reset read as known")
    }

    @Test func testASitFinishedHereMakesTheFlagsUnknownUntilTheNextAnswer() {
        var state = answeredNeitherDone()
        state.recordCompletion(sessionType: .standard, track: .primary, now: october(27, 10), dualTrack: true, calendar: newYork)
        #expect(!state.doneTodayFlagsKnown, "an answer from before the sit read as current")
    }

    @Test func testANewDayMakesYesterdaysAnswerUnknown() {
        var state = answeredNeitherDone()
        state.rollOverIfNeeded(now: october(28, 9), dualTrack: true, calendar: newYork)
        #expect(!state.doneTodayFlagsKnown, "yesterday's answer was read as today's")
    }

    /// With the flags known, the offer behaves as before: the rule is `CombinedSit`'s.
    @Test func testAKnownNeitherDoneAnswerStillOffersTheCombinedSit() {
        let state = answeredNeitherDone()
        #expect(
            state.doneTodayFlagsKnown && CombinedSit.isCombineOffered(
                dualTrackEnabled: true,
                primaryDoneToday: state.primaryDoneToday,
                secondDoneToday: state.secondDoneToday,
                recoveryActive: false
            )
        )
    }
}
