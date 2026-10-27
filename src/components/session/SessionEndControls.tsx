"use client";

import type { CSSProperties } from "react";
import { mono } from "./sessionViewStyles";

type SessionEndControlsProps = {
  isMobile: boolean;
  isActive: boolean;
  /** #884: false once the sit has ended — neither Pause nor Resume applies. */
  pauseToggleEnabled: boolean;
  /** #930: false once the sit has ended — End Early or Abandon would save it twice. */
  endEnabled: boolean;
  onTogglePause: () => void;
  onEndEarly: () => void;
  onAbandon: () => void;
};

function pillStyle(borderColor: string, color: string, enabled: boolean): CSSProperties {
  return {
    background: "none",
    border: `1px solid ${borderColor}`,
    color,
    ...mono,
    fontSize: "11px",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    padding: "14px 24px",
    minHeight: "44px",
    borderRadius: "20px",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.4,
  };
}

/** Pause/resume, end early & keep, and abandon. */
export function SessionEndControls({
  isMobile,
  isActive,
  pauseToggleEnabled,
  endEnabled,
  onTogglePause,
  onEndEarly,
  onAbandon,
}: SessionEndControlsProps) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: isMobile ? "16px" : "32px", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onTogglePause}
        disabled={!pauseToggleEnabled}
        style={pillStyle("var(--border-2)", "var(--fg-3)", pauseToggleEnabled)}
      >
        {isActive ? "pause" : "resume"}
      </button>
      <button
        type="button"
        onClick={onEndEarly}
        disabled={!endEnabled}
        style={pillStyle("var(--accent-green-border)", "var(--accent-green-dim)", endEnabled)}
      >
        end early &amp; keep
      </button>
      <button
        type="button"
        onClick={onAbandon}
        disabled={!endEnabled}
        style={pillStyle("var(--accent-danger-border)", "var(--accent-danger-muted)", endEnabled)}
      >
        abandon
      </button>
    </div>
  );
}
