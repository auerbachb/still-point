import { ApiError } from "@/lib/api";
import { buddyPolicyUserMessage } from "@/lib/buddyPolicyCodes";

export function formatBuddyActionError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    return buddyPolicyUserMessage(e.code) ?? e.message;
  }
  return e instanceof Error ? e.message : fallback;
}

export function formatScheduledStart(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
