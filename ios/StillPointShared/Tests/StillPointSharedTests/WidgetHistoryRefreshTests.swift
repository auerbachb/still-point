import XCTest
import StillPointShared

final class WidgetHistoryRefreshTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ string: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)!
    }

    func testNeverFetchedRefreshes() {
        XCTAssertTrue(WidgetDataStore.shouldRefreshWidgetHistory(
            userId: "u",
            now: date("2026-10-07T15:00:00Z"),
            lastUserId: nil,
            lastLocalDay: nil,
            lastSuccessAt: nil,
            calendar: calendar
        ))
    }

    func testSameAccountInsideTheIntervalDoesNotRefresh() {
        let now = date("2026-10-07T15:00:00Z")
        XCTAssertFalse(WidgetDataStore.shouldRefreshWidgetHistory(
            userId: "u",
            now: now,
            lastUserId: "u",
            lastLocalDay: "2026-10-07",
            lastSuccessAt: now.addingTimeInterval(-60),
            calendar: calendar
        ))
    }

    func testSameAccountRefreshesOnceTheIntervalElapses() {
        let now = date("2026-10-07T15:00:00Z")
        XCTAssertTrue(WidgetDataStore.shouldRefreshWidgetHistory(
            userId: "u",
            now: now,
            lastUserId: "u",
            lastLocalDay: "2026-10-07",
            lastSuccessAt: now.addingTimeInterval(-WidgetDataStore.widgetHistoryRefreshInterval),
            calendar: calendar
        ))
    }

    func testANewLocalDayRefreshesImmediately() {
        XCTAssertTrue(WidgetDataStore.shouldRefreshWidgetHistory(
            userId: "u",
            now: date("2026-10-07T00:01:00Z"),
            lastUserId: "u",
            lastLocalDay: "2026-10-06",
            lastSuccessAt: date("2026-10-06T23:00:00Z"),
            calendar: calendar
        ))
    }

    func testADifferentAccountRefreshesImmediately() {
        let now = date("2026-10-07T15:00:00Z")
        XCTAssertTrue(WidgetDataStore.shouldRefreshWidgetHistory(
            userId: "other",
            now: now,
            lastUserId: "u",
            lastLocalDay: "2026-10-07",
            lastSuccessAt: now,
            calendar: calendar
        ))
    }

    func testAClearedSuccessRetriesImmediately() {
        XCTAssertTrue(WidgetDataStore.shouldRefreshWidgetHistory(
            userId: "u",
            now: date("2026-10-07T15:00:00Z"),
            lastUserId: "u",
            lastLocalDay: "2026-10-07",
            lastSuccessAt: nil,
            calendar: calendar
        ))
    }
}
