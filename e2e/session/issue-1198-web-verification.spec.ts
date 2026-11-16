import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  tap,
  tapWithControlReveal,
} from "../utils/mobile-helpers";

// #1198: web halves of the post-merge verification checklists that a spec can
// truly assert from the DOM, persisted state, layout boxes, or stubbed browser
// APIs. Device, by-ear and by-eye items stay on their source issues.
//   #786 solo "Enable local audio" alert (suspended AudioContext)
//   #725 wake lock request/release through a stubbed navigator.wakeLock
//   #685 minimal "just the timer" view on web
//   #688 sound toggle pills: aria-pressed state, one row, tap targets at 320px

/** A stand-in AudioContext that starts suspended. `resume()` only reaches
 *  "running" once `window.__audioUnlockable` is true, so a test decides whether
 *  the user's gesture can clear the block. */
const SUSPENDED_AUDIO_CONTEXT = `
(() => {
  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = {};
      this._listeners = [];
      window.__fakeAudioContext = this;
    }
    addEventListener(type, fn) { if (type === "statechange") this._listeners.push(fn); }
    removeEventListener() {}
    resume() {
      // Notify only on a real change: the app's listener calls resume() again
      // while the state still needs it, and that would recurse forever.
      if (window.__audioUnlockable && this.state !== "running") {
        this.state = "running";
        this._listeners.forEach((fn) => fn());
      }
      return Promise.resolve();
    }
    close() { return Promise.resolve(); }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createOscillator() {
      return { type: "sine", frequency: { value: 0, setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null };
    }
    createBufferSource() {
      return { buffer: null, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null };
    }
    createBuffer(channels, length, sampleRate) {
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData() { return new Float32Array(length); } };
    }
    decodeAudioData() { return Promise.reject(new Error("not supported in test")); }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
})();
`;

/** Makes every IndexedDB open fail, the way a browser with storage refused
 *  presents it. The offline queue then cannot store a finished sit (#723). */
const REFUSE_INDEXED_DB = `
(() => {
  IDBFactory.prototype.open = function () {
    throw new DOMException("IndexedDB refused in test", "UnknownError");
  };
})();
`;

/** Refuses IndexedDB asynchronously: `open()` returns a request whose
 *  `onerror` fires on a later task, as a real storage refusal does. */
const REFUSE_INDEXED_DB_ASYNC = `
(() => {
  IDBFactory.prototype.open = function () {
    const request = { result: undefined, error: null, onerror: null, onsuccess: null, onupgradeneeded: null };
    setTimeout(() => {
      request.error = new DOMException("IndexedDB refused in test", "UnknownError");
      if (request.onerror) request.onerror({ target: request });
    }, 0);
    return request;
  };
})();
`;

/** Records every wake lock request and explicit release on `window.__wake`.
 *  `window.__wake.systemRelease()` models the browser dropping the lock while
 *  the page stays visible: it marks the sentinel released and fires its
 *  `release` event, as the UA does (an explicit `release()` fires no event). */
const STUB_WAKE_LOCK = `
(() => {
  window.__wake = { requests: [], releases: 0, rejectNext: false, live: [] };
  const wakeLock = {
    request(type) {
      if (window.__wake.rejectNext) {
        return Promise.reject(new DOMException("Battery saver", "NotAllowedError"));
      }
      window.__wake.requests.push(type);
      const listeners = [];
      const sentinel = {
        released: false,
        type,
        release() {
          if (!this.released) window.__wake.releases += 1;
          this.released = true;
          return Promise.resolve();
        },
        addEventListener(name, fn) { if (name === "release") listeners.push(fn); },
        removeEventListener(name, fn) {
          const i = listeners.indexOf(fn);
          if (name === "release" && i >= 0) listeners.splice(i, 1);
        },
        _fireSystemRelease() {
          this.released = true;
          listeners.slice().forEach((fn) => fn());
        },
      };
      window.__wake.live.push(sentinel);
      return Promise.resolve(sentinel);
    },
  };
  Object.defineProperty(navigator, "wakeLock", { value: wakeLock, configurable: true });
  window.__wake.systemRelease = () => {
    const held = window.__wake.live.filter((s) => !s.released);
    held.forEach((s) => s._fireSystemRelease());
    return held.length;
  };
})();
`;

type WakeState = { requests: string[]; releases: number };

async function wakeState(page: Page): Promise<WakeState> {
  return page.evaluate(() => {
    const w = (window as unknown as { __wake: WakeState }).__wake;
    return { requests: [...w.requests], releases: w.releases };
  });
}

function beginButton(page: Page) {
  return page.getByRole("button", { name: "Begin", exact: true });
}

/** The minimal view's restore control is visually hidden until it takes focus
 *  (#685 keyboard path), so it is reached by focus and Enter, not by a tap. */
async function restoreFullView(page: Page) {
  const restore = page.getByRole("button", { name: "show session controls" });
  await restore.focus();
  await page.keyboard.press("Enter");
}

function soundToggles(page: Page) {
  return page.locator("[data-sound-toggle]");
}

