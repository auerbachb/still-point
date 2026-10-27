import Foundation
import Testing
@testable import StillPointShared

/// Issue #894: before 6:00, a sit that finishes yesterday must not be outvoted by a
/// server answer about yesterday that was read before the sit ended. That answer cannot
/// have seen the sit, so its "incomplete" is the server lagging, not contradicting it.
/// Before the fix, the next sit before 6:00 was stored on yesterday again. Web keeps a
/// sit remembered across the same read (#855, PR #878).
///
/// Split out of one `PracticeDayStateTests` (#1129); fixtures in `PracticeDayStateTestSupport`.
@MainActor
struct PracticeDayStateYesterdayLookupTests: PracticeDayStateTestSupport {
    // MARK: - A sit that ends while the lookup is in flight

    /// The order the issue names. The lookup leaves at 1:00, the sit that finishes
    /// yesterday ends at 1:30, and the lookup then lands with the "incomplete" it read
    /// before that sit reached the server.
    @Test func testAnIncompleteAnswerLandingAfterTheSitEndsDoesNotReopenYesterday() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        // The sit itself is stored on yesterday, and finishes it.
        #expect(screen.creditedSessionDate(at: october(27, 1, 10)) == yesterday)
        screen.finishSit(.standard, at: october(27, 1, 30))
        #expect(screen.creditedSessionDate(at: october(27, 1, 30)) == today)

        read.settle()
        await resolving.value

