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
        // #661: the raw ramp value is 236s; it is snapped to the nearest 10-second block.
        XCTAssertEqual(
            DurationRecovery.sessionDurationForUser(sessionType: .standard, currentDay: 45, recovery: recovery),
            240
        )
        XCTAssertEqual(
            DurationRecovery.sessionDurationForUser(sessionType: .quick, currentDay: 45, recovery: recovery),
            StillPoint.quickDuration
        )
    }

    // MARK: - Recovery badge copy (#664)

    /// Pins the badge string to the web's, character for character — the middle
    /// dot is U+00B7, written `&middot;` in `src/components/HomeView.tsx`.
    func testRecoveryProgressTextMatchesWebCopy() {
        let recovery = DurationRecovery.ActiveRecovery(
            recoveryTargetDay: 45,
            recoveryCurrentStep: 3,
            recoveryTotalSteps: 5
        )
        XCTAssertEqual(
            DurationRecovery.recoveryProgressText(recovery),
            "recovery 3/5 \u{00B7} ramping back to day 45"
        )
    }

    // MARK: - 10-second block rounding (#661)

    func testRoundToNearestBlockLeavesAlignedValuesUnchanged() {
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(60), 60)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(600), 600)
        XCTAssertEqual(
            DurationRecovery.roundToNearestBlock(Double(StillPoint.blockDuration)),
            StillPoint.blockDuration
        )
    }

    func testRoundToNearestBlockRoundsBothDirections() {
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(148), 150)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(324), 320)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(236), 240)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(412), 410)
    }

    /// Ties must round up so iOS matches the web's `Math.round` (half-up on positives).
    func testRoundToNearestBlockRoundsMidpointsUp() {
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(75), 80)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(65), 70)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(155), 160)
    }

    func testRoundToNearestBlockNeverReturnsZero() {
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(0), StillPoint.blockDuration)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(1), StillPoint.blockDuration)
        XCTAssertEqual(DurationRecovery.roundToNearestBlock(4.99), StillPoint.blockDuration)
    }

    /// Exhaustive over every day that can enter recovery: day 1 has nothing to recover
    /// and forkDay (55) onward all share the 10-minute cap, so 2...60 covers every
    /// distinct ramp shape including the capped tail. Mirrors the web suite's range.
    func testEveryRecoveryStepFillsWholeBlocks() {
        for targetDay in 2...60 {
            let totalSteps = DurationRecovery.recoveryTotalStepsFor(targetDay: targetDay)
            guard totalSteps > 0 else { continue }
            var previous = 0
            for step in 1...totalSteps {
                let duration = DurationRecovery.recoveryStepDuration(
                    targetDay: targetDay,
                    totalSteps: totalSteps,
                    step: step
                )
                XCTAssertEqual(
                    duration % StillPoint.blockDuration, 0,
                    "day \(targetDay) step \(step) (\(duration)s) is not a whole block"
                )
                XCTAssertGreaterThanOrEqual(duration, StillPoint.blockDuration)
                XCTAssertGreaterThanOrEqual(duration, previous, "ramp went backwards at day \(targetDay)")
                previous = duration
            }
            XCTAssertLessThan(previous, StillPoint.duration(forDay: targetDay))
        }
    }

    func testDay45RampLandsOnBlockBoundaries() {
        let durations = (1...5).map {
            DurationRecovery.recoveryStepDuration(targetDay: 45, totalSteps: 5, step: $0)
        }
        XCTAssertEqual(durations, [60, 150, 240, 320, 410])
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
