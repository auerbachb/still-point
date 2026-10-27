"use client";

import { mono } from "./sessionViewStyles";

export type SessionMindState = "clear" | "thinking" | "hyperfocus";

type SessionMindStateStatusProps = {
  mindState: SessionMindState;
  distractionSegmentCount: number;
  capturedCount: number;
};

/** The status row: the mind-state dot, its label, and this sit's running counts. */
export function SessionMindStateStatus({
  mindState,
  distractionSegmentCount,
  capturedCount,
}: SessionMindStateStatusProps) {
  const stateLabel =
    mindState === "thinking" ? "Distracted" : mindState === "hyperfocus" ? "Hyperfocus" : "Aware";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        ...mono,
        fontSize: "11px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--fg-3)",
        justifyContent: "center",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background:
            mindState === "thinking"
              ? "var(--accent-amber)"
              : mindState === "hyperfocus"
                ? "rgba(96, 165, 250, 0.95)"
                : "var(--accent-green)",
          boxShadow:
            mindState === "thinking"
              ? "0 0 12px var(--accent-amber)"
              : mindState === "hyperfocus"
                ? "0 0 12px rgba(59, 130, 246, 0.6)"
                : "none",
          flexShrink: 0,
        }}
      />
      <span>{stateLabel}</span>
      {distractionSegmentCount > 0 && (
        <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
          · {distractionSegmentCount} light {distractionSegmentCount === 1 ? "segment" : "segments"}
        </span>
      )}
      {capturedCount > 0 && (
        <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
          · {capturedCount} captured {capturedCount === 1 ? "note" : "notes"}
        </span>
      )}
    </div>
  );
}
