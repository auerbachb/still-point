import Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";

export type AnthropicCallOptions = {
  timeout: number;
  maxRetries: 0;
  signal?: AbortSignal;
};

export function anthropicCallOptions(timeoutMs: number, signal?: AbortSignal): AnthropicCallOptions {
  return {
    timeout: timeoutMs,
    maxRetries: 0,
    ...(signal ? { signal } : {}),
  };
}

export function isAnthropicTimeoutError(error: unknown): boolean {
  return (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError && /timed?\s*out/i.test(error.message))
  );
}

export function isAnthropicRateLimitError(error: unknown): boolean {
  return error instanceof APIError && error.status === 429;
}

export function classifyAnthropicError(error: unknown): "timeout" | "rate_limit" | "api" | "unknown" {
  if (isAnthropicTimeoutError(error)) {
    return "timeout";
  }
  if (isAnthropicRateLimitError(error)) {
    return "rate_limit";
  }
  if (error instanceof APIError) {
    return "api";
  }
  return "unknown";
}

export async function withAnthropicTimeout<T>(
  client: Anthropic,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  run: (options: AnthropicCallOptions) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await run(anthropicCallOptions(timeoutMs, controller.signal));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
