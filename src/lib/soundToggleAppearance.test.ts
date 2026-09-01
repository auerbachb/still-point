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
      cue: "audio",
    });
  });

  test("off state drops the fill and uses the muted icon", () => {
    expect(soundToggleAppearance(false)).toEqual({
      isFilled: false,
      hasProminentBorder: false,
      isIconMuted: true,
      cue: "audio",
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

  // #712 — the haptics pill governs vibration, not sound.
  test("the cue defaults to audio so existing pills are unchanged", () => {
    expect(soundToggleAppearance(true).cue).toBe("audio");
  });

  test("the haptic cue is carried through so the glyph can differ", () => {
    expect(soundToggleAppearance(true, "haptic").cue).toBe("haptic");
    expect(soundToggleAppearance(false, "haptic").cue).toBe("haptic");
  });

  test("the haptic cue still distinguishes on from off on every channel", () => {
    const on = soundToggleAppearance(true, "haptic");
    const off = soundToggleAppearance(false, "haptic");

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

  // #712: announcing the haptics pill as a sound would tell a screen-reader
  // user the opposite of what it does.
  test("the haptics pill is not announced as a sound", () => {
    const label = soundToggleAccessibilityLabel("haptics", "haptic");

    expect(label).toBe("haptics feedback");
    expect(label.startsWith("haptics")).toBe(true);
    expect(label).not.toContain("sound");
  });

  test("the haptics test id follows the existing format", () => {
    expect(soundToggleTestId("haptics")).toBe("session.soundToggle.haptics");
  });

  test("state text announces on/off rather than relying on colour", () => {
    expect(soundToggleStateText(true)).toBe("on");
    expect(soundToggleStateText(false)).toBe("off");
  });
});
