import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type ChatTurn = {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
};

export type GeminiTurnResult = {
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export type GeminiStreamChatOptions = {
  system: string;
  history: ChatTurn[];
  tools?: Tool[];
  signal?: AbortSignal;
};

export interface GeminiChatClient {
  isConfigured(): boolean;
  streamChat(
    options: GeminiStreamChatOptions,
  ): AsyncGenerator<string, GeminiTurnResult>;
}
