import Foundation
import Testing
@testable import StillPointShared

struct TrackingUnlockGateTests {

    // MARK: - Constant

    @Test func testMinDurationConstantIs300() {
        #expect(TrackingUnlockGate.minDurationSeconds == 300, "Must match web's TRACKING_UNLOCK_MIN_DURATION_SECONDS")
    }

    // MARK: - qualifies(completed:duration:)

    @Test func testQualifiesWhenCompletedAtExactThreshold() {
        // Boundary: exactly 300 s should qualify.
        #expect(TrackingUnlockGate.qualifies(completed: true, duration: 300))
    }

    @Test func testQualifiesWhenCompletedAndAboveThreshold() {
        #expect(TrackingUnlockGate.qualifies(completed: true, duration: 600))
        #expect(TrackingUnlockGate.qualifies(completed: true, duration: 1800))
    }

    @Test func testDoesNotQualifyWhenCompletedButOneBelowThreshold() {
        // Boundary: 299 s must NOT qualify.
        #expect(!TrackingUnlockGate.qualifies(completed: true, duration: 299))
    }

    @Test func testDoesNotQualifyWhenCompletedButWellBelowThreshold() {
        #expect(!TrackingUnlockGate.qualifies(completed: true, duration: 0))
        #expect(!TrackingUnlockGate.qualifies(completed: true, duration: 60))
        #expect(!TrackingUnlockGate.qualifies(completed: true, duration: 240))
    }

    @Test func testDoesNotQualifyWhenNotCompleted() {
        // Not completed (ended early) — even a long sit must not unlock.
        #expect(!TrackingUnlockGate.qualifies(completed: false, duration: 300))
        #expect(!TrackingUnlockGate.qualifies(completed: false, duration: 600))
    }

    @Test func testDoesNotQualifyWhenNeitherCompletedNorLongEnough() {
        #expect(!TrackingUnlockGate.qualifies(completed: false, duration: 0))
        #expect(!TrackingUnlockGate.qualifies(completed: false, duration: 100))
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

    @Test func testHistoryQualifiesOnAQualifyingSit() {
        #expect(TrackingUnlockGate.historyQualifies([session(.standard, duration: 120), session(.standard, duration: 300)]))
        #expect(!TrackingUnlockGate.historyQualifies([session(.standard, duration: 299)]))
        #expect(!TrackingUnlockGate.historyQualifies([session(.standard, completed: false, duration: 600)]))
        #expect(!TrackingUnlockGate.historyQualifies([]))
    }

    /// A focus session is not a sit, so even a completed two-hour one unlocks nothing,
    /// as on web (`syncTrackingUnlockFromSessions`, #836).
    @Test func testHistoryQualifiesIgnoresFocusSessions() {
        #expect(!TrackingUnlockGate.historyQualifies([session(.focus, duration: 7200)]))
        #expect(
            !TrackingUnlockGate.historyQualifies([
                session(.focus, duration: 1800),
                session(.standard, duration: 120),
            ])
        )
        #expect(
            TrackingUnlockGate.historyQualifies([
                session(.focus, duration: 1800),
                session(.standard, duration: 300),
            ])
        )
    }
}
