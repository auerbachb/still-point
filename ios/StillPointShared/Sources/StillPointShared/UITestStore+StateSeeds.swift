import Foundation

// Account-state seeds for the fake backend (issue #1199), split out of
// `UITestAPIStore.swift` like the snapshot seed. Each seed is one `SP_UI_TEST_*`
// flag (see `UITestConfig`). They apply only in UI-test mode, because
// `UITestAPIStore` is built only when `SP_UI_TEST_MODE` is set.
//
// Dates are counted back from `now`, so a test that passes a fixed date gets the
// same rows every time. The launch path passes the device clock.

extension UITestStore {
    /// The fixture account in the requested #1199 states.
    ///
    /// - `dualTrack`: `.bothDue` and `.primaryDone` turn on the second track. Track
    ///   Two has a completed sit yesterday. `.primaryDone` also adds a completed
    ///   Track One sit today.
    /// - `recoveryRamp`: an active recovery ramp (target day 3, step 2 of 3). The
    ///   last completed Track One sit is four days back, so the ramp reads as a
    ///   missed-day gap.
    /// - `focusHistory`: three completed focus sessions over the last three days,
    ///   two with a category and one without.
    static func makeStateSeeded(
        seedAuthenticated: Bool,
        dualTrack: UITestDualTrackSeed,
        recoveryRamp: Bool,
        focusHistory: Bool,
        now: Date = Date()
    ) -> UITestStore {
        func day(_ offset: Int) -> String {
            SessionCalendar.localIsoDate(now: now, offsetDays: offset)
        }

        let isDual = dualTrack != .none
        let primaryDoneToday = dualTrack == .primaryDone

        // Track One history: two completed sits, or one four days back when a
        // recovery ramp needs a missed-day gap.
        let priorOffsets = recoveryRamp ? [-5, -4] : [-2, -1]
        var sessions: [SessionDTO] = priorOffsets.enumerated().map { index, offset in
            seedSit(
                id: "ui-seed-primary-\(index + 1)",
                dayNumber: index + 1,
                sessionDate: day(offset),
                track: .primary
            )
        }

        if isDual {
            sessions.append(seedSit(
                id: "ui-seed-second-1",
                dayNumber: 1,
                sessionDate: day(-1),
                track: .second
            ))
        }

        let currentDay = priorOffsets.count + 1 + (primaryDoneToday ? 1 : 0)
        if primaryDoneToday {
            sessions.append(seedSit(
                id: "ui-seed-primary-today",
                dayNumber: currentDay - 1,
                sessionDate: day(0),
                track: .primary
            ))
        }

        if focusHistory {
            sessions += [
                seedFocusSit(id: "ui-seed-focus-reading", sessionDate: day(-1), category: .reading),
                seedFocusSit(id: "ui-seed-focus-writing", sessionDate: day(-2), category: .writing),
                seedFocusSit(id: "ui-seed-focus-uncategorised", sessionDate: day(-3), category: nil),
            ]
        }

        let fixtureUser = UserDTO(
            id: "ui-user-1",
            email: "ios.fixture@stillpoint.test",
            username: "ios_fixture",
            isPublic: false,
            currentDay: currentDay,
            dualTrackEnabled: isDual,
            secondTrackDay: isDual ? 2 : 1,
            recoveryTargetDay: recoveryRamp ? 3 : nil,
            recoveryCurrentStep: recoveryRamp ? 2 : nil,
            recoveryTotalSteps: recoveryRamp ? 3 : nil
        )

        return UITestStore(
            user: fixtureUser,
            loginEmail: fixtureUser.email,
            loginPassword: "stillpoint-pass",
            isAuthenticated: seedAuthenticated,
            sessions: sessions,
            thoughts: [],
            failureReasons: [:],
            nextSessionOrdinal: 1,
            nextThoughtOrdinal: 1
        )
    }

    /// A completed standard sit on `track`, with the fixture's usual numbers.
    private static func seedSit(id: String, dayNumber: Int, sessionDate: String, track: Track) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: dayNumber,
            sessionType: .standard,
            duration: 120,
            bonusSeconds: nil,
            completed: true,
            actualTime: 120,
            clearPercent: 75,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: sessionDate,
            createdAt: nil,
            buddySessionId: nil,
            track: track
        )
    }

    /// A completed focus session, logged on the web: its category is kept only when
    /// one was picked (#839).
    private static func seedFocusSit(id: String, sessionDate: String, category: FocusCategory?) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: 0,
            sessionType: .focus,
            duration: 600,
            bonusSeconds: nil,
            completed: true,
            actualTime: 600,
            clearPercent: 70,
            thoughtCount: 0,
            mindStateLog: [],
            sessionDate: sessionDate,
            createdAt: nil,
            buddySessionId: nil,
            focusCategory: category
        )
    }
}
