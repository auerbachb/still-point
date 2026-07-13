import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolUseBlock,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import {
  getChatAgentEffort,
  getChatAgentModel,
  getChatStreamTimeoutMs,
  isFableModel,
} from "../config/env.js";
import {
  createAnthropicClient,
  EPHEMERAL_CACHE_CONTROL,
  getAnthropicClientOrNull,
  isAnthropicConfigured,
  withSystemCacheControl,
} from "./anthropicClient.js";
import type { ChatContentBlock, ChatTurn } from "./geminiChatClient.js";
import { anthropicCallOptions } from "../services/scoring/anthropic.provider.js";

export type AnthropicToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicTurnResult = {
  stopReason: string;
  assistantMessage: BetaMessageParam;
  text: string;
  toolUses: AnthropicToolUse[];
  usage?: BetaUsage;
  model?: string;
  hadFallback: boolean;
};

export type AnthropicStreamChatOptions = {
  system: string;
  history: ChatTurn[];
  tools?: Tool[];
  signal?: AbortSignal;
  model?: string;
  maxTokens?: number;
};

const FABLE_REFUSAL_BETAS = ["server-side-fallback-2026-06-01"] as const;
const FABLE_REFUSAL_FALLBACKS = [{ model: "claude-opus-4-8" as const }];

function isToolUseBlock(block: ChatContentBlock): block is Extract<ChatContentBlock, { type: "tool_use" }> {
  return block.type === "tool_use";
}

function isToolResultBlock(block: ChatContentBlock): block is Extract<ChatContentBlock, { type: "tool_result" }> {
  return block.type === "tool_result";
}

function toBetaMessageParams(history: ChatTurn[]): BetaMessageParam[] {
  return history.map((turn) => {
    if (typeof turn.content === "string") {
      return {
        role: turn.role,
        content: turn.content,
      };
    }

    return {
      role: turn.role,
      content: turn.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        if (isToolUseBlock(block)) {
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        return {
          type: "tool_result" as const,
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error ? { is_error: true } : {}),
        };
      }),
    };
  });
}

function applyPromptCaching(system: string, messages: BetaMessageParam[]): {
  system: Anthropic.Beta.Messages.MessageCreateParams["system"];
  messages: BetaMessageParam[];
} {
  const cachedSystem: BetaTextBlockParam[] = [
    withSystemCacheControl({
      type: "text",
      text: system,
    }),
  ];

  if (messages.length === 0) {
    return { system: cachedSystem, messages };
  }

  const cachedMessages = messages.map((message, index) => {
    if (index !== messages.length - 1) {
      return message;
    }

    if (typeof message.content === "string") {
      return {
        ...message,
        content: [
          {
            type: "text" as const,
            text: message.content,
            cache_control: EPHEMERAL_CACHE_CONTROL,
          },
        ],
      };
    }

    const blocks = [...message.content];
    const lastBlock = blocks.at(-1);
    if (lastBlock && typeof lastBlock === "object" && "type" in lastBlock) {
      blocks[blocks.length - 1] = {
        ...lastBlock,
        cache_control: EPHEMERAL_CACHE_CONTROL,
      } as typeof lastBlock;
    }

    return {
      ...message,
      content: blocks,
    };
  });

  return { system: cachedSystem, messages: cachedMessages };
}

function extractTextFromMessage(message: BetaMessage | BetaMessageParam): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((block): block is Extract<BetaContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractToolUses(message: BetaMessage): AnthropicToolUse[] {
  return message.content
    .filter((block): block is BetaToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    }));
}

function messageToAssistantParam(message: BetaMessage): BetaMessageParam {
  return {
    role: "assistant",
    content: message.content,
  };
}

function buildRequestParams(
  options: AnthropicStreamChatOptions,
): Anthropic.Beta.Messages.MessageCreateParams {
  const model = options.model ?? getChatAgentModel();
  const messages = toBetaMessageParams(options.history);
  const cached = applyPromptCaching(options.system, messages);

  const params: Anthropic.Beta.Messages.MessageCreateParams = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    system: cached.system,
    messages: cached.messages,
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };

  if (isFableModel(model)) {
    params.output_config = { effort: getChatAgentEffort() };
    params.betas = [...FABLE_REFUSAL_BETAS];
    params.fallbacks = [...FABLE_REFUSAL_FALLBACKS];
  }

  return params;
}

