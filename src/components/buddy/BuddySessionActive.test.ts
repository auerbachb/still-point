/** @vitest-environment jsdom */
import { act, createElement, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuddySnapshot } from "@/lib/api";
import type { SoundPrefs } from "@/lib/audio";
import type { BuddyMindState } from "@/lib/useBuddyMindState";
import type { MindHoldKind } from "@/lib/useMindStateHold";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../BlockTimer", () => ({
  BlockTimer: () => null,
}));
vi.mock("../BuddyVideo", () => ({
  BuddyVideo: () => null,
}));
vi.mock("./BuddyMindStateControls", () => ({
  BuddyMindStateControls: () => null,
}));

const { BuddySessionActive } = await import("./BuddySessionActive");

const liveRoots: Array<{ unmount: () => Promise<void> }> = [];

const snap: BuddySnapshot = {
  id: "sess",
  state: "active",
  revision: 1,
  durationSeconds: 600,
  scheduledStartAt: null,
  startedAt: "2026-10-06T20:00:00.000Z",
  serverNow: "2026-10-06T20:00:01.000Z",
  endsAt: null,
  elapsedSeconds: 1,
  remainingSeconds: 599,
  dailyRoomUrl: null,
  hostUserId: "user-1",
  isHost: true,
  participants: [
    {
      userId: "user-1",
      username: "ada",
      isHost: true,
      ready: true,
      joinedAt: "2026-10-06T20:00:00.000Z",
      leftAt: null,
      connected: true,
      participantCompletedAt: null,
    },
  ],
};

function Harness({
  prefs,
  onToggle,
  onCueMode = () => {},
}: {
  prefs: SoundPrefs;
  onToggle: (key: keyof SoundPrefs) => void;
  onCueMode?: (mode: "tick" | "haptic" | "voice") => void;
}) {
  const mindStateRef = useRef<BuddyMindState>("clear");
  const holdKindRef = useRef<MindHoldKind>("none");
  const elapsedRef = useRef(0);
  return createElement(BuddySessionActive, {
    sessionId: "sess",
    snap,
    currentUserId: "user-1",
    isMobile: true,
    mindState: "clear",
    mindStateRef,
    mindStateLog: [],
    holdKindRef,
    showPostDistractionCapture: false,
    distractionSegmentCount: 0,
    sessionThoughts: [],
    buddyAwarenessPct: 0,
    elapsedRef,
    soundPrefs: prefs,
    audioBlocked: false,
    dailyMeetingToken: null,
    dailyTokenError: null,
    finalizeActiveBuddyHold: () => {},
    beginBuddyDistraction: () => {},
    beginBuddyHyperfocus: () => {},
    onElapsedChange: () => {},
    onSoundPlaybackBlocked: () => {},
    onSoundPlaybackResumed: () => {},
    onTimerComplete: () => {},
    onSaveThought: () => {},
    onDismissPostCapture: () => {},
    onOpenThoughtCapture: () => {},
    onSoundPrefToggle: onToggle,
    onCueMode,
    onEnableLocalAudio: () => {},
    onLeave: () => {},
  });
}

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const handle = {
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  liveRoots.push(handle);
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  return container;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const el = container.querySelector(`[data-testid="buddySession.soundToggle.${label}"]`);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`missing buddy sound toggle ${label}`);
  }
  return el;
}

afterEach(async () => {
  for (const view of liveRoots.splice(0)) {
    await view.unmount();
  }
});

describe("BuddySessionActive sound toggles", () => {
  const prefs: SoundPrefs = {
    tick: true,
    chime: false,
    completion: false,
    voiceCountdown: true,
    haptics: false,
  };

  it("renders one cue control plus chime and end pills", async () => {
    const onToggle = vi.fn();
    const onCueMode = vi.fn();
    const container = await render(createElement(Harness, { prefs, onToggle, onCueMode }));

    const row = container.querySelector('[data-testid="buddySession.soundToggles"]');
    expect(row).toBeInstanceOf(HTMLElement);
    expect((row as HTMLElement).style.flexWrap).toBe("wrap");
    expect((row as HTMLElement).style.maxWidth).toBe("min(420px, calc(100vw - 40px))");

    const group = container.querySelector('[data-testid="buddySession.cueMode"]');
    expect(group?.getAttribute("role")).toBe("radiogroup");
    const tick = container.querySelector('[data-testid="buddySession.cueMode.tick"]');
    const voice = container.querySelector('[data-testid="buddySession.cueMode.voice"]');
    if (!(tick instanceof HTMLButtonElement) || !(voice instanceof HTMLButtonElement)) {
      throw new Error("missing cue mode segments");
    }
    // Tick wins when more than one cue flag is on.
    expect(tick.getAttribute("aria-checked")).toBe("true");
    expect(voice.getAttribute("aria-checked")).toBe("false");
    expect(tick.style.minHeight).toBe("44px");

    const chime = button(container, "chime");
    expect(chime.getAttribute("aria-pressed")).toBe("false");
    expect(chime.getAttribute("aria-label")).toBe("chime sound; only you hear this");
    expect(chime.style.backgroundColor || chime.style.background).toBe("transparent");
    expect(chime.getAttribute("style")).toContain("border: 1px solid var(--border-1)");
    expect(button(container, "end").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[data-testid="buddySession.soundToggle.tick"]')).toBeNull();
    expect(container.querySelector('[data-testid="buddySession.soundToggle.haptics"]')).toBeNull();

    expect(container.textContent).toContain("sounds play only on this device");

    voice.click();
    expect(onCueMode).toHaveBeenCalledWith("voice");
    expect(onToggle).not.toHaveBeenCalled();

    expect(tick.tabIndex).toBe(0);
    expect(voice.tabIndex).toBe(-1);
    tick.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onCueMode).toHaveBeenCalledWith("haptic");
  });
});