        #expect(
            screen.creditedSessionDate(at: october(27, 1, 40)) == today,
            "an answer read before the sit ended reopened yesterday"
        )
    }

    /// A lookup that fails is no better. By the time it lands, the sit has rolled the
    /// flags onto today, so the failure fallback used to read "before 6:00, still open".
    @Test func testAFailedLookupLandingAfterTheSitEndsDoesNotReopenYesterday() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.failed)
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, at: october(27, 1, 30))
        read.settle()
        await resolving.value

        #expect(
            screen.creditedSessionDate(at: october(27, 1, 40)) == today,
            "a lookup that failed after the sit ended reopened yesterday"
        )
    }

    /// The same answer, landing before the sit ends. It is still current when the sit
    /// ends, and the rollover used to prefer it to the flags.
    @Test func testAnIncompleteAnswerThatLandedBeforeTheSitDoesNotOutvoteIt() async {
        let screen = makeScreen()
        await screen.resolvePreviousPracticeDay(now: october(27, 1), reading: { .answered(primary: false, second: false) })
        #expect(screen.creditedSessionDate(at: october(27, 1, 10)) == yesterday)

        screen.finishSit(.standard, at: october(27, 1, 30))

        #expect(screen.creditedSessionDate(at: october(27, 1, 40)) == today, "an answer read before the sit ended outvoted it")
    }

    /// Once a sit has finished yesterday, the next refresh asks nothing more about it.
    /// The only news a lookup could bring is the server lagging that sit, or, offline as
    /// on the trip home after it, a failure whose fallback reads "before 6:00, still
    /// open" once the flags are on today.
    @Test func testARefreshAfterTheSitFinishesYesterdayDoesNotAskAgain() async {
        let screen = makeScreen()
        screen.finishSit(.standard, at: october(27, 1, 30))

        await screen.resolvePreviousPracticeDay(now: october(27, 1, 35), reading: {
            Issue.record("asked about yesterday again after a sit finished it")
            return .failed
        })

        #expect(screen.creditedSessionDate(at: october(27, 1, 40)) == today)
    }

    /// Two-a-day: the first sit does not finish yesterday, so the lookup's answer still
    /// applies and the day stays open. The second sit finishes it, and that answer,
    /// current by then, does not outvote it.
    @Test func testTwoADayClosesYesterdayWhenItsSecondSitEnds() async {
        let screen = makeScreen()
        screen.dualTrack = true
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, track: .primary, at: october(27, 1, 30))
        read.settle()
        await resolving.value
        #expect(screen.creditedSessionDate(at: october(27, 1, 35)) == yesterday, "the first of two sits finished yesterday")

        screen.finishSit(.standard, track: .second, at: october(27, 2))

        #expect(screen.creditedSessionDate(at: october(27, 2, 5)) == today)
    }

    // MARK: - Unchanged

    /// A quick sit is practice, but not one of yesterday's required sits. It finishes
    /// nothing, so the lookup's answer still applies.
    @Test func testAQuickSitDuringTheLookupLeavesYesterdayOpen() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.quick, at: october(27, 1, 30))
        read.settle()
        await resolving.value

        #expect(screen.creditedSessionDate(at: october(27, 1, 40)) == yesterday)
    }

    /// At 6:00 the new calendar day begins whatever is known about yesterday, so a
    /// lookup that left before 6:00 and lands after it changes nothing.
    @Test func testALookupThatLeftBefore6AndLandsAfterItLeavesTheDayOnToday() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: false, second: false))
        let leftAt = october(27, 5, 50)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, at: october(27, 6, 5))
        read.settle()
        await resolving.value

        #expect(screen.creditedSessionDate(at: october(27, 6, 10)) == today)
    }

    /// A badge query about yesterday that left before 6:00 and lands after a sit at
    /// 6:00 or later rolled the flags onto today. Its answer must not move the stamp
    /// back to yesterday, or the next rollover clears today's sit.
    @Test func testABadgeAnswerAboutYesterdayLandingAfterATodaySitKeepsTheSit() {
        let screen = makeScreen()
        let leftAt = october(27, 5, 59)
        #expect(screen.creditedSessionDate(at: leftAt) == yesterday)

        screen.finishSit(.standard, at: october(27, 6, 1))
        screen.landBadgeAnswer(
            primary: false, second: true, creditedDate: yesterday,
            leftAt: leftAt, landedAt: october(27, 6, 2)
        )

        #expect(stampDay(screen) == today, "a late answer about yesterday rewound the stamp")
        #expect(screen.state.primaryStandardDoneToday, "the next rollover cleared today's sit")
        #expect(screen.state.practiceDoneToday)
        #expect(!screen.state.secondPracticeDoneToday, "yesterday's second-track sit was claimed for today")
    }

    /// A reset disowns a lookup still in flight. Its answer here would have finished
    /// yesterday, so a day still open afterwards shows that it was dropped.
    @Test func testAResetDuringTheLookupDropsItsAnswer() async {
        let screen = makeScreen()
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: true, second: false))
        let leftAt = october(27, 1)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: leftAt, reading: read.perform) }
        await read.untilStarted()

        screen.reset()
        read.settle()
        await resolving.value

        #expect(!screen.state.previousDayResolved)
        #expect(screen.creditedSessionDate(at: october(27, 1, 40)) == yesterday)
    }

    /// Before 6:00, nothing known and nothing sat keeps yesterday open, and an answer
    /// that says it is finished closes it.
    @Test func testBefore6YesterdayStaysOpenUntilAnAnswerFinishesIt() async {
        let screen = makeScreen()
        #expect(screen.creditedSessionDate(at: october(27, 1)) == yesterday)

        await screen.resolvePreviousPracticeDay(now: october(27, 1, 5), reading: { .answered(primary: true, second: false) })

        #expect(screen.creditedSessionDate(at: october(27, 1, 10)) == today)
    }

    /// A failed lookup with nothing sat leaves yesterday open, and the next refresh
    /// asks again.
    @Test func testAFailedLookupWithNothingSatLeavesYesterdayOpen() async {
        let screen = makeScreen()

        await screen.resolvePreviousPracticeDay(now: october(27, 1), reading: { .failed })

        #expect(screen.creditedSessionDate(at: october(27, 1, 10)) == yesterday)
        var askedAgain = false
        await screen.resolvePreviousPracticeDay(now: october(27, 1, 20), reading: {
            askedAgain = true
            return .failed
        })
        #expect(askedAgain)
    }
}
