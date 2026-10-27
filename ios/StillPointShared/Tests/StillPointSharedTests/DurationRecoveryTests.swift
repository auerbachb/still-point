import Foundation
import Testing
@testable import StillPointShared

struct DurationRecoveryTests {
    @Test func testRecoveryConstantsMatchSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        #expect(fixture.constants.recoveryMaxSteps == DurationRecovery.recoveryMaxSteps)
        #expect(fixture.constants.missedDayGapThreshold == DurationRecovery.missedDayGapThreshold)
    }

    @Test func testAdvanceProgressionSharedFixture() throws {
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
            #expect(actual == expected, Comment(rawValue: testCase.name))
        }
    }

    @Test func testDetectMissedDayGapSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        for testCase in fixture.detectMissedDayGap ?? [] {
            let actual = DurationRecovery.detectMissedDayGap(
                lastCompletedSessionDate: testCase.lastCompletedSessionDate,
                todayIso: testCase.todayIso,
                currentDay: testCase.currentDay,
                recovery: recoveryFields(from: testCase.recovery)
            )
            if let expected = testCase.expected {
                #expect(actual?.recoveryTargetDay == expected.recoveryTargetDay, Comment(rawValue: testCase.name))
                #expect(actual?.recoveryCurrentStep == expected.recoveryCurrentStep, Comment(rawValue: testCase.name))
                #expect(actual?.recoveryTotalSteps == expected.recoveryTotalSteps, Comment(rawValue: testCase.name))
            } else {
                #expect(actual == nil, Comment(rawValue: testCase.name))
            }
        }
    }

    @Test func testRecoveryStepDurationSharedFixture() throws {
        let fixture = try SharedFixtures.load("durationForDay.json", as: DurationForDayFixture.self)
        for testCase in fixture.recoveryStepDuration ?? [] {
            let actual = DurationRecovery.recoveryStepDuration(
                targetDay: testCase.targetDay,
                totalSteps: testCase.totalSteps,
                step: testCase.step
            )
            #expect(actual == testCase.expected, Comment(rawValue: testCase.name))
        }
    }

    @Test func testRepeatedMissRecoveryCyclesAdvancePastDay45() {
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
        #expect(state.currentDay == 46)
        #expect(
            DurationRecovery.activeRecovery(DurationRecovery.RecoveryFields(
                recoveryTargetDay: state.recoveryTargetDay,
                recoveryCurrentStep: state.recoveryCurrentStep,
                recoveryTotalSteps: state.recoveryTotalSteps
            )) == nil
        )

        let gapRecovery = DurationRecovery.detectMissedDayGap(
            lastCompletedSessionDate: "2026-06-01",
            todayIso: "2026-06-04",
            currentDay: state.currentDay,
            recovery: .none
        )
        #expect(gapRecovery?.recoveryTargetDay == 46)
        #expect(gapRecovery?.recoveryCurrentStep == 1)

        state = DurationRecovery.ProgressionState(
            currentDay: state.currentDay,
            recovery: DurationRecovery.RecoveryFields(
                recoveryTargetDay: gapRecovery!.recoveryTargetDay,
                recoveryCurrentStep: gapRecovery!.recoveryCurrentStep,
                recoveryTotalSteps: gapRecovery!.recoveryTotalSteps
            )
        )
        completeRecoveryCycle()
        #expect(state.currentDay == 47)
        #expect(StillPoint.duration(forDay: state.currentDay) == 520)
    }

    @Test func testSessionDurationForUserUsesRecoveryRamp() {
        let recovery = DurationRecovery.RecoveryFields(
            recoveryTargetDay: 45,
            recoveryCurrentStep: 3,
            recoveryTotalSteps: 5
        )
        // #661: the raw ramp value is 236s; it is snapped to the nearest 10-second block.
        #expect(DurationRecovery.sessionDurationForUser(sessionType: .standard, currentDay: 45, recovery: recovery) == 240)
        #expect(DurationRecovery.sessionDurationForUser(sessionType: .quick, currentDay: 45, recovery: recovery) == StillPoint.quickDuration)
    }

    // MARK: - Recovery badge copy (#664)

    /// Pins the badge string to the web's, character for character — the middle
    /// dot is U+00B7, written `&middot;` in `src/components/HomeView.tsx`.
    @Test func testRecoveryProgressTextMatchesWebCopy() {
        let recovery = DurationRecovery.ActiveRecovery(
            recoveryTargetDay: 45,
            recoveryCurrentStep: 3,
            recoveryTotalSteps: 5
        )
        #expect(DurationRecovery.recoveryProgressText(recovery) == "recovery 3/5 \u{00B7} ramping back to day 45")
    }

    // MARK: - 10-second block rounding (#661)

    @Test func testRoundToNearestBlockLeavesAlignedValuesUnchanged() {
        #expect(DurationRecovery.roundToNearestBlock(60) == 60)
        #expect(DurationRecovery.roundToNearestBlock(600) == 600)
        #expect(DurationRecovery.roundToNearestBlock(Double(StillPoint.blockDuration)) == StillPoint.blockDuration)
    }

    @Test func testRoundToNearestBlockRoundsBothDirections() {
        #expect(DurationRecovery.roundToNearestBlock(148) == 150)
        #expect(DurationRecovery.roundToNearestBlock(324) == 320)
        #expect(DurationRecovery.roundToNearestBlock(236) == 240)
        #expect(DurationRecovery.roundToNearestBlock(412) == 410)
    }

    /// Ties must round up so iOS matches the web's `Math.round` (half-up on positives).
    @Test func testRoundToNearestBlockRoundsMidpointsUp() {
        #expect(DurationRecovery.roundToNearestBlock(75) == 80)
        #expect(DurationRecovery.roundToNearestBlock(65) == 70)
        #expect(DurationRecovery.roundToNearestBlock(155) == 160)
    }

    @Test func testRoundToNearestBlockNeverReturnsZero() {
        #expect(DurationRecovery.roundToNearestBlock(0) == StillPoint.blockDuration)
        #expect(DurationRecovery.roundToNearestBlock(1) == StillPoint.blockDuration)
        #expect(DurationRecovery.roundToNearestBlock(4.99) == StillPoint.blockDuration)
    }

    /// Exhaustive over every day that can enter recovery: day 1 has nothing to recover
    /// and forkDay (55) onward all share the 10-minute cap, so 2...60 covers every
    /// distinct ramp shape including the capped tail. Mirrors the web suite's range.
    @Test func testEveryRecoveryStepFillsWholeBlocks() {
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
                #expect(
                    duration % StillPoint.blockDuration == 0,
                    "day \(targetDay) step \(step) (\(duration)s) is not a whole block"
                )
                #expect(duration >= StillPoint.blockDuration)
                #expect(duration >= previous, "ramp went backwards at day \(targetDay)")
                previous = duration
            }
            #expect(previous < StillPoint.duration(forDay: targetDay))
        }
    }

    @Test func testDay45RampLandsOnBlockBoundaries() {
        let durations = (1...5).map {
            DurationRecovery.recoveryStepDuration(targetDay: 45, totalSteps: 5, step: $0)
        }
        #expect(durations == [60, 150, 240, 320, 410])
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

// MARK: - #896 combined sit

extension DurationRecoveryTests {
    @Test func testPreviewNextCombinedDuration() {
        let user = UserDTO(
            id: "u", email: "e@example.com", username: "u", isPublic: false,
            currentDay: 45, dualTrackEnabled: true, secondTrackDay: 10
        )
        #expect(DurationRecovery.previewNextCombinedDuration(completed: true, user: user) == StillPoint.duration(forDay: 46) + StillPoint.duration(forDay: 11))
        #expect(DurationRecovery.previewNextCombinedDuration(completed: false, user: user) == 650)
        #expect(DurationRecovery.previewNextCombinedDuration(completed: true, user: nil) == StillPoint.baseDuration * 2)
    }

    /// The one-track preview is left alone.
    @Test func testStandardPreviewIgnoresCombined() {
        let user = UserDTO(
            id: "u", email: "e@example.com", username: "u", isPublic: false,
            currentDay: 45, dualTrackEnabled: true, secondTrackDay: 10
        )
        #expect(
            DurationRecovery.previewNextStandardDuration(
                sessionType: .standard, completed: true, track: .primary, user: user
            ) == StillPoint.duration(forDay: 46)
        )
    }
}
