import { useCallback, useEffect, useRef } from "react";
import { isMindStateTypingTarget } from "@/lib/mindStateSession";

export type MindHoldKind = "none" | "pointerHold" | "spaceDistraction" | "commaHyperfocus";

type UseMindStateHoldOptions = {
  /** When false, Space/Comma listeners are not registered (e.g. paused sit or buddy lobby). */
  enabled: boolean;
  beginDistraction: () => void;
  beginHyperfocus: () => void;
  /** Release keyboard-driven hold (Space or Comma path). */
  endHoldFromKeyboard: () => void;
};

/**
 * Space (light distraction) and Comma (hyperfocus) hold tracking shared by solo
 * SessionView and BuddySessionRoom. Pointer holds set `holdKindRef` to
 * `"pointerHold"` in the parent; this hook only manages keyboard sources and
 * calls the provided begin/end callbacks.
 */
export function useMindStateHold({
  enabled,
  beginDistraction,
  beginHyperfocus,
  endHoldFromKeyboard,
}: UseMindStateHoldOptions) {
  const holdKindRef = useRef<MindHoldKind>("none");
  const spaceDownRef = useRef(false);
  const commaDownRef = useRef(false);

  const resetHoldTracking = useCallback(() => {
    holdKindRef.current = "none";
    spaceDownRef.current = false;
    commaDownRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isMindStateTypingTarget(e.target)) return;

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceDownRef.current = true;
        if (holdKindRef.current === "none") {
          holdKindRef.current = "spaceDistraction";
          beginDistraction();
        }
        return;
      }

      if ((e.code === "Comma" || e.key === ",") && !e.repeat) {
        e.preventDefault();
        commaDownRef.current = true;
        if (holdKindRef.current === "none") {
          holdKindRef.current = "commaHyperfocus";
          beginHyperfocus();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (!spaceDownRef.current) return;
        spaceDownRef.current = false;
        e.preventDefault();
        if (holdKindRef.current === "spaceDistraction") {
          holdKindRef.current = "none";
          endHoldFromKeyboard();
        }
        return;
      }
      if (e.code === "Comma" || e.key === ",") {
        if (!commaDownRef.current) return;
        commaDownRef.current = false;
        e.preventDefault();
        if (holdKindRef.current === "commaHyperfocus") {
          holdKindRef.current = "none";
          endHoldFromKeyboard();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [enabled, beginDistraction, beginHyperfocus, endHoldFromKeyboard]);

  return { holdKindRef, resetHoldTracking };
}
