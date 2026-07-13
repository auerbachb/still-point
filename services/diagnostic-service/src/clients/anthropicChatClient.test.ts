import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnthropicChatClient,
  assistantTurnFromResult,
  buildToolResultTurn,
  historyIncludesParallelToolResults,
} from "./anthropicChatClient.js";
import type { ChatTurn } from "./geminiChatClient.js";

type StreamHandlers = {
  onText?: (delta: string) => void;
};

function makeTextStreamEvents(text: string): BetaRawMessageStreamEvent[] {
  return [
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "", citations: null },
    } as BetaRawMessageStreamEvent,
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    } as BetaRawMessageStreamEvent,
    {
      type: "content_block_stop",
      index: 0,
    } as BetaRawMessageStreamEvent,
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null, container: null, stop_details: null },
      usage: {
        output_tokens: 1,
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        iterations: [],
        server_tool_use: null,
      },
      context_management: null,
    } as unknown as BetaRawMessageStreamEvent,
    {
      type: "message_stop",
    } as BetaRawMessageStreamEvent,
  ];
}

function makeFinalMessage(overrides: Partial<BetaMessage> & Pick<BetaMessage, "content">): BetaMessage {
  return {
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "claude-fable-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      iterations: [],
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  } as BetaMessage;
}

function createMockStream(
  events: BetaRawMessageStreamEvent[],
  finalMessage: BetaMessage,
  handlers: StreamHandlers = {},
) {
  const controller = new AbortController();

  const stream = {
    controller,
    abort: vi.fn(() => {
      controller.abort();
    }),
    finalMessage: vi.fn(async () => finalMessage),
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          handlers.onText?.(event.delta.text);
        }
        yield event;
      }
    },
  };

  return stream;
}

function createMockAnthropic(streamFactory: () => ReturnType<typeof createMockStream>) {
  const stream = vi.fn(() => streamFactory());

  return {
    beta: {
      messages: {
        stream,
      },
    },
    _stream: stream,
  } as unknown as Anthropic & { _stream: ReturnType<typeof vi.fn> };
}

