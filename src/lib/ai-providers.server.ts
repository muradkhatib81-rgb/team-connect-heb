import { getAnthropicApiKey, getGeminiApiKey, getOpenAiApiKey } from "@/integrations/supabase/ai-env.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiErrorCode } from "@/lib/ai-errors";
import { DEFAULT_AI_PROVIDER, type AiProviderCode } from "@/modules/ai";
import { GeminiProvider } from "@/modules/ai/providers/gemini.provider";
import { OpenAiProvider } from "@/modules/ai/providers/openai.provider";
import { isAiProviderRegistered, registerAiProvider } from "@/modules/ai/ai.router";

let providersRegistered = false;

export function ensureAiProvidersRegistered(): void {
  if (providersRegistered) return;
  registerAiProvider(new GeminiProvider());
  registerAiProvider(new OpenAiProvider());
  providersRegistered = true;
}

function isProviderConfigured(code: AiProviderCode): boolean {
  switch (code) {
    case "gemini":
      return !!getGeminiApiKey();
    case "openai":
      return !!getOpenAiApiKey();
    case "anthropic":
      return !!getAnthropicApiKey();
    default:
      return false;
  }
}

/** Platform default AI provider for server-side tasks (e.g. content translation). */
export async function resolvePlatformTranslationProvider(): Promise<{
  providerCode: AiProviderCode;
  model?: string;
}> {
  ensureAiProvidersRegistered();

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("ai_platform_settings")
    .select("default_provider_code")
    .maybeSingle();
  if (settingsErr) throw new Error(settingsErr.message);

  const preferred = (settings?.default_provider_code ?? DEFAULT_AI_PROVIDER) as AiProviderCode;
  const candidates = [preferred, DEFAULT_AI_PROVIDER, "openai" as const].filter(
    (code, index, arr) => arr.indexOf(code) === index,
  );

  for (const code of candidates) {
    const { data: row, error } = await supabaseAdmin
      .from("ai_providers")
      .select("code, default_model, is_enabled")
      .eq("code", code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.is_enabled) continue;
    if (!isAiProviderRegistered(code)) continue;
    if (!isProviderConfigured(code)) continue;
    return { providerCode: code, model: row.default_model ?? undefined };
  }

  throw new Error(aiErrorCode("providerNotConfigured"));
}
