"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type Ref } from "react";
import { elapsedDisplay } from "@/lib/breathCounting";
import { BLOCK_DURATION, MAX_DURATION, QUICK_DURATION } from "@/lib/constants";
import {
  activeRecovery,
  focusSessionDuration,
  sessionDurationForUser,
  type ActiveRecovery,
  type RecoveryFields,
} from "@/lib/duration";
import { formatFocusGoal } from "@/lib/focusActivity";
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
  /** #895: today's two sits can be done as one (`isCombineOffered`). */
  combineOffered: boolean;
  /** #895: the combined sit's planned length in seconds (`combinedDurationForUser`),
   *  shown in the confirmation. */
  combinedDuration: number;
  /** #895: start today's two sits as one. The action only renders when this is
   *  set and `combineOffered` is true. */
  onCombineSessions?: () => void;
  onBegin: () => void;
  /** #240: start the second track's sit (only used when dual-track is enabled). */
  onBeginSecond?: () => void;
  /** #240: opt into the second track from the fork card. */
  onEnableDualTrack?: () => Promise<void>;
  /** #240: dismiss the fork card for now (stay single-track). */
  onDismissFork?: () => void;
  onQuickBegin: () => void;
  onBreath?: () => void;
  /** #836: the focus goal counter; the button shows `focusSessionDuration` of it. */
  focusActivityDay?: number;
  /** #836: open the focus activity timer (#837: its category picker first).
   *  The button only renders when set. */
  onFocusActivity?: () => void;
  /** #837: the "Focus activity" button, which the picker gives focus back to. */
  focusActivityButtonRef?: Ref<HTMLButtonElement>;
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
          fontFamily: "var(--font-mono)",
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
          fontFamily: "var(--font-mono)",
          lineHeight: 1,
          color: "var(--fg-4)",
        }}
      >
        {day}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
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
            fontFamily: "var(--font-mono)",
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
          fontFamily: "var(--font-serif)",
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

/** #895: the wording is decided on #895, and iOS uses it character for character in 5/5 (#898). */
const COMBINE_COPY = {
  action: "Combine today's sits",
  title: "Combine today's sits?",
  advice:
    "Splitting your sits is better. Two separate sits suit your practice more than one long one, so combine only if you can't sit twice today.",
  keep: "Keep them separate",
  combine: "Combine anyway",
} as const;

/** A keyboard-only focus ring, the one the single-track Begin draws. */
function showFocusRing(e: FocusEvent<HTMLElement>) {
  if (e.currentTarget.matches(":focus-visible")) {
    e.currentTarget.style.outline = "2px solid var(--border-3)";
    e.currentTarget.style.outlineOffset = "3px";
  }
}

function hideFocusRing(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.outline = "none";
}

/** The quiet text style of the combine action and of "Combine anyway". */
const quietTextButtonStyle = {
  background: "none",
  border: "none",
  padding: "var(--s1) var(--s2)",
  minHeight: "44px",
  color: "var(--fg-3)",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textDecoration: "underline",
  textDecorationColor: "var(--border-3)",
  textUnderlineOffset: "4px",
  cursor: "pointer",
} as const;

/**
 * #895: today's two sits done as one, offered quietly under Track Two's card.
 * The action starts nothing. It opens an inline confirmation that says
 * splitting the sits is better, where "Keep them separate" is the prominent
 * choice and only "Combine anyway" starts the sit. HomeView mounts this only
 * while the offer stands, so the panel closes by itself if the offer goes away.
 */
