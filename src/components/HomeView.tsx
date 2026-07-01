"use client";

import { BLOCK_DURATION, QUICK_DURATION, durationForDay } from "@/lib/constants";
import { Pathway } from "@/components/Pathway";
import { aphorismForDay } from "@/lib/aphorisms";

type HomeViewProps = {
  currentDay: number;
  /** #88: opt-in pre-session inspiration quote. */
  aphorismsEnabled?: boolean;
  onBegin: () => void;
  onQuickBegin: () => void;
  onBreath?: () => void;
  onBuddy?: () => void;
};

export function HomeView({
  currentDay,
  aphorismsEnabled,
  onBegin,
  onQuickBegin,
  onBreath,
  onBuddy,
}: HomeViewProps) {
  const todayDuration = durationForDay(currentDay);
  const totalBlocks = Math.ceil(todayDuration / BLOCK_DURATION);
  const aphorism = aphorismsEnabled ? aphorismForDay(currentDay) : null;

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

      {/* Block B2: Lesson pathway (#336) */}
      <Pathway currentDay={currentDay} />

      {/* Block B3: pre-session aphorism, opt-in (#88) */}
      {aphorism && (
        <div style={{
          textAlign: "center",
          maxWidth: "min(360px, calc(100vw - 40px))",
          padding: "0 var(--s2)",
        }}>
          <p style={{
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "15px", fontStyle: "italic", fontWeight: 300,
            color: "var(--fg-2)", margin: 0, lineHeight: 1.5,
          }}>
            &ldquo;{aphorism.text}&rdquo;
          </p>
          <p style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px", color: "var(--fg-4)",
            letterSpacing: "0.1em", textTransform: "uppercase",
            marginTop: "var(--s2)",
          }}>
            &mdash; {aphorism.author}
          </p>
        </div>
      )}

      {/* Block C: CTA */}
      <button
        type="button"
        onClick={onBegin}
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "17px", fontStyle: "italic",
          padding: "16px 52px", borderRadius: "40px",
          cursor: "pointer", transition: "all 0.3s", letterSpacing: "0.04em",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = "var(--border-3)";
          e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = "var(--border-2)";
          e.currentTarget.style.background = "var(--surface-1)";
        }}
        onFocus={e => {
          if (e.currentTarget.matches(":focus-visible")) {
            e.currentTarget.style.outline = "2px solid var(--border-3)";
            e.currentTarget.style.outlineOffset = "3px";
          }
        }}
        onBlur={e => {
          e.currentTarget.style.outline = "none";
        }}
      >
        Begin
      </button>

      <button
        type="button"
        onClick={onQuickBegin}
        style={{
          background: "transparent",
          border: "1px solid var(--accent-green-border)",
          color: "var(--accent-green-text)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "12px 24px",
          borderRadius: "40px",
          cursor: "pointer",
        }}
      >
        Quick minute &middot; {QUICK_DURATION}s
      </button>

      {onBreath && (
        <button
          type="button"
          onClick={onBreath}
          style={{
            background: "transparent",
            border: "1px solid var(--border-2)",
            color: "var(--fg-2)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 24px",
            borderRadius: "40px",
            cursor: "pointer",
          }}
        >
          Breath counting
        </button>
      )}

      {onBuddy && (
        <button
          type="button"
          onClick={onBuddy}
          style={{
            background: "transparent",
            border: "1px solid var(--border-2)",
            color: "var(--fg-2)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 24px",
            borderRadius: "40px",
            cursor: "pointer",
          }}
        >
          Meditate with a friend
        </button>
      )}

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
            fontSize: "12px", color: "var(--fg-3)",
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
