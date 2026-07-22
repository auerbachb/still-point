import Foundation
import SwiftUI
import StillPointShared

/// State machine for the in-session guided exercise overlay (#519).
///
/// Wall-clock timer recomputes elapsed-in-step from `Date()` each tick (~250ms),
/// mirroring web `GuidedExerciseOverlay.tsx` and `BreathCountingViewModel`.
@Observable
@MainActor
final class GuidedExerciseViewModel {
    enum Phase: Equatable {
        case picker
        case running
        case complete
    }

    private(set) var phase: Phase = .picker
    private(set) var exerciseId: GuidedExerciseId?
    private(set) var stepIndex = 0
    private(set) var progress: Double = 0
    private(set) var isPaused = false

    private var stepStartedAt: Date?
    private var pausedElapsedMs: Double = 0
    private var timer: Timer?

    private static let tickInterval: TimeInterval = 0.25

    var exercise: GuidedExerciseDefinition? {
        guard let exerciseId else { return nil }
        return GuidedExerciseContent.guidedExerciseById(exerciseId)
    }

    var currentStep: GuidedExerciseStep? {
        guard let exercise else { return nil }
        let index = GuidedExerciseLogic.clampStepIndex(stepIndex, stepCount: exercise.steps.count)
        return exercise.steps[index]
    }

    var isLastStep: Bool {
        guard let exercise else { return false }
        return GuidedExerciseLogic.isLastStep(stepIndex, stepCount: exercise.steps.count)
    }

    func start(_ id: GuidedExerciseId) {
        exerciseId = id
        stepIndex = 0
        progress = 0
        isPaused = false
        pausedElapsedMs = 0
        stepStartedAt = Date()
        phase = .running
        startTimer()
    }

    func nextOrFinish() {
        guard let exercise else { return }

        if GuidedExerciseLogic.isLastStep(stepIndex, stepCount: exercise.steps.count) {
            stopTimer()
            phase = .complete
            progress = 1
            return
        }

        stepIndex = GuidedExerciseLogic.nextStepIndex(stepIndex, stepCount: exercise.steps.count)
        beginStep()
    }

    func back() {
        if stepIndex == 0 {
            reset()
            return
        }

        stepIndex = GuidedExerciseLogic.previousStepIndex(stepIndex)
        beginStep()
    }

    func togglePause() {
        if isPaused {
            guard let stepStartedAt else { return }
            self.stepStartedAt = Date().addingTimeInterval(-pausedElapsedMs / 1000)
            isPaused = false
            startTimer()
        } else {
            pausedElapsedMs = elapsedInStepMs()
            isPaused = true
            stopTimer()
            if let step = currentStep {
                progress = GuidedExerciseLogic.stepProgressFraction(
                    index: stepIndex,
                    elapsedInStepMs: pausedElapsedMs,
                    step: step
                )
            }
        }
    }

    func repeatExercise() {
        guard let exerciseId else { return }
        start(exerciseId)
    }

    func chooseAnother() {
        stopTimer()
        phase = .picker
        exerciseId = nil
        stepIndex = 0
        progress = 0
        isPaused = false
        pausedElapsedMs = 0
        stepStartedAt = nil
    }

    func reset() {
        stopTimer()
        phase = .picker
        exerciseId = nil
        stepIndex = 0
        progress = 0
        isPaused = false
        pausedElapsedMs = 0
        stepStartedAt = nil
    }

    func stop() {
        stopTimer()
    }

    private func beginStep() {
        pausedElapsedMs = 0
        stepStartedAt = Date()
        progress = 0
        isPaused = false
        startTimer()
    }

    private func elapsedInStepMs(now: Date = Date()) -> Double {
        guard let stepStartedAt else { return 0 }
        if isPaused { return pausedElapsedMs }
        return max(0, now.timeIntervalSince(stepStartedAt) * 1000)
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: Self.tickInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        guard phase == .running, !isPaused, let step = currentStep else { return }

        let elapsed = elapsedInStepMs()
        progress = GuidedExerciseLogic.stepProgressFraction(
            index: stepIndex,
            elapsedInStepMs: elapsed,
            step: step
        )

        if elapsed >= Double(step.durationMs) {
            if GuidedExerciseLogic.isLastStep(stepIndex, stepCount: exercise?.steps.count ?? 0) {
                stopTimer()
                phase = .complete
                progress = 1
            } else {
                stepIndex = GuidedExerciseLogic.nextStepIndex(
                    stepIndex,
                    stepCount: exercise?.steps.count ?? 0
                )
                beginStep()
            }
        }
    }
}
