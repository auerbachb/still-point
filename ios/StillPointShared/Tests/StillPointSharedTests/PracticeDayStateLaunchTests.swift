import Foundation
import Testing
@testable import StillPointShared

/// Issue #969: a sit must close yesterday after a launch before 6:00.
///
/// Split out of one `PracticeDayStateTests` (#1129); fixtures in `PracticeDayStateTestSupport`.
@MainActor
struct PracticeDayStateLaunchTests: PracticeDayStateTestSupport {
    // MARK: - A launch before 6:00 (#969)

    /// The issue's order: a launch at 3:00 with the network down, so the yesterday
    /// lookup and the badge query both fail. A sit that finishes yesterday still closes
    /// it, and the next sit is stored on today with no badge query answered in between.
    /// The launch rollover used to stamp the flags onto today, so nothing weighed them
    /// against yesterday until a badge query answered and moved the stamp back.
    @Test func testAfterALaunchBefore6ASitClosesYesterdayWhenBothReadsFail() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)
        #expect(screen.creditedSessionDate(at: october(27, 3, 5)) == yesterday)
        #expect(stampDay(screen) == yesterday, "the launch stamped the flags onto a day no sit is credited to")

        screen.finishSit(.standard, at: october(27, 3, 30))

        #expect(
            screen.creditedSessionDate(at: october(27, 3, 40)) == today,
            "a sit that finished yesterday after a launch left it open"
        )
        #expect(stampDay(screen) == today)
    }

    /// The same with no refresh yet: the sit starts straight after the launch, so its
    /// own credited date runs the first rollover.
    @Test func testAfterALaunchBefore6ASitClosesYesterdayBeforeAnyRead() {
        let screen = makeLaunchedScreen()
        #expect(screen.creditedSessionDate(at: october(27, 3)) == yesterday)

        screen.finishSit(.standard, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
    }

    /// An answer that yesterday is unfinished, and a failed badge query. The sit still
    /// closes yesterday: the answer was read before the sit ended (#894).
    @Test func testAfterALaunchBefore6ASitClosesYesterdayAfterAnIncompleteAnswer() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: false), badges: .failed)
        #expect(screen.creditedSessionDate(at: october(27, 3, 5)) == yesterday)

        screen.finishSit(.standard, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
    }

    /// A lookup that leaves at the launch and fails after the sit has ended changes
    /// nothing, and the next refresh asks nothing more about yesterday.
    @Test func testAfterALaunchBefore6ALookupThatFailsAfterTheSitDoesNotReopenYesterday() async {
        let screen = makeLaunchedScreen()
        let read = HeldSave(settlingWith: YesterdayRead.failed)
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: october(27, 3), reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, at: october(27, 3, 30))
        read.settle()
        await resolving.value

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
        await screen.resolvePreviousPracticeDay(now: october(27, 3, 45), reading: {
            Issue.record("asked about yesterday again after a sit finished it")
            return .failed
        })
    }

    /// Unchanged: a quick or breath sit is practice, but not one of yesterday's required
    /// sits, so after a launch it leaves yesterday open, as it does at any other time.
    @Test func testAfterALaunchBefore6AQuickOrBreathSitLeavesYesterdayOpen() async {
        for sessionType in [SessionType.quick, .breath] {
            let screen = makeLaunchedScreen()
            await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)

            screen.finishSit(sessionType, at: october(27, 3, 30))

            #expect(
                screen.creditedSessionDate(at: october(27, 3, 40)) == yesterday,
                "a \(sessionType) sit after a launch closed yesterday"
            )
            #expect(screen.state.practiceDoneToday, "a \(sessionType) sit after a launch was not recorded")
        }
    }

    /// What a sit raises before 6:00 after a launch is about yesterday, the day it was
    /// credited to, so it retires at 6:00 instead of carrying into today. Stamped onto
    /// today, a quick sit at 3:30 stayed raised past 6:00, and the widget folded it
    /// into today's row.
    @Test func testAfterALaunchBefore6TheFlagsRetireAt6() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)
        screen.finishSit(.quick, at: october(27, 3, 30))
        #expect(screen.state.practiceDoneToday)

        #expect(screen.creditedSessionDate(at: october(27, 6, 5)) == today)

        #expect(!screen.state.practiceDoneToday, "yesterday's quick sit carried into today")
    }

    /// Two-a-day after a launch: the first sit leaves yesterday open (unchanged), and
    /// the second closes it.
    @Test func testAfterALaunchBefore6TwoADayClosesYesterdayWithItsSecondSit() async {
        let screen = makeLaunchedScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)

        screen.finishSit(.standard, track: .primary, at: october(27, 3, 30))
        #expect(screen.creditedSessionDate(at: october(27, 3, 35)) == yesterday, "the first of two sits finished yesterday")

        screen.finishSit(.standard, track: .second, at: october(27, 4))

        #expect(screen.creditedSessionDate(at: october(27, 4, 5)) == today)
    }

    /// Unchanged: at 6:00 or later a launch credits today and stamps the flags there.
    @Test func testALaunchAt6OrLaterStampsAndCreditsToday() async {
        let screen = makeLaunchedScreen()
        await screen.refresh(at: october(27, 6), yesterday: .failed, badges: .failed)

        #expect(stampDay(screen) == today)
        #expect(screen.creditedSessionDate(at: october(27, 6, 5)) == today)
    }

    /// The same rollover after a stamp older than yesterday: the app comes back before
    /// 6:00 after two days away, and the lookup says yesterday is unfinished. The flags
    /// roll onto yesterday, not today, so a sit closes it.
    @Test func testAfterTwoDaysAwayASitBefore6ClosesTheYesterdayALookupKeptOpen() async {
        let screen = PracticeDayScreen(calendar: newYork, lastUsed: october(25, 20))
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: false), badges: .failed)
        #expect(screen.creditedSessionDate(at: october(27, 3, 5)) == yesterday)

        screen.finishSit(.standard, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
    }
}
