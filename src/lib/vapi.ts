import "server-only";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";

export const REQUIRED_VAPI_ENV_VARS = [
  "VAPI_API_KEY",
  "VAPI_ASSISTANT_ID",
  "VAPI_PHONE_NUMBER_ID",
] as const;

const VAPI_CALL_URL = "https://api.vapi.ai/call";
const VAPI_REQUEST_TIMEOUT_MS = 10_000;

export type MissedSitCallContext = {
  userName: string;
  currentStreak: number;
  daysMissed: number;
};

export type InitiateMissedSitCallParams = {
  userId: string;
  phoneNumber: string;
  windowKey: string;
  context: MissedSitCallContext;
};

export type InitiateMissedSitCallResult =
  | { ok: true; callId: string; attemptId: string }
  | { ok: false; reason: string; attemptId?: string };

export function getVapiConfigStatus(): { configured: boolean; missing: string[] } {
  const missing = REQUIRED_VAPI_ENV_VARS.filter((name) => !process.env[name]);
  return { configured: missing.length === 0, missing: [...missing] };
}

export async function logCallAttempt(params: {
  userId: string;
  phoneNumber: string;
  windowKey: string;
  status: "initiated" | "failed";
  vapiCallId?: string | null;
  errorMessage?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(callAttempts)
    .values({
      userId: params.userId,
      phoneNumber: params.phoneNumber,
      windowKey: params.windowKey,
      status: params.status,
      vapiCallId: params.vapiCallId ?? null,
      errorMessage: params.errorMessage ?? null,
    })
    .returning({ id: callAttempts.id });

  return row.id;
}

export async function initiateMissedSitCall(
  params: InitiateMissedSitCallParams,
  fetchImpl: typeof fetch = fetch,
): Promise<InitiateMissedSitCallResult> {
  const { configured, missing } = getVapiConfigStatus();
  if (!configured) {
    const reason = `Vapi not configured (missing: ${missing.join(", ")})`;
    const attemptId = await logCallAttempt({
      userId: params.userId,
      phoneNumber: params.phoneNumber,
      windowKey: params.windowKey,
      status: "failed",
      errorMessage: reason,
    });
    return { ok: false, reason, attemptId };
  }

  const payload = {
    assistantId: process.env.VAPI_ASSISTANT_ID,
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: {
      number: params.phoneNumber,
    },
    assistantOverrides: {
      variableValues: {
        userName: params.context.userName,
        currentStreak: String(params.context.currentStreak),
        daysMissed: String(params.context.daysMissed),
      },
    },
  };

  try {
    const response = await fetchImpl(VAPI_CALL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(VAPI_REQUEST_TIMEOUT_MS),
    });

    const body = await response.json().catch(() => ({})) as { id?: string; message?: string };

    if (!response.ok) {
      const reason = body.message ?? `Vapi call failed (${response.status})`;
      const attemptId = await logCallAttempt({
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        windowKey: params.windowKey,
        status: "failed",
        errorMessage: reason,
      });
      return { ok: false, reason, attemptId };
    }

    const callId = body.id;
    if (!callId) {
      const reason = "Vapi call response missing id";
      const attemptId = await logCallAttempt({
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        windowKey: params.windowKey,
        status: "failed",
        errorMessage: reason,
      });
      return { ok: false, reason, attemptId };
    }

    try {
      const attemptId = await logCallAttempt({
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        windowKey: params.windowKey,
        status: "initiated",
        vapiCallId: callId,
      });
      return { ok: true, callId, attemptId };
    } catch (logError) {
      console.error("Vapi call placed but call_attempts insert failed:", logError);
      return { ok: true, callId };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Vapi call request failed";
    const attemptId = await logCallAttempt({
      userId: params.userId,
      phoneNumber: params.phoneNumber,
      windowKey: params.windowKey,
      status: "failed",
      errorMessage: reason,
    });
    return { ok: false, reason, attemptId };
  }
}
