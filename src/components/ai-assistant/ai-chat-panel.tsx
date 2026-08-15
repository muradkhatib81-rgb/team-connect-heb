import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { sendAiMessage } from "@/lib/ai.functions";
import type { AiAssistantKind } from "@/modules/ai";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { translateAiError } from "@/lib/ai-errors";

type ChatMessage = { role: "user" | "assistant"; content: string };

export function AiChatPanel({
  assistantKind,
  remainingMinutes,
}: {
  assistantKind: AiAssistantKind;
  remainingMinutes: number | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language?.slice(0, 2) ?? "he") as "he" | "ar" | "en";
  const title = t(`ai.assistantTitle.${assistantKind}`);

  const sendFn = useServerFn(sendAiMessage);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [remaining, setRemaining] = useState<number | null>(remainingMinutes);

  const chatMut = useMutation({
    mutationFn: async (text: string) => {
      const history = messages.slice(-10);
      return sendFn({
        data: { message: text, history, locale },
      });
    },
    onSuccess: (res, text) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: res.text },
      ]);
      setRemaining(res.remainingMinutes);
      setInput("");
    },
  });

  function handleSend() {
    const text = input.trim();
    if (!text || chatMut.isPending) return;
    chatMut.mutate(text);
  }

  return (
    <Card className="flex flex-col h-[min(70vh,640px)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="size-4 text-primary shrink-0" />
          <h2 className="font-semibold truncate">{title}</h2>
        </div>
        {remaining != null && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {t("ai.remainingMinutes", { count: remaining })}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">{t("ai.emptyChat")}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
              m.role === "user"
                ? "ms-auto bg-primary text-primary-foreground"
                : "me-auto bg-muted",
            )}
          >
            {m.content}
          </div>
        ))}
        {chatMut.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("ai.thinking")}
          </div>
        )}
        {chatMut.isError && (
          <p className="text-sm text-destructive">
            {translateAiError((chatMut.error as Error).message, t)}
          </p>
        )}
      </div>

      <div className="border-t p-3 flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ai.inputPlaceholder")}
          rows={2}
          className="min-h-[44px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          className="shrink-0"
          disabled={!input.trim() || chatMut.isPending}
          onClick={handleSend}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </Card>
  );
}
