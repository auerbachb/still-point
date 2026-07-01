"use client";

type RatingSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
};

/** #109: reusable 1-10 self-report slider (native range input) shared by the
 *  post-session focus/happiness prompts in CompletionScreen. */
export function RatingSlider({
  label,
  value,
  onChange,
  min = 1,
  max = 10,
  disabled = false,
}: RatingSliderProps) {
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
      }}>
        <span style={{
          fontSize: "11px", color: "var(--fg-3)",
          letterSpacing: "0.12em", textTransform: "uppercase",
        }}>
          {label}
        </span>
        <span style={{ fontSize: "13px", color: "var(--accent-green-text)" }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        style={{
          width: "100%",
          accentColor: "var(--accent-green)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </div>
  );
}
