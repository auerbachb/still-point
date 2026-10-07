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
}: {
  prefs: SoundPrefs;
  onToggle: (key: keyof SoundPrefs) => void;
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
    onTimerComplete: () => {},
    onSaveThought: () => {},
    onDismissPostCapture: () => {},
    onOpenThoughtCapture: () => {},
    onSoundPrefToggle: onToggle,
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

  it("renders #668 pills with a 44px target and buddy-only names", async () => {
    const onToggle = vi.fn();
    const container = await render(createElement(Harness, { prefs, onToggle }));

    const row = container.querySelector('[data-testid="buddySession.soundToggles"]');
    expect(row).toBeInstanceOf(HTMLElement);
    expect((row as HTMLElement).style.flexWrap).toBe("wrap");
    expect((row as HTMLElement).style.maxWidth).toBe("min(420px, calc(100vw - 40px))");

    const tick = button(container, "tick");
    expect(tick.getAttribute("aria-pressed")).toBe("true");
    expect(tick.getAttribute("aria-label")).toBe("tick sound; only you hear this");
    expect(tick.title).toBe("Only you hear this — does not change audio for others");
    expect(tick.style.minHeight).toBe("44px");
    expect(tick.style.backgroundColor || tick.style.background).toBe("var(--surface-3)");
    expect(tick.getAttribute("style")).toContain("border: 1px solid var(--border-2)");
    expect(tick.querySelector("path[d='M10.5 5.75a3 3 0 010 4.5']")).not.toBeNull();

    const chime = button(container, "chime");
    expect(chime.getAttribute("aria-pressed")).toBe("false");
    expect(chime.getAttribute("aria-label")).toBe("chime sound; only you hear this");
    expect(chime.style.backgroundColor || chime.style.background).toBe("transparent");
    expect(chime.getAttribute("style")).toContain("border: 1px solid var(--border-1)");
    expect(chime.querySelector("path[d='M10.5 6l4 4m0-4l-4 4']")).not.toBeNull();

    expect(button(container, "voice").getAttribute("aria-pressed")).toBe("true");
    expect(button(container, "end").getAttribute("aria-pressed")).toBe("false");

    const haptics = button(container, "haptics");
    expect(haptics.getAttribute("aria-label")).toBe("haptics feedback; only you feel this");
    expect(haptics.title).toBe("Only you feel this — does not change anything for others");
    expect(haptics.querySelector("rect")).not.toBeNull();

    expect(container.textContent).toContain("sounds play only on this device");

    tick.click();
    expect(onToggle).toHaveBeenCalledWith("tick");
  });
});
