// URL-driven tabs. The first path segment of /app/[[...tab]] selects the tab;
// `/app` (no segment) resolves to the Progress tab.
export type Tab =
  | "progress"
  | "history"
  | "journal"
  | "board"
  | "friends"
  | "settings"
  | "buddy";

// Tabs that appear in the persistent nav, in display order. `buddy` is reached
// from the Progress screen rather than the nav, so it is intentionally omitted.
export const NAV_TABS: readonly Tab[] = ["progress", "history", "journal", "board", "friends", "settings"];

export const ALL_TABS: readonly Tab[] = [...NAV_TABS, "buddy"];

export const DEFAULT_TAB: Tab = "progress";

// Visible nav labels are decoupled from the route slug: the Progress tab keeps
// its existing "home" label (shorter, so the 6-item mobile nav row stays
// readable) while living at /app/progress.
export const TAB_LABELS: Readonly<Record<Tab, string>> = {
  progress: "home",
  history: "history",
  journal: "journal",
  board: "board",
  friends: "friends",
  settings: "settings",
  buddy: "buddy",
};

export function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (ALL_TABS as readonly string[]).includes(value);
}

export function pathForTab(tab: Tab): string {
  return `/app/${tab}`;
}
