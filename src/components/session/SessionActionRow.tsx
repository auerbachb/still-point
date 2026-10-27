"use client";

import type { RefObject } from "react";
import { captureNoteButtonStyle } from "./sessionViewStyles";

type SessionActionRowProps = {
  isActive: boolean;
  isMobile: boolean;
  /** Secondary chrome is dimmed while the sit runs and the pointer is idle. */
  dimmed: boolean;
  /** Focus returns here when the guided exercise closes. */
  guidedExerciseTriggerRef: RefObject<HTMLButtonElement | null>;
  onOpenGuidedExercise: () => void;
  onOpenThoughtCapture: () => void;
  onEnterMinimalView: () => void;
};

/** Guided exercise (while running), capture note, and "just the timer". */
export function SessionActionRow({
  isActive,
  isMobile,
  dimmed,
  guidedExerciseTriggerRef,
  onOpenGuidedExercise,
  onOpenThoughtCapture,
  onEnterMinimalView,
}: SessionActionRowProps) {
  const opacity = dimmed ? 0.48 : 0.88;

  return (
    <div
      style={{
        marginTop: isMobile ? "12px" : "18px",
        display: "flex",
        justifyContent: "center",
        gap: "10px",
        flexWrap: "wrap",
        width: "100%",
      }}
    >
      {isActive && (
        <button
          ref={guidedExerciseTriggerRef}
          type="button"
          onClick={onOpenGuidedExercise}
          aria-label="Open guided exercise"
          data-testid="guided-exercise-open"
          style={{
            ...captureNoteButtonStyle,
            borderColor: "var(--accent-green-border-subtle)",
            color: "var(--accent-green-dim)",
            opacity,
          }}
        >
          guided exercise
        </button>
      )}
      <button
        type="button"
        onClick={onOpenThoughtCapture}
        aria-label="Capture note"
        style={{
          ...captureNoteButtonStyle,
          opacity,
        }}
      >
        capture note
      </button>
      <button
        type="button"
        onClick={onEnterMinimalView}
        aria-label="Show only the timer"
        data-minimal-view-enter
        style={{
          ...captureNoteButtonStyle,
          borderColor: "var(--border-2)",
          color: "var(--fg-3)",
          opacity,
        }}
      >
        just the timer
      </button>
    </div>
  );
}
