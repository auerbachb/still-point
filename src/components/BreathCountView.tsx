"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  breathCountForTaps,
  elapsedDisplay,
  elapsedSeconds,
  phaseForTaps,
} from "@/lib/breathCounting";
import {
  breathKeyBindingLabel,
  eventMatchesBreathKeyBinding,
  loadBreathKeyBinding,
  subscribeBreathKeyBinding,
  type BreathKeyBinding,
} from "@/lib/breathKeyBinding";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";

export type BreathSessionResult = {
  /** Whole seconds from the first input to End (wall-clock). */
  elapsedSeconds: number;
  /** Complete breaths (2 taps = 1 breath). */
  breathCount: number;
  /** Raw tap count — lets callers distinguish a started-but-short session
   *  (tapCount > 0) from End pressed before any tap (tapCount = 0), since
   *  both can produce elapsedSeconds=0 and breathCount=0. */
  tapCount: number;
};

type BreathCountViewProps = {
  /** Called on End. The parent persists the session (#374 data semantics) and
   *  navigates home. An empty session (no taps, no elapsed time) is reported as
   *  `{ elapsedSeconds: 0, breathCount: 0 }` so the parent can skip logging it. */
  onEnd: (result: BreathSessionResult) => void;
};

/** Live view of the configured breath key binding (re-renders on Settings save / cross-tab). */
function useBreathKeyBinding(): BreathKeyBinding {
  return useSyncExternalStore(
    subscribeBreathKeyBinding,
    () => loadBreathKeyBinding(),
    () => "Space" as BreathKeyBinding,
  );
}

export function BreathCountView({ onEnd }: BreathCountViewProps) {
  const [tapCount, setTapCount] = useState(0);
  const [startMs, setStartMs] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const keyBinding = useBreathKeyBinding();

  // Wake lock parity with sits (#317): keep the screen awake once running.
  const keepAwakePref = useKeepScreenAwakePref();
  useWakeLock(keepAwakePref && startMs !== null);

  // Re-entrancy guard so a second End (button + key in the same frame) can't
  // double-report. Mirrors iOS `isSavingBreathSession`.
  const endedRef = useRef(false);
  // Refs are the source of truth for tap count and start time: they are mutated
  // synchronously inside `recordTap` (not assigned during render) so `handleEnd`
  // always sees the latest values even when End fires in the same tick as a tap,
  // before React has re-rendered. State mirrors the refs only to drive the UI.
  const startMsRef = useRef<number | null>(null);
  const tapCountRef = useRef(0);

  const recordTap = useCallback(() => {
    if (endedRef.current) return;
    tapCountRef.current += 1;
    setTapCount(tapCountRef.current);
    if (startMsRef.current === null) {
      startMsRef.current = Date.now();
      setStartMs(startMsRef.current);
    }
  }, []);

  const handleEnd = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Recompute elapsed from the wall clock so ending between 1-second ticks
    // (or right after the first tap) doesn't under-report the duration. When
    // no tap was recorded, startMsRef is null and the session is empty (0s).
    const finalElapsed =
      startMsRef.current !== null ? elapsedSeconds(startMsRef.current, Date.now()) : 0;
    onEnd({
      elapsedSeconds: finalElapsed,
      breathCount: breathCountForTaps(tapCountRef.current),
      tapCount: tapCountRef.current,
    });
  }, [onEnd]);

  // Count-up timer from the first input. Wall-clock based so backgrounding the
  // tab doesn't drift the counter.
  useEffect(() => {
    if (startMs === null) return;
    setSeconds(elapsedSeconds(startMs, Date.now()));
    const id = setInterval(() => {
      setSeconds(elapsedSeconds(startMs, Date.now()));
    }, 250);
    return () => clearInterval(id);
  }, [startMs]);

  // Global key handler: the bound key registers a breath and is prevented from
  // its default action (Space scrolling the page / activating a focused button)
  // while the breath view is active. Auto-repeat (held key) is ignored so a tap
  // stays discrete.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!eventMatchesBreathKeyBinding(event, keyBinding)) return;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      recordTap();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyBinding, recordTap]);

  const [focusVisible, setFocusVisible] = useState(false);
  const running = startMs !== null;
  const phase = phaseForTaps(tapCount);
  const breaths = breathCountForTaps(tapCount);
  const bindingLabel = breathKeyBindingLabel(keyBinding);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Breath counting. Tap anywhere to register a breath."
      onClick={recordTap}
      onFocus={(e) => {
        // Only show focus ring for keyboard navigation, not mouse clicks.
        if (e.target === e.currentTarget) setFocusVisible(true);
      }}
      onBlur={() => setFocusVisible(false)}
      onMouseDown={() => setFocusVisible(false)}
      onKeyDown={(e) => {
        // Enter triggers a tap from keyboard focus; the configured key binding
        // is handled by the global listener above.
        if (e.key === "Enter") {
          e.preventDefault();
          recordTap();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgb(var(--bg-rgb))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s5)",
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        outline: focusVisible ? "2px solid var(--accent-green-text)" : "none",
        outlineOffset: focusVisible ? "-2px" : undefined,
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        padding: "var(--s4)",
        animation: "fadeIn 0.6s ease",
      }}
    >
      <div
        data-testid="breath-elapsed"
        style={{
          fontSize: "min(120px, 22vw)",
          fontWeight: 200,
          lineHeight: 1,
          color: "var(--fg)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {elapsedDisplay(seconds)}
      </div>

      {/* Phase indicator — the next expected action. */}
      <div
        data-testid="breath-phase"
        style={{
          fontSize: "28px",
          fontWeight: 200,
          letterSpacing: "0.3em",
          textTransform: "lowercase",
          transition: "color 0.2s ease",
          color: !running
            ? "var(--fg-4)"
            : phase === "inhale"
              ? "var(--accent-green-text)"
              : "var(--fg-3)",
        }}
      >
        {!running ? "tap to begin" : phase === "inhale" ? "in" : "out"}
      </div>

      {breaths > 0 ? (
        <div
          data-testid="breath-count"
          style={{
            fontSize: "16px",
            letterSpacing: "0.15em",
            color: "var(--accent-green-text)",
          }}
        >
          {breaths} breath{breaths === 1 ? "" : "s"}
        </div>
      ) : (
        <div style={{ fontSize: "13px", letterSpacing: "0.08em", color: "var(--fg-4)" }}>
          tap each inhale and exhale &middot; or press {bindingLabel}
        </div>
      )}

      {/* End — explicit, interactive, pinned near the bottom. stopPropagation so
          ending the session never also registers a breath on the tap target. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleEnd();
        }}
        onKeyDown={(e) => {
          // Always stop propagation so the container tap handler never fires
          // from a button keypress. But allow the configured breath key to
          // reach the window-level listener by NOT stopping propagation for it.
          // (React 17+ delegates to the root element, which is below window, so
          // stopPropagation() would prevent the window listener from seeing it.)
          if (!eventMatchesBreathKeyBinding(e.nativeEvent, keyBinding)) {
            e.stopPropagation();
          }
        }}
        style={{
          position: "absolute",
          bottom: "calc(var(--s5) + env(safe-area-inset-bottom, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--surface-1)",
          border: "1px solid var(--border-1)",
          color: "var(--fg-3)",
          borderRadius: "999px",
          padding: "12px 32px",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "13px",
          fontWeight: 500,
          letterSpacing: "0.08em",
          cursor: "pointer",
        }}
        aria-label="End breath counting session"
      >
        End
      </button>
    </div>
  );
}
