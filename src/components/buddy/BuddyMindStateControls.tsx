import type { MutableRefObject } from "react";
import type { MindHoldKind } from "@/lib/useMindStateHold";
import type { BuddyMindState } from "@/lib/useBuddyMindState";
import { ThoughtCapture } from "../ThoughtCapture";

type BuddyMindStateControlsProps = {
  mindState: BuddyMindState;
  mindStateRef: MutableRefObject<BuddyMindState>;
  holdKindRef: MutableRefObject<MindHoldKind>;
  showPostDistractionCapture: boolean;
  distractionSegmentCount: number;
  sessionThoughtsCount: number;
  buddyAwarenessPct: number;
  elapsedRef: MutableRefObject<number>;
  finalizeActiveBuddyHold: (atTime: number) => void;
  beginBuddyDistraction: () => void;
  beginBuddyHyperfocus: () => void;
  onSaveThought: (text: string) => void;
  onDismissPostCapture: () => void;
};

export function BuddyMindStateControls({
  mindState,
  mindStateRef,
  holdKindRef,
  showPostDistractionCapture,
  distractionSegmentCount,
  sessionThoughtsCount,
  buddyAwarenessPct,
  elapsedRef,
  finalizeActiveBuddyHold,
  beginBuddyDistraction,
  beginBuddyHyperfocus,
  onSaveThought,
  onDismissPostCapture,
}: BuddyMindStateControlsProps) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: "min(420px, calc(100vw - 40px))",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginTop: "8px",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--fg-3)",
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
        <span>
          {mindState === "thinking"
            ? "Distracted"
            : mindState === "hyperfocus"
              ? "Hyperfocus"
              : "Aware"}
        </span>
        {distractionSegmentCount > 0 && (
          <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
            · {distractionSegmentCount} light{" "}
            {distractionSegmentCount === 1 ? "segment" : "segments"}
          </span>
        )}
        {sessionThoughtsCount > 0 && (
          <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
            · {sessionThoughtsCount} captured {sessionThoughtsCount === 1 ? "note" : "notes"}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
          marginTop: "12px",
          width: "100%",
        }}
      >
        <button
          type="button"
          aria-pressed={mindState === "thinking"}
          aria-label="Hold for light distraction, or hold Space. Only on your device."
          title="Mind-state and thoughts stay on this device; others are not notified."
          onMouseDown={(e) => {
            e.preventDefault();
            if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
            holdKindRef.current = "pointerHold";
            beginBuddyDistraction();
          }}
          onMouseUp={() => {
            if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") {
              return;
            }
            holdKindRef.current = "none";
            finalizeActiveBuddyHold(elapsedRef.current);
          }}
          onMouseLeave={() => {
            if (holdKindRef.current === "pointerHold" && mindStateRef.current === "thinking") {
              holdKindRef.current = "none";
              finalizeActiveBuddyHold(elapsedRef.current);
            }
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
            holdKindRef.current = "pointerHold";
            beginBuddyDistraction();
          }}
          onTouchEnd={() => {
            if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") {
              return;
            }
            holdKindRef.current = "none";
            finalizeActiveBuddyHold(elapsedRef.current);
          }}
          onTouchCancel={() => {
            if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") {
              return;
            }
            holdKindRef.current = "none";
            finalizeActiveBuddyHold(elapsedRef.current);
          }}
          style={{
            background:
              mindState === "thinking" ? "var(--accent-amber-bg)" : "var(--accent-green-bg-subtle)",
            border: `1px solid ${
              mindState === "thinking"
                ? "var(--accent-amber-border)"
                : "var(--accent-green-border)"
            }`,
            color: mindState === "thinking" ? "var(--accent-amber)" : "var(--accent-green)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 16px",
            borderRadius: "16px",
            cursor: "pointer",
            transition: "all 0.25s",
            flex: "1 1 140px",
            minWidth: "min(160px, 42vw)",
            maxWidth: "200px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>{mindState === "thinking" ? "Release" : "Hold"} — light distraction</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              letterSpacing: "0.14em",
              opacity: 0.85,
              textTransform: "none",
            }}
          >
            or hold Space
          </span>
        </button>

        <button
          type="button"
          aria-pressed={mindState === "hyperfocus"}
          aria-label="Hold for hyperfocus, or hold Comma. Only on your device."
          title="Mind-state and thoughts stay on this device; others are not notified."
          onMouseDown={(e) => {
            e.preventDefault();
            if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
            holdKindRef.current = "pointerHold";
            beginBuddyHyperfocus();
          }}
          onMouseUp={() => {
            if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") {
              return;
            }
            holdKindRef.current = "none";
            finalizeActiveBuddyHold(elapsedRef.current);
          }}
          onMouseLeave={() => {
            if (holdKindRef.current === "pointerHold" && mindStateRef.current === "hyperfocus") {
              holdKindRef.current = "none";
              finalizeActiveBuddyHold(elapsedRef.current);
            }
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
            holdKindRef.current = "pointerHold";
            beginBuddyHyperfocus();
          }}
          onTouchEnd={() => {
            if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") {
              return;
            }
            holdKindRef.current = "none";
            finalizeActiveBuddyHold(elapsedRef.current);
          }}
          onTouchCancel={() => {
            if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") {
              return;
            }
            holdKindRef.current = "none";
            finalizeActiveBuddyHold(elapsedRef.current);
          }}
          style={{
            background:
              mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.12)" : "var(--surface-1)",
            border: `1px solid ${
              mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.55)" : "var(--border-2)"
            }`,
            color:
              mindState === "hyperfocus" ? "rgba(147, 197, 253, 0.95)" : "var(--fg-2)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 16px",
            borderRadius: "16px",
            cursor: "pointer",
            transition: "all 0.25s",
            flex: "1 1 140px",
            minWidth: "min(160px, 42vw)",
            maxWidth: "200px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>{mindState === "hyperfocus" ? "Release" : "Hold"} — hyperfocus</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              letterSpacing: "0.14em",
              opacity: 0.85,
              textTransform: "none",
            }}
          >
            or hold ,
          </span>
        </button>
      </div>

      <p
        style={{
          margin: "12px 0 0",
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--fg-4)",
          letterSpacing: "0.05em",
          lineHeight: 1.45,
        }}
      >
        Shortcuts when not typing — only on your device. Light distraction holds only log segments;
        captured notes require an explicit capture path.
      </p>

      <div
        style={{
          marginTop: "12px",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--fg-4)",
          letterSpacing: "0.08em",
          textAlign: "center",
        }}
      >
        <span style={{ color: "var(--accent-green-dim)" }}>{buddyAwarenessPct}% awareness</span>
        <span style={{ margin: "0 6px", color: "var(--fg-4)" }}>·</span>
        <span style={{ color: "var(--accent-amber-border)" }}>
          {Math.max(0, 100 - buddyAwarenessPct)}% distraction
        </span>
      </div>

      {showPostDistractionCapture && (
        <div
          data-no-space-distraction
          style={{ marginTop: "16px", width: "100%", display: "flex", justifyContent: "center" }}
        >
          <ThoughtCapture onSave={onSaveThought} onCancel={onDismissPostCapture} />
        </div>
      )}
    </div>
  );
}
