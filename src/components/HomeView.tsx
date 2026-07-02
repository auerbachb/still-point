"use client";

import { BLOCK_DURATION, MAX_DURATION, QUICK_DURATION } from "@/lib/constants";
import { activeRecovery, sessionDurationForUser, type ActiveRecovery, type RecoveryFields } from "@/lib/duration";
import { Pathway } from "@/components/Pathway";
import { DualTrackFork } from "@/components/DualTrackFork";
import { aphorismForDay } from "@/lib/aphorisms";

type HomeViewProps = {
  currentDay: number;
  /** #88: opt-in pre-session inspiration quote. */
  aphorismsEnabled?: boolean;
  recovery?: RecoveryFields;
  /** #240: dual-track fork state. */
  dualTrackEnabled?: boolean;
  secondTrackDay?: number;
  /** True once the primary track has passed the 10-minute mark (fork available). */
  dualTrackEligible?: boolean;
  /** Per-track "completed a standard sit today" — drives the completion badges. */
  primaryDoneToday?: boolean;
  secondDoneToday?: boolean;
  onBegin: () => void;
  /** #240: start the second track's sit (only used when dual-track is enabled). */
  onBeginSecond?: () => void;
  /** #240: opt into the second track from the fork card. */
  onEnableDualTrack?: () => Promise<void>;
  /** #240: dismiss the fork card for now (stay single-track). */
  onDismissFork?: () => void;
  onQuickBegin: () => void;
  onBreath?: () => void;
  onBuddy?: () => void;
};

const NO_RECOVERY: RecoveryFields = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

const MAX_MINUTES = Math.round(MAX_DURATION / 60);

/** One track's Home card (#240): day number, planned length, completion badge and
 *  its own Begin button so either track can be started independently. */
function TrackCard({
  label,
  day,
  duration,
  doneToday,
  recovery,
  onBegin,
}: {
  label: string;
  day: number;
  duration: number;
  doneToday: boolean;
  recovery: ActiveRecovery | null;
  onBegin: () => void;
}) {
  const blocks = Math.ceil(duration / BLOCK_DURATION);
  return (
    <div
      style={{
        width: "100%",
        border: "1px solid var(--border-2)",
        borderRadius: "16px",
        padding: "var(--s4) var(--s3)",
        background: "var(--surface-1)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--s2)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s2)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "11px",
          color: "var(--fg-3)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        <span>{label}</span>
        {doneToday && (
          <span
            style={{ color: "var(--accent-green-text)" }}
            aria-label="completed today"
          >
            &#10003; done today
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: "min(72px, 16vw)",
          fontWeight: 200,
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          lineHeight: 1,
          color: "var(--fg-4)",
        }}
      >
        {day}
      </div>
      <div
        style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "12px",
          color: "var(--fg-2)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        day &middot; {duration}s &middot; {blocks} blocks
      </div>
      {recovery && (
        <div
          style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "10px",
            color: "var(--accent-amber-text)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          recovery {recovery.recoveryCurrentStep}/{recovery.recoveryTotalSteps} &middot; ramping back to day {recovery.recoveryTargetDay}
        </div>
      )}

      <button
        type="button"
        onClick={onBegin}
        style={{
          marginTop: "var(--s2)",
          background: "var(--surface-2)",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          fontSize: "16px",
          fontStyle: "italic",
          padding: "12px 40px",
          borderRadius: "40px",
          cursor: "pointer",
          transition: "all 0.3s",
          letterSpacing: "0.04em",
        }}
      >
        {doneToday ? "Sit again" : "Begin"}
      </button>
    </div>
  );
}

export function HomeView({
  currentDay,
  aphorismsEnabled,
  recovery = NO_RECOVERY,
  dualTrackEnabled = false,
  secondTrackDay = 1,
  dualTrackEligible = false,
  primaryDoneToday = false,
  secondDoneToday = false,
  onBegin,
  onBeginSecond,
  onEnableDualTrack,
  onDismissFork,
  onQuickBegin,
  onBreath,
  onBuddy,
}: HomeViewProps) {
  const todayDuration = sessionDurationForUser("standard", currentDay, recovery);
  const totalBlocks = Math.ceil(todayDuration / BLOCK_DURATION);
  const inRecovery = activeRecovery(recovery);
  const aphorism = aphorismsEnabled ? aphorismForDay(currentDay) : null;
  const secondDuration = sessionDurationForUser("standard", secondTrackDay, NO_RECOVERY);
  const showFork = !dualTrackEnabled && dualTrackEligible && !!onEnableDualTrack;

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

      {/* Block B: Session data. Single-track shows the classic day readout; the
          dual-track view (#240) swaps in two independently-startable track cards. */}
      {dualTrackEnabled ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "var(--s3)", width: "100%", maxWidth: "min(440px, calc(100vw - 40px))",
        }}>
          <TrackCard
            label={`Track One \u00B7 ${MAX_MINUTES} min`}
            day={currentDay}
            duration={todayDuration}
            doneToday={primaryDoneToday}
            recovery={inRecovery}
            onBegin={onBegin}
          />
          <TrackCard
            label="Track Two"
            day={secondTrackDay}
            duration={secondDuration}
            doneToday={secondDoneToday}
            recovery={null}
            onBegin={onBeginSecond ?? onBegin}
          />
        </div>
      ) : (
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
          {inRecovery && (
            <div style={{
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "10px", color: "var(--accent-amber-text)",
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              recovery {inRecovery.recoveryCurrentStep}/{inRecovery.recoveryTotalSteps} &middot; ramping back to day {inRecovery.recoveryTargetDay}
            </div>
          )}
        </div>
      )}

      {/* Fork choice (#240): once past the 10-minute mark, offer a second track. */}
      {showFork && (
        <DualTrackFork
          onEnable={onEnableDualTrack!}
          onDismiss={onDismissFork ?? (() => {})}
        />
      )}

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

      {/* Block C: CTA. The primary Begin lives inside the per-track cards in the
          dual-track view, so the standalone button only shows for a single track. */}
      {!dualTrackEnabled && (
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
      )}

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
