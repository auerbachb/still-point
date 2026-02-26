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
      gap: "var(--s5)", animation: "fadeIn 0.6s ease",
      width: "100%",
    }}>
      {/* Block A: Brand lockup */}
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          fontSize: "42px", fontWeight: 300, margin: 0,
          letterSpacing: "-0.02em", fontStyle: "italic",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        }}>
          Still Point
        </h1>
        <p style={{
          fontSize: "13px", color: "var(--fg-2)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          letterSpacing: "0.15em", textTransform: "uppercase",
          marginTop: "var(--s1)",
        }}>
          attention training
        </p>
      </div>

      {/* Block B: Session data */}
      <div style={{
        textAlign: "center", animation: "breathe 4s ease-in-out infinite",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "var(--s1)",
      }}>
        <div style={{
          fontSize: "min(120px, 20vw)", fontWeight: 200,
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          lineHeight: 1, color: "var(--fg-4)",
        }}>
          {currentDay}
        </div>
        <div style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "12px", color: "var(--fg-2)",
          letterSpacing: "0.15em", textTransform: "uppercase",
        }}>
          day &middot; {todayDuration}s &middot; {totalBlocks} blocks
        </div>
      </div>

      {/* Block C: CTA */}
      <button
        type="button"
        onClick={onBegin}
        style={{
          background: "rgba(232, 228, 222, 0.04)",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "17px", fontStyle: "italic",
          padding: "16px 52px", borderRadius: "40px",
          cursor: "pointer", transition: "all 0.3s", letterSpacing: "0.04em",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = "rgba(232, 228, 222, 0.35)";
          e.currentTarget.style.background = "rgba(232, 228, 222, 0.08)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = "var(--border-2)";
          e.currentTarget.style.background = "rgba(232, 228, 222, 0.04)";
        }}
        onFocus={e => {
          if (e.currentTarget.matches(":focus-visible")) {
            e.currentTarget.style.outline = "2px solid rgba(232, 228, 222, 0.35)";
            e.currentTarget.style.outlineOffset = "3px";
          }
        }}
        onBlur={e => {
          e.currentTarget.style.outline = "none";
        }}
      >
        Begin
      </button>

      {/* Block D: FAQ */}
      <div style={{
        marginTop: "var(--s3)", maxWidth: "min(420px, calc(100vw - 40px))", width: "100%",
      }}>
        <div style={{
          borderTop: "1px solid var(--border-1)",
          paddingTop: "var(--s4)",
        }}>
          <div style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px", color: "var(--fg-3)",
            letterSpacing: "0.15em", textTransform: "uppercase",
            marginBottom: "var(--s3)",
            textAlign: "center",
          }}>
            FAQ
          </div>
          <div style={{ padding: "0 var(--s1)" }}>
            <p style={{
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "14px", fontStyle: "italic",
              color: "var(--fg-2)", margin: "0 0 var(--s1)",
              lineHeight: 1.6, textAlign: "left",
            }}>
              &ldquo;This app is incredibly boring, what&rsquo;s the point of it?&rdquo;
            </p>
            <p style={{
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "14px",
              color: "var(--fg)", margin: 0,
              lineHeight: 1.6, textAlign: "left",
            }}>
              That is the point.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
