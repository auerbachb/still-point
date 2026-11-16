"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatFocusCountdown,
  type FocusEndReason,
  type FocusSessionResult,
} from "@/lib/focusActivity";
import {
  advanceFocusGame,
  createFocusGame,
  focusGameRemainingMs,
  focusGameResult,
  FOCUS_GAME_COLUMNS,
  FOCUS_GAME_DEFAULT_DURATION_SECONDS,
  FOCUS_GAME_DURATIONS_SECONDS,
  FOCUS_GAME_GRID_GAP_PX,
  FOCUS_GAME_MAX_ROWS,
  isFocusGameFinished,
  rowsForViewport,
  tapFocusGameCell,
  type FocusGameOutcome,
  type FocusGameState,
} from "@/lib/focusGameLogic";
import { useSessionSuppressionRelay } from "@/lib/useSessionSuppression";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";

/** How long a tap's colour feedback stays on a square. */
const FLASH_MS = 300;
/** How long the "missed it" notice stays up after a reset. */
const RESET_NOTICE_MS = 1500;
/** Countdown refresh cadence. Matches the breath counter's tick. */
const TICK_MS = 250;

type FocusGamesViewProps = {
  /** Called once when the game ends: the countdown ran out, or End was pressed.
   *  `null` when there is nothing to save (Back from the start screen, or End before
   *  a whole second of countdown). The result is a focus session result, saved as a
   *  focus session under the game's category. */
  onEnd: (result: FocusSessionResult | null) => void;
  /** Reports whether a game is running (not on the start screen, not after it ended).
   *  The page holds a pending buddy invite only while this is true. */
  onPlayingChange?: (playing: boolean) => void;
};

type Phase = "setup" | "playing" | "ended";

