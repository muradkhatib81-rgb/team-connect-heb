/** Server-only AI provider API keys — never exposed to the client. */

import { readServerEnv } from "./server-dotenv.server";

export function getGeminiApiKey(): string | undefined {
  return readServerEnv("GEMINI_API_KEY") ?? readServerEnv("GOOGLE_AI_API_KEY");
}

export function getOpenAiApiKey(): string | undefined {
  return readServerEnv("OPENAI_API_KEY");
}

export function getAnthropicApiKey(): string | undefined {
  return readServerEnv("ANTHROPIC_API_KEY");
}
