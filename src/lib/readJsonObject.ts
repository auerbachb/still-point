import { NextResponse } from "next/server";

export type ReadJsonObjectResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

/** Rejects invalid JSON, `null`, arrays, and non-objects with 400. */
export async function readJsonObject(request: Request): Promise<ReadJsonObjectResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}
