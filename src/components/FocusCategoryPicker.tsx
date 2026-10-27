"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { FocusCategory } from "@/lib/constants";
import { formatFocusGoal } from "@/lib/focusActivity";
import { FOCUS_ACTIVITIES } from "@/lib/focusActivityContent";

type FocusCategoryPickerProps = {
  /** The shared focus goal in seconds, shown so it is plain that every category
   *  counts toward the same one. */
  goalSeconds: number;
  /** A card was chosen. The parent starts the timer for that category. */
  onChoose: (category: FocusCategory) => void;
  /** Cancel or Escape. The parent returns Home. */
  onCancel: () => void;
  /** Where Cancel and Escape put focus once Home is back: the "Focus activity"
   *  button that opened the picker. Named explicitly, as `SessionView` names the
   *  guided-exercise trigger, because a tap never focuses a button in Safari. */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
};

/**
 * #837 — choose what a focus session is for before its timer starts. Modeled on
 * the picker phase of `GuidedExerciseOverlay`: a full-screen dialog of option
 * cards that traps focus while it is open and hands it back to the button that
 * opened it on Cancel. It holds no session logic: it reports a choice or a
 * cancel, and the page decides what happens next.
 */
export function FocusCategoryPicker({
  goalSeconds,
  onChoose,
  onCancel,
  returnFocusRef,
}: FocusCategoryPickerProps) {
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // Read through a ref so new parent props never re-run the effect below,
  // which would pull focus back to Cancel in the middle of a Tab.
  const latestRef = useRef({ onCancel, returnFocusRef });
  latestRef.current = { onCancel, returnFocusRef };

  // Cancel gives focus back to the opening button once Home is showing again,
  // on the next frame, as `SessionView` does when the guided exercise closes.
  // Choosing a card does not: the timer replaces Home.
  const handleCancel = useCallback(() => {
    const { onCancel: cancel, returnFocusRef: target } = latestRef.current;
    cancel();
    requestAnimationFrame(() => {
      const element = target?.current;
      if (element?.isConnected) element.focus();
    });
  }, []);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusableElements = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(element => !element.hasAttribute("disabled"));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Not on one of the controls: the dialog itself, after a tap on its
      // backdrop. Tab from there would otherwise leave the dialog.
      const offControls = !focusable.includes(document.activeElement as HTMLElement);

      if (event.shiftKey) {
        if (document.activeElement === first || offControls) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (document.activeElement === last || offControls) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [handleCancel]);

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 210,
    background: "rgba(var(--bg-rgb), 0.94)",
    backdropFilter: "blur(6px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    // Scrolls rather than clipping the cards on a short (landscape) screen; the
    // card column's auto margins centre it whenever it fits.
    overflowY: "auto",
    outline: "none",
    padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))",
    animation: reduceMotion ? undefined : "fadeIn 0.5s ease",
    ...mono,
  };

  const cardStyle: CSSProperties = {
    width: "100%",
    maxWidth: "min(440px, calc(100vw - 40px))",
    margin: "auto 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
  };

  const cancelButtonStyle: CSSProperties = {
    position: "absolute",
    top: "max(16px, env(safe-area-inset-top))",
    right: "max(16px, env(safe-area-inset-right))",
    background: "none",
    border: "1px solid var(--border-2)",
    color: "var(--fg-3)",
    ...mono,
    fontSize: "10px",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    padding: "10px 16px",
    minHeight: "44px",
    borderRadius: "999px",
    cursor: "pointer",
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a focus activity"
      data-testid="focus-category-picker"
      // Focusable from script only, so a tap on the backdrop keeps focus inside
      // the dialog, where Escape and the Tab trap still answer.
      tabIndex={-1}
      style={overlayStyle}
    >
      <button
        ref={cancelButtonRef}
        type="button"
        onClick={handleCancel}
        aria-label="Cancel focus activity"
        style={cancelButtonStyle}
      >
        cancel
      </button>

      <div style={cardStyle}>
        <div style={{ textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: "10px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--fg-4)",
            }}
          >
            Focus activity
          </p>
          <h2
            style={{
              margin: "10px 0 0",
              fontSize: "18px",
              fontWeight: 400,
              letterSpacing: "0.06em",
              color: "var(--fg-2)",
            }}
          >
            What are you focusing on?
          </h2>
          <p
            data-testid="focus-category-goal"
            style={{ margin: "12px 0 0", fontSize: "12px", lineHeight: 1.55, color: "var(--fg-4)" }}
          >
            One goal for all three: {formatFocusGoal(goalSeconds)}. The timer starts when you choose.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
          {FOCUS_ACTIVITIES.map(item => (
            <button
              key={item.id}
              type="button"
              data-testid={`focus-activity-option-${item.id}`}
              onClick={() => onChoose(item.id)}
              style={{
                textAlign: "left",
                background: "var(--surface-1)",
                border: "1px solid var(--accent-green-border-subtle)",
                borderRadius: "16px",
                padding: "16px 18px",
                cursor: "pointer",
                color: "var(--fg-2)",
                ...mono,
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent-green-dim)",
                }}
              >
                {item.label}
              </div>
              <div style={{ marginTop: "8px", fontSize: "11px", lineHeight: 1.5, color: "var(--fg-4)" }}>
                {item.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
