export type ChatAgentEffort = "low" | "medium" | "high" | "xhigh" | "max";

const DEFAULT_CHAT_AGENT_MODEL = "claude-fable-5";
const DEFAULT_CHAT_AGENT_EFFORT: ChatAgentEffort = "medium";
const DEFAULT_CHAT_STREAM_TIMEOUT_MS = 120_000;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAnthropicApiKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

export function getChatAgentModel(): string {
  const model = process.env.CHAT_AGENT_MODEL?.trim();
  return model || DEFAULT_CHAT_AGENT_MODEL;
}

export function getChatAgentEffort(): ChatAgentEffort {
  const effort = process.env.CHAT_AGENT_EFFORT?.trim() as ChatAgentEffort | undefined;
  const allowed: ChatAgentEffort[] = ["low", "medium", "high", "xhigh", "max"];
  return effort && allowed.includes(effort) ? effort : DEFAULT_CHAT_AGENT_EFFORT;
}

export function getChatStreamTimeoutMs(): number {
  return readPositiveInt("CHAT_STREAM_TIMEOUT_MS", DEFAULT_CHAT_STREAM_TIMEOUT_MS);
}

export function isFableModel(model: string): boolean {
  return model.startsWith("claude-fable-");
}
