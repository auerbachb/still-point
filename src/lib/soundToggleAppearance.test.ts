/**
 * #668 — the sound toggles must read as buttons with an unmistakable on/off state.
 *
 * Ports ios/StillPointShared/Tests/StillPointSharedTests/SoundToggleAppearanceTests.swift
 * so both clients assert the same rules; keep the two files in step.
 */
import { describe, expect, test } from "vitest";
import {
  SOUND_TOGGLE_MIN_TAP_TARGET_PX,
  soundToggleAccessibilityLabel,
  soundToggleAppearance,
  soundToggleStateText,
  soundToggleTestId,
} from "@/lib/soundToggleAppearance";

describe("soundToggleAppearance", () => {
  test("on state fills the pill and uses the sounding icon", () => {
    expect(soundToggleAppearance(true)).toEqual({
      isFilled: true,
      hasProminentBorder: true,
      isIconMuted: false,
    });
  });

  test("off state drops the fill and uses the muted icon", () => {
    expect(soundToggleAppearance(false)).toEqual({
      isFilled: false,
      hasProminentBorder: false,
      isIconMuted: true,
    });
  });

  // The acceptance criterion the restyle exists for: on and off must differ in
  // fill, border, *and* icon — not in text colour alone. A regression that
  // collapses the state onto one channel fails here.
  test("every visual channel distinguishes on from off", () => {
    const on = soundToggleAppearance(true);
    const off = soundToggleAppearance(false);

    expect(on.isFilled).not.toBe(off.isFilled);
    expect(on.hasProminentBorder).not.toBe(off.hasProminentBorder);
    expect(on.isIconMuted).not.toBe(off.isIconMuted);
  });
});

describe("tap target", () => {
  test("minimum tap target meets WCAG 2.5.5", () => {
    expect(SOUND_TOGGLE_MIN_TAP_TARGET_PX).toBeGreaterThanOrEqual(44);
  });
});

describe("accessibility", () => {
  // UI tests address the toggles by this identifier; the restyle must not move it.
  test("test id keeps the existing format", () => {
    expect(soundToggleTestId("tick")).toBe("session.soundToggle.tick");
    expect(soundToggleTestId("chime")).toBe("session.soundToggle.chime");
    expect(soundToggleTestId("voice")).toBe("session.soundToggle.voice");
    expect(soundToggleTestId("end")).toBe("session.soundToggle.end");
  });

  // WCAG 2.5.3: the accessible name starts with the word shown on the control,
  // so voice control matches what a sighted user would say.
  test("accessible name starts with the visible word", () => {
    expect(soundToggleAccessibilityLabel("tick")).toBe("tick sound");
    expect(soundToggleAccessibilityLabel("voice").startsWith("voice")).toBe(true);
  });

  test("state text announces on/off rather than relying on colour", () => {
    expect(soundToggleStateText(true)).toBe("on");
    expect(soundToggleStateText(false)).toBe("off");
  });
});
