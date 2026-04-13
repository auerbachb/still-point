/**
 * Buddy shared-session controls policy (#118, parent #92).
 *
 * ## Policy matrix (MVP)
 *
 * | Control / action | Scope | Who may use it | Server enforcement |
 * | ---------------- | ----- | -------------- | ------------------ |
 * | Tick / chime / end sounds | Local (device) | Everyone | N/A — client-only prefs |
 * | Mind state, thought capture (until #119) | Local (device) | Everyone | N/A |
 * | Ready toggle | Per-user lobby flag | In-lobby participants | PATCH …/ready |
 * | Start session | Global | Host only | POST …/start |
 * | Cancel session (lobby) | Global | Host only | POST …/cancel |
 * | Leave | Per-user row | Everyone | POST …/leave |
 * | Host leaves while session live | Global | — | Session → abandoned (no host transfer) |
 * | Participant leaves during active sit | Per-user | Participant | Others stay active |
 * | Timer (startedAt, duration, active→completed) | Global | Server reconcile only | No client mutation API |
 * | Participant complete (#119) | Per-user metadata | Participant | POST …/participant-complete |
 *
 * ## Host disconnect / leave
 *
 * If the host leaves and the session is not already completed or abandoned, the session
 * becomes abandoned for everyone. There is no automatic host promotion in MVP.
 *
 * ## #119 handoff
 *
 * `participant-complete` records per-user completion for journaling; it does not end the
 * shared timer or change session phase for other participants. Completion UI and journal
 * writes belong in #119.
 */

import { NextResponse } from "next/server";
import type { BuddySessionRow, BuddyParticipantRow } from "@/lib/buddySession";
import {
  BUDDY_POLICY_CODES,
  type BuddyPolicyCode,
} from "@/lib/buddyPolicyCodes";

export { BUDDY_POLICY_CODES, type BuddyPolicyCode };

export function buddyPolicyJson(
  status: 403 | 409,
  error: string,
  code: BuddyPolicyCode,
): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

/** Membership row must exist and not have left. */
export function requireBuddyActiveParticipant(
  p: BuddyParticipantRow | undefined,
): NextResponse | null {
  if (!p || p.leftAt != null) {
    return buddyPolicyJson(
      403,
      "Not in this session",
      BUDDY_POLICY_CODES.NOT_IN_SESSION,
    );
  }
  return null;
}

/** Start, cancel (lobby): host only, still in session. */
export function requireBuddyHost(p: BuddyParticipantRow | undefined): NextResponse | null {
  const inSession = requireBuddyActiveParticipant(p);
  if (inSession) return inSession;
  if (!p!.isHost) {
    return buddyPolicyJson(
      403,
      "Only the host can do that for everyone",
      BUDDY_POLICY_CODES.HOST_ONLY,
    );
  }
  return null;
}

export function requireLobbyForReady(session: BuddySessionRow): NextResponse | null {
  if (session.state !== "waiting" && session.state !== "ready_check") {
    return buddyPolicyJson(
      409,
      "Ready can only change before the session starts",
      BUDDY_POLICY_CODES.READY_LOBBY_ONLY,
    );
  }
  return null;
}

export function requireReadyCheckForStart(session: BuddySessionRow): NextResponse | null {
  if (session.state !== "ready_check") {
    return buddyPolicyJson(
      409,
      "Everyone must be ready and at least one guest must join before starting",
      BUDDY_POLICY_CODES.START_WRONG_PHASE,
    );
  }
  return null;
}

export function requireLobbyForCancel(session: BuddySessionRow): NextResponse | null {
  if (session.state !== "waiting" && session.state !== "ready_check") {
    return buddyPolicyJson(
      409,
      "Session cannot be cancelled now",
      BUDDY_POLICY_CODES.CANCEL_WRONG_PHASE,
    );
  }
  return null;
}

export function requireParticipantCompletePhase(sessionState: string): NextResponse | null {
  if (sessionState !== "active" && sessionState !== "completed") {
    return buddyPolicyJson(
      409,
      "Participant completion is only tracked during or after an active sit",
      BUDDY_POLICY_CODES.PARTICIPANT_COMPLETE_WRONG_PHASE,
    );
  }
  return null;
}

/**
 * When the host leaves, abandon the session for everyone if it is still "live".
 * Participants leaving never call this path — only the host branch in leave.
 */
export function hostLeaveShouldAbandonSession(session: BuddySessionRow): boolean {
  return session.state !== "completed" && session.state !== "abandoned";
}
