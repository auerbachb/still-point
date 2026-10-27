import Foundation
import Testing
@testable import StillPointShared

struct GuidedExerciseLogicTests {

    // MARK: - Content shape

    @Test func testDefinesAllThreeExerciseModes() {
        let ids = GuidedExerciseContent.all.map(\.id)
        #expect(ids == [.progressiveSensory, .breathingAwareness, .bodyScan])
    }

    @Test func testProgressiveSensoryHasFiveSenseSteps() {
        let exercise = GuidedExerciseContent.guidedExerciseById(.progressiveSensory)
        #expect(exercise.steps.count == 5)
        #expect(exercise.steps.map(\.id) == ["sight", "sound", "smell", "taste", "touch"])
    }

    @Test func testBodyScanWalksThroughBodyRegions() {
        let exercise = GuidedExerciseContent.guidedExerciseById(.bodyScan)
        #expect(exercise.steps.count >= 8)
        #expect(exercise.steps.first?.title == "Feet")
        #expect(exercise.steps.last?.title == "Whole body")
    }

    @Test func testEveryStepHasPositiveDurationForGentlePacing() {
        for exercise in GuidedExerciseContent.all {
            for step in exercise.steps {
                #expect(step.durationMs > 0)
                #expect(step.prompt.count > 10)
            }
        }
    }

    // MARK: - Step math helpers

    @Test func testTotalDurationMsSumsStepDurations() {
        let steps = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps
        let expected = steps.reduce(0) { $0 + $1.durationMs }
        #expect(GuidedExerciseLogic.totalDurationMs(steps: steps) == expected)
    }

    @Test func testClampStepIndexKeepsIndexInRange() {
        let stepCount = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps.count
        #expect(GuidedExerciseLogic.clampStepIndex(-2, stepCount: stepCount) == 0)
        #expect(GuidedExerciseLogic.clampStepIndex(2, stepCount: stepCount) == 2)
        #expect(GuidedExerciseLogic.clampStepIndex(99, stepCount: stepCount) == stepCount - 1)
    }

    @Test func testNextAndPreviousStepIndices() {
        let stepCount = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps.count
        #expect(GuidedExerciseLogic.nextStepIndex(0, stepCount: stepCount) == 1)
        #expect(GuidedExerciseLogic.nextStepIndex(stepCount - 1, stepCount: stepCount) == stepCount - 1)
        #expect(GuidedExerciseLogic.previousStepIndex(0) == 0)
        #expect(GuidedExerciseLogic.previousStepIndex(2) == 1)
    }

    @Test func testIsLastStepIdentifiesFinalPrompt() {
        let stepCount = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps.count
        #expect(!GuidedExerciseLogic.isLastStep(stepCount - 2, stepCount: stepCount))
        #expect(GuidedExerciseLogic.isLastStep(stepCount - 1, stepCount: stepCount))
    }

    @Test func testStepProgressFractionTracksElapsedTimeWithinStep() {
        let step = GuidedExerciseContent.guidedExerciseById(.progressiveSensory).steps[0]
        #expect(GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: 0, step: step) == 0)
        #expect(GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: Double(step.durationMs) / 2, step: step) == 0.5)
        #expect(GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: Double(step.durationMs), step: step) == 1)
        #expect(GuidedExerciseLogic.stepProgressFraction(index: 0, elapsedInStepMs: Double(step.durationMs * 2), step: step) == 1)
    }

    @Test func testExerciseSummaryReportsStepCountAndTotalDuration() {
        let summary = GuidedExerciseLogic.exerciseSummary(id: .breathingAwareness)
        let exercise = GuidedExerciseContent.guidedExerciseById(.breathingAwareness)
        #expect(summary.stepCount == 5)
        #expect(summary.totalDurationMs == GuidedExerciseLogic.totalDurationMs(steps: exercise.steps))
    }

    // MARK: - Shared cross-platform fixtures (#421)

    @Test func testSharedGuidedExerciseFixtures() throws {
        let fixture = try SharedFixtures.load("guidedExercise.json", as: GuidedExerciseFixture.self)

        for testCase in fixture.clampStepIndex {
            #expect(
                GuidedExerciseLogic.clampStepIndex(testCase.index, stepCount: testCase.stepCount) == testCase.expected,
                "clampStepIndex(\(testCase.index), \(testCase.stepCount))"
            )
        }

        for testCase in fixture.isLastStep {
            #expect(
                GuidedExerciseLogic.isLastStep(testCase.index, stepCount: testCase.stepCount) == testCase.expected,
                "isLastStep(\(testCase.index), \(testCase.stepCount))"
            )
        }

        for testCase in fixture.nextStepIndex {
            #expect(
                GuidedExerciseLogic.nextStepIndex(testCase.index, stepCount: testCase.stepCount) == testCase.expected,
                "nextStepIndex(\(testCase.index), \(testCase.stepCount))"
            )
        }

        for testCase in fixture.previousStepIndex {
            #expect(
                GuidedExerciseLogic.previousStepIndex(testCase.index) == testCase.expected,
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
            #expect(
                abs(GuidedExerciseLogic.stepProgressFraction(
                    index: testCase.index,
                    elapsedInStepMs: Double(testCase.elapsedInStepMs),
                    step: step
                ) - testCase.expected) <= 0.0001,
                "stepProgressFraction(\(testCase.index), \(testCase.elapsedInStepMs), \(testCase.stepDurationMs))"
            )
        }

        for testCase in fixture.totalDurationMs {
            let steps = testCase.stepDurationsMs.map {
                GuidedExerciseStep(id: "s", title: "S", prompt: "Step prompt for fixture.", durationMs: $0)
            }
            #expect(
                GuidedExerciseLogic.totalDurationMs(steps: steps) == testCase.expected,
                "totalDurationMs(\(testCase.stepDurationsMs))"
            )
        }

        for testCase in fixture.exerciseSummary {
            let id = GuidedExerciseId(rawValue: testCase.id)!
            let summary = GuidedExerciseLogic.exerciseSummary(id: id)
            #expect(summary.stepCount == testCase.expectedStepCount, Comment(rawValue: testCase.id))
            #expect(summary.totalDurationMs == testCase.expectedTotalDurationMs, Comment(rawValue: testCase.id))
        }
    }
}
