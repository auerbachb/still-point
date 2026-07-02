import { useCallback, useEffect, useRef } from "react";
import {
  createInitialMindHoldKeyboardState,
  reduceMindHoldKeyDown,
  reduceMindHoldKeyUp,
  type MindHoldKind,
} from "@/lib/mindStateSession";

export type { MindHoldKind };

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
  const keyboardStateRef = useRef(createInitialMindHoldKeyboardState());

  const resetHoldTracking = useCallback(() => {
    holdKindRef.current = "none";
    keyboardStateRef.current = createInitialMindHoldKeyboardState();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const applyEffects = (
      effects: ReturnType<typeof reduceMindHoldKeyDown>["effects"],
      e: KeyboardEvent,
    ) => {
      for (const effect of effects) {
        if (effect.type === "preventDefault") e.preventDefault();
        if (effect.type === "beginDistraction") beginDistraction();
        if (effect.type === "beginHyperfocus") beginHyperfocus();
        if (effect.type === "endHold") endHoldFromKeyboard();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      keyboardStateRef.current = {
        ...keyboardStateRef.current,
        holdKind: holdKindRef.current,
      };
      const { state, effects } = reduceMindHoldKeyDown(keyboardStateRef.current, e);
      keyboardStateRef.current = state;
      holdKindRef.current = state.holdKind;
      applyEffects(effects, e);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keyboardStateRef.current = {
        ...keyboardStateRef.current,
        holdKind: holdKindRef.current,
      };
      const { state, effects } = reduceMindHoldKeyUp(keyboardStateRef.current, e);
      keyboardStateRef.current = state;
      holdKindRef.current = state.holdKind;
      applyEffects(effects, e);
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
