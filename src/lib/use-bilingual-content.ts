import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "@/i18n";
import {
  translateUserContentBatch,
  type ContentEntityType,
  type ContentField,
  type TranslateContentResult,
} from "@/lib/translate-content.functions";

export type BilingualContentInput = {
  key: string;
  entityType: ContentEntityType;
  entityId: string;
  field: ContentField;
  text: string;
  authorId: string;
};

export function useBilingualContentMap(
  items: BilingualContentInput[],
  enabled = true,
): {
  map: Record<string, TranslateContentResult | undefined>;
  isLoading: boolean;
} {
  const { i18n } = useTranslation();
  const targetLang = (i18n.language === "ar" || i18n.language === "en" ? i18n.language : "he") as AppLanguage;
  const translateFn = useServerFn(translateUserContentBatch);

  const stableItems = useMemo(
    () =>
      items
        .filter((item) => item.text?.trim() && item.authorId && item.entityId)
        .map((item) => ({
          key: item.key,
          entityType: item.entityType,
          entityId: item.entityId,
          field: item.field,
          text: item.text.trim(),
          authorId: item.authorId,
        })),
    [items],
  );

  const queryKey = useMemo(
    () => ["content-translations", targetLang, stableItems],
    [targetLang, stableItems],
  );

  const q = useQuery({
    enabled: enabled && stableItems.length > 0,
    queryKey,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = await translateFn({
        data: { targetLang, items: stableItems },
      });
      return Object.fromEntries(rows.map((row) => [row.key, row]));
    },
  });

  return { map: q.data ?? {}, isLoading: q.isLoading };
}

export function pickBilingualResult(
  map: Record<string, TranslateContentResult | undefined>,
  key: string,
  fallbackText: string,
): TranslateContentResult {
  return (
    map[key] ?? {
      key,
      dual: false,
      original: fallbackText,
    }
  );
}
