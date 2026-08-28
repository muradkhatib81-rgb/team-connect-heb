import i18n from "@/i18n";
import { toast } from "sonner";

/** Toast the signed-in employee when their own break request status changes. */
export function notifyOwnBreakStatusTransition(payload: {
  old?: Record<string, unknown> | null;
  new?: Record<string, unknown> | null;
}) {
  const prev = payload.old?.status as string | undefined;
  const next = payload.new?.status as string | undefined;
  if (!next || prev === next) return;

  const actorName =
    (payload.new?.ended_by_manager_name as string | null)?.trim() ||
    (payload.new?.cancelled_by_name as string | null)?.trim() ||
    i18n.t("breaks.manager");
  const atRaw =
    (payload.new?.completed_at as string | null) ||
    (payload.new?.cancelled_at as string | null) ||
    (payload.new?.rejected_at as string | null);
  const when = atRaw
    ? new Intl.DateTimeFormat("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        numberingSystem: "latn",
      }).format(new Date(atRaw))
    : "";
  const whenPart = when ? ` · ${when}` : "";

  if (prev !== "active" && next === "active") {
    toast.success(i18n.t("breaks.breakStarted"));
  } else if (prev !== "completed" && next === "completed") {
    toast(i18n.t("breaks.breakEnded"));
  } else if (prev !== "rejected" && next === "rejected") {
    toast.error(`${i18n.t("breaks.breakRejected").replace("{name}", actorName)}${whenPart}`);
  } else if (prev !== "ended_by_manager" && next === "ended_by_manager") {
    toast(`${i18n.t("breaks.breakEndedByMgr").replace("{name}", actorName)}${whenPart}`);
  } else if (prev !== "cancelled_by_manager" && next === "cancelled_by_manager") {
    toast(`${i18n.t("breaks.breakCancelledByMgr").replace("{name}", actorName)}${whenPart}`);
  }
}
