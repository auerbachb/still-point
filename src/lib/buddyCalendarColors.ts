/** Client-safe buddy accent colors (#350). Shared by web UI and iOS parity docs. */

const BUDDY_CALENDAR_PALETTE = [
  "#5B8C7A",
  "#7A6B8C",
  "#8C7A5B",
  "#5B6F8C",
  "#8C5B6B",
  "#6B8C5B",
  "#8C6B5B",
  "#5B8C8C",
] as const;

/** Deterministic accent color from buddy user id (stable across unified + per-buddy views). */
export function buddyColorFromUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return BUDDY_CALENDAR_PALETTE[hash % BUDDY_CALENDAR_PALETTE.length];
}
