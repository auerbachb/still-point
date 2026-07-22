import XCTest
@testable import StillPointShared

final class GuidedExerciseLogicTests: XCTestCase {

    // MARK: - Content shape

    func testDefinesAllThreeExerciseModes() {
        let ids = GuidedExerciseContent.all.map(\.id)
        XCTAssertEqual(ids, [.progressiveSensory, .breathingAwareness, .bodyScan])
    }

    func testProgressiveSensoryHasFiveSenseSteps() {
        let exercise = GuidedExerciseContent.guidedExerciseById(.progressiveSensory)
        XCTAssertEqual(exercise.steps.count, 5)
        XCTAssertEqual(exercise.steps.map(\.id), ["sight", "sound", "smell", "taste", "touch"])
    }

    func testBodyScanWalksThroughBodyRegions() {
        let exercise = GuidedExerciseContent.guidedExerciseById(.bodyScan)
        XCTAssertGreaterThanOrEqual(exercise.steps.count, 8)
        XCTAssertEqual(exercise.steps.first?.title, "Feet")
        XCTAssertEqual(exercise.steps.last?.title, "Whole body")
    }

    func testEveryStepHasPositiveDurationForGentlePacing() {
        for exercise in GuidedExerciseContent.all {
            for step in exercise.steps {
                XCTAssertGreaterThan(step.durationMs, 0)
                XCTAssertGreaterThan(step.prompt.count, 10)
            }
        }
    }

    // MARK: - Step math helpers

    func testTotalDurationMsSumsStepDurations() {
        let steps = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps
        let expected = steps.reduce(0) { $0 + $1.durationMs }
        XCTAssertEqual(GuidedExerciseLogic.totalDurationMs(steps: steps), expected)
    }

    func testClampStepIndexKeepsIndexInRange() {
        let stepCount = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps.count
        XCTAssertEqual(GuidedExerciseLogic.clampStepIndex(-2, stepCount: stepCount), 0)
        XCTAssertEqual(GuidedExerciseLogic.clampStepIndex(2, stepCount: stepCount), 2)
        XCTAssertEqual(GuidedExerciseLogic.clampStepIndex(99, stepCount: stepCount), stepCount - 1)
    }

    func testNextAndPreviousStepIndices() {
        let stepCount = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps.count
        XCTAssertEqual(GuidedExerciseLogic.nextStepIndex(0, stepCount: stepCount), 1)
        XCTAssertEqual(GuidedExerciseLogic.nextStepIndex(stepCount - 1, stepCount: stepCount), stepCount - 1)
        XCTAssertEqual(GuidedExerciseLogic.previousStepIndex(0), 0)
        XCTAssertEqual(GuidedExerciseLogic.previousStepIndex(2), 1)
    }

    func testIsLastStepIdentifiesFinalPrompt() {
        let stepCount = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps.count
        XCTAssertFalse(GuidedExerciseLogic.isLastStep(stepCount - 2, stepCount: stepCount))
        XCTAssertTrue(GuidedExerciseLogic.isLastStep(stepCount - 1, stepCount: stepCount))
    }

    func testStepProgressFractionTracksElapsedTimeWithinStep() {
        let step = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps[0]
        XCTAssertEqual(GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: 0, step: step), 0)
        XCTAssertEqual(
            GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: Double(step.durationMs) / 2, step: step),
            0.5
        )
        XCTAssertEqual(
            GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: Double(step.durationMs), step: step),
            1
        )
        XCTAssertEqual(
            GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: Double(step.durationMs * 2), step: step),
            1
        )
    }

    func testExerciseSummaryReportsStepCountAndTotalDuration() {
        let summary = GuidedExerciseLogic.exerciseSummary(id: .breathingAwareness)
        let exercise = GuidedExerciseContent.guidedExerciseById(.breathingAwareness)
        XCTAssertEqual(summary.stepCount, 5)
        XCTAssertEqual(summary.totalDurationMs, GuidedExerciseLogic.totalDurationMs(steps: exercise.steps))
    }

    // MARK: - Shared cross-platform fixtures (#421)

    func testSharedGuidedExerciseFixtures() throws {
        let fixture = try SharedFixtures.load("guidedExercise.json", as: GuidedExerciseFixture.self)

        for testCase in fixture.clampStepIndex {
            XCTAssertEqual(
                GuidedExerciseLogic.clampStepIndex(testCase.index, stepCount: testCase.stepCount),
                testCase.expected,
                "clampStepIndex(\(testCase.index), \(testCase.stepCount))"
            )
        }

        for testCase in fixture.isLastStep {
            XCTAssertEqual(
                GuidedExerciseLogic.isLastStep(testCase.index, stepCount: testCase.stepCount),
                testCase.expected,
                "isLastStep(\(testCase.index), \(testCase.stepCount))"
            )
        }

        for testCase in fixture.nextStepIndex {
            XCTAssertEqual(
                GuidedExerciseLogic.nextStepIndex(testCase.index, stepCount: testCase.stepCount),
                testCase.expected,
                "nextStepIndex(\(testCase.index), \(testCase.stepCount))"
            )
        }

        for testCase in fixture.previousStepIndex {
            XCTAssertEqual(
                GuidedExerciseLogic.previousStepIndex(testCase.index),
                testCase.expected,
                "previousStepIndex(\(testCase.index))"
            )
        }

        for testCase in fixture.stepProgressFraction {
            let step = GuidedExerciseStep(
                id: "fixture",
                title: "Fixture",
                prompt: "Fixture prompt for parity harness.",
                durationMs: testCase.stepDurationMs
            )
            XCTAssertEqual(
                GuidedExerciseLogic.stepProgressFraction(
                    index: testCase.index,
                    elapsedInStepMs: Double(testCase.elapsedInStepMs),
                    step: step
                ),
                testCase.expected,
                accuracy: 0.0001,
                "stepProgressFraction(\(testCase.index), \(testCase.elapsedInStepMs), \(testCase.stepDurationMs))"
            )
        }

        for testCase in fixture.totalDurationMs {
            let steps = testCase.stepDurationsMs.map {
                GuidedExerciseStep(id: "s", title: "S", prompt: "Step prompt for fixture.", durationMs: $0)
            }
            XCTAssertEqual(
                GuidedExerciseLogic.totalDurationMs(steps: steps),
                testCase.expected,
                "totalDurationMs(\(testCase.stepDurationsMs))"
            )
        }

        for testCase in fixture.exerciseSummary {
            let id = GuidedExerciseId(rawValue: testCase.id)!
            let summary = GuidedExerciseLogic.exerciseSummary(id: id)
            XCTAssertEqual(summary.stepCount, testCase.expectedStepCount, testCase.id)
            XCTAssertEqual(summary.totalDurationMs, testCase.expectedTotalDurationMs, testCase.id)
        }
    }
}
