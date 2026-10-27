import Foundation
import Testing
import StillPointShared

struct WidgetHistoryMarkerTests {
    private func date(_ string: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)!
    }

    @Test func testFailedCurrentAttemptOwnsItsMarker() {
        let attemptedAt = date("2026-10-07T15:00:00Z")
        #expect(
            WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
                cancelled: false,
                markerUserId: "u",
                markerDay: "2026-10-07",
                markerAttemptedAt: attemptedAt,
                attemptUserId: "u",
                attemptDay: "2026-10-07",
                attemptedAt: attemptedAt
            )
        )
    }

    @Test func testCancelledOlderAttemptLeavesTheNewerMarker() {
        let attemptA = date("2026-10-07T15:00:00Z")
        let attemptB = attemptA.addingTimeInterval(1)
        #expect(
            !WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
                cancelled: true,
                markerUserId: "u",
                markerDay: "2026-10-07",
                markerAttemptedAt: attemptB,
                attemptUserId: "u",
                attemptDay: "2026-10-07",
                attemptedAt: attemptA
            )
        )
    }

    @Test func testFailedOlderAttemptLeavesTheNewerMarker() {
        let attemptA = date("2026-10-07T15:00:00Z")
        let attemptB = attemptA.addingTimeInterval(1)
        #expect(
            !WidgetDataStore.failedAttemptOwnsWidgetHistoryMarker(
                cancelled: false,
                markerUserId: "u",
                markerDay: "2026-10-07",
                markerAttemptedAt: attemptB,
                attemptUserId: "u",
                attemptDay: "2026-10-07",
                attemptedAt: attemptA
            )
        )
    }
}
