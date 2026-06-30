"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type FlashHintProps = {
  children: ReactNode;
  /** How long the hint stays fully visible before it begins to fade (ms). */
  delayMs?: number;
  /** Fade-out duration (ms). */
  fadeMs?: number;
  /** Wrapper style applied while the hint is mounted. */
  style?: CSSProperties;
};

/**
 * Shows instructional/explanatory copy briefly on mount, then fades it out and
 * unmounts so it stops consuming vertical space during a session (#473 P5).
 * Honors `prefers-reduced-motion` by skipping the fade transition.
 */
export function FlashHint({ children, delayMs = 5000, fadeMs = 700, style }: FlashHintProps) {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setPhase("fading"), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("gone"), reduceMotion.current ? 0 : fadeMs);
    return () => clearTimeout(t);
  }, [phase, fadeMs]);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden={phase === "fading"}
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: reduceMotion.current ? undefined : `opacity ${fadeMs}ms ease`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
