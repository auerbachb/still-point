"use client";

import { offlineIndicatorCopy, type OfflineIndicatorState } from "@/lib/offlineIndicatorCopy";

type OfflineIndicatorProps = {
  /**
   * Which of the strip's three things to say — resolved by
   * `offlineIndicatorStateFor`, which also decides whether there is anything to
   * say at all. The caller does not render this component for `null`.
   */
  state: OfflineIndicatorState;
};

/**
 * #666: the unobtrusive strip shown while the app is running from its local copy
 * of identity and state. The web twin of the iOS `OfflineIndicatorView` (#665),
 * down to the same three design tokens (`amberText` / `amberBgFaint` /
 * `amberBorderSubtle`) and the same copy, so the two clients look and read the
 * same when disconnected.
 *
 * Deliberately not an error in its usual state. There is nothing to act on and
 * nothing to dismiss — the sit still runs, the day number is still right, and
 * the completion still queues for upload. It replaces what a lost connection
 * used to produce: an "Unable to verify your sign-in" screen nobody asked for.
 * Amber, not red, for the same reason, and `role="status"` rather than
 * `role="alert"` so a screen reader announces it politely instead of
 * interrupting.
 *
 * #703 is the one case where that reassurance would be a lie: a refused
 * IndexedDB write means the sit is on no device and will upload nowhere. The
 * strip then carries the withdrawn copy in danger tokens instead.
 *
 * #717: that failure is not a connectivity failure, so the strip also has to be
 * able to raise itself while the user is online — which means the struck-out
 * wifi glyph has to go with the copy. It is the loudest thing on the strip and
 * says "offline" on its own, so an online failure gets a warning triangle and
 * the glyph never contradicts the label it sits next to.
 */
export function OfflineIndicator({ state }: OfflineIndicatorProps) {
  const copy = offlineIndicatorCopy(state);
  const sitNotStored = state !== "offlineSavedProgress";
  const offline = state !== "onlineSitNotStored";

  return (
    <div
      role="status"
      data-testid="offline-indicator"
      data-state={
        state === "offlineSavedProgress"
          ? "offline-saved-progress"
          : state === "offlineSitNotStored"
            ? "offline-sit-not-stored"
            : "online-sit-not-stored"
      }
      aria-label={copy.accessibilityLabel}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s1)",
        padding: "var(--s1) var(--s2)",
        marginBottom: "var(--s3)",
        background: "var(--accent-amber-bg-faint)",
        borderBottom: sitNotStored
          ? "1px solid var(--accent-danger-border-subtle)"
          : "1px solid var(--accent-amber-border-subtle)",
        color: sitNotStored ? "var(--accent-danger)" : "var(--accent-amber-text)",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.2em",
      }}
    >
      <span aria-hidden="true">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          {offline ? (
            <>
              <path d="M2 2l20 20" />
              <path d="M8.5 16.5a5 5 0 0 1 7 0" />
              <path d="M5 12.9a10 10 0 0 1 5.2-2.7" />
              <path d="M13.8 10.2a10 10 0 0 1 5.2 2.7" />
              <path d="M2 8.8a15 15 0 0 1 5.1-3" />
              <path d="M16.9 5.8A15 15 0 0 1 22 8.8" />
              <path d="M12 20h.01" />
            </>
          ) : (
            <>
              <path d="M12 3.5 2.2 20.5h19.6L12 3.5z" />
              <path d="M12 10v4" />
              <path d="M12 17.5h.01" />
            </>
          )}
        </svg>
      </span>
      <span>{copy.label}</span>
    </div>
  );
}
