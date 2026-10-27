"use client";

import { useRef } from "react";
import { MOOD_MATRIX_GRID_PX, MoodMatrix, type MoodMatrixValue } from "@/components/MoodMatrix";
import { useElementWidth } from "@/lib/useElementWidth";
import { SaveStatus, type SaveStatusState } from "./SaveStatus";

type SessionNoteFieldProps = {
  note: string;
  onChange: (next: string) => void;
  disabled: boolean;
  status: SaveStatusState;
};

/** Session note — saved as the user types (#753). */
export function SessionNoteField({ note, onChange, disabled, status }: SessionNoteFieldProps) {
  return (
    <div style={{
      width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
    }}>
      <textarea
        value={note}
        onChange={(e) => onChange(e.target.value)}
        placeholder="end-of-session note..."
        rows={3}
        maxLength={1000}
        aria-label="end-of-session note"
        disabled={disabled}
        style={{
          width: "100%",
          background: "var(--surface-1)",
          border: "1px solid var(--border-1)",
          borderRadius: "10px",
          color: "var(--fg)",
          fontFamily: "var(--font-serif)",
          fontSize: "14px", fontStyle: "italic",
          padding: "12px 16px",
          resize: "vertical",
          outline: "none",
        }}
      />
      <SaveStatus status={status} savedLabel="note saved" />
    </div>
  );
}

type MoodShiftSectionProps = {
  value: MoodMatrixValue;
  onChange: (next: MoodMatrixValue) => void;
  disabled: boolean;
  compact: boolean;
  status: SaveStatusState;
};

/** Mood matrix (#472). */
export function MoodShiftSection({ value, onChange, disabled, compact, status }: MoodShiftSectionProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const wrapperWidth = useElementWidth(wrapperRef);
  // #911: the side-by-side grid is wider than a phone; stack it there.
  // #964: at 44px boxes the grid needs 544px, which a window just above the
  // compact breakpoint may not have, so it also stacks whenever the measured
  // column is narrower than the grid.
  const stacked = compact || (wrapperWidth !== null && wrapperWidth < MOOD_MATRIX_GRID_PX);
  return (
    <div ref={wrapperRef} style={{
      width: "100%", maxWidth: `min(${MOOD_MATRIX_GRID_PX}px, calc(100vw - 40px))`,
      display: "flex", flexDirection: "column", alignItems: "center", gap: "14px",
    }}>
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px", color: "var(--fg-3)",
        letterSpacing: "0.12em", textTransform: "uppercase",
        alignSelf: "flex-start",
      }}>
        Mood Shift
      </div>

      <MoodMatrix
        value={value}
        onChange={onChange}
        disabled={disabled}
        layout={stacked ? "stacked" : "grid"}
      />
      <SaveStatus status={status} savedLabel="mood saved" />
    </div>
  );
}
