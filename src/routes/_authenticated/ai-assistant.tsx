import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useAiAccess } from "@/lib/use-ai-access";
import { AiChatPanel } from "@/components/ai-assistant/ai-chat-panel";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/ai-assistant")({
  component: AiAssistantPage,
});

function AiAssistantPage() {
  const { t } = useTranslation();
  const accessQ = useAiAccess();

  if (accessQ.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessQ.data?.allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Sparkles className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("ai.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("ai.subtitle")}</p>
        </div>
      </div>
      <AiChatPanel
        assistantKind={accessQ.data.assistantKind}
        remainingMinutes={accessQ.data.remainingMinutes}
      />
    </div>
  );
}
