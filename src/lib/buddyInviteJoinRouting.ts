// #990: where a `?buddy=` join the server accepted may take the user on the web.
//
// The app page's invite effect starts `api.joinBuddySession(token)` when someone is
// signed in and no sit is up. The request is an await, so the screen that decision
// was made for can be gone by the time the server answers: the user may have tapped
// Begin in between. Routing then closed the sit overlay on them and spent the invite.
//
// A sit, a breath sit, a focus activity or a completion screen holds the invite: the
// join leaves the overlay and the route alone, and `?buddy=` stays in the URL. The
// effect runs again once the overlay closes, and that join opens the buddy room. The
// server takes a repeat join by an existing participant as a rejoin
// (`src/app/api/buddy/sessions/join/route.ts`), so the retry costs one request.
//
// The focus category picker does not hold it. It is a dialog over Home with nothing
// in progress, so the buddy room may replace it. Mirrors `BuddyInviteJoinRouting` in
// `StillPointShared` (iOS, #856).

/** The app page's transient overlays (`Overlay` in `src/app/app/[[...tab]]/page.tsx`). */
export type AppOverlay = "session" | "breath" | "focusPicker" | "focus" | "complete";

export type BuddyInviteJoinDecision =
  /** Open the buddy room. The invite is spent. */
  | "route"
  /** The effect that started the join was torn down (sign-out, new account, URL
   *  change). Nothing routes. */
  | "stale"
  /** A sit or its completion screen is up. `?buddy=` stays for a later join. */
  | "deferForSession";

/** Whether `overlay` is a sit or its completion screen, which a buddy invite waits for. */
export function overlayHoldsBuddyInvite(overlay: AppOverlay | null): boolean {
  return overlay === "session" || overlay === "breath" || overlay === "focus" || overlay === "complete";
}

/** Whether the invite effect may start a join now. */
export function mayStartBuddyInviteJoin(overlay: AppOverlay | null): boolean {
  return !overlayHoldsBuddyInvite(overlay);
}

/**
 * Decide what an accepted join does, read after the request returns.
 * @param cancelled the effect that started the join has been cleaned up.
 * @param overlay the overlay on screen now.
 */
export function buddyInviteJoinDecision({
  cancelled,
  overlay,
}: {
  cancelled: boolean;
  overlay: AppOverlay | null;
}): BuddyInviteJoinDecision {
  if (cancelled) return "stale";
  if (overlayHoldsBuddyInvite(overlay)) return "deferForSession";
  return "route";
}

/**
 * `path` with the pending `?buddy=` token from `search` carried over, so a navigation
 * that ends a sit (the completion screen's Return) keeps the invite for the join that
 * runs after it. Any other query is dropped, as before.
 */
export function pathKeepingBuddyInvite(path: string, search: string): string {
  const token = new URLSearchParams(search).get("buddy")?.trim();
  if (!token) return path;
  return `${path}?${new URLSearchParams({ buddy: token }).toString()}`;
}
