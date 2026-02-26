"use client";

type MindStateBarProps = {
  elapsed: number;
  totalSeconds: number;
  mindStateLog: Array<{ time: number; state: string }>;
  currentState: string;
};

export function MindStateBar({ elapsed, totalSeconds, mindStateLog, currentState }: MindStateBarProps) {
  if (elapsed <= 0) return null;

  const barWidth = 460;
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
    <div style={{ width: `${barWidth}px`, margin: "0 auto" }}>
      <div style={{
        height: "8px", borderRadius: "4px", overflow: "hidden",
        display: "flex", background: "rgba(232,228,222,0.06)",
      }}>
        {segments.map((seg, i) => (
          <div key={i} style={{
            width: `${(seg.end - seg.start) * 100}%`, height: "100%",
            background: seg.state === "clear"
              ? "linear-gradient(to right, #4ade80, #22c55e)"
              : "linear-gradient(to right, #fbbf24, #f59e0b)",
            opacity: 0.7,
          }} />
        ))}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", marginTop: "6px",
        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
        fontSize: "10px", color: "rgba(232,228,222,0.25)",
      }}>
        <span>0s</span>
        <span>{totalSeconds}s</span>
      </div>
    </div>
  );
}
