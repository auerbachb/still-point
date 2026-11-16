"use client";

import { useEffect, useState } from "react";
import { sandProgress } from "@/lib/sandProgress";

type SandCarrierProps = {
  elapsed: number;
  totalSeconds: number;
};

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 110;
const GROUND_Y = 96;
const PILE_MAX_HEIGHT = 56;
const PILE_WIDTH = 96;
const SOURCE_CENTER_X = 60;
const DESTINATION_CENTER_X = 260;
const ROUTE_START_X = 92;
const ROUTE_END_X = 228;
const BOB_HEIGHT = 2;

/**
 * #662: the sit as a small character carrying sand from a source pile to a
 * destination pile. Motion is derived from `elapsed` on each render (the
 * 50ms clock in BlockTimer), so there is no animation loop to keep running
 * while the sit is paused and no replay after a backgrounded tab resumes.
 *
 * With `prefers-reduced-motion`, the piles still show the correct sizes, while
 * the carrier stays static at the middle of the route with no walk bob.
 *
 * Decorative: the caller provides the accessible remaining-time label.
 */
export function SandCarrier({ elapsed, totalSeconds }: SandCarrierProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const state = sandProgress(elapsed, totalSeconds);
  const carrierPosition = reducedMotion ? 0.5 : state.carrierPosition;
  const carrying = reducedMotion ? false : state.carrying;
  const bob = carrying && !reducedMotion
    ? Math.abs(Math.sin(state.walkPhase * Math.PI)) * BOB_HEIGHT
    : 0;

  const sourceHeight = state.sourceFraction * PILE_MAX_HEIGHT;
  const destinationHeight = state.destinationFraction * PILE_MAX_HEIGHT;
  const carrierX = ROUTE_START_X + carrierPosition * (ROUTE_END_X - ROUTE_START_X);
  const headY = GROUND_Y - 30 - bob;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width="100%"
      height={VIEW_HEIGHT}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", maxWidth: "min(320px, 100%)", margin: "0 auto", overflow: "visible" }}
    >
      <line
        x1={0}
        y1={GROUND_Y}
        x2={VIEW_WIDTH}
        y2={GROUND_Y}
        stroke="var(--border-2)"
        strokeWidth={1}
      />
      <rect
        x={SOURCE_CENTER_X - PILE_WIDTH / 2}
        y={GROUND_Y - sourceHeight}
        width={PILE_WIDTH}
        height={sourceHeight}
        rx={8}
        fill="var(--accent-amber)"
        opacity={0.6}
      />
      <rect
        x={DESTINATION_CENTER_X - PILE_WIDTH / 2}
        y={GROUND_Y - destinationHeight}
        width={PILE_WIDTH}
        height={destinationHeight}
        rx={8}
        fill="var(--accent-green)"
        opacity={0.6}
      />
      <g transform={`translate(${carrierX} 0)`}>
        {carrying && (
          <rect x={-6} y={headY - 14} width={12} height={6} rx={2} fill="var(--accent-amber)" opacity={0.8} />
        )}
        <circle cx={0} cy={headY} r={5} fill="var(--fg-2)" />
        <rect x={-5} y={headY + 6} width={10} height={16} rx={4} fill="var(--fg-3)" />
      </g>
    </svg>
  );
}
