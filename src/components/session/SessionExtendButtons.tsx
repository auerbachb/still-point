"use client";

import type { CSSProperties } from "react";
import { mono } from "./sessionViewStyles";

type SessionExtendButtonsProps = {
  isMobile: boolean;
  disabled: boolean;
  onExtend: (extraSeconds: number) => void;
};

const EXTENSIONS = [
  { seconds: 60, label: "+1 min", ariaLabel: "Add one minute to this session" },
  { seconds: 300, label: "+5 min", ariaLabel: "Add five minutes to this session" },
] as const;

/** The +1 / +5 minute bonus-time buttons under the timer. */
export function SessionExtendButtons({ isMobile, disabled, onExtend }: SessionExtendButtonsProps) {
  const buttonStyle: CSSProperties = {
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
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: isMobile ? "12px" : "20px", flexWrap: "wrap" }}>
      {EXTENSIONS.map(({ seconds, label, ariaLabel }) => (
        <button
          key={seconds}
          type="button"
          disabled={disabled}
          onClick={() => onExtend(seconds)}
          aria-label={ariaLabel}
          style={buttonStyle}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
