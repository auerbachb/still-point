import { NextRequest, NextResponse } from "next/server";

export type ApiHandlerContext = unknown;

export type RouteParams<T extends Record<string, string>> = {
  params: Promise<T>;
};

export type WithApiHandlerOptions = {
  /** Maps known errors to responses; return null/undefined to fall through to 500. */
  mapError?: (error: unknown) => NextResponse | null | undefined;
  /** Overrides default `console.error` logging before the 500 response. */
  logError?: (label: string, error: unknown) => void;
};

function defaultLogError(label: string, error: unknown): void {
  console.error(`${label} error:`, error);
}

function wrapHandler(
  label: string,
  handler: (...args: never[]) => Promise<NextResponse>,
  options?: WithApiHandlerOptions,
) {
  const logError = options?.logError ?? defaultLogError;
  const mapError = options?.mapError;

  return (...args: never[]) => {
    const run = async () => {
      try {
        return await handler(...args);
      } catch (error) {
        try {
          const mapped = mapError?.(error);
          if (mapped) return mapped;
        } catch (mapErrorError) {
          defaultLogError(`${label} mapError error:`, mapErrorError);
        }
        try {
          logError(label, error);
        } catch (logErrorError) {
          defaultLogError(`${label} logError error:`, logErrorError);
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
    };
    return run();
  };
}

/**
 * Wraps a route handler with consistent uncaught-error handling.
 * Preserves each route's domain-specific status codes by only catching
 * errors that escape the handler body.
 */
export function withApiHandler(
  label: string,
  handler: () => Promise<NextResponse>,
  options?: WithApiHandlerOptions,
): () => Promise<NextResponse>;

export function withApiHandler(
  label: string,
  handler: (request: NextRequest) => Promise<NextResponse>,
  options?: WithApiHandlerOptions,
): (request: NextRequest) => Promise<NextResponse>;

export function withApiHandler<TContext extends ApiHandlerContext>(
  label: string,
  handler: (request: NextRequest, context: TContext) => Promise<NextResponse>,
  options?: WithApiHandlerOptions,
): (request: NextRequest, context: TContext) => Promise<NextResponse>;

export function withApiHandler(
  label: string,
  handler: (...args: never[]) => Promise<NextResponse>,
  options?: WithApiHandlerOptions,
): (...args: never[]) => Promise<NextResponse> {
  return wrapHandler(label, handler, options);
}
