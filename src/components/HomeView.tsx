"use client";

import { BASE_DURATION, INCREMENT, BLOCK_DURATION } from "@/lib/constants";

type HomeViewProps = {
  currentDay: number;
  onBegin: () => void;
};

export function HomeView({ currentDay, onBegin }: HomeViewProps) {
  const todayDuration = BASE_DURATION + (currentDay - 1) * INCREMENT;
  const totalBlocks = Math.ceil(todayDuration / BLOCK_DURATION);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: "48px", animation: "fadeIn 0.6s ease",
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          fontSize: "42px", fontWeight: 300, margin: 0,
          letterSpacing: "-1px", fontStyle: "italic",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        }}>
          Still Point
        </h1>
        <p style={{
          fontSize: "13px", color: "rgba(232,228,222,0.35)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          letterSpacing: "3px", textTransform: "uppercase", marginTop: "12px",
        }}>
          attention training
        </p>
      </div>

      <div style={{ textAlign: "center", animation: "breathe 4s ease-in-out infinite" }}>
        <div style={{
          fontSize: "120px", fontWeight: 200,
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          lineHeight: 1, color: "rgba(232,228,222,0.15)",
        }}>
          {currentDay}
        </div>
        <div style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px", color: "rgba(232,228,222,0.3)",
          letterSpacing: "3px", textTransform: "uppercase", marginTop: "8px",
        }}>
          day &middot; {todayDuration}s &middot; {totalBlocks} blocks
        </div>
      </div>

      <button
        onClick={onBegin}
        style={{
          background: "none",
          border: "1px solid rgba(232,228,222,0.15)",
          color: "#e8e4de",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "16px", fontStyle: "italic",
          padding: "16px 48px", borderRadius: "40px",
          cursor: "pointer", transition: "all 0.3s", letterSpacing: "1px",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = "rgba(232,228,222,0.4)";
          e.currentTarget.style.background = "rgba(232,228,222,0.05)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = "rgba(232,228,222,0.15)";
          e.currentTarget.style.background = "none";
        }}
      >
        Begin
      </button>
    </div>
  );
}
