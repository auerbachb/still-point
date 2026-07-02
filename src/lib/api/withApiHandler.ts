import { NextRequest, NextResponse } from "next/server";

export type ApiHandlerContext = unknown;

export type WithApiHandlerOptions = {
  /** Maps known errors to responses; return null/undefined to fall through to 500. */
  mapError?: (error: unknown) => NextResponse | null | undefined;
  /** Overrides default `console.error` logging before the 500 response. */
  logError?: (label: string, error: unknown) => void;
};

type ApiHandlerFn = (
  request?: NextRequest,
  context?: ApiHandlerContext,
) => Promise<NextResponse>;

function defaultLogError(label: string, error: unknown): void {
  console.error(`${label} error:`, error);
}

/**
 * Wraps a route handler with consistent uncaught-error handling.
 * Preserves each route's domain-specific status codes by only catching
 * errors that escape the handler body.
 */
export function withApiHandler(
  label: string,
  handler: ApiHandlerFn,
  options?: WithApiHandlerOptions,
): ApiHandlerFn {
  const logError = options?.logError ?? defaultLogError;
  const mapError = options?.mapError;

  return async (request?: NextRequest, context?: ApiHandlerContext) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const mapped = mapError?.(error);
      if (mapped) return mapped;
      logError(label, error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