export class AnthropicChatClient {
  private readonly client: Anthropic | null;

  constructor(client?: Anthropic | null) {
    this.client = client === undefined ? getAnthropicClientOrNull() : client;
  }

  isConfigured(): boolean {
    return this.client != null || isAnthropicConfigured();
  }

  private requireClient(): Anthropic {
    if (this.client) {
      return this.client;
    }
    return createAnthropicClient();
  }

  async *streamChat(
    options: AnthropicStreamChatOptions,
  ): AsyncGenerator<string, AnthropicTurnResult> {
    const client = this.requireClient();
    const params = buildRequestParams(options);
    const timeoutMs = getChatStreamTimeoutMs();
    const controller = new AbortController();

    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    const stream = client.beta.messages.stream(params, anthropicCallOptions(timeoutMs, controller.signal));

    let streamedText = "";
    let aborted = false;

    const abortStream = () => {
      if (aborted) {
        return;
      }
      aborted = true;
      stream.abort();
    };

    if (options.signal?.aborted) {
      abortStream();
      throw new DOMException("Anthropic chat stream aborted", "AbortError");
    }

    options.signal?.addEventListener("abort", abortStream, { once: true });

    try {
      for await (const event of stream) {
        if (options.signal?.aborted || controller.signal.aborted) {
          abortStream();
          throw new DOMException("Anthropic chat stream aborted", "AbortError");
        }

        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          streamedText += event.delta.text;
          yield event.delta.text;
        }
      }

      if (options.signal?.aborted || controller.signal.aborted) {
        abortStream();
        throw new DOMException("Anthropic chat stream aborted", "AbortError");
      }

      const finalMessage = await stream.finalMessage();
      const stopReason = finalMessage.stop_reason ?? "end_turn";
      const hadFallback = finalMessage.content.some((block) => block.type === "fallback");

      if (stopReason === "refusal" && !hadFallback) {
        throw new Error("Anthropic chat turn refused without fallback");
      }

      const toolUses = extractToolUses(finalMessage);
      const text = extractTextFromMessage(finalMessage) || streamedText;

      return {
        stopReason,
        assistantMessage: messageToAssistantParam(finalMessage),
        text,
        toolUses,
        usage: finalMessage.usage,
        model: finalMessage.model,
        hadFallback,
      };
    } catch (error) {
      if (options.signal?.aborted || controller.signal.aborted) {
        abortStream();
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", onExternalAbort);
      options.signal?.removeEventListener("abort", abortStream);
    }
  }
}

export function assistantTurnFromResult(result: AnthropicTurnResult): ChatTurn {
  if (typeof result.assistantMessage.content === "string") {
    return {
      role: "assistant",
      content: result.assistantMessage.content,
    };
  }

  return {
    role: "assistant",
    content: result.assistantMessage.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      throw new Error(`unsupported assistant block type for chat history: ${block.type}`);
    }),
  };
}

export function buildToolResultTurn(
  toolUses: AnthropicToolUse[],
  results: Array<{ toolUseId: string; content: string; isError?: boolean }>,
): ChatTurn {
  if (toolUses.length !== results.length) {
    throw new Error("tool result count must match tool_use count");
  }

  const resultById = new Map(results.map((result) => [result.toolUseId, result]));

  return {
    role: "user",
    content: toolUses.map((toolUse) => {
      const result = resultById.get(toolUse.id);
      if (!result) {
        throw new Error(`missing tool result for ${toolUse.id}`);
      }

      const block: ChatContentBlock = {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      };
      return block;
    }),
  };
}

export function historyIncludesParallelToolResults(history: ChatTurn[]): boolean {
  return history.some(
    (turn) =>
      turn.role === "user" &&
      Array.isArray(turn.content) &&
      turn.content.filter(isToolResultBlock).length > 1,
  );
}
