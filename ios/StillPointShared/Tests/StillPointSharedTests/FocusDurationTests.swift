import XCTest
@testable import StillPointShared

/// #839 (focus activity tracking 4/5, #765): the iOS copy of the focus goal and
/// the guarantee that a focus session never moves meditation progression.
/// `shared/test-fixtures/focusDuration.json` also backs the web suite
/// (`src/lib/focusDuration.test.ts`), so the duplicated ramp cannot drift.
final class FocusDurationTests: XCTestCase {
    private let allSessionTypes: [SessionType] = [.standard, .quick, .breath, .focus]
    private let activeRecovery = DurationRecovery.RecoveryFields(
        recoveryTargetDay: 11,
        recoveryCurrentStep: 3,
        recoveryTotalSteps: 5
    )

    private func loadFixture() throws -> FocusDurationFixture {
        try SharedFixtures.load("focusDuration.json", as: FocusDurationFixture.self)
    }

    // MARK: - Shared fixture

    func testFocusRampMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertEqual(
            StillPoint.focusDurationConfig,
            DurationRampConfig(base: fixture.config.base, increment: fixture.config.increment, cap: fixture.config.cap)
        )
        XCTAssertFalse(fixture.focusDuration.isEmpty)
        for testCase in fixture.focusDuration {
            XCTAssertEqual(
                StillPoint.focusDuration(forDay: testCase.day),
                testCase.expected,
                "focusDuration day \(testCase.day)"
            )
        }
    }

    func testShouldAdvanceFocusDayMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.shouldAdvanceFocusDay.isEmpty)
        for testCase in fixture.shouldAdvanceFocusDay {
            let sessionType = try XCTUnwrap(SessionType(rawValue: testCase.sessionType), testCase.sessionType)
            XCTAssertEqual(
                StillPoint.shouldAdvanceFocusDay(sessionType: sessionType, completed: testCase.completed),
                testCase.expected,
                "shouldAdvanceFocusDay \(testCase.sessionType), completed \(testCase.completed)"
            )
        }
    }

    func testAdvanceFocusActivityDayMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        XCTAssertFalse(fixture.advanceFocusActivityDay.isEmpty)
        for testCase in fixture.advanceFocusActivityDay {
            let sessionType = try XCTUnwrap(SessionType(rawValue: testCase.sessionType), testCase.name)
            XCTAssertEqual(
                StillPoint.advanceFocusActivityDay(
                    sessionType: sessionType,
                    completed: testCase.completed,
                    focusActivityDay: testCase.focusActivityDay
                ),
                testCase.expected,
                testCase.name
            )
        }
    }

    // MARK: - Ramp

    func testFocusGoalIsOneMinuteClimbingAMinuteADayToTwoHours() {
        XCTAssertEqual(StillPoint.focusDurationConfig, DurationRampConfig(base: 60, increment: 60, cap: 7200))
        XCTAssertEqual(StillPoint.focusDuration(forDay: 1), 60)
        XCTAssertEqual(StillPoint.focusDuration(forDay: 2), 120)
        XCTAssertEqual(StillPoint.focusDuration(forDay: 119), 7140)
        // Day 120 is the first capped day, and the goal holds there.
        XCTAssertEqual(StillPoint.focusDuration(forDay: 120), 7200)
        XCTAssertEqual(StillPoint.focusDuration(forDay: 5000), 7200)
    }

    func testFocusDaysBelowOneBehaveAsDayOne() {
        XCTAssertEqual(StillPoint.focusDuration(forDay: 0), 60)
        XCTAssertEqual(StillPoint.focusDuration(forDay: -5), 60)
    }

    func testMeditationConfigReproducesTheDurationForDayFormula() {
        XCTAssertEqual(StillPoint.meditationDurationConfig, DurationRampConfig(base: 60, increment: 10, cap: 600))
        for day in 1...200 {
            let formula = min(StillPoint.maxDuration, StillPoint.baseDuration + (day - 1) * StillPoint.increment)
            XCTAssertEqual(StillPoint.duration(forDay: day), formula, "duration(forDay:) day \(day)")
            XCTAssertEqual(
                StillPoint.rampDuration(forDay: day, config: StillPoint.meditationDurationConfig),
                formula,
                "rampDuration day \(day)"
            )
        }
    }

    // MARK: - Dispatchers

    func testDurationForFocusIsTheFocusGoal() {
        for day in [1, 3, 60, 120, 500] {
            XCTAssertEqual(StillPoint.duration(for: .focus, day: day), StillPoint.focusDuration(forDay: day), "day \(day)")
        }
        // The same day number plans a different length for a standard sit.
        XCTAssertEqual(StillPoint.duration(for: .focus, day: 3), 180)
        XCTAssertEqual(StillPoint.duration(for: .standard, day: 3), 80)
    }

    func testSessionDurationForUserGivesFocusItsGoalAndIgnoresTheRecoveryRamp() {
        XCTAssertEqual(DurationRecovery.sessionDurationForUser(sessionType: .focus, currentDay: 3, recovery: .none), 180)
        XCTAssertEqual(DurationRecovery.sessionDurationForUser(sessionType: .focus, currentDay: 3, recovery: activeRecovery), 180)
        XCTAssertEqual(DurationRecovery.sessionDurationForUser(sessionType: .focus, currentDay: 500, recovery: .none), 7200)
        // The same recovery state does change a standard sit's length.
        XCTAssertEqual(DurationRecovery.sessionDurationForUser(sessionType: .standard, currentDay: 11, recovery: activeRecovery), 100)
    }

    // MARK: - Advance rules

    func testOnlyACompletedFocusSessionAdvancesTheFocusGoal() {
        for sessionType in allSessionTypes {
            for completed in [true, false] {
                XCTAssertEqual(
                    StillPoint.shouldAdvanceFocusDay(sessionType: sessionType, completed: completed),
                    completed && sessionType == .focus,
                    "\(sessionType.rawValue), completed \(completed)"
                )
            }
        }
        XCTAssertEqual(StillPoint.advanceFocusActivityDay(sessionType: .focus, completed: true, focusActivityDay: 1), 2)
        XCTAssertEqual(StillPoint.advanceFocusActivityDay(sessionType: .focus, completed: false, focusActivityDay: 4), 4)
        XCTAssertEqual(StillPoint.advanceFocusActivityDay(sessionType: .standard, completed: true, focusActivityDay: 4), 4)
    }

    func testACompletedFocusSessionNeverMovesMeditationProgression() {
        XCTAssertFalse(StillPoint.shouldAdvanceDay(sessionType: .focus, completed: true))
        XCTAssertEqual(StillPoint.advanceSecondTrackDay(sessionType: .focus, completed: true, secondTrackDay: 3), 3)
        let state = DurationRecovery.ProgressionState(currentDay: 11, recovery: activeRecovery)
        XCTAssertEqual(DurationRecovery.advanceProgression(sessionType: .focus, completed: true, state: state), state)
    }

    // MARK: - Categories

    func testFocusCategoriesAndTheirLabels() {
        XCTAssertEqual(FocusCategory.allCases, [.reading, .writing, .listening])
        XCTAssertEqual(FocusCategory.allCases.map(\.rawValue), ["reading", "writing", "listening"])
        XCTAssertEqual(FocusCategory.allCases.map(\.displayLabel), ["Reading", "Writing", "Listening"])
        XCTAssertEqual(SessionType(rawValue: "focus"), .focus)
    }

    func testHistoryLabelForAFocusSession() {
        XCTAssertEqual(FocusCategory.sessionLabel(for: .reading), "Focus \u{00B7} Reading")
        XCTAssertEqual(FocusCategory.sessionLabel(for: .writing), "Focus \u{00B7} Writing")
        XCTAssertEqual(FocusCategory.sessionLabel(for: .listening), "Focus \u{00B7} Listening")
        XCTAssertEqual(FocusCategory.sessionLabel(for: nil), "Focus")
    }
}
