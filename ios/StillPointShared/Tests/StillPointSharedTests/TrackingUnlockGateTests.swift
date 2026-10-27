import XCTest
@testable import StillPointShared

final class TrackingUnlockGateTests: XCTestCase {

    // MARK: - Constant

    func testMinDurationConstantIs300() {
        XCTAssertEqual(TrackingUnlockGate.minDurationSeconds, 300,
                       "Must match web's TRACKING_UNLOCK_MIN_DURATION_SECONDS")
    }

    // MARK: - qualifies(completed:duration:)

    func testQualifiesWhenCompletedAtExactThreshold() {
        // Boundary: exactly 300 s should qualify.
        XCTAssertTrue(TrackingUnlockGate.qualifies(completed: true, duration: 300))
    }

    func testQualifiesWhenCompletedAndAboveThreshold() {
        XCTAssertTrue(TrackingUnlockGate.qualifies(completed: true, duration: 600))
        XCTAssertTrue(TrackingUnlockGate.qualifies(completed: true, duration: 1800))
    }

    func testDoesNotQualifyWhenCompletedButOneBelowThreshold() {
        // Boundary: 299 s must NOT qualify.
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: true, duration: 299))
    }

    func testDoesNotQualifyWhenCompletedButWellBelowThreshold() {
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: true, duration: 0))
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: true, duration: 60))
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: true, duration: 240))
    }

    func testDoesNotQualifyWhenNotCompleted() {
        // Not completed (ended early) — even a long sit must not unlock.
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: false, duration: 300))
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: false, duration: 600))
    }

    func testDoesNotQualifyWhenNeitherCompletedNorLongEnough() {
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: false, duration: 0))
        XCTAssertFalse(TrackingUnlockGate.qualifies(completed: false, duration: 100))
    }

    // MARK: - historyQualifies(_:) (#839)

    private func session(_ type: SessionType, completed: Bool = true, duration: Int) -> SessionDTO {
        SessionDTO(
            id: UUID().uuidString,
            dayNumber: 1,
            sessionType: type,
            duration: duration,
            completed: completed,
            actualTime: duration,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: nil,
            sessionDate: "2026-10-27",
            buddySessionId: nil
        )
    }

    func testHistoryQualifiesOnAQualifyingSit() {
        XCTAssertTrue(TrackingUnlockGate.historyQualifies([session(.standard, duration: 120), session(.standard, duration: 300)]))
        XCTAssertFalse(TrackingUnlockGate.historyQualifies([session(.standard, duration: 299)]))
        XCTAssertFalse(TrackingUnlockGate.historyQualifies([session(.standard, completed: false, duration: 600)]))
        XCTAssertFalse(TrackingUnlockGate.historyQualifies([]))
    }

    /// A focus session is not a sit, so even a completed two-hour one unlocks nothing,
    /// as on web (`syncTrackingUnlockFromSessions`, #836).
    func testHistoryQualifiesIgnoresFocusSessions() {
        XCTAssertFalse(TrackingUnlockGate.historyQualifies([session(.focus, duration: 7200)]))
        XCTAssertFalse(TrackingUnlockGate.historyQualifies([
            session(.focus, duration: 1800),
            session(.standard, duration: 120),
        ]))
        XCTAssertTrue(TrackingUnlockGate.historyQualifies([
            session(.focus, duration: 1800),
            session(.standard, duration: 300),
        ]))
    }
}
