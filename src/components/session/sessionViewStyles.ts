import type { CSSProperties } from "react";

/** The mono face every label on the session screen uses. */
export const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
};

/** Capture stays in the persistent tracking layer while running so it is never hidden with secondary chrome. */
export const captureNoteButtonStyle: CSSProperties = {
  background: "none",
  border: "1px solid var(--accent-amber-border)",
  color: "var(--accent-amber-border)",
  ...mono,
  fontSize: "11px",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  padding: "14px 24px",
  minHeight: "44px",
  minWidth: "44px",
  borderRadius: "20px",
  cursor: "pointer",
  transition: "opacity 0.5s ease",
};

/** Off-screen until focused: the keyboard/screen-reader way out of minimal view. */
export function minimalExitButtonStyle(focused: boolean): CSSProperties {
  return focused
    ? {
        position: "fixed",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "var(--surface-1)",
        border: "1px solid var(--border-2)",
        color: "var(--fg-3)",
        ...mono,
        fontSize: "11px",
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        padding: "14px 24px",
        minHeight: "44px",
        borderRadius: "20px",
        cursor: "pointer",
      }
    : {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: 0,
        background: "none",
      };
}
