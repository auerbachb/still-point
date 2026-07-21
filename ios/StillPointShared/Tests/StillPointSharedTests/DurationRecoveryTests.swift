import XCTest
@testable import StillPointShared

final class DurationRecoveryTests: XCTestCase {
    func testRecoveryConstantsMatchSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        XCTAssertEqual(fixture.constants.recoveryMaxSteps, DurationRecovery.recoveryMaxSteps)
        XCTAssertEqual(fixture.constants.missedDayGapThreshold, DurationRecovery.missedDayGapThreshold)
    }

    func testAdvanceProgressionSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        for testCase in fixture.advanceProgression ?? [] {
            let sessionType = SessionType(rawValue: testCase.sessionType)!
            let state = DurationRecovery.ProgressionState(
                currentDay: testCase.state.currentDay,
                recovery: recoveryFields(from: testCase.state)
            )
            let expected = DurationRecovery.ProgressionState(
                currentDay: testCase.expected.currentDay,
                recovery: recoveryFields(from: testCase.expected)
            )
            let actual = DurationRecovery.advanceProgression(
                sessionType: sessionType,
                completed: testCase.completed,
                state: state
            )
            XCTAssertEqual(actual, expected, testCase.name)
        }
    }

    func testDetectMissedDayGapSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        for testCase in fixture.detectMissedDayGap ?? [] {
            let actual = DurationRecovery.detectMissedDayGap(
                lastCompletedSessionDate: testCase.lastCompletedSessionDate,
                todayIso: testCase.todayIso,
                currentDay: testCase.currentDay,
                recovery: recoveryFields(from: testCase.recovery)
            )
            if let expected = testCase.expected {
                XCTAssertEqual(actual?.recoveryTargetDay, expected.recoveryTargetDay, testCase.name)
                XCTAssertEqual(actual?.recoveryCurrentStep, expected.recoveryCurrentStep, testCase.name)
                XCTAssertEqual(actual?.recoveryTotalSteps, expected.recoveryTotalSteps, testCase.name)
            } else {
                XCTAssertNil(actual, testCase.name)
            }
        }
    }

    func testRecoveryStepDurationSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        for testCase in fixture.recoveryStepDuration ?? [] {
            let actual = DurationRecovery.recoveryStepDuration(
                targetDay: testCase.targetDay,
                totalSteps: testCase.totalSteps,
                step: testCase.step
            )
            XCTAssertEqual(actual, testCase.expected, testCase.name)
        }
    }

    func testRepeatedMissRecoveryCyclesAdvancePastDay45() {
        var state = DurationRecovery.ProgressionState(currentDay: 45)

        func completeRecoveryCycle() {
            state = DurationRecovery.ProgressionState(
                currentDay: state.currentDay,
                recovery: DurationRecovery.RecoveryFields(
                    recoveryTargetDay: state.currentDay,
                    recoveryCurrentStep: 1,
                    recoveryTotalSteps: 5
                )
            )
            for step in 1...5 {
                state = DurationRecovery.ProgressionState(
                    currentDay: state.currentDay,
                    recovery: DurationRecovery.RecoveryFields(
                        recoveryTargetDay: state.recoveryTargetDay,
                        recoveryCurrentStep: step,
                        recoveryTotalSteps: 5
                    )
                )
                state = DurationRecovery.advanceProgression(
                    sessionType: .standard,
                    completed: true,
                    state: state
                )
            }
        }

        completeRecoveryCycle()
        XCTAssertEqual(state.currentDay, 46)
        XCTAssertNil(DurationRecovery.activeRecovery(DurationRecovery.RecoveryFields(
            recoveryTargetDay: state.recoveryTargetDay,
            recoveryCurrentStep: state.recoveryCurrentStep,
            recoveryTotalSteps: state.recoveryTotalSteps
        )))

        let gapRecovery = DurationRecovery.detectMissedDayGap(
            lastCompletedSessionDate: "2026-06-01",
            todayIso: "2026-06-04",
            currentDay: state.currentDay,
            recovery: .none
        )
        XCTAssertEqual(gapRecovery?.recoveryTargetDay, 46)
        XCTAssertEqual(gapRecovery?.recoveryCurrentStep, 1)

        state = DurationRecovery.ProgressionState(
            currentDay: state.currentDay,
            recovery: DurationRecovery.RecoveryFields(
                recoveryTargetDay: gapRecovery!.recoveryTargetDay,
                recoveryCurrentStep: gapRecovery!.recoveryCurrentStep,
                recoveryTotalSteps: gapRecovery!.recoveryTotalSteps
            )
        )
        completeRecoveryCycle()
        XCTAssertEqual(state.currentDay, 47)
        XCTAssertEqual(StillPoint.duration(forDay: state.currentDay), 520)
    }

    func testSessionDurationForUserUsesRecoveryRamp() {
        let recovery = DurationRecovery.RecoveryFields(
            recoveryTargetDay: 45,
            recoveryCurrentStep: 3,
            recoveryTotalSteps: 5
        )
        XCTAssertEqual(
            DurationRecovery.sessionDurationForUser(sessionType: .standard, currentDay: 45, recovery: recovery),
            236
        )
        XCTAssertEqual(
            DurationRecovery.sessionDurationForUser(sessionType: .quick, currentDay: 45, recovery: recovery),
            StillPoint.quickDuration
        )
    }

    private func recoveryFields(from state: DurationForDayFixture.ProgressionState) -> DurationRecovery.RecoveryFields {
        DurationRecovery.RecoveryFields(
            recoveryTargetDay: state.recoveryTargetDay,
            recoveryCurrentStep: state.recoveryCurrentStep,
            recoveryTotalSteps: state.recoveryTotalSteps
        )
    }

    private func recoveryFields(from state: DurationForDayFixture.RecoveryState) -> DurationRecovery.RecoveryFields {
        DurationRecovery.RecoveryFields(
            recoveryTargetDay: state.recoveryTargetDay,
            recoveryCurrentStep: state.recoveryCurrentStep,
            recoveryTotalSteps: state.recoveryTotalSteps
        )
    }
}
