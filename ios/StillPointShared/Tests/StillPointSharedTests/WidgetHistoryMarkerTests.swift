import XCTest
import StillPointShared

final class WidgetHistoryMarkerTests: XCTestCase {
    private func date(_ string: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)!
    }

    func testFailedCurrentAttemptOwnsItsMarker() {
        let attemptedAt = date("2026-10-07T15:00:00Z")
        XCTAssertTrue(WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
            cancelled: false,
            markerUserId: "u",
            markerDay: "2026-10-07",
            markerAttemptedAt: attemptedAt,
            attemptUserId: "u",
            attemptDay: "2026-10-07",
            attemptedAt: attemptedAt
        ))
    }

    func testCancelledOlderAttemptLeavesTheNewerMarker() {
        let attemptA = date("2026-10-07T15:00:00Z")
        let attemptB = attemptA.addingTimeInterval(1)
        XCTAssertFalse(WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
            cancelled: true,
            markerUserId: "u",
            markerDay: "2026-10-07",
            markerAttemptedAt: attemptB,
            attemptUserId: "u",
            attemptDay: "2026-10-07",
            attemptedAt: attemptA
        ))
    }

    func testFailedOlderAttemptLeavesTheNewerMarker() {
        let attemptA = date("2026-10-07T15:00:00Z")
        let attemptB = attemptA.addingTimeInterval(1)
        XCTAssertFalse(WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
            cancelled: false,
            markerUserId: "u",
            markerDay: "2026-10-07",
            markerAttemptedAt: attemptB,
            attemptUserId: "u",
            attemptDay: "2026-10-07",
            attemptedAt: attemptA
        ))
    }
}
