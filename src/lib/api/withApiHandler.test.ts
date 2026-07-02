import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { withApiHandler } from "./withApiHandler";

describe("withApiHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns handler response on success", async () => {
    const handler = withApiHandler("Test route", async () =>
      NextResponse.json({ ok: true }),
    );

    const response = await handler();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("returns 500 on uncaught error with default logging", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiHandler("Test route", async () => {
      throw new Error("boom");
    });

    const response = await handler();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
    expect(consoleError).toHaveBeenCalledWith("Test route error:", expect.any(Error));
  });

  test("uses mapError when provided", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiHandler(
      "Test route",
      async () => {
        throw new Error("conflict");
      },
      {
        mapError: (error) => {
          if (error instanceof Error && error.message === "conflict") {
            return NextResponse.json({ error: "Conflict" }, { status: 409 });
          }
          return null;
        },
      },
    );

    const response = await handler();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Conflict" });
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("passes request and context through", async () => {
    const handler = withApiHandler(
      "Test route",
      async (request: NextRequest, context: { params: { id: string } }) => {
        return NextResponse.json({
          method: request.method,
          id: context.params.id,
        });
      },
    );

    const request = new NextRequest("http://test.local/api/x", { method: "PATCH" });
    const response = await handler(request, { params: { id: "abc" } });

    await expect(response.json()).resolves.toEqual({ method: "PATCH", id: "abc" });
  });
});
