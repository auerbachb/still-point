"use client";

/**
 * #472: before/after mood matrix for the completion recap screen.
 *
 * Five mood rows (Calm, Focus, Energy, Anxiety, Overall) × two columns
 * (Before | After) × five tap boxes (1 low → 5 high).
 *
 * Captured retrospectively: the user fills both columns at session end with
 * no pre-session friction. Data is persisted via the sessions PATCH endpoint
 * as `moodMatrix` (JSONB, 1–5 per cell).
 *
 * Pure helpers (isMoodMatrixTouched, buildMoodMatrixPayload, MOOD_KEYS, etc.)
 * live in @/lib/moodMatrix so vitest (node mode, jsx:preserve) can test them
 * without a JSX transform. They are re-exported here for convenience.
 */

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
  type MoodKey,
  type MoodEntry,
  type MoodMatrixValue,
} from "@/lib/moodMatrix";

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
        width: "28px",
        height: "28px",
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

type MoodRowProps = {
  moodKey: MoodKey;
  entry: MoodEntry;
  disabled: boolean;
  onChange: (key: MoodKey, entry: MoodEntry) => void;
};

function MoodRow({ moodKey, entry, disabled, onChange }: MoodRowProps) {
  const label = MOOD_LABELS[moodKey];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "60px 1fr 1fr",
        gap: "6px",
        alignItems: "center",
      }}
    >
      {/* Mood label */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--fg-3)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          textAlign: "right",
          paddingRight: "8px",
        }}
      >
        {label}
      </div>

      {/* Before boxes */}
      <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
        {([1, 2, 3, 4, 5] as const).map((level) => (
          <MoodBox
            key={level}
            level={level}
            selected={entry.before === level}
            disabled={disabled}
            onClick={() =>
              onChange(moodKey, {
                ...entry,
                before: entry.before === level ? null : level,
              })
            }
            ariaLabel={`${label} before: ${level}`}
          />
        ))}
      </div>

      {/* After boxes */}
      <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
        {([1, 2, 3, 4, 5] as const).map((level) => (
          <MoodBox
            key={level}
            level={level}
            selected={entry.after === level}
            disabled={disabled}
            onClick={() =>
              onChange(moodKey, {
                ...entry,
                after: entry.after === level ? null : level,
              })
            }
            ariaLabel={`${label} after: ${level}`}
          />
        ))}
      </div>
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
};

/** Renders the full before/after mood matrix with column headers. */
export function MoodMatrix({ value, onChange, disabled = false }: MoodMatrixProps) {
  function handleRowChange(key: MoodKey, entry: MoodEntry) {
    onChange({ ...value, [key]: entry });
  }

  return (
    <div style={{ width: "100%" }}>
      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 1fr",
          gap: "6px",
          marginBottom: "8px",
        }}
      >
        <div />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--fg-4)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          Before
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--fg-4)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          After
        </div>
      </div>

      {/* Scale hint: low → high */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 1fr",
          gap: "6px",
          marginBottom: "10px",
        }}
      >
        <div />
        {([0, 1] as const).map((col) => (
          <div
            key={col}
            style={{
              display: "flex",
              justifyContent: "space-between",
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
