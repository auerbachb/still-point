"use client";

import type { CSSProperties, RefObject } from "react";
import type { MindHoldKind } from "@/lib/useMindStateHold";
import { FlashHint } from "../FlashHint";
import { mono } from "./sessionViewStyles";
import type { SessionMindState } from "./SessionMindStateStatus";

type SessionHoldControlsProps = {
  isActive: boolean;
  isMobile: boolean;
  mindState: SessionMindState;
  mindStateRef: RefObject<SessionMindState>;
  holdKindRef: RefObject<MindHoldKind>;
  onDistractionDown: () => void;
  onDistractionUp: () => void;
  onHyperfocusDown: () => void;
  onHyperfocusUp: () => void;
};

/**
 * The light-distraction and hyperfocus hold buttons, plus the hint under them.
 * Each hold starts on press and ends on release (or when the pointer leaves
 * the button mid-hold); the session screen owns the mind-state log they feed.
 */
export function SessionHoldControls({
  isActive,
  isMobile,
  mindState,
  mindStateRef,
  holdKindRef,
  onDistractionDown,
  onDistractionUp,
  onHyperfocusDown,
  onHyperfocusUp,
}: SessionHoldControlsProps) {
  const holdButtonBase: CSSProperties = {
    ...mono,
    fontSize: "12px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "12px 14px",
    borderRadius: "16px",
    cursor: isActive ? "pointer" : "default",
    transition: "all 0.25s",
    // On phones keep both holds on one row (was wrapping to two, adding height).
    flex: isMobile ? "1 1 0" : "1 1 140px",
    minWidth: isMobile ? 0 : "min(160px, 42vw)",
    maxWidth: isMobile ? "none" : "200px",
    minHeight: "44px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    border: "1px solid var(--border-2)",
    background: "var(--surface-1)",
    color: "var(--fg-2)",
    opacity: isActive ? 1 : 0.45,
  };

  return (
    <>
      <div
        data-tracking-controls="visible"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
          marginTop: "16px",
          width: "100%",
        }}
      >
        <button
          type="button"
          disabled={!isActive}
          aria-pressed={mindState === "thinking"}
          aria-label={isMobile ? "Hold for light distraction. Release when aware again." : "Hold for light distraction, or hold Space. Release when aware again."}
          onMouseDown={e => {
            e.preventDefault();
            onDistractionDown();
          }}
          onMouseUp={onDistractionUp}
          onMouseLeave={() => {
            if (holdKindRef.current === "pointerHold" && mindStateRef.current === "thinking") {
              onDistractionUp();
            }
          }}
          onTouchStart={e => {
            e.preventDefault();
            onDistractionDown();
          }}
          onTouchEnd={onDistractionUp}
          onTouchCancel={onDistractionUp}
          style={{
            ...holdButtonBase,
            borderColor:
              mindState === "thinking" ? "var(--accent-amber-border)" : "var(--accent-green-border-subtle)",
            background:
              mindState === "thinking" ? "var(--accent-amber-bg)" : "var(--accent-green-bg-subtle)",
            color: mindState === "thinking" ? "var(--accent-amber)" : "var(--accent-green)",
          }}
        >
          <span>{mindState === "thinking" ? "Release" : "Hold"} — light distraction</span>
          {!isMobile && (
            <span style={{ ...mono, fontSize: "9px", letterSpacing: "0.14em", opacity: 0.85, textTransform: "none" }}>
              or hold Space
            </span>
          )}
        </button>

        <button
          type="button"
          disabled={!isActive}
          aria-pressed={mindState === "hyperfocus"}
          aria-label={isMobile ? "Hold for hyperfocus. Release to return to aware." : "Hold for hyperfocus, or hold Comma. Release to return to aware."}
          onMouseDown={e => {
            e.preventDefault();
            onHyperfocusDown();
          }}
          onMouseUp={onHyperfocusUp}
          onMouseLeave={() => {
            if (holdKindRef.current === "pointerHold" && mindStateRef.current === "hyperfocus") {
              onHyperfocusUp();
            }
          }}
          onTouchStart={e => {
            e.preventDefault();
            onHyperfocusDown();
          }}
          onTouchEnd={onHyperfocusUp}
          onTouchCancel={onHyperfocusUp}
          style={{
            ...holdButtonBase,
            borderColor:
              mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.55)" : "var(--border-2)",
            background:
              mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.12)" : "var(--surface-1)",
            color: mindState === "hyperfocus" ? "rgba(147, 197, 253, 0.95)" : "var(--fg-2)",
          }}
        >
          <span>{mindState === "hyperfocus" ? "Release" : "Hold"} — hyperfocus</span>
          {!isMobile && (
            <span style={{ ...mono, fontSize: "9px", letterSpacing: "0.14em", opacity: 0.85, textTransform: "none" }}>
              or hold ,
            </span>
          )}
        </button>
      </div>

      <FlashHint>
        <p
          style={{
            margin: "12px 0 0",
            textAlign: "center",
            ...mono,
            fontSize: "10px",
            color: "var(--fg-4)",
            letterSpacing: "0.05em",
            lineHeight: 1.45,
          }}
        >
          Light distraction holds only log awareness segments. Captured notes are reserved for explicit capture paths.
        </p>
      </FlashHint>
    </>
  );
}
