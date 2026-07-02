import {
  type GuidedExerciseDefinition,
  type GuidedExerciseStep,
  guidedExerciseById,
  type GuidedExerciseId,
} from "./guidedExerciseContent";

export function totalDurationMs(steps: GuidedExerciseStep[]): number {
  return steps.reduce((sum, step) => sum + step.durationMs, 0);
}

export function clampStepIndex(index: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.min(Math.max(0, index), stepCount - 1);
}

export function isLastStep(index: number, stepCount: number): boolean {
  return stepCount > 0 && index >= stepCount - 1;
}

export function nextStepIndex(index: number, stepCount: number): number {
  return clampStepIndex(index + 1, stepCount);
}

export function previousStepIndex(index: number): number {
  return Math.max(0, index - 1);
}

export function stepProgressFraction(index: number, elapsedInStepMs: number, step: GuidedExerciseStep): number {
  if (step.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedInStepMs / step.durationMs));
}

export function exerciseSummary(id: GuidedExerciseId): Pick<GuidedExerciseDefinition, "id" | "label" | "shortLabel" | "description"> & {
  stepCount: number;
  totalDurationMs: number;
} {
  const exercise = guidedExerciseById(id);
  return {
    id: exercise.id,
    label: exercise.label,
    shortLabel: exercise.shortLabel,
    description: exercise.description,
    stepCount: exercise.steps.length,
    totalDurationMs: totalDurationMs(exercise.steps),
  };
}
