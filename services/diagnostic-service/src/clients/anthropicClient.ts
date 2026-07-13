import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaCacheControlEphemeral,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import { getAnthropicApiKey } from "../config/env.js";
import { NotConfiguredError } from "./errors.js";

export const EPHEMERAL_CACHE_CONTROL: BetaCacheControlEphemeral = {
  type: "ephemeral",
};

export function isAnthropicConfigured(): boolean {
  return getAnthropicApiKey() != null;
}

export function createAnthropicClient(apiKey = getAnthropicApiKey()): Anthropic {
  if (!apiKey) {
    throw new NotConfiguredError("Anthropic", "ANTHROPIC_API_KEY is not set");
  }

  return new Anthropic({ apiKey });
}

export function getAnthropicClientOrNull(): Anthropic | null {
  const apiKey = getAnthropicApiKey();
  return apiKey ? createAnthropicClient(apiKey) : null;
}

export function withSystemCacheControl(block: BetaTextBlockParam): BetaTextBlockParam {
  return {
    ...block,
    cache_control: EPHEMERAL_CACHE_CONTROL,
  };
}
