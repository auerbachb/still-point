/**
 * Stable API error codes for buddy session policy (#118). Safe to import from client code.
 */

export const BUDDY_POLICY_CODES = {
  NOT_IN_SESSION: "BUDDY_NOT_IN_SESSION",
  HOST_ONLY: "BUDDY_HOST_ONLY",
  READY_LOBBY_ONLY: "BUDDY_READY_LOBBY_ONLY",
  START_WRONG_PHASE: "BUDDY_START_WRONG_PHASE",
  CANCEL_WRONG_PHASE: "BUDDY_CANCEL_WRONG_PHASE",
  PARTICIPANT_COMPLETE_WRONG_PHASE: "BUDDY_PARTICIPANT_COMPLETE_WRONG_PHASE",
  /** Shared sit must be server-completed before recording a personal history row (#119). */
  RECORD_PERSONAL_WRONG_PHASE: "BUDDY_RECORD_PERSONAL_WRONG_PHASE",
} as const;

export type BuddyPolicyCode = (typeof BUDDY_POLICY_CODES)[keyof typeof BUDDY_POLICY_CODES];

/** Same string in JSON `error` and UI for `START_WRONG_PHASE`. */
export const BUDDY_START_WRONG_PHASE_MESSAGE =
  "Starting is not available until everyone is ready." as const;

/** Short copy for inline UI when the server returns a policy code. */
const USER_FACING: Record<BuddyPolicyCode, string> = {
  [BUDDY_POLICY_CODES.NOT_IN_SESSION]:
    "You are no longer in this session. You can go back or join again with the link.",
  [BUDDY_POLICY_CODES.HOST_ONLY]: "Only the host can do that for everyone.",
  [BUDDY_POLICY_CODES.READY_LOBBY_ONLY]: "Ready can only change before the sit starts.",
  [BUDDY_POLICY_CODES.START_WRONG_PHASE]: BUDDY_START_WRONG_PHASE_MESSAGE,
  [BUDDY_POLICY_CODES.CANCEL_WRONG_PHASE]: "This session can no longer be cancelled from here.",
  [BUDDY_POLICY_CODES.PARTICIPANT_COMPLETE_WRONG_PHASE]:
    "That step is only available during or after the shared sit.",
  [BUDDY_POLICY_CODES.RECORD_PERSONAL_WRONG_PHASE]:
    "Your personal session is saved only after the shared timer has finished.",
};

export function buddyPolicyUserMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return USER_FACING[code as BuddyPolicyCode];
}
