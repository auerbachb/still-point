"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  isLastStep,
  nextStepIndex,
  previousStepIndex,
  stepProgressFraction,
} from "@/lib/guidedExercise";
import {
  GUIDED_EXERCISES,
  guidedExerciseById,
  type GuidedExerciseId,
} from "@/lib/guidedExerciseContent";

type GuidedExerciseOverlayProps = {
  open: boolean;
  onClose: () => void;
};

type Phase = "picker" | "running" | "complete";

const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
};

const TICK_MS = 250;

export function GuidedExerciseOverlay({ open, onClose }: GuidedExerciseOverlayProps) {
  const [phase, setPhase] = useState<Phase>("picker");
  const [exerciseId, setExerciseId] = useState<GuidedExerciseId | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsedInStepMs, setElapsedInStepMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotionRef = useRef(false);
  const stepIndexRef = useRef(stepIndex);
  const elapsedRef = useRef(elapsedInStepMs);

  stepIndexRef.current = stepIndex;
  elapsedRef.current = elapsedInStepMs;

  const exercise = exerciseId ? guidedExerciseById(exerciseId) : null;
  const steps = exercise?.steps ?? [];
  const currentStep = steps[stepIndex];
  const progress = currentStep ? stepProgressFraction(stepIndex, elapsedInStepMs, currentStep) : 0;

  const resetState = useCallback(() => {
    setPhase("picker");
    setExerciseId(null);
    setStepIndex(0);
    setElapsedInStepMs(0);
    setPaused(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const startExercise = useCallback((id: GuidedExerciseId) => {
    setExerciseId(id);
    setStepIndex(0);
    setElapsedInStepMs(0);
    setPaused(false);
    setPhase("running");
  }, []);

  const advanceStep = useCallback(() => {
    if (!exercise) return;
    setStepIndex(i => {
      if (isLastStep(i, exercise.steps.length)) {
        setPhase("complete");
        return i;
      }
      elapsedRef.current = 0;
      setElapsedInStepMs(0);
      return nextStepIndex(i, exercise.steps.length);
    });
  }, [exercise]);

  const goBack = useCallback(() => {
    setStepIndex(i => {
      if (i === 0) {
        resetState();
        return 0;
      }
      elapsedRef.current = 0;
      setElapsedInStepMs(0);
      return previousStepIndex(i);
    });
  }, [resetState]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    reduceMotionRef.current =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!open || phase !== "running" || paused || !exercise) return;

    const id = window.setInterval(() => {
      const idx = stepIndexRef.current;
      const step = exercise.steps[idx];
      if (!step) return;

      const nextElapsed = elapsedRef.current + TICK_MS;
      if (nextElapsed < step.durationMs) {
        elapsedRef.current = nextElapsed;
        setElapsedInStepMs(nextElapsed);
        return;
      }

      elapsedRef.current = 0;
      if (isLastStep(idx, exercise.steps.length)) {
        setPhase("complete");
        setElapsedInStepMs(0);
        return;
      }

      const nextIdx = nextStepIndex(idx, exercise.steps.length);
      stepIndexRef.current = nextIdx;
      setStepIndex(nextIdx);
      setElapsedInStepMs(0);
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [open, phase, paused, exercise]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 210,
    background: "rgba(var(--bg-rgb), 0.94)",
    backdropFilter: "blur(6px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))",
    animation: reduceMotionRef.current ? undefined : "fadeIn 0.5s ease",
    ...mono,
  };

  const cardStyle: CSSProperties = {
    width: "100%",
    maxWidth: "min(440px, calc(100vw - 40px))",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
  };

  const buttonRowStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "10px",
    width: "100%",
  };

  const secondaryButtonStyle: CSSProperties = {
    background: "var(--surface-1)",
    border: "1px solid var(--border-2)",
    color: "var(--fg-2)",
    ...mono,
    fontSize: "11px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "12px 18px",
    minHeight: "44px",
    borderRadius: "16px",
    cursor: "pointer",
  };

  const closeButtonStyle: CSSProperties = {
    position: "absolute",
    top: "max(16px, env(safe-area-inset-top))",
    right: "max(16px, env(safe-area-inset-right))",
    background: "none",
    border: "1px solid var(--border-2)",
    color: "var(--fg-3)",
    ...mono,
    fontSize: "10px",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    padding: "10px 16px",
    minHeight: "44px",
    borderRadius: "999px",
    cursor: "pointer",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Guided exercise"
      data-testid="guided-exercise-overlay"
      data-no-space-distraction
      style={overlayStyle}
    >
      <button type="button" onClick={handleClose} aria-label="Close guided exercise" style={closeButtonStyle}>
        close
      </button>

      <div style={cardStyle}>
        {phase === "picker" && (
          <>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "10px",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--fg-4)",
                }}
              >
                Guided exercise
              </p>
              <h2
                style={{
                  margin: "10px 0 0",
                  fontSize: "18px",
                  fontWeight: 400,
                  letterSpacing: "0.06em",
                  color: "var(--fg-2)",
                }}
              >
                Choose a focus
              </h2>
              <p style={{ margin: "12px 0 0", fontSize: "12px", lineHeight: 1.55, color: "var(--fg-4)" }}>
                Your sit keeps running. Each prompt advances gently on its own — tap next anytime.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
              {GUIDED_EXERCISES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`guided-exercise-option-${item.id}`}
                  onClick={() => startExercise(item.id)}
                  style={{
                    textAlign: "left",
                    background: "var(--surface-1)",
                    border: "1px solid var(--accent-green-border-subtle)",
                    borderRadius: "16px",
                    padding: "16px 18px",
                    cursor: "pointer",
                    color: "var(--fg-2)",
                    ...mono,
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--accent-green-dim)",
                    }}
                  >
                    {item.shortLabel}
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "13px", letterSpacing: "0.04em" }}>{item.label}</div>
                  <div style={{ marginTop: "8px", fontSize: "11px", lineHeight: 1.5, color: "var(--fg-4)" }}>
                    {item.description}
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "10px", color: "var(--fg-4)", letterSpacing: "0.08em" }}>
                    {item.steps.length} prompts
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "running" && exercise && currentStep && (
          <>
            <div style={{ width: "100%", textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "10px",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--fg-4)",
                }}
              >
                {exercise.shortLabel} · {stepIndex + 1} / {steps.length}
              </p>
              <h2
                data-testid="guided-exercise-step-title"
                style={{
                  margin: "12px 0 0",
                  fontSize: "22px",
                  fontWeight: 300,
                  letterSpacing: "0.08em",
                  color: "var(--accent-green-text)",
                }}
              >
                {currentStep.title}
              </h2>
            </div>

            <div
              aria-hidden
              style={{
                width: "100%",
                height: "3px",
                borderRadius: "999px",
                background: "var(--border-2)",
                overflow: "hidden",
              }}
            >
              <div
                data-testid="guided-exercise-step-progress"
                style={{
                  height: "100%",
                  width: `${progress * 100}%`,
                  background: "var(--accent-green)",
                  transition: reduceMotionRef.current ? undefined : "width 0.25s linear",
                }}
              />
            </div>

            <p
              data-testid="guided-exercise-step-prompt"
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: "14px",
                lineHeight: 1.65,
                color: "var(--fg-2)",
                letterSpacing: "0.02em",
                maxWidth: "36ch",
              }}
            >
              {currentStep.prompt}
            </p>

            <div style={buttonRowStyle}>
              <button type="button" onClick={goBack} style={secondaryButtonStyle}>
                back
              </button>
              <button
                type="button"
                onClick={() => setPaused(p => !p)}
                aria-pressed={paused}
                style={secondaryButtonStyle}
              >
                {paused ? "resume" : "pause"}
              </button>
              <button type="button" onClick={advanceStep} style={secondaryButtonStyle}>
                {isLastStep(stepIndex, steps.length) ? "finish" : "next"}
              </button>
            </div>
          </>
        )}

        {phase === "complete" && exercise && (
          <>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "10px",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--fg-4)",
                }}
              >
                {exercise.shortLabel} complete
              </p>
              <h2
                style={{
                  margin: "12px 0 0",
                  fontSize: "20px",
                  fontWeight: 300,
                  letterSpacing: "0.06em",
                  color: "var(--fg-2)",
                }}
              >
                Return to your sit
              </h2>
              <p style={{ margin: "14px 0 0", fontSize: "13px", lineHeight: 1.55, color: "var(--fg-4)" }}>
                Let the exercise dissolve. Your timer and tracking continue as before.
              </p>
            </div>

            <div style={buttonRowStyle}>
              <button type="button" onClick={() => startExercise(exercise.id)} style={secondaryButtonStyle}>
                repeat
              </button>
              <button type="button" onClick={resetState} style={secondaryButtonStyle}>
                choose another
              </button>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  ...secondaryButtonStyle,
                  borderColor: "var(--accent-green-border)",
                  color: "var(--accent-green-dim)",
                }}
              >
                back to sit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
