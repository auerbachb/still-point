import Foundation
import Testing
@testable import StillPointShared

/// Issue #970: two-a-day, a sit closes yesterday with a server sit on the other track
/// that only the yesterday lookup reported, when the badge query fails.
///
/// Split out of one `PracticeDayStateTests` (#1129); fixtures in `PracticeDayStateTestSupport`.
@MainActor
struct PracticeDayStateFailedBadgeQueryTests: PracticeDayStateTestSupport {
    // MARK: - Two-a-day and a failed badge query (#970)

    /// The issue's case. The primary sit is on the server only, sat on the web, and the
    /// yesterday lookup says so, but the badge query that would raise a flag for it
    /// fails. The second-track sit that finishes here still closes yesterday. The
    /// lookup's answer used to be kept only as "unfinished", which lost the primary
    /// sit, so the next sit was stored on yesterday again.
    @Test func testTwoADayClosesYesterdayWithTheServersSitAndALocalSitWhenTheBadgeQueryFails() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)
        #expect(screen.creditedSessionDate(at: october(27, 3, 5)) == yesterday)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        #expect(
            screen.creditedSessionDate(at: october(27, 3, 40)) == today,
            "the server's sit on the other track was lost with the failed badge query"
        )
    }

    /// The other way round: the second-track sit is on the server only, and the primary
    /// sit finishes here. The Home badge still fails closed: the kept answer counts for
    /// crediting only.
    @Test func testTwoADayClosesYesterdayWithTheServersSecondTrackSitAndALocalPrimarySit() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: true), badges: .failed)
        #expect(!screen.state.secondDoneToday, "the Home badge showed a sit the failed badge query did not report")

        screen.finishSit(.standard, track: .primary, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
    }

    /// The same after a launch before 6:00, which needs the launch stamp (#969) as well:
    /// the flags have to describe yesterday before a sit is weighed against it.
    @Test func testAfterALaunchTwoADayClosesYesterdayWithTheServersSitAndALocalSit() async {
        let screen = makeLaunchedScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
    }

    /// No badge query has answered yet: the second-track sit ends while the lookup is
    /// in flight, and the lookup then lands with the primary sit. Together they finish
    /// yesterday.
    @Test func testTwoADayClosesYesterdayWhenTheLookupLandsWithTheOtherTracksSitAfterALocalOne() async {
        let screen = makeScreen()
        screen.dualTrack = true
        let read = HeldSave(settlingWith: YesterdayRead.answered(primary: true, second: false))
        let resolving = Task { await screen.resolvePreviousPracticeDay(now: october(27, 1), reading: read.perform) }
        await read.untilStarted()

        screen.finishSit(.standard, track: .second, at: october(27, 1, 30))
        read.settle()
        await resolving.value

        #expect(screen.creditedSessionDate(at: october(27, 1, 40)) == today)
    }

    /// A badge query that answered is not lost to a later one that fails. Its primary
    /// sit is kept in a local flag (#679), and since #1021 the Home badges fall back to
    /// that flag rather than clearing.
    @Test func testTwoADayKeepsAnEarlierBadgeAnswerAcrossAFailedBadgeQuery() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .answered(primary: true, second: false))
        #expect(screen.state.primaryDoneToday)

        await screen.refresh(at: october(27, 3, 10), yesterday: .failed, badges: .failed)
        #expect(screen.state.primaryDoneToday, "a failed badge query cleared a sit the session remembers")
        #expect(!screen.state.secondDoneToday, "a failed badge query invented a Track Two sit")
        #expect(screen.state.primaryStandardDoneToday, "a failed badge query dropped the sit it had reported")

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == today)
    }

    /// Unchanged: a single-track user needs only the primary sit, so the server's sit on
    /// the second track, with one here on that track too, leaves yesterday open.
    @Test func testASingleTrackUserStillNeedsThePrimarySit() async {
        let screen = makeScreen()
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: false, second: true), badges: .failed)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))
        #expect(screen.creditedSessionDate(at: october(27, 3, 35)) == yesterday)

        screen.finishSit(.standard, track: .primary, at: october(27, 4))
        #expect(screen.creditedSessionDate(at: october(27, 4, 5)) == today)
    }

    /// Unchanged: two-a-day with only one track sat, on the server and here, leaves
    /// yesterday open.
    @Test func testTwoADayWithOnlyOneTrackSatLeavesYesterdayOpen() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)

        screen.finishSit(.standard, track: .primary, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == yesterday)
    }

    /// Unchanged: with no server read answered in this app run, nothing says the other
    /// track was sat, so one sit here leaves yesterday open. There is no answer to keep.
    @Test func testTwoADayWithNoServerAnswerLeavesYesterdayOpenAfterOneSit() async {
        let screen = makeLaunchedScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .failed, badges: .failed)

        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == yesterday)
    }

    /// A reset drops the server's answer about yesterday with everything else: it
    /// belongs to the account that was signed in.
    @Test func testAResetDropsTheServersAnswerAboutYesterday() async {
        let screen = makeScreen()
        screen.dualTrack = true
        await screen.refresh(at: october(27, 3), yesterday: .answered(primary: true, second: false), badges: .failed)

        screen.reset()
        screen.finishSit(.standard, track: .second, at: october(27, 3, 30))

        #expect(screen.creditedSessionDate(at: october(27, 3, 40)) == yesterday, "the answer about yesterday outlived a reset")
    }
}