test.describe("#786 solo enable-local-audio alert", () => {
  test("appears while the AudioContext is suspended, hides in minimal view, clears after unlock", async ({ page, ensureLoggedIn }) => {
    await page.addInitScript(SUSPENDED_AUDIO_CONTEXT);
    await page.addInitScript(() => {
      (window as unknown as { __audioUnlockable: boolean }).__audioUnlockable = false;
    });
    await ensureLoggedIn();
    await tap(beginButton(page));

    // Enabling a cue that plays audio starts an unlock. With the context
    // suspended and unlockable false, that unlock is "blocked" and the alert shows.
    // The chime pill is off by default; if it starts on, switch it off first.
    const chime = page.locator('[data-sound-toggle="chime"]');
    await expect(chime).toBeVisible();
    if ((await chime.getAttribute("aria-pressed")) === "true") await tapWithControlReveal(page, chime);
    await tapWithControlReveal(page, chime);

    const alert = page.getByRole("alert").filter({ hasText: "Browser audio is paused" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Enable local audio" })).toBeVisible();

    // Minimal view hides the sound controls, and the alert with them.
    await tapWithControlReveal(page, page.getByRole("button", { name: "Show only the timer" }));
    await expect(page.getByRole("button", { name: "show session controls" })).toBeVisible();
    await expect(alert).toBeHidden();

    // Restore the full view. A gesture that cannot unlock keeps the alert up.
    await restoreFullView(page);
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "Enable local audio" }).click();
    await expect(alert).toBeVisible();

    // Once the browser accepts the gesture, the alert clears.
    await page.evaluate(() => {
      (window as unknown as { __audioUnlockable: boolean }).__audioUnlockable = true;
    });
    await alert.getByRole("button", { name: "Enable local audio" }).click();
    await expect(alert).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __fakeAudioContext?: { state: string } }).__fakeAudioContext?.state))
      .toBe("running");
  });
});

test.describe("#725 web screen wake lock", () => {
  test("requests a screen wake lock when a solo sit begins", async ({ page, ensureLoggedIn }) => {
    await page.addInitScript(STUB_WAKE_LOCK);
    await ensureLoggedIn();
    await tap(beginButton(page));
    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __wake: { requests: string[] } }).__wake.requests))
      .toContain("screen");
  });

  test("the lock is released on pause and on end, and re-acquired on resume", async ({ page, ensureLoggedIn }) => {
    await page.addInitScript(STUB_WAKE_LOCK);
    await ensureLoggedIn();
    await tap(beginButton(page));
    // Counts are taken relative to a baseline: dev StrictMode runs the effect
    // twice on mount, so the absolute request count is not the contract.
    await expect.poll(async () => (await wakeState(page)).requests.length).toBeGreaterThan(0);
    const requestsAtBegin = (await wakeState(page)).requests.length;

    await tapWithControlReveal(page, page.getByRole("button", { name: "pause", exact: true }));
    await expect.poll(async () => (await wakeState(page)).releases, "lock released on pause").toBeGreaterThan(0);
    const releasesAtPause = (await wakeState(page)).releases;

    await tapWithControlReveal(page, page.getByRole("button", { name: "resume", exact: true }));
    await expect.poll(async () => (await wakeState(page)).requests.length, "lock re-acquired on resume").toBeGreaterThan(requestsAtBegin);

    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
    await expect(page.getByTestId("completion-return-bottom")).toBeVisible();
    await expect.poll(async () => (await wakeState(page)).releases, "lock released when the sit ends").toBeGreaterThan(releasesAtPause);
    const held = await page.evaluate(() => (window as unknown as { __wake: { live: { released: boolean }[] } }).__wake.live.filter((s) => !s.released).length);
    expect(held, "no lock is left held after the sit ends").toBe(0);
  });

  test("re-acquires after a system release, and after the tab is hidden then shown", async ({ page, ensureLoggedIn }) => {
    await page.addInitScript(STUB_WAKE_LOCK);
    await ensureLoggedIn();
    await tap(beginButton(page));
    await expect.poll(async () => (await wakeState(page)).requests.length).toBeGreaterThan(0);

    // #1176: the browser drops the lock while the page stays visible.
    const beforeSystemRelease = (await wakeState(page)).requests.length;
    await page.evaluate(() => (window as unknown as { __wake: { systemRelease: () => number } }).__wake.systemRelease());
    await expect.poll(async () => (await wakeState(page)).requests.length, "re-acquired after a system release").toBeGreaterThan(beforeSystemRelease);

    // Tab hidden: the browser drops the lock and the hook must not ask for one.
    const beforeHidden = (await wakeState(page)).requests.length;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      (window as unknown as { __wake: { systemRelease: () => number } }).__wake.systemRelease();
    });
    // acquire() returns before calling request() on a hidden page, so no request
    // can be pending here; the count is read straight after the events.
    const whileHidden = (await wakeState(page)).requests.length;
    expect(whileHidden, "no lock requested while the tab is hidden").toBe(beforeHidden);

    // Tab visible again: the lock is re-acquired.
    await page.evaluate(() => {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await wakeState(page)).requests.length, "re-acquired when the tab is visible again").toBeGreaterThan(whileHidden);
  });

  test("a rejected lock request (battery saver) does not stop the sit or raise an error", async ({ page, ensureLoggedIn }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(STUB_WAKE_LOCK);
    await page.addInitScript(() => {
      (window as unknown as { __wake: { rejectNext: boolean } }).__wake.rejectNext = true;
    });
    await ensureLoggedIn();
    await tap(beginButton(page));

    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
    await expect(page.getByRole("button", { name: /end early/i })).toBeVisible();
    // The sit is running, not merely on screen: the pause control is in its
    // running state and the countdown moves after the refused request.
    await expect(page.getByRole("button", { name: "pause", exact: true })).toBeVisible();
    const digits = page.locator("[data-session-timer-digits]");
    const firstReading = await digits.textContent();
    await expect
      .poll(() => digits.textContent(), "countdown advances after the rejected lock request")
      .not.toBe(firstReading);
    expect(pageErrors, "no uncaught error from the rejected wake lock").toEqual([]);
  });

  test("a browser without the Wake Lock API still runs the sit", async ({ page, ensureLoggedIn }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      // Remove the API the way an unsupported browser presents it.
      delete (Navigator.prototype as unknown as Record<string, unknown>).wakeLock;
    });
    await ensureLoggedIn();
    await tap(beginButton(page));

    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("#685 web minimal session view", () => {
  test("collapses to the timer and restores the full controls", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(beginButton(page));

    const collapse = page.getByRole("button", { name: "Show only the timer" });
    await tapWithControlReveal(page, collapse);

    const restore = page.getByRole("button", { name: "show session controls" });
    await expect(restore).toBeVisible();
    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
    await expect(soundToggles(page).first()).toBeHidden();
    await expect(page.getByRole("button", { name: "Show only the timer" })).toHaveCount(0);

    await restoreFullView(page);
    await expect(restore).toHaveCount(0);
    await expect(soundToggles(page).first()).toBeVisible();
  });
});

