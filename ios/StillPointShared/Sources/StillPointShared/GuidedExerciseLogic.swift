import Foundation

/// Pure step-sequencing helpers for guided exercises (#519).
///
/// Mirrors `src/lib/guidedExercise.ts` — keep both implementations in sync.
public enum GuidedExerciseLogic {
    public struct ExerciseSummary: Equatable, Sendable {
        public let id: GuidedExerciseId
        public let label: String
        public let shortLabel: String
        public let description: String
        public let stepCount: Int
        public let totalDurationMs: Int
    }

    public static func totalDurationMs(steps: [GuidedExerciseStep]) -> Int {
        steps.reduce(0) { $0 + $1.durationMs }
    }

    public static func clampStepIndex(_ index: Int, stepCount: Int) -> Int {
        guard stepCount > 0 else { return 0 }
        return min(max(0, index), stepCount - 1)
    }

    public static func isLastStep(_ index: Int, stepCount: Int) -> Bool {
        stepCount > 0 && index >= stepCount - 1
    }

    public static func nextStepIndex(_ index: Int, stepCount: Int) -> Int {
        clampStepIndex(index + 1, stepCount: stepCount)
    }

    public static func previousStepIndex(_ index: Int) -> Int {
        max(0, index - 1)
    }

    public static func stepProgressFraction(
        index: Int,
        elapsedInStepMs: Double,
        step: GuidedExerciseStep
    ) -> Double {
        guard step.durationMs > 0 else { return 1 }
        return min(1, max(0, elapsedInStepMs / Double(step.durationMs)))
    }

    public static func exerciseSummary(id: GuidedExerciseId) -> ExerciseSummary {
        let exercise = GuidedExerciseContent.guidedExerciseById(id)
        return ExerciseSummary(
            id: exercise.id,
            label: exercise.label,
            shortLabel: exercise.shortLabel,
            description: exercise.description,
            stepCount: exercise.steps.count,
            totalDurationMs: totalDurationMs(steps: exercise.steps)
        )
    }
}
