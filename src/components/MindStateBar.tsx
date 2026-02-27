"use client";

type MindStateBarProps = {
  elapsed: number;
  totalSeconds: number;
  mindStateLog: Array<{ time: number; state: string }>;
  currentState: string;
};

export function MindStateBar({ elapsed, totalSeconds, mindStateLog, currentState }: MindStateBarProps) {
  if (elapsed <= 0) return null;

  const barWidth = "min(460px, calc(100vw - 40px))";
  const segments: Array<{ start: number; end: number; state: string }> = [];
  let lastTime = 0;
  let lastState = "clear";

  const fullLog = [...mindStateLog];
  if (elapsed < totalSeconds) {
    fullLog.push({ time: elapsed, state: currentState });
  } else {
    fullLog.push({ time: totalSeconds, state: lastState });
  }

  for (const entry of fullLog) {
    if (entry.time > lastTime) {
      segments.push({
        start: lastTime / totalSeconds,
        end: entry.time / totalSeconds,
        state: lastState,
      });
    }
    lastTime = entry.time;
    lastState = entry.state;
  }

  return (
    <div style={{ width: barWidth, margin: "0 auto" }}>
      <div style={{
        height: "8px", borderRadius: "4px", overflow: "hidden",
        display: "flex", background: "var(--surface-2)",
      }}>
        {segments.map((seg, i) => (
          <div key={i} style={{
            width: `${(seg.end - seg.start) * 100}%`, height: "100%",
            background: seg.state === "clear"
              ? "linear-gradient(to right, var(--accent-green), var(--accent-green-end))"
              : "linear-gradient(to right, var(--accent-amber), var(--accent-amber-end))",
            opacity: 0.7,
          }} />
        ))}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", marginTop: "6px",
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        fontSize: "11px", color: "var(--fg-4)",
      }}>
        <span>0s</span>
        <span>{totalSeconds}s</span>
      </div>
    </div>
  );
}
