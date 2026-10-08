import {
  cueModeOf,
  type CueMode,
  type HapticInterval,
  type SoundPrefs,
} from "@/lib/audio";

const OPTIONS: { mode: CueMode; label: string }[] = [
  { mode: "tick", label: "tick" },
  { mode: "haptic", label: "haptic" },
  { mode: "voice", label: "voice" },
];

/**
 * Three-way cue picker. Tick, haptic, and voice are one choice; the selected
 * segment is the only one of those three that stays on.
 */
export function CueModeControl({
  prefs,
  onChange,
  testId,
  onlyYou = false,
}: {
  prefs: SoundPrefs;
  onChange: (mode: CueMode) => void;
  testId: string;
  onlyYou?: boolean;
}) {
  const selected = cueModeOf(prefs);
  return (
    <div
      role="radiogroup"
      aria-label={onlyYou ? "Cue mode, only on this device" : "Cue mode"}
      data-testid={testId}
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-1)",
        borderRadius: "22px",
        overflow: "hidden",
        minHeight: "44px",
      }}
    >
      {OPTIONS.map((opt, index) => {
        const isSelected = selected === opt.mode;
        const feel = opt.mode === "haptic" ? "feel" : "hear";
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            data-testid={`${testId}.${opt.label}`}
            onClick={() => onChange(opt.mode)}
            onKeyDown={(event) => {
              const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
              const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
              if (!forward && !backward) return;
              event.preventDefault();
              const next = forward
                ? (index + 1) % OPTIONS.length
                : (index - 1 + OPTIONS.length) % OPTIONS.length;
              onChange(OPTIONS[next].mode);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]',
              );
              buttons?.[next]?.focus();
            }}
            title={
              onlyYou
                ? `Only you ${feel} this — does not change the sit for others`
                : undefined
            }
            style={{
              background: isSelected ? "var(--surface-3)" : "transparent",
              border: "none",
              borderRight: opt.mode === "voice" ? "none" : "1px solid var(--border-1)",
              cursor: "pointer",
              color: isSelected ? "var(--fg-2)" : "var(--fg-4)",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "0.06em",
              padding: "0 12px",
              minHeight: "44px",
              minWidth: "44px",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const INTERVALS: { value: HapticInterval; label: string }[] = [
  { value: "minute", label: "Every minute" },
  { value: "tenSeconds", label: "Every 10 sec" },
];

/** Two-way haptic spacing. Shown while haptic mode is the active cue. */
export function HapticIntervalControl({
  value,
  onChange,
  testId,
}: {
  value: HapticInterval;
  onChange: (interval: HapticInterval) => void;
  testId: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Haptic interval"
      data-testid={testId}
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-1)",
        borderRadius: "22px",
        overflow: "hidden",
        minHeight: "44px",
      }}
    >
      {INTERVALS.map((opt, index) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            data-testid={`${testId}.${opt.value}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(event) => {
              const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
              const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
              if (!forward && !backward) return;
              event.preventDefault();
              const next = forward
                ? (index + 1) % INTERVALS.length
                : (index - 1 + INTERVALS.length) % INTERVALS.length;
              onChange(INTERVALS[next].value);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]',
              );
              buttons?.[next]?.focus();
            }}
            style={{
              background: isSelected ? "var(--surface-3)" : "transparent",
              border: "none",
              cursor: "pointer",
              color: isSelected ? "var(--fg-2)" : "var(--fg-4)",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "0.06em",
              padding: "0 12px",
              minHeight: "44px",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
