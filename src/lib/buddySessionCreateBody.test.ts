import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { readBuddySessionCreateBody } from "@/lib/buddySessionCreateBody";

describe("readBuddySessionCreateBody", () => {
  test("rejects client-provided durationSeconds", async () => {
    const request = new NextRequest("http://test.local/api/buddy/sessions", {
      method: "POST",
      body: JSON.stringify({ durationSeconds: 900 }),
    });

    const result = await readBuddySessionCreateBody(request);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(400);
      await expect(result.json()).resolves.toEqual({
        error: "Session length is set automatically for buddy sessions",
      });
    }
  });

  test("rejects non-ISO scheduledStartAt strings", async () => {
    const request = new NextRequest("http://test.local/api/buddy/sessions", {
      method: "POST",
      body: JSON.stringify({ scheduledStartAt: "2026-06-01" }),
    });

    const result = await readBuddySessionCreateBody(request);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(400);
      await expect(result.json()).resolves.toEqual({
        error: "scheduledStartAt must be an ISO timestamp",
      });
    }
  });

  test("rejects durationSeconds key even when null", async () => {
    const request = new NextRequest("http://test.local/api/buddy/sessions", {
      method: "POST",
      body: JSON.stringify({ durationSeconds: null }),
    });

    const result = await readBuddySessionCreateBody(request);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(400);
    }
  });
});