describe("AnthropicChatClient", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.CHAT_AGENT_MODEL = "claude-fable-5";
    process.env.CHAT_AGENT_EFFORT = "medium";
    process.env.CHAT_STREAM_TIMEOUT_MS = "30000";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CHAT_AGENT_MODEL;
    delete process.env.CHAT_AGENT_EFFORT;
    delete process.env.CHAT_STREAM_TIMEOUT_MS;
  });

  it("streams a text-only turn and returns end_turn result", async () => {
    const finalMessage = makeFinalMessage({
      content: [{ type: "text", text: "Hello there", citations: null }],
    });
    const mockClient = createMockAnthropic(() =>
      createMockStream(makeTextStreamEvents("Hello there"), finalMessage),
    );
    const client = new AnthropicChatClient(mockClient);

    const chunks: string[] = [];
    const iterator = client.streamChat({
      system: "You are helpful",
      history: [{ role: "user", content: "Hi" }],
    });

    let result;
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      chunks.push(next.value);
    }

    expect(chunks.join("")).toBe("Hello there");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolUses).toEqual([]);
    expect(result.text).toBe("Hello there");
    const [requestParams, requestOptions] = mockClient._stream.mock.calls[0] ?? [];
    expect(requestParams.model).toBe("claude-fable-5");
    expect(requestParams.output_config).toEqual({ effort: "medium" });
    expect(requestParams.betas).toEqual(["server-side-fallback-2026-06-01"]);
    expect(requestParams.fallbacks).toEqual([{ model: "claude-opus-4-8" }]);
    expect(requestParams).not.toHaveProperty("tools");
    expect(requestOptions).toMatchObject({ maxRetries: 0, timeout: 30000 });
  });

  it("behaves like plain chat when no tools are passed", async () => {
    const finalMessage = makeFinalMessage({
      content: [{ type: "text", text: "Plain reply", citations: null }],
    });
    const mockClient = createMockAnthropic(() =>
      createMockStream(makeTextStreamEvents("Plain reply"), finalMessage),
    );
    const client = new AnthropicChatClient(mockClient);

    const iterator = client.streamChat({
      system: "system",
      history: [{ role: "user", content: "question" }],
    });

    const next = await iterator.next();
    expect(next.done).toBe(false);
    expect(next.value).toBe("Plain reply");

    const done = await iterator.next();
    expect(done.done).toBe(true);
    if (!done.done) {
      throw new Error("expected generator to finish");
    }
    expect(done.value.stopReason).toBe("end_turn");
    expect(mockClient._stream.mock.calls[0]?.[0]).not.toHaveProperty("tools");
  });

  it("returns parallel tool_use blocks for a single tool round-trip", async () => {
    const toolBlocks: BetaToolUseBlock[] = [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "lookup",
        input: { q: "a" },
      },
      {
        type: "tool_use",
        id: "toolu_2",
        name: "lookup",
        input: { q: "b" },
      },
    ];

    const finalMessage = makeFinalMessage({
      stop_reason: "tool_use",
      content: toolBlocks,
    });

    const mockClient = createMockAnthropic(() => createMockStream([], finalMessage));
    const client = new AnthropicChatClient(mockClient);

    const iterator = client.streamChat({
      system: "system",
      history: [{ role: "user", content: "run tools" }],
      tools: [
        {
          name: "lookup",
          description: "lookup values",
          input_schema: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
    });

    const result = await iterator.next();
    expect(result.done).toBe(true);
    if (!result.done) {
      throw new Error("expected generator to finish");
    }
    expect(result.value.stopReason).toBe("tool_use");
    expect(result.value.toolUses).toEqual([
      { id: "toolu_1", name: "lookup", input: { q: "a" } },
      { id: "toolu_2", name: "lookup", input: { q: "b" } },
    ]);
  });

  it("builds a single user message with parallel tool_result blocks", () => {
    const turn = buildToolResultTurn(
      [
        { id: "toolu_1", name: "lookup", input: {} },
        { id: "toolu_2", name: "lookup", input: {} },
      ],
      [
        { toolUseId: "toolu_1", content: "result-a" },
        { toolUseId: "toolu_2", content: "result-b" },
      ],
    );

    expect(turn.role).toBe("user");
    expect(Array.isArray(turn.content)).toBe(true);
    expect(turn.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "result-a" },
      { type: "tool_result", tool_use_id: "toolu_2", content: "result-b" },
    ]);
    expect(historyIncludesParallelToolResults([turn])).toBe(true);
  });

  it("handles refusal fallback blocks from the final message", async () => {
    const finalMessage = makeFinalMessage({
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [
        {
          type: "fallback",
          from: { model: "claude-fable-5" },
          to: { model: "claude-opus-4-8" },
          trigger: { type: "refusal", category: "cyber" },
        },
        { type: "text", text: "Safe alternative answer", citations: null },
      ],
    });

    const mockClient = createMockAnthropic(() =>
      createMockStream(makeTextStreamEvents("Safe alternative answer"), finalMessage),
    );
    const client = new AnthropicChatClient(mockClient);

    const iterator = client.streamChat({
      system: "system",
      history: [{ role: "user", content: "risky" }],
    });

    const chunks: string[] = [];
    let result;
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      chunks.push(next.value);
    }

    expect(result.hadFallback).toBe(true);
    expect(result.model).toBe("claude-opus-4-8");
    expect(result.text).toBe("Safe alternative answer");
  });

  it("maps assistant tool_use turns back into history for continuation", () => {
    const turn = assistantTurnFromResult({
      stopReason: "tool_use",
      text: "",
      toolUses: [{ id: "toolu_1", name: "lookup", input: { q: "a" } }],
      assistantMessage: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "lookup",
            input: { q: "a" },
          },
        ],
      },
      hadFallback: false,
    });

    expect(turn).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "a" } }],
    });
  });

  it("aborts mid-stream and cleans up the underlying stream", async () => {
    const controller = new AbortController();
    const abortSpy = vi.fn();
    const finalMessage = makeFinalMessage({
      content: [{ type: "text", text: "partial", citations: null }],
    });

    const mockClient = createMockAnthropic(() => {
      const stream = createMockStream(makeTextStreamEvents("partial"), finalMessage);
      stream.abort = abortSpy;
      stream.finalMessage = vi.fn(async () => {
        throw new Error("finalMessage should not run after abort");
      });
      return stream;
    });

    const client = new AnthropicChatClient(mockClient);
    const iterator = client.streamChat({
      system: "system",
      history: [{ role: "user", content: "abort me" }],
      signal: controller.signal,
    });

    const first = await iterator.next();
    expect(first.done).toBe(false);
    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(abortSpy).toHaveBeenCalled();
  });

  it("supports tool round-trip history with assistant tool_use blocks", async () => {
    const finalMessage = makeFinalMessage({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "done", citations: null }],
    });
    const mockClient = createMockAnthropic(() => createMockStream([], finalMessage));
    const client = new AnthropicChatClient(mockClient);

    const history: ChatTurn[] = [
      { role: "user", content: "lookup both" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "a" } }],
      },
      buildToolResultTurn([{ id: "toolu_1", name: "lookup", input: {} }], [
        { toolUseId: "toolu_1", content: "found" },
      ]),
    ];

    const iterator = client.streamChat({ system: "sys", history });
    const result = await iterator.next();
    expect(result.done).toBe(true);
    if (!result.done) {
      throw new Error("expected generator to finish");
    }
    expect(result.value.stopReason).toBe("end_turn");

    const params = mockClient._stream.mock.calls[0]?.[0];
    expect(params.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "a" } }],
    });
    expect(params.messages[2].role).toBe("user");
  });

  it("supports claude-opus-4-8 via CHAT_AGENT_MODEL without fable fallbacks", async () => {
    process.env.CHAT_AGENT_MODEL = "claude-opus-4-8";

    const finalMessage = makeFinalMessage({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "Opus reply", citations: null }],
    });
    const mockClient = createMockAnthropic(() =>
      createMockStream(makeTextStreamEvents("Opus reply"), finalMessage),
    );
    const client = new AnthropicChatClient(mockClient);

    const iterator = client.streamChat({
      system: "system",
      history: [{ role: "user", content: "hello" }],
    });

    while (!(await iterator.next()).done) {
      // drain chunks
    }

    const params = mockClient._stream.mock.calls[0]?.[0];
    expect(params.model).toBe("claude-opus-4-8");
    expect(params).not.toHaveProperty("betas");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("output_config");
  });

  it("applies cache_control to system and the last history turn", async () => {
    const finalMessage = makeFinalMessage({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    const mockClient = createMockAnthropic(() => createMockStream([], finalMessage));
    const client = new AnthropicChatClient(mockClient);

    const history: ChatTurn[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "middle" },
      { role: "user", content: "last" },
    ];

    const iterator = client.streamChat({ system: "sys", history });
    await iterator.next();

    const params = mockClient._stream.mock.calls[0]?.[0];
    expect(params.system).toEqual([
      { type: "text", text: "sys", cache_control: { type: "ephemeral" } },
    ]);
    expect(params.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "last", cache_control: { type: "ephemeral" } }],
    });
    expect(params.messages[0]).toEqual({ role: "user", content: "first" });
  });
});

describe("AnthropicChatClient configuration", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("reports unconfigured when ANTHROPIC_API_KEY is missing", () => {
    const client = new AnthropicChatClient(null);
    expect(client.isConfigured()).toBe(false);
  });
});
