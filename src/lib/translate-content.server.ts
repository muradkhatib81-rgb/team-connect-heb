import { createHash } from "node:crypto";
import type { AppLanguage } from "@/i18n";
import { ensureAiProvidersRegistered, resolvePlatformTranslationProvider } from "@/lib/ai-providers.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeAiChat } from "@/modules/ai";
import type { AiProviderCode } from "@/modules/ai";

export type ContentEntityType = "message" | "morning_board_item" | "task" | "task_comment";
export type ContentField = "title" | "body" | "description";

export type TranslateContentItem = {
  key: string;
  entityType: ContentEntityType;
  entityId: string;
  field: ContentField;
  text: string;
  authorId: string;
};

export type TranslateContentResult = {
  key: string;
  dual: boolean;
  original: string;
  translated?: string;
  sourceLang?: AppLanguage;
  targetLang?: AppLanguage;
};

const LANG_LABEL: Record<AppLanguage, string> = {
  he: "Hebrew",
  ar: "Arabic",
  en: "English",
};

const TRANSLATION_SYSTEM_PROMPT =
  "You translate workplace messages between Hebrew, Arabic, and English. " +
  "Preserve meaning, tone, names, and line breaks. Return ONLY valid JSON: " +
  '{"translations":[{"index":0,"text":"..."}]}. Same order and count as input. No markdown fences.';

function normalizeLang(value: unknown): AppLanguage {
  if (value === "he" || value === "ar" || value === "en") return value;
  return "he";
}

export function hashContentText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function parseTranslationResponse(raw: string, count: number): string[] {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { translations?: { index?: number; text?: string }[] };
  const out = Array.from({ length: count }, () => "");
  for (const row of parsed.translations ?? []) {
    if (typeof row.index === "number" && row.index >= 0 && row.index < out.length) {
      out[row.index] = (row.text ?? "").trim();
    }
  }
  return out;
}

async function fetchAuthorLanguages(authorIds: string[]): Promise<Record<string, AppLanguage>> {
  const unique = Array.from(new Set(authorIds.filter(Boolean)));
  if (!unique.length) return {};
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, preferred_language")
    .in("id", unique);
  if (error) throw new Error(error.message);
  return Object.fromEntries(
    (data ?? []).map((row: { id: string; preferred_language?: string | null }) => [
      row.id,
      normalizeLang(row.preferred_language),
    ]),
  );
}

async function readCachedTranslation(
  entityType: ContentEntityType,
  entityId: string,
  field: ContentField,
  targetLang: AppLanguage,
  sourceHash: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("content_translations")
    .select("translated_text")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("field_name", field)
    .eq("target_lang", targetLang)
    .eq("source_hash", sourceHash)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.translated_text ?? null;
}

async function writeCachedTranslation(input: {
  entityType: ContentEntityType;
  entityId: string;
  field: ContentField;
  sourceLang: AppLanguage;
  targetLang: AppLanguage;
  sourceHash: string;
  translatedText: string;
}) {
  const { error } = await supabaseAdmin.from("content_translations").upsert(
    {
      entity_type: input.entityType,
      entity_id: input.entityId,
      field_name: input.field,
      source_lang: input.sourceLang,
      target_lang: input.targetLang,
      source_hash: input.sourceHash,
      translated_text: input.translatedText,
    },
    { onConflict: "entity_type,entity_id,field_name,target_lang,source_hash" },
  );
  if (error) throw new Error(error.message);
}

async function translateBatchWithPlatformProvider(
  jobs: Array<{ index: number; text: string; sourceLang: AppLanguage; targetLang: AppLanguage }>,
  providerCode: AiProviderCode,
  model?: string,
): Promise<string[]> {
  ensureAiProvidersRegistered();

  const lines = jobs
    .map(
      (job, i) =>
        `${i}. From ${LANG_LABEL[job.sourceLang]} to ${LANG_LABEL[job.targetLang]}:\n"""${job.text}"""`,
    )
    .join("\n\n");

  const response = await routeAiChat({
    providerCode,
    model,
    maxOutputTokens: 8192,
    messages: [
      { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: lines },
    ],
  });

  return parseTranslationResponse(response.text, jobs.length);
}

export async function translateContentItems(
  items: TranslateContentItem[],
  targetLang: AppLanguage,
): Promise<TranslateContentResult[]> {
  const trimmed = items
    .map((item) => ({ ...item, text: item.text?.trim() ?? "" }))
    .filter((item) => item.text.length > 0);

  if (!trimmed.length) return [];

  const authorLangs = await fetchAuthorLanguages(trimmed.map((item) => item.authorId));
  const results: TranslateContentResult[] = [];
  const pending: Array<{
    item: (typeof trimmed)[number];
    sourceLang: AppLanguage;
    sourceHash: string;
    batchIndex: number;
  }> = [];

  for (const item of trimmed) {
    const sourceLang = authorLangs[item.authorId] ?? "he";
    if (sourceLang === targetLang) {
      results.push({
        key: item.key,
        dual: false,
        original: item.text,
        sourceLang,
        targetLang,
      });
      continue;
    }

    const sourceHash = hashContentText(item.text);
    const cached = await readCachedTranslation(
      item.entityType,
      item.entityId,
      item.field,
      targetLang,
      sourceHash,
    );
    if (cached) {
      results.push({
        key: item.key,
        dual: true,
        original: item.text,
        translated: cached,
        sourceLang,
        targetLang,
      });
      continue;
    }

    pending.push({
      item,
      sourceLang,
      sourceHash,
      batchIndex: pending.length,
    });
  }

  if (pending.length) {
    try {
      const { providerCode, model } = await resolvePlatformTranslationProvider();
      const translated = await translateBatchWithPlatformProvider(
        pending.map((job) => ({
          index: job.batchIndex,
          text: job.item.text,
          sourceLang: job.sourceLang,
          targetLang,
        })),
        providerCode,
        model,
      );

      for (const job of pending) {
        const text = translated[job.batchIndex]?.trim() || job.item.text;
        await writeCachedTranslation({
          entityType: job.item.entityType,
          entityId: job.item.entityId,
          field: job.item.field,
          sourceLang: job.sourceLang,
          targetLang,
          sourceHash: job.sourceHash,
          translatedText: text,
        });
        results.push({
          key: job.item.key,
          dual: true,
          original: job.item.text,
          translated: text,
          sourceLang: job.sourceLang,
          targetLang,
        });
      }
    } catch {
      for (const job of pending) {
        results.push({
          key: job.item.key,
          dual: false,
          original: job.item.text,
          sourceLang: job.sourceLang,
          targetLang,
        });
      }
    }
  }

  return results;
}
