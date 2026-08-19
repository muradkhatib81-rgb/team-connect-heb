import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppLanguage } from "@/i18n";
import type { TranslateContentResult } from "@/lib/translate-content.functions";
import { cn } from "@/lib/utils";

function langLabel(t: (key: string) => string, lang?: AppLanguage) {
  if (!lang) return "";
  return t(`contentTranslation.lang.${lang}`);
}

type BilingualContentProps = {
  text: string;
  result?: TranslateContentResult;
  loading?: boolean;
  className?: string;
  inline?: boolean;
};

export function BilingualContent({
  text,
  result,
  loading,
  className,
  inline = false,
}: BilingualContentProps) {
  const { t } = useTranslation();
  const display = result ?? { key: "", dual: false, original: text };

  if (loading && !result?.dual) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin shrink-0" />
        <span>{text}</span>
      </div>
    );
  }

  if (!display.dual || !display.translated) {
    const Tag = inline ? "span" : "div";
    return <Tag className={className}>{text}</Tag>;
  }

  if (inline) {
    return (
      <span className={className}>
        <span>{text}</span>
        <span className="text-muted-foreground mx-1.5" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">{display.translated}</span>
      </span>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
          {t("contentTranslation.originalIn", { lang: langLabel(t, display.sourceLang) })}
        </p>
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
      <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
        <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
          {t("contentTranslation.translatedTo", { lang: langLabel(t, display.targetLang) })}
        </p>
        <div className="whitespace-pre-wrap">{display.translated}</div>
      </div>
    </div>
  );
}