test.describe("#688 sound toggle pills @320px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 667 });
  });

  test("pills keep a 44px tap target with no horizontal overflow", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(beginButton(page));

    const toggles = soundToggles(page);
    await expect(toggles.first()).toBeVisible();
    const count = await toggles.count();
    expect(count, "sound pills rendered").toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i += 1) {
      await expectMinimumTapTarget(toggles.nth(i), `sound pill ${i}`);
    }
    await expectNoHorizontalOverflow(page);
  });

  // #688 acceptance: all four pills on one line at 320px. The two data-sound-toggle
  // pills wrap onto two rows here (measured tops 421px and 472px at 320px on
  // mobile-chromium-narrow). Tracked in Issue #1211; stays fixme until the layout is fixed.
  test.fixme("pills stay on one row at 320px (#688 acceptance, currently wraps)", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(beginButton(page));

    const toggles = soundToggles(page);
    await expect(toggles.first()).toBeVisible();
    const count = await toggles.count();
    const tops: number[] = [];
    for (let i = 0; i < count; i += 1) {
      tops.push((await toggles.nth(i).boundingBox())!.y);
    }
    expect(Math.max(...tops) - Math.min(...tops), `pill tops=${tops.join(",")}`).toBeLessThanOrEqual(3);
  });

  test("each pill exposes aria-pressed and flips it on tap", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(beginButton(page));

    const toggles = soundToggles(page);
    await expect(toggles.first()).toBeVisible();
    const count = await toggles.count();
    expect(count, "sound pills rendered").toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i += 1) {
      const pill = toggles.nth(i);
      const label = `sound pill ${i}`;
      const before = await pill.getAttribute("aria-pressed");
      expect(["true", "false"], `${label} aria-pressed`).toContain(before);

      await tapWithControlReveal(page, pill);
      await expect(pill, label).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
      await expect(pill, label).toHaveAttribute("data-state", before === "true" ? "off" : "on");
    }
  });
});

test.describe("#723 sit not saved when IndexedDB is refused", () => {
  test("a finished sit shows the not-saved banner and nothing reaches the server", async ({ page, ensureLoggedIn, mockApiState }) => {
    await page.addInitScript(REFUSE_INDEXED_DB);
    await ensureLoggedIn();
    await tap(beginButton(page));
    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));

    const banner = page.getByTestId("completion-not-stored");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("this sit was not saved");
    await expect(page.getByRole("button", { name: "retry save" })).toBeVisible();
    expect(mockApiState.sessions.length, "a sit the device refused is not uploaded").toBe(0);
  });

  test("an asynchronous IndexedDB refusal (onerror on a later task) shows the same banner", async ({ page, ensureLoggedIn, mockApiState }) => {
    await page.addInitScript(REFUSE_INDEXED_DB_ASYNC);
    await ensureLoggedIn();
    await tap(beginButton(page));
    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));

    const banner = page.getByTestId("completion-not-stored");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("this sit was not saved");
    expect(mockApiState.sessions.length, "an asynchronously refused sit is not uploaded").toBe(0);
  });
});
