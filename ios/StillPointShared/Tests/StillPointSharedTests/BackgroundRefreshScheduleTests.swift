import Foundation
import Testing
import StillPointShared

/// #663: the app's one background app-refresh request carries the earliest time
/// either app blocking (#549) or the widget wants, and a run reports once.
struct BackgroundRefreshScheduleTests {
    private let now = Date(timeIntervalSince1970: 1_793_000_000)

    // MARK: - Widget's wanted time

    @Test func testASignedInWidgetAsksOneLeadTimeAhead() {
        #expect(BackgroundRefreshSchedule.widgetRefreshDate(signedIn: true, now: now) == now.addingTimeInterval(BackgroundRefreshSchedule.widgetRefreshLeadTime))
    }

    @Test func testASignedOutWidgetAsksForNothing() {
        #expect(BackgroundRefreshSchedule.widgetRefreshDate(signedIn: false, now: now) == nil)
    }

    // MARK: - Combining the two jobs

    @Test func testTheEarlierShieldTimeWins() {
        let shield = now.addingTimeInterval(5 * 60)
        let widget = now.addingTimeInterval(15 * 60)
        #expect(BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: shield, widgetRefresh: widget) == shield)
    }

    /// Shields unlocked for today ask for the next local midnight. The widget
    /// must not have to wait that long to pick up a web sit.
    @Test func testTheEarlierWidgetTimeWins() {
        let shieldAtMidnight = now.addingTimeInterval(9 * 60 * 60)
        let widget = now.addingTimeInterval(15 * 60)
        #expect(BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: shieldAtMidnight, widgetRefresh: widget) == widget)
    }

    @Test func testEitherJobAloneKeepsItsOwnTime() {
        let date = now.addingTimeInterval(15 * 60)
        #expect(BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: date, widgetRefresh: nil) == date)
        #expect(BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: nil, widgetRefresh: date) == date)
    }

    /// Nothing to guard and nobody signed in: the pending request is cancelled.
    @Test func testNeitherJobMeansNoRequest() {
        #expect(BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: nil, widgetRefresh: nil) == nil)
    }

    // MARK: - Reporting a run once

    @Test func testARunStartsUnreported() {
        #expect(BackgroundTaskCompletion().reported == nil)
    }

    @Test func testTheFirstReportCompletesTheTask() {
        var completion = BackgroundTaskCompletion()
        #expect(completion.report(success: true) == true)
        #expect(completion.reported == true)
    }

    /// The system expired the run, then its cancelled work finished anyway.
    @Test func testWorkFinishingAfterExpiryIsIgnored() {
        var completion = BackgroundTaskCompletion()
        #expect(completion.report(success: false) == true)
        #expect(completion.report(success: true) == false)
        #expect(completion.reported == false)
    }

    /// The work finished first, then the expiration handler fired late.
    @Test func testExpiryAfterTheWorkFinishedIsIgnored() {
        var completion = BackgroundTaskCompletion()
        #expect(completion.report(success: true) == true)
        #expect(completion.report(success: false) == false)
        #expect(completion.reported == true)
    }
}
