import XCTest
import StillPointShared

/// #663: the app's one background app-refresh request carries the earliest time
/// either app blocking (#549) or the widget wants, and a run reports once.
final class BackgroundRefreshScheduleTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_793_000_000)

    // MARK: - Widget's wanted time

    func testASignedInWidgetAsksOneLeadTimeAhead() {
        XCTAssertEqual(
            BackgroundRefreshSchedule.widgetRefreshDate(signedIn: true, now: now),
            now.addingTimeInterval(BackgroundRefreshSchedule.widgetRefreshLeadTime)
        )
    }

    func testASignedOutWidgetAsksForNothing() {
        XCTAssertNil(BackgroundRefreshSchedule.widgetRefreshDate(signedIn: false, now: now))
    }

    // MARK: - Combining the two jobs

    func testTheEarlierShieldTimeWins() {
        let shield = now.addingTimeInterval(5 * 60)
        let widget = now.addingTimeInterval(15 * 60)
        XCTAssertEqual(
            BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: shield, widgetRefresh: widget),
            shield
        )
    }

    /// Shields unlocked for today ask for the next local midnight. The widget
    /// must not have to wait that long to pick up a web sit.
    func testTheEarlierWidgetTimeWins() {
        let shieldAtMidnight = now.addingTimeInterval(9 * 60 * 60)
        let widget = now.addingTimeInterval(15 * 60)
        XCTAssertEqual(
            BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: shieldAtMidnight, widgetRefresh: widget),
            widget
        )
    }

    func testEitherJobAloneKeepsItsOwnTime() {
        let date = now.addingTimeInterval(15 * 60)
        XCTAssertEqual(
            BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: date, widgetRefresh: nil),
            date
        )
        XCTAssertEqual(
            BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: nil, widgetRefresh: date),
            date
        )
    }

    /// Nothing to guard and nobody signed in: the pending request is cancelled.
    func testNeitherJobMeansNoRequest() {
        XCTAssertNil(BackgroundRefreshSchedule.earliestBeginDate(shieldRefresh: nil, widgetRefresh: nil))
    }

    // MARK: - Reporting a run once

    func testARunStartsUnreported() {
        XCTAssertNil(BackgroundTaskCompletion().reported)
    }

    func testTheFirstReportCompletesTheTask() {
        var completion = BackgroundTaskCompletion()
        XCTAssertTrue(completion.report(success: true))
        XCTAssertEqual(completion.reported, true)
    }

    /// The system expired the run, then its cancelled work finished anyway.
    func testWorkFinishingAfterExpiryIsIgnored() {
        var completion = BackgroundTaskCompletion()
        XCTAssertTrue(completion.report(success: false))
        XCTAssertFalse(completion.report(success: true))
        XCTAssertEqual(completion.reported, false)
    }

    /// The work finished first, then the expiration handler fired late.
    func testExpiryAfterTheWorkFinishedIsIgnored() {
        var completion = BackgroundTaskCompletion()
        XCTAssertTrue(completion.report(success: true))
        XCTAssertFalse(completion.report(success: false))
        XCTAssertEqual(completion.reported, true)
    }
}
