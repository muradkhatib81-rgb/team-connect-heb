import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { User, Briefcase, Building2, Calendar, Clock } from "lucide-react";

interface SenderInfo {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  department_name: string | null;
  top_role: AppRole | null;
}

function intlLocale(language: string) {
  const lang = language.split("-")[0];
  if (lang === "ar") return "ar";
  if (lang === "en") return "en";
  return "he-IL";
}

function uiDir(language: string): "rtl" | "ltr" {
  return language.split("-")[0] === "en" ? "ltr" : "rtl";
}

function formatDate(iso: string, language: string) {
  try {
    return new Date(iso).toLocaleDateString(intlLocale(language), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatTime(iso: string, language: string) {
  try {
    return new Date(iso).toLocaleTimeString(intlLocale(language), {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function CommSenderHeader({
  senderId,
  sentAt,
}: {
  senderId: string;
  sentAt: string;
}) {
  const { i18n } = useTranslation();
  const q = useQuery({
    queryKey: ["comm-sender", senderId],
    enabled: !!senderId,
    queryFn: async (): Promise<SenderInfo | null> => {
      const { data, error } = await supabase.rpc("get_communication_sender", {
        _user_id: senderId,
      });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as SenderInfo) ?? null;
    },
  });

  const s = q.data;
  const name = s?.full_name ?? "—";
  const roleLabel = s?.top_role ? ROLE_LABELS[s.top_role] ?? "—" : "—";
  const initials =
    name && name !== "—"
      ? name
          .split(" ")
          .map((n) => n[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
      : "?";

  return (
    <div
      className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3"
      dir={uiDir(i18n.language)}
    >
      <Avatar className="size-12 shrink-0">
        {s?.avatar_url ? <AvatarImage src={s.avatar_url} alt={name} /> : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <User className="size-3.5 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Briefcase className="size-3.5" /> {roleLabel}
            {s?.job_title ? ` · ${s.job_title}` : ""}
          </span>
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3.5" /> {s?.department_name ?? "—"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3.5" /> {formatDate(sentAt, i18n.language)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {formatTime(sentAt, i18n.language)}
          </span>
        </div>
      </div>
    </div>
  );
}
