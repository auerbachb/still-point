import Foundation

// Fastlane snapshot seed (Issue #325), split out of `UITestAPIStore.swift` (issue
// #1052) so screenshot data changes never touch the fake backend's request logic.

extension UITestStore {
    /// Rich canned history, journal rows, and board-relevant profile for Fastlane screenshots.
    static func makeSnapshot(seedAuthenticated: Bool) -> UITestStore {
        let fixtureUser = UserDTO(
            id: "snapshot-user-1",
            email: "snapshot@stillpoint.test",
            username: "still_snapshot",
            isPublic: true,
            currentDay: 9,
            aphorismsEnabled: true
        )

        let sessions: [SessionDTO] = [
            snapshotSession(id: "snap-sess-1", dayNumber: 4, duration: 120, bonusSeconds: 60, actualTime: 125, clearPercent: 74, thoughtCount: 2, sessionDate: "2026-01-05", createdAt: "2026-01-05T08:30:00Z"),
            snapshotSession(id: "snap-sess-2", dayNumber: 4, duration: 120, bonusSeconds: nil, actualTime: 118, clearPercent: 81, thoughtCount: 1, sessionDate: "2026-01-05", createdAt: "2026-01-05T19:15:00Z"),
            snapshotSession(id: "snap-sess-3", dayNumber: 5, duration: 130, bonusSeconds: 300, actualTime: 400, clearPercent: 69, thoughtCount: 4, sessionDate: "2026-01-06", createdAt: "2026-01-06T07:00:00Z"),
            snapshotSession(id: "snap-sess-4", dayNumber: 6, duration: 140, bonusSeconds: nil, actualTime: 140, clearPercent: 88, thoughtCount: 0, sessionDate: "2026-01-07", createdAt: "2026-01-07T12:20:00Z"),
            snapshotSession(id: "snap-sess-5", dayNumber: 7, duration: 150, bonusSeconds: nil, actualTime: 150, clearPercent: 72, thoughtCount: 3, sessionDate: "2026-01-08", createdAt: "2026-01-08T06:45:00Z"),
            snapshotSession(id: "snap-sess-6", dayNumber: 8, duration: 160, bonusSeconds: 120, actualTime: 265, clearPercent: 79, thoughtCount: 2, sessionDate: "2026-01-09", createdAt: "2026-01-09T21:05:00Z"),
            snapshotSession(id: "snap-quick-1", dayNumber: 8, sessionType: .quick, duration: StillPoint.quickDuration, bonusSeconds: nil, actualTime: StillPoint.quickDuration, clearPercent: 62, thoughtCount: 1, sessionDate: "2026-01-09", createdAt: "2026-01-09T08:10:00Z"),
        ]

        let thoughts: [ThoughtDTO] = [
            ThoughtDTO(id: "snap-th-1", sessionId: "snap-sess-1", dayNumber: 4, timeInSession: 42, text: "Planning the week instead of watching the timer."),
            ThoughtDTO(id: "snap-th-2", sessionId: "snap-sess-1", dayNumber: 4, timeInSession: 96, text: "Sound of traffic — came back to the breath."),
            ThoughtDTO(id: "snap-th-3", sessionId: "snap-sess-3", dayNumber: 5, timeInSession: 55, text: "Should I adjust tomorrow's sit length?"),
            ThoughtDTO(id: "snap-th-4", sessionId: "snap-sess-3", dayNumber: 5, timeInSession: 200, text: "Lost thread for a moment; noticed and returned."),
            ThoughtDTO(id: "snap-th-5", sessionId: "snap-sess-5", dayNumber: 7, timeInSession: 22, text: "Flash of an old conversation."),
            ThoughtDTO(id: "snap-th-6", sessionId: "snap-sess-6", dayNumber: 8, timeInSession: 140, text: "Room felt quieter toward the end."),
            ThoughtDTO(id: "snap-th-7", sessionId: "snap-quick-1", dayNumber: 8, timeInSession: 12, text: "Quick reset between meetings."),
        ]

        return UITestStore(
            user: fixtureUser,
            loginEmail: fixtureUser.email,
            loginPassword: "snapshot-pass",
            isAuthenticated: seedAuthenticated,
            sessions: sessions,
            thoughts: thoughts,
            failureReasons: [:],
            nextSessionOrdinal: 100,
            nextThoughtOrdinal: 100
        )
    }

    /// A completed snapshot sit with an empty mind-state log and no buddy session,
    /// which every seeded row shares.
    private static func snapshotSession(
        id: String,
        dayNumber: Int,
        sessionType: SessionType = .standard,
        duration: Int,
        bonusSeconds: Int?,
        actualTime: Int,
        clearPercent: Int,
        thoughtCount: Int,
        sessionDate: String,
        createdAt: String
    ) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: dayNumber,
            sessionType: sessionType,
            duration: duration,
            bonusSeconds: bonusSeconds,
            completed: true,
            actualTime: actualTime,
            clearPercent: clearPercent,
            thoughtCount: thoughtCount,
            mindStateLog: [],
            sessionDate: sessionDate,
            createdAt: createdAt,
            buddySessionId: nil
        )
    }
}
