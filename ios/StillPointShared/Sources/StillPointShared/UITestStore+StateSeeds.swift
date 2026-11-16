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
    /// - `recoveryRamp`: an active recovery ramp (step 2 of 3) targeting the open
    ///   day. The last completed Track One sit is four days back, so the ramp reads
    ///   as a missed-day gap.
    /// - Dates follow the app's practice day (`effectiveLocalIsoDate`), so the seed
    ///   reads the same before and after 6:00 local.
    /// - Dual track starts the day after the fork (`forkDay + 1`), the first day it
    ///   can be on (#240).
    /// - `focusHistory`: three completed focus sessions over the last three days,
    ///   two with a category and one without.
    static func makeStateSeeded(
        seedAuthenticated: Bool,
        dualTrack: UITestDualTrackSeed,
        recoveryRamp: Bool,
        focusHistory: Bool,
        now: Date = Date()
    ) -> UITestStore {
        // The practice day the app requests at `now`. Before 6:00 an unfinished
        // previous day stays open, so the seed is stamped against that day. The
        // seed completes yesterday unless a recovery ramp leaves it empty (#1199).
        let practice = SessionCalendar.effectiveLocalIsoDate(previousDayComplete: !recoveryRamp, now: now)
        func day(_ offset: Int) -> String {
            SessionCalendar.addDays(toIsoDate: practice, deltaDays: offset)
        }

        let isDual = dualTrack != .none
        let primaryDoneToday = dualTrack == .primaryDone

        // The Track One day the account is on before today's sit. Dual-track opts
        // in only past the fork (`currentDay > forkDay`, #240), so a dual seed starts
        // the day after it. A single-track seed starts on day 3.
        let openDay = isDual ? StillPoint.forkDay + 1 : 3

        // Track One history: two completed sits, or one four days back when a
        // recovery ramp needs a missed-day gap.
        let priorOffsets = recoveryRamp ? [-5, -4] : [-2, -1]
        var sessions: [SessionDTO] = priorOffsets.enumerated().map { index, offset in
            seedSit(
                id: "ui-seed-primary-\(index + 1)",
                dayNumber: openDay - priorOffsets.count + index,
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

        // A recovery ramp freezes `currentDay` at its target (the pre-miss level,
        // `DurationRecovery.startRecovery`), so a done-today sit stays on that day.
        // Otherwise a done-today sit moves the account on by one day.
        let currentDay = recoveryRamp ? openDay : openDay + (primaryDoneToday ? 1 : 0)
        if primaryDoneToday {
            sessions.append(seedSit(
                id: "ui-seed-primary-today",
                dayNumber: openDay,
                sessionDate: day(0),
                track: .primary
            ))
        }

        if focusHistory {
            sessions += [
                // Focus saves number from day 1 (`FocusActivityLogic`, `max(..., 1)`).
                seedFocusSit(id: "ui-seed-focus-reading", dayNumber: 3, sessionDate: day(-1), category: .reading),
                seedFocusSit(id: "ui-seed-focus-writing", dayNumber: 2, sessionDate: day(-2), category: .writing),
                seedFocusSit(id: "ui-seed-focus-uncategorised", dayNumber: 1, sessionDate: day(-3), category: nil),
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
            recoveryTargetDay: recoveryRamp ? openDay : nil,
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
    private static func seedFocusSit(id: String, dayNumber: Int, sessionDate: String, category: FocusCategory?) -> SessionDTO {
        SessionDTO(
            id: id,
            dayNumber: dayNumber,
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
