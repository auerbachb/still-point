// localStorage preference for the breath-counting key binding (#376).
// Mirrors the audio.ts / wakeLockPrefs.ts persistence + cross-tab subscription
// pattern. The breath view binds a single key that registers a breath (tap);
// the default is Space, with Right Arrow as the alternate.

/** Canonical key bindings the breath view understands. Values are
 *  `KeyboardEvent.code` strings so they are layout-independent. */
export const BREATH_KEY_BINDINGS = ["Space", "ArrowRight"] as const;
export type BreathKeyBinding = (typeof BREATH_KEY_BINDINGS)[number];

export const DEFAULT_BREATH_KEY_BINDING: BreathKeyBinding = "Space";

/** Human-readable label for a binding (settings UI + view hint). */
export function breathKeyBindingLabel(binding: BreathKeyBinding): string {
  switch (binding) {
    case "Space":
      return "Space";
    case "ArrowRight":
      return "Right Arrow";
  }
}

function isBreathKeyBinding(value: unknown): value is BreathKeyBinding {
  return typeof value === "string" && (BREATH_KEY_BINDINGS as readonly string[]).includes(value);
}

const STORAGE_KEY = "stillpoint_breath_key_binding";

export function loadBreathKeyBinding(): BreathKeyBinding {
  if (typeof window === "undefined") return DEFAULT_BREATH_KEY_BINDING;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BREATH_KEY_BINDING;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_BREATH_KEY_BINDING;
    const value = (parsed as Record<string, unknown>).binding;
    return isBreathKeyBinding(value) ? value : DEFAULT_BREATH_KEY_BINDING;
  } catch {
    return DEFAULT_BREATH_KEY_BINDING;
  }
}

export function saveBreathKeyBinding(binding: BreathKeyBinding): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ binding }));
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
  notifyBreathKeyBindingListeners();
}

/**
 * True when `event` matches `binding`. Compares `KeyboardEvent.code` first
 * (layout-independent), and also accepts legacy `event.key` values for Space
 * (`" "` / `"Spacebar"`) and ArrowRight (`"Right"`) so older browsers that
 * don't populate `event.code` still register taps.
 */
export function eventMatchesBreathKeyBinding(
  event: Pick<KeyboardEvent, "code" | "key">,
  binding: BreathKeyBinding,
): boolean {
  if (event.code === binding) return true;
  if (binding === "Space") return event.key === " " || event.key === "Spacebar";
  if (binding === "ArrowRight") return event.key === "ArrowRight" || event.key === "Right";
  return false;
}

type BreathKeyBindingListener = () => void;

const listeners = new Set<BreathKeyBindingListener>();

function onStorageEvent(e: StorageEvent): void {
  // key === null means the whole storage area was cleared.
  if (e.key === STORAGE_KEY || e.key === null) notifyBreathKeyBindingListeners();
}

function notifyBreathKeyBindingListeners(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to breath key-binding changes: same-tab saves via
 * `saveBreathKeyBinding` and cross-tab changes via the `storage` event.
 * Returns an unsubscribe function (`useSyncExternalStore`-compatible).
 */
export function subscribeBreathKeyBinding(listener: BreathKeyBindingListener): () => void {
  if (typeof window !== "undefined" && listeners.size === 0) {
    window.addEventListener("storage", onStorageEvent);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}
