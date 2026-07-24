import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const dbInsert = vi.fn(() => ({ values: insertValues }));

vi.mock("@/db", () => ({
  db: {
    insert: dbInsert,
  },
}));

vi.mock("@/db/schema", () => ({
  callAttempts: {
    id: "id",
  },
}));

describe("initiateMissedSitCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.VAPI_API_KEY;
    delete process.env.VAPI_ASSISTANT_ID;
    delete process.env.VAPI_PHONE_NUMBER_ID;
    insertReturning.mockResolvedValue([{ id: "attempt-1" }]);
  });

  test("returns ok:false when Vapi env is missing", async () => {
    const { initiateMissedSitCall } = await import("./vapi");
    const fetchMock = vi.fn();

    const result = await initiateMissedSitCall({
      userId: "user-1",
      phoneNumber: "+15551234567",
      windowKey: "2026-05-29T14",
      context: { userName: "Alex", currentStreak: 3, daysMissed: 1 },
    }, fetchMock);

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("Vapi not configured"),
      attemptId: "attempt-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbInsert).toHaveBeenCalled();
  });

  test("posts Vapi payload with assistantOverrides.variableValues", async () => {
    process.env.VAPI_API_KEY = "test-key";
    process.env.VAPI_ASSISTANT_ID = "asst-123";
    process.env.VAPI_PHONE_NUMBER_ID = "phone-456";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "call-789" }),
    });

    const { initiateMissedSitCall } = await import("./vapi");
    const result = await initiateMissedSitCall({
      userId: "user-1",
      phoneNumber: "+15551234567",
      windowKey: "2026-05-29T14",
      context: { userName: "Alex", currentStreak: 5, daysMissed: 2 },
    }, fetchMock);

    expect(result).toEqual({ ok: true, callId: "call-789", attemptId: "attempt-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.vapi.ai/call",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
        body: JSON.stringify({
          assistantId: "asst-123",
          phoneNumberId: "phone-456",
          customer: { number: "+15551234567" },
          assistantOverrides: {
            variableValues: {
              userName: "Alex",
              currentStreak: "5",
              daysMissed: "2",
            },
          },
        }),
      }),
    );
  });

  test("returns ok:false when Vapi responds with error", async () => {
    process.env.VAPI_API_KEY = "test-key";
    process.env.VAPI_ASSISTANT_ID = "asst-123";
    process.env.VAPI_PHONE_NUMBER_ID = "phone-456";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "invalid phone" }),
    });

    const { initiateMissedSitCall } = await import("./vapi");
    const result = await initiateMissedSitCall({
      userId: "user-1",
      phoneNumber: "+15551234567",
      windowKey: "2026-05-29T14",
      context: { userName: "Alex", currentStreak: 0, daysMissed: 1 },
    }, fetchMock);

    expect(result).toEqual({
      ok: false,
      reason: "invalid phone",
      attemptId: "attempt-1",
    });
  });
});

describe("getVapiConfigStatus", () => {
  test("reports missing env vars", async () => {
    delete process.env.VAPI_API_KEY;
    delete process.env.VAPI_ASSISTANT_ID;
    delete process.env.VAPI_PHONE_NUMBER_ID;
    vi.resetModules();
    const { getVapiConfigStatus } = await import("./vapi");
    expect(getVapiConfigStatus()).toEqual({
      configured: false,
      missing: ["VAPI_API_KEY", "VAPI_ASSISTANT_ID", "VAPI_PHONE_NUMBER_ID"],
    });
  });
});
