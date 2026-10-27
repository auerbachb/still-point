import Foundation
import Testing
@testable import StillPointShared

/// Issue #1021: after a failed badge query, Home's badges fall back to the sits this
/// session remembers (web parity with #961).
///
/// Split out of one `PracticeDayStateTests` (#1129); fixtures in `PracticeDayStateTestSupport`.
@MainActor
struct PracticeDayStateHomeBadgeTests: PracticeDayStateTestSupport {
    // MARK: - Home badges after a failed badge query (#1021, web parity with #961)

    /// The issue's case: a primary standard sit finished offline, so the badge query
    /// fails. Home shows it as done from the local flag instead of neither-done.
    @Test func testAFailedBadgeQueryShowsAPrimarySitFinishedOffline() async {
        let screen = makeScreen()
        screen.finishSit(.standard, at: october(27, 9))

        await screen.refresh(at: october(27, 9, 5), yesterday: .failed, badges: .failed)

        #expect(screen.state.primaryDoneToday, "a sit finished offline showed as not done on Home")
        #expect(!screen.state.secondDoneToday)
    }

    /// Two-a-day: the fallback is per track, so a Track Two sit finished offline lights
    /// only the Track Two badge.
    @Test func testTwoADayFailedBadgeQueryShowsOnlyTheTrackSatOffline() async {
        let screen = makeScreen()
        screen.dualTrack = true
        screen.finishSit(.standard, track: .second, at: october(27, 9))

        await screen.refresh(at: october(27, 9, 5), yesterday: .failed, badges: .failed)

        #expect(!screen.state.primaryDoneToday, "a Track Two sit lit the Track One badge")
        #expect(screen.state.secondDoneToday, "a Track Two sit finished offline showed as not done on Home")
    }

    /// The badges mean a *standard* sit (#240). A quick or breath sit raises the
    /// widget's practice flag but not the standard one, so it does not light a badge.
    @Test func testAFailedBadgeQueryDoesNotCountAQuickOrBreathSitAsAStandardOne() async {
        for sessionType in [SessionType.quick, .breath] {
            let screen = makeScreen()
            screen.finishSit(sessionType, at: october(27, 9))

            await screen.refresh(at: october(27, 9, 5), yesterday: .failed, badges: .failed)

            #expect(screen.state.practiceDoneToday)
            #expect(!screen.state.primaryDoneToday, "a \(sessionType) sit lit the standard-sit badge")
        }
    }

    /// No stale badge past the day: a sit from yesterday afternoon, then a failed
    /// badge query the next morning after 6:00, shows neither track done.
    @Test func testAFailedBadgeQueryOnANewDayShowsNeitherTrackDone() async {
        let screen = makeScreen()
        screen.dualTrack = true
        screen.finishSit(.standard, at: october(26, 21))
        screen.finishSit(.standard, track: .second, at: october(26, 22))

        await screen.refresh(at: october(27, 9), yesterday: .failed, badges: .failed)

        #expect(!screen.state.primaryDoneToday, "yesterday's Track One sit leaked onto today's badge")
        #expect(!screen.state.secondDoneToday, "yesterday's Track Two sit leaked onto today's badge")
    }

    /// The fallback rolls the flags over when it reads them, not only when the query
    /// left: a query that left before midnight and failed after it shows neither done.
    @Test func testAFailedBadgeQueryThatOutlivedTheDayShowsNeitherTrackDone() {
        var state = PracticeDayState()
        state.rollOverIfNeeded(now: october(26, 20), dualTrack: false, calendar: newYork)
        state.recordCompletion(sessionType: .standard, track: .primary, now: october(26, 21), dualTrack: false, calendar: newYork)

        state.applyFailedTracksDoneRead(now: october(27, 9), dualTrack: false, calendar: newYork)

        #expect(!state.primaryDoneToday, "a sit from the day before reached today's badge")
        #expect(!state.primaryStandardDoneToday)
    }
}
