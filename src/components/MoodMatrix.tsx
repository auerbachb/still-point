"use client";

/**
 * #472: before/after mood matrix for the completion recap screen.
 *
 * One row per `MOOD_KEYS` entry (Calm, Focus, Energy, Anxiety, Happiness,
 * Overall) × two columns (Before | After) × five tap boxes (1 low → 5 high).
 *
 * Captured retrospectively: the user fills both columns at session end with
 * no pre-session friction. Data is persisted via the sessions PATCH endpoint
 * as `moodMatrix` (JSONB, 1–5 per cell).
 *
 * #911: the side-by-side grid is wider than a phone, so the recap's compact
 * (mobile) layout stacks BEFORE above AFTER under each mood instead. Both
 * layouts render the same cells and send the same values; only the
 * arrangement differs.
 *
 * Pure helpers (isMoodMatrixTouched, buildMoodMatrixPayload, MOOD_KEYS, etc.)
 * live in @/lib/moodMatrix so vitest (node mode, jsx:preserve) can test them
 * without a JSX transform. They are re-exported here for convenience.
 */

import { Fragment, type CSSProperties } from "react";
import {
  MOOD_KEYS,
  MOOD_LABELS,
  type MoodKey,
  type MoodEntry,
  type MoodMatrixValue,
} from "@/lib/moodMatrix";

// Re-export pure helpers so callers import from one place.
export {
  MOOD_KEYS,
  MOOD_LABELS,
  isMoodMatrixTouched,
  buildMoodMatrixPayload,
  buildMoodMatrixPatch,
  type MoodKey,
  type MoodEntry,
  type MoodMatrixValue,
} from "@/lib/moodMatrix";

// #885: the column-header, scale-hint and mood-row grids share one label
// column so they stay aligned. 68px leaves 66px of text after the right
// padding; HAPPINESS measures 63–65px at the label style below. The 3px box gap
// pays for the wider column, so the grid's minimum width is still 384px:
// 68 + 2 × 6 gap + 2 × (5 × 28 + 4 × 3).
const LABEL_COLUMN_PX = 68;
const LABEL_PADDING_PX = 2;
const COLUMN_GAP_PX = 6;
const BOX_PX = 28;
const BOX_GAP_PX = 3;
const GRID_COLUMNS = `${LABEL_COLUMN_PX}px 1fr 1fr`;
// #911: one mood's five boxes. The column headers, the low/high hints and the
// box groups all take this width, so they line up in both layouts.
const SCALE_PX = 5 * BOX_PX + 4 * BOX_GAP_PX;
// #911: a stacked row is a phase label and one scale, 52 + 6 + 152 = 210px,
// which fits the 280px the recap has at a 320px viewport. BEFORE measures
// about 45px at the phase-label style.
const PHASE_COLUMN_PX = 52;
const STACKED_COLUMNS = `${PHASE_COLUMN_PX}px ${SCALE_PX}px`;

/** #911: `grid` puts BEFORE and AFTER side by side (384px minimum); `stacked`
 *  puts them one above the other (210px), for narrow screens. */
export type MoodMatrixLayout = "grid" | "stacked";

type MoodSide = "before" | "after";

const SIDES: readonly MoodSide[] = ["before", "after"];
const SIDE_LABELS: Record<MoodSide, string> = { before: "Before", after: "After" };

const MOOD_LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--fg-3)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

/** The BEFORE/AFTER column headers, and the stacked layout's phase labels. */
const SIDE_LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "10px",
  color: "var(--fg-4)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

type MoodBoxProps = {
  level: number; // 1–5
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
};

function MoodBox({ level, selected, disabled, onClick, ariaLabel }: MoodBoxProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={selected}
      style={{
        width: `${BOX_PX}px`,
        height: `${BOX_PX}px`,
        borderRadius: "5px",
        border: selected
          ? "1px solid var(--accent-green-border)"
          : "1px solid var(--border-1)",
        background: selected
          ? `rgba(74, 222, 128, ${0.08 + level * 0.07})`
          : "var(--surface-1)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 0.12s, border-color 0.12s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        minWidth: 0,
        padding: 0,
      }}
    >
      {selected && (
        <div
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "2px",
            background: `rgba(74, 222, 128, ${0.4 + level * 0.12})`,
          }}
        />
      )}
    </button>
  );
}

type MoodScaleProps = {
  moodKey: MoodKey;
  side: MoodSide;
  entry: MoodEntry;
  disabled: boolean;
  onChange: (key: MoodKey, entry: MoodEntry) => void;
};

/** One mood's five boxes for one side. Tapping the selected box clears it. */
function MoodScale({ moodKey, side, entry, disabled, onChange }: MoodScaleProps) {
  const label = MOOD_LABELS[moodKey];

  return (
    <div
      data-testid={`mood-matrix-scale-${moodKey}-${side}`}
      style={{
        display: "flex",
        gap: `${BOX_GAP_PX}px`,
        width: `${SCALE_PX}px`,
        justifySelf: "center",
      }}
    >
      {([1, 2, 3, 4, 5] as const).map((level) => (
        <MoodBox
          key={level}
          level={level}
          selected={entry[side] === level}
          disabled={disabled}
          onClick={() => {
            const next = entry[side] === level ? null : level;
            onChange(moodKey, side === "before" ? { ...entry, before: next } : { ...entry, after: next });
          }}
          ariaLabel={`${label} ${side}: ${level}`}
        />
      ))}
    </div>
  );
}

