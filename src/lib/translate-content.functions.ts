import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppLanguage } from "@/i18n";
import {
  translateContentItems,
  type ContentEntityType,
  type ContentField,
  type TranslateContentResult,
} from "@/lib/translate-content.server";

const langSchema = z.enum(["he", "ar", "en"]);
const entityTypeSchema = z.enum(["message", "morning_board_item", "task", "task_comment"]);
const fieldSchema = z.enum(["title", "body", "description"]);

const translateBatchInput = z.object({
  targetLang: langSchema,
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        entityType: entityTypeSchema,
        entityId: z.string().uuid(),
        field: fieldSchema,
        text: z.string().max(12000),
        authorId: z.string().uuid(),
      }),
    )
    .max(40),
});

export const translateUserContentBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => translateBatchInput.parse(raw))
  .handler(async ({ data }): Promise<TranslateContentResult[]> => {
    return translateContentItems(data.items, data.targetLang as AppLanguage);
  });

export const syncPreferredLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ lang: langSchema }).parse(raw))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ preferred_language: data.lang, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const, lang: data.lang };
  });

const themeSchema = z.enum(["light", "dark", "system"]);
export type AppTheme = z.infer<typeof themeSchema>;

export const syncPreferredTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ theme: themeSchema }).parse(raw))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ preferred_theme: data.theme, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const, theme: data.theme };
  });

export type { ContentEntityType, ContentField, TranslateContentResult };