type Frame = {
  state: FocusGameState;
  nowMs: number;
  flash: { cell: number; kind: "hit" | "wrong"; at: number } | null;
  resetAt: number | null;
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function FocusGamesView({ onEnd, onPlayingChange }: FocusGamesViewProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [durationSeconds, setDurationSeconds] = useState<number>(FOCUS_GAME_DEFAULT_DURATION_SECONDS);
  const [rows, setRows] = useState<number>(FOCUS_GAME_MAX_ROWS);
  const [frame, setFrame] = useState<Frame | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  // The game state lives in a ref, so the tick and tap handlers always read the
  // latest values; React state only drives the rendering of each frame.
  const gameRef = useRef<FocusGameState | null>(null);
  const cellsRef = useRef<number>(FOCUS_GAME_COLUMNS * FOCUS_GAME_MAX_ROWS);
  const endedRef = useRef(false);

  // Wake lock parity with the breath counter: keep the screen awake while playing,
  // and hold back push notifications for the session.
  const keepAwakePref = useKeepScreenAwakePref();
  const playing = phase === "playing";
  useWakeLock(keepAwakePref && playing);
  const notificationSessionKeyRef = useRef(crypto.randomUUID());
  useSessionSuppressionRelay(playing, notificationSessionKeyRef.current);

  // The parent passes a fresh callback each render; keep the latest in a ref so the
  // countdown timer is not torn down and rebuilt on every parent render.
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  // Report playing state to the parent; a torn-down view always reports not playing.
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);
  useEffect(() => {
    onPlayingChangeRef.current?.(playing);
  }, [playing]);
  useEffect(() => () => onPlayingChangeRef.current?.(false), []);

  const finish = useCallback((reason: FocusEndReason, nowMs: number) => {
    // Re-entrancy guard: a tap and the countdown can both try to end the game.
    if (endedRef.current) return;
    endedRef.current = true;
    const game = gameRef.current;
    // Leaving `playing` releases the wake lock and notification suppression now, not
    // when the parent unmounts this view after the save.
    setPhase("ended");
    onEndRef.current(game ? focusGameResult(game, nowMs, reason) : null);
  }, []);

  // Advance the game on a fixed cadence: resets missed squares, lights new ones,
  // and ends the game when the countdown runs out.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const game = gameRef.current;
      if (!game || endedRef.current) return;
      const nowMs = Date.now();
      const { state, outcome } = advanceFocusGame(game, nowMs, Math.random, cellsRef.current);
      gameRef.current = state;
      if (isFocusGameFinished(state, nowMs)) {
        finish("expired", nowMs);
        return;
      }
      setFrame(prev => ({
        state,
        nowMs,
        flash: prev?.flash ?? null,
        resetAt: outcome === "reset" ? nowMs : prev?.resetAt ?? null,
      }));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, finish]);

  const startGame = () => {
    const nowMs = Date.now();
    // Fewer rows on a short viewport; the row count is fixed for the whole game.
    const rowCount = rowsForViewport(window.innerHeight);
    cellsRef.current = FOCUS_GAME_COLUMNS * rowCount;
    setRows(rowCount);
    endedRef.current = false;
    const game = createFocusGame(durationSeconds, nowMs, Math.random);
    gameRef.current = game;
    setFrame({ state: game, nowMs, flash: null, resetAt: null });
    setPhase("playing");
  };

  const tapCell = (cell: number) => {
    const game = gameRef.current;
    if (!game || endedRef.current) return;
    const nowMs = Date.now();
    const result = tapFocusGameCell(game, cell, nowMs, Math.random, cellsRef.current);
    gameRef.current = result.state;
    if (isFocusGameFinished(result.state, nowMs)) {
      finish("expired", nowMs);
      return;
    }
    setFrame(prev => ({
      state: result.state,
      nowMs,
      flash: flashFor(result.outcome, cell, nowMs) ?? prev?.flash ?? null,
      resetAt: result.outcome === "reset" ? nowMs : prev?.resetAt ?? null,
    }));
  };

  if (phase === "ended") {
    return null;
  }

  if (phase === "setup" || !frame) {
    return (
      <div role="dialog" aria-label="Focus game" style={overlayStyle}>
        <div style={{ fontSize: "28px", fontWeight: 200, color: "var(--fg)" }}>Focus game</div>
        <p style={{ maxWidth: "320px", textAlign: "center", fontSize: "13px", lineHeight: 1.6, color: "var(--fg-3)", margin: 0 }}>
          Keep your eyes on the grid. When a square lights up, tap it within one second, or the countdown starts over.
        </p>
        <div role="radiogroup" aria-label="Duration" style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
          {FOCUS_GAME_DURATIONS_SECONDS.map((seconds) => {
            const selected = seconds === durationSeconds;
            return (
              <button
                key={seconds}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDurationSeconds(seconds)}
                style={pillStyle(selected)}
              >
                {Math.round(seconds / 60)} min
              </button>
            );
          })}
        </div>
        <button type="button" onClick={startGame} style={pillStyle(true)}>
          Start
        </button>
        <button type="button" onClick={() => onEnd(null)} style={{ ...pillStyle(false), marginTop: "var(--s3)" }}>
          Back
        </button>
      </div>
    );
  }

  const { state, nowMs } = frame;
  const remainingSeconds = Math.ceil(focusGameRemainingMs(state, nowMs) / 1000);
  const resetNotice = frame.resetAt !== null && nowMs - frame.resetAt < RESET_NOTICE_MS;
  const cellCount = FOCUS_GAME_COLUMNS * rows;

  return (
    // Scrolls rather than pushing End off-screen on a viewport below the minimum grid.
    <div role="region" aria-label="Focus game in progress" style={{ ...overlayStyle, overflowY: "auto", justifyContent: "safe center" }}>
      <div
        data-testid="focus-game-countdown"
        style={{
          fontSize: "min(96px, 18vw)",
          fontWeight: 200,
          lineHeight: 1,
          color: resetNotice ? "var(--fg-3)" : "var(--fg)",
          fontVariantNumeric: "tabular-nums",
          transition: reducedMotion ? "none" : "color 0.2s ease",
        }}
      >
        {formatFocusCountdown(remainingSeconds)}
      </div>

      <div
        role="status"
        style={{ fontSize: "13px", letterSpacing: "0.08em", color: "var(--fg-3)", minHeight: "20px", textAlign: "center" }}
      >
        {resetNotice
          ? "Missed it. The countdown started over."
          : `${state.hits} hit${state.hits === 1 ? "" : "s"} · streak ${state.streak}`}
      </div>

      <div
        role="group"
        aria-label="Grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${FOCUS_GAME_COLUMNS}, minmax(44px, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(44px, 1fr))`,
          gap: `${FOCUS_GAME_GRID_GAP_PX}px`,
          width: "min(86vw, 300px)",
        }}
      >
        {Array.from({ length: cellCount }, (_, cell) => {
          const lit = state.lit?.cell === cell;
          const flash = frame.flash && frame.flash.cell === cell && nowMs - frame.flash.at < FLASH_MS
            ? frame.flash.kind
            : null;
          return (
            <button
              key={cell}
              type="button"
              aria-label={lit ? "Lit square: tap it" : "Square"}
              aria-pressed={lit}
              onClick={() => tapCell(cell)}
              style={{
                minWidth: "44px",
                minHeight: "44px",
                borderRadius: "10px",
                border: `1px solid ${lit ? "var(--accent-green-text)" : "var(--border-1)"}`,
                background: squareBackground(lit, flash),
                boxShadow: lit && !reducedMotion ? "0 0 18px var(--accent-green-text)" : "none",
                transition: reducedMotion ? "none" : "background 0.12s ease, box-shadow 0.12s ease",
                cursor: "pointer",
                padding: 0,
              }}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => finish("ended", Date.now())}
        aria-label="End focus game"
        style={{ ...pillStyle(false), marginTop: "var(--s3)" }}
      >
        End
      </button>
    </div>
  );
}

/** The colour feedback a tap leaves on the square it touched; null for no feedback. */
function flashFor(outcome: FocusGameOutcome, cell: number, at: number): Frame["flash"] {
  if (outcome === "hit") return { cell, kind: "hit", at };
  if (outcome === "wrong") return { cell, kind: "wrong", at };
  return null;
}

function squareBackground(lit: boolean, flash: "hit" | "wrong" | null): string {
  if (flash === "hit") return "var(--accent-green-text)";
  if (flash === "wrong") return "var(--surface-2)";
  if (lit) return "var(--accent-green-text)";
  return "var(--surface-1)";
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgb(var(--bg-rgb))",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--s4)",
  fontFamily: "var(--font-mono)",
  padding: "var(--s4)",
  userSelect: "none",
  WebkitUserSelect: "none",
} as const;

function pillStyle(selected: boolean) {
  return {
    background: selected ? "var(--surface-2)" : "var(--surface-1)",
    border: `1px solid ${selected ? "var(--border-2)" : "var(--border-1)"}`,
    color: selected ? "var(--fg)" : "var(--fg-3)",
    borderRadius: "999px",
    padding: "10px 22px",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    letterSpacing: "0.08em",
    cursor: "pointer",
  } as const;
}