/** Low/high ends of the scale, as wide as a box group so each end sits over
 *  the first or the fifth box. */
function ScaleHint({ testId }: { testId: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        justifyContent: "space-between",
        width: `${SCALE_PX}px`,
        justifySelf: "center",
        paddingInline: "2px",
        fontFamily: "var(--font-mono)",
        fontSize: "9px",
        color: "var(--fg-4)",
        letterSpacing: "0.05em",
      }}
    >
      <span>low</span>
      <span>high</span>
    </div>
  );
}

type MoodRowProps = {
  moodKey: MoodKey;
  entry: MoodEntry;
  disabled: boolean;
  onChange: (key: MoodKey, entry: MoodEntry) => void;
};

function MoodRow({ moodKey, entry, disabled, onChange }: MoodRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
        gap: `${COLUMN_GAP_PX}px`,
        alignItems: "center",
      }}
    >
      {/* Mood label */}
      <div
        style={{
          ...MOOD_LABEL_STYLE,
          textAlign: "right",
          paddingRight: `${LABEL_PADDING_PX}px`,
        }}
      >
        {MOOD_LABELS[moodKey]}
      </div>

      {SIDES.map((side) => (
        <MoodScale
          key={side}
          moodKey={moodKey}
          side={side}
          entry={entry}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

/** #911: one mood in the stacked layout: its label on a line of its own, then
 *  a BEFORE row and an AFTER row. */
function StackedMoodBlock({ moodKey, entry, disabled, onChange }: MoodRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: STACKED_COLUMNS,
        columnGap: `${COLUMN_GAP_PX}px`,
        rowGap: "4px",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ ...MOOD_LABEL_STYLE, gridColumn: "1 / -1" }}>
        {MOOD_LABELS[moodKey]}
      </div>

      {SIDES.map((side) => (
        <Fragment key={side}>
          <div
            data-testid={`mood-matrix-phase-${moodKey}-${side}`}
            style={{ ...SIDE_LABEL_STYLE, textAlign: "right" }}
          >
            {SIDE_LABELS[side]}
          </div>
          <MoodScale
            moodKey={moodKey}
            side={side}
            entry={entry}
            disabled={disabled}
            onChange={onChange}
          />
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

type MoodMatrixProps = {
  value: MoodMatrixValue;
  onChange: (value: MoodMatrixValue) => void;
  disabled?: boolean;
  /** #911: `stacked` on narrow screens, where the side-by-side grid does not fit. */
  layout?: MoodMatrixLayout;
};

/** Renders the full before/after mood matrix with column headers. */
export function MoodMatrix({ value, onChange, disabled = false, layout = "grid" }: MoodMatrixProps) {
  function handleRowChange(key: MoodKey, entry: MoodEntry) {
    onChange({ ...value, [key]: entry });
  }

  if (layout === "stacked") {
    return (
      <div data-testid="mood-matrix" data-layout="stacked" style={{ width: "100%" }}>
        {/* Scale hint: low → high, over the scale column of every row below */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: STACKED_COLUMNS,
            columnGap: `${COLUMN_GAP_PX}px`,
            justifyContent: "center",
            marginBottom: "10px",
          }}
        >
          <div />
          <ScaleHint testId="mood-matrix-hint" />
        </div>

        {/* Mood blocks */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {MOOD_KEYS.map((key) => (
            <StackedMoodBlock
              key={key}
              moodKey={key}
              entry={value[key] ?? { before: null, after: null }}
              disabled={disabled}
              onChange={handleRowChange}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="mood-matrix" data-layout="grid" style={{ width: "100%" }}>
      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLUMNS,
          gap: `${COLUMN_GAP_PX}px`,
          marginBottom: "8px",
        }}
      >
        <div />
        {SIDES.map((side) => (
          <div
            key={side}
            data-testid={`mood-matrix-header-${side}`}
            style={{
              ...SIDE_LABEL_STYLE,
              width: `${SCALE_PX}px`,
              justifySelf: "center",
              textAlign: "center",
            }}
          >
            {SIDE_LABELS[side]}
          </div>
        ))}
      </div>

      {/* Scale hint: low → high */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLUMNS,
          gap: `${COLUMN_GAP_PX}px`,
          marginBottom: "10px",
        }}
      >
        <div />
        {SIDES.map((side) => (
          <ScaleHint key={side} testId={`mood-matrix-hint-${side}`} />
        ))}
      </div>

      {/* Mood rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {MOOD_KEYS.map((key) => (
          <MoodRow
            key={key}
            moodKey={key}
            entry={value[key] ?? { before: null, after: null }}
            disabled={disabled}
            onChange={handleRowChange}
          />
        ))}
      </div>
    </div>
  );
}
