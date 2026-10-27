import Foundation
import Testing
@testable import StillPointShared

/// #839 (focus activity tracking 4/5, #765): the iOS copy of the focus goal and
/// the guarantee that a focus session never moves meditation progression.
/// `shared/test-fixtures/focusDuration.json` also backs the web suite
/// (`src/lib/focusDuration.test.ts`), so the duplicated ramp cannot drift.
struct FocusDurationTests {
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

    @Test func testFocusRampMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(StillPoint.focusDurationConfig == DurationRampConfig(base: fixture.config.base, increment: fixture.config.increment, cap: fixture.config.cap))
        #expect(!fixture.focusDuration.isEmpty)
        for testCase in fixture.focusDuration {
            #expect(StillPoint.focusDuration(forDay: testCase.day) == testCase.expected, "focusDuration day \(testCase.day)")
        }
    }

    @Test func testShouldAdvanceFocusDayMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.shouldAdvanceFocusDay.isEmpty)
        for testCase in fixture.shouldAdvanceFocusDay {
            let sessionType = try #require(SessionType(rawValue: testCase.sessionType), Comment(rawValue: testCase.sessionType))
            #expect(
                StillPoint.shouldAdvanceFocusDay(sessionType: sessionType, completed: testCase.completed) == testCase.expected,
                "shouldAdvanceFocusDay \(testCase.sessionType), completed \(testCase.completed)"
            )
        }
    }

    @Test func testAdvanceFocusActivityDayMatchesSharedFixture() throws {
        let fixture = try loadFixture()

        #expect(!fixture.advanceFocusActivityDay.isEmpty)
        for testCase in fixture.advanceFocusActivityDay {
            let sessionType = try #require(SessionType(rawValue: testCase.sessionType), Comment(rawValue: testCase.name))
            #expect(
                StillPoint.advanceFocusActivityDay(
                    sessionType: sessionType,
                    completed: testCase.completed,
                    focusActivityDay: testCase.focusActivityDay
                ) == testCase.expected,
                Comment(rawValue: testCase.name)
            )
        }
    }

    // MARK: - Ramp

    @Test func testFocusGoalIsOneMinuteClimbingAMinuteADayToTwoHours() {
        #expect(StillPoint.focusDurationConfig == DurationRampConfig(base: 60, increment: 60, cap: 7200))
        #expect(StillPoint.focusDuration(forDay: 1) == 60)
        #expect(StillPoint.focusDuration(forDay: 2) == 120)
        #expect(StillPoint.focusDuration(forDay: 119) == 7140)
        // Day 120 is the first capped day, and the goal holds there.
        #expect(StillPoint.focusDuration(forDay: 120) == 7200)
        #expect(StillPoint.focusDuration(forDay: 5000) == 7200)
    }

    @Test func testFocusDaysBelowOneBehaveAsDayOne() {
        #expect(StillPoint.focusDuration(forDay: 0) == 60)
        #expect(StillPoint.focusDuration(forDay: -5) == 60)
    }

    @Test func testMeditationConfigReproducesTheDurationForDayFormula() {
        #expect(StillPoint.meditationDurationConfig == DurationRampConfig(base: 60, increment: 10, cap: 600))
        for day in 1...200 {
            let formula = min(StillPoint.maxDuration, StillPoint.baseDuration + (day - 1) * StillPoint.increment)
            #expect(StillPoint.duration(forDay: day) == formula, "duration(forDay:) day \(day)")
            #expect(
                StillPoint.rampDuration(forDay: day, config: StillPoint.meditationDurationConfig) == formula,
                "rampDuration day \(day)"
            )
        }
    }

    // MARK: - Dispatchers

    @Test func testDurationForFocusIsTheFocusGoal() {
        for day in [1, 3, 60, 120, 500] {
            #expect(StillPoint.duration(for: .focus, day: day) == StillPoint.focusDuration(forDay: day), "day \(day)")
        }
        // The same day number plans a different length for a standard sit.
        #expect(StillPoint.duration(for: .focus, day: 3) == 180)
        #expect(StillPoint.duration(for: .standard, day: 3) == 80)
    }

    @Test func testSessionDurationForUserGivesFocusItsGoalAndIgnoresTheRecoveryRamp() {
        #expect(DurationRecovery.sessionDurationForUser(sessionType: .focus, currentDay: 3, recovery: .none) == 180)
        #expect(DurationRecovery.sessionDurationForUser(sessionType: .focus, currentDay: 3, recovery: activeRecovery) == 180)
        #expect(DurationRecovery.sessionDurationForUser(sessionType: .focus, currentDay: 500, recovery: .none) == 7200)
        // The same recovery state does change a standard sit's length.
        #expect(DurationRecovery.sessionDurationForUser(sessionType: .standard, currentDay: 11, recovery: activeRecovery) == 100)
    }

    // MARK: - Advance rules

    @Test func testOnlyACompletedFocusSessionAdvancesTheFocusGoal() {
        for sessionType in allSessionTypes {
            for completed in [true, false] {
                #expect(
                    StillPoint.shouldAdvanceFocusDay(sessionType: sessionType, completed: completed) == (completed && sessionType == .focus),
                    "\(sessionType.rawValue), completed \(completed)"
                )
            }
        }
        #expect(StillPoint.advanceFocusActivityDay(sessionType: .focus, completed: true, focusActivityDay: 1) == 2)
        #expect(StillPoint.advanceFocusActivityDay(sessionType: .focus, completed: false, focusActivityDay: 4) == 4)
        #expect(StillPoint.advanceFocusActivityDay(sessionType: .standard, completed: true, focusActivityDay: 4) == 4)
    }

    @Test func testACompletedFocusSessionNeverMovesMeditationProgression() {
        #expect(!StillPoint.shouldAdvanceDay(sessionType: .focus, completed: true))
        #expect(StillPoint.advanceSecondTrackDay(sessionType: .focus, completed: true, secondTrackDay: 3) == 3)
        let state = DurationRecovery.ProgressionState(currentDay: 11, recovery: activeRecovery)
        #expect(DurationRecovery.advanceProgression(sessionType: .focus, completed: true, state: state) == state)
    }

    // MARK: - Categories

    @Test func testFocusCategoriesAndTheirLabels() {
        #expect(FocusCategory.allCases == [.reading, .writing, .listening])
        #expect(FocusCategory.allCases.map(\.rawValue) == ["reading", "writing", "listening"])
        #expect(FocusCategory.allCases.map(\.displayLabel) == ["Reading", "Writing", "Listening"])
        #expect(SessionType(rawValue: "focus") == .focus)
    }

    @Test func testHistoryLabelForAFocusSession() {
        #expect(FocusCategory.sessionLabel(for: .reading) == "Focus \u{00B7} Reading")
        #expect(FocusCategory.sessionLabel(for: .writing) == "Focus \u{00B7} Writing")
        #expect(FocusCategory.sessionLabel(for: .listening) == "Focus \u{00B7} Listening")
        #expect(FocusCategory.sessionLabel(for: nil) == "Focus")
    }
}
