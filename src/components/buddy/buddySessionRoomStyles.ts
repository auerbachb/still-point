import type { CSSProperties } from "react";

export const btnPrimary: CSSProperties = {
  background: "linear-gradient(180deg, var(--accent-green), var(--accent-green-end))",
  color: "rgb(var(--bg-rgb))",
  border: "none",
  borderRadius: "40px",
  padding: "14px 24px",
  cursor: "pointer",
  fontFamily: "var(--font-serif)",
  fontSize: "17px",
  fontStyle: "italic",
};

export const btnSecondary: CSSProperties = {
  border: "1px solid var(--border-2)",
  background: "transparent",
  color: "var(--fg)",
  padding: "12px 18px",
  borderRadius: "8px",
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const inlineLinkButton: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--accent-amber)",
  cursor: "pointer",
  font: "inherit",
  padding: 0,
  textDecoration: "underline",
};

export const btnGhost: CSSProperties = {
  ...btnSecondary,
  border: "none",
  color: "var(--fg-3)",
};