function CombineSitsAction({
  combinedDuration,
  onCombine,
}: {
  combinedDuration: number;
  onCombine: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Set by a dismissal, so focus goes back to the action once it is rendered
  // again. Named explicitly rather than restored to whatever had focus, because
  // a tap never focuses a button in Safari.
  const returnFocusRef = useRef(false);
  const titleId = useId();
  const adviceId = useId();
  const lengthId = useId();

  useEffect(() => {
    if (confirming) {
      // The panel grows down from where the action was, which on a phone can be
      // just above the fixed bottom nav. Bring all of it into view (its scroll
      // margin clears the nav), then focus without scrolling again.
      panelRef.current?.scrollIntoView({ block: "nearest" });
      keepRef.current?.focus({ preventScroll: true });
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      actionRef.current?.focus();
    }
  }, [confirming]);

  const dismiss = () => {
    returnFocusRef.current = true;
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <button
        ref={actionRef}
        type="button"
        onClick={() => setConfirming(true)}
        onFocus={showFocusRing}
        onBlur={hideFocusRing}
        style={quietTextButtonStyle}
      >
        {COMBINE_COPY.action}
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={`${adviceId} ${lengthId}`}
      // Focusable from script only, so a tap on the panel's text keeps focus
      // inside it, where Escape still answers.
      tabIndex={-1}
      onKeyDown={e => {
        if (e.key === "Escape") {
          e.preventDefault();
          dismiss();
        }
      }}
      style={{
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid var(--border-1)",
        borderRadius: "16px",
        padding: "var(--s4) var(--s3)",
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--s2)",
        textAlign: "center",
        outline: "none",
        animation: "fadeIn 0.3s ease",
        // Clears the fixed bottom nav when the panel is scrolled into view (#479).
        scrollMarginBottom: "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <h2
        id={titleId}
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: "20px",
          fontWeight: 300,
          fontStyle: "italic",
          color: "var(--fg)",
        }}
      >
        {COMBINE_COPY.title}
      </h2>
      <p id={adviceId} style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "var(--fg-2)" }}>
        {COMBINE_COPY.advice}
      </p>
      <p id={lengthId} style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "var(--fg-2)" }}>
        This will be one{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg)" }}>
          {elapsedDisplay(combinedDuration)}
        </span>{" "}
        sit, and it counts for both tracks.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--s1)",
          marginTop: "var(--s2)",
        }}
      >
        <button
          ref={keepRef}
          type="button"
          onClick={dismiss}
          onFocus={showFocusRing}
          onBlur={hideFocusRing}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-2)",
            color: "var(--fg)",
            fontFamily: "var(--font-serif)",
            fontSize: "16px",
            fontStyle: "italic",
            padding: "12px 32px",
            borderRadius: "40px",
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          {COMBINE_COPY.keep}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onCombine();
          }}
          onFocus={showFocusRing}
          onBlur={hideFocusRing}
          style={{ ...quietTextButtonStyle, fontSize: "11px" }}
        >
          {COMBINE_COPY.combine}
        </button>
      </div>
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
  combineOffered,
  combinedDuration,
  onCombineSessions,
  onBegin,
  onBeginSecond,
  onEnableDualTrack,
  onDismissFork,
  onQuickBegin,
  onBreath,
  focusActivityDay = 1,
  onFocusActivity,
  focusActivityButtonRef,
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
          fontFamily: "var(--font-serif)",
        }}>
          Still Point
        </h1>
        <p style={{
          fontSize: "13px", color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
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
          {/* #895: absent, not disabled, whenever it is not offered. */}
          {combineOffered && onCombineSessions && (
            <CombineSitsAction combinedDuration={combinedDuration} onCombine={onCombineSessions} />
          )}
        </div>
      ) : (
        <div style={{
          textAlign: "center", animation: "breathe 4s ease-in-out infinite",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "var(--s1)",
        }}>
          <div style={{
            fontSize: "min(120px, 20vw)", fontWeight: 200,
            fontFamily: "var(--font-mono)",
            lineHeight: 1, color: "var(--fg-4)",
          }}>
            {currentDay}
          </div>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px", color: "var(--fg-2)",
            letterSpacing: "0.15em", textTransform: "uppercase",
          }}>
            day &middot; {todayDuration}s &middot; {totalBlocks} blocks
          </div>
          {inRecovery && (
            <div style={{
              fontFamily: "var(--font-mono)",
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

      {/* Block B2: Lesson pathway preview (#336 / #587) */}
      <Pathway />

      {/* Block B3: pre-session aphorism, opt-in (#88) */}
      {aphorism && (
        <div style={{
          textAlign: "center",
          maxWidth: "min(360px, calc(100vw - 40px))",
          padding: "0 var(--s2)",
        }}>
          <p style={{
            fontFamily: "var(--font-serif)",
            fontSize: "15px", fontStyle: "italic", fontWeight: 300,
            color: "var(--fg-2)", margin: 0, lineHeight: 1.5,
          }}>
            &ldquo;{aphorism.text}&rdquo;
          </p>
          <p style={{
            fontFamily: "var(--font-mono)",
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
            fontFamily: "var(--font-serif)",
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
          fontFamily: "var(--font-mono)",
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
            fontFamily: "var(--font-mono)",
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

      {onFocusActivity && (
        <button
          ref={focusActivityButtonRef}
          type="button"
          onClick={onFocusActivity}
          style={{
            background: "transparent",
            border: "1px solid var(--border-2)",
            color: "var(--fg-2)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 24px",
            borderRadius: "40px",
            cursor: "pointer",
          }}
        >
          Focus activity &middot; {formatFocusGoal(focusSessionDuration(focusActivityDay))}
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
            fontFamily: "var(--font-mono)",
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
            fontFamily: "var(--font-mono)",
            fontSize: "12px", color: "var(--fg-3)",
            letterSpacing: "0.15em", textTransform: "uppercase",
            marginBottom: "var(--s3)",
            textAlign: "center",
          }}>
            FAQ
          </div>
          <div style={{ padding: "0 var(--s1)" }}>
            <p style={{
              fontFamily: "var(--font-serif)",
              fontSize: "14px", fontStyle: "italic",
              color: "var(--fg-2)", margin: "0 0 var(--s1)",
              lineHeight: 1.6, textAlign: "left",
            }}>
              &ldquo;This app is incredibly boring, what&rsquo;s the point of it?&rdquo;
            </p>
            <p style={{
              fontFamily: "var(--font-serif)",
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
