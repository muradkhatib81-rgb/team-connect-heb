import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Loader2, Users } from "lucide-react";
import { getDepartmentColleaguesForViewer } from "@/lib/schedules.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactActions } from "@/components/contact-actions";
import { isEmployeeCurrentlyOnLeave } from "@/lib/employee-leave";
import i18n from "@/i18n";

const DASH_TILE = "card-elevated flex h-full min-h-[4.75rem] p-3 transition-colors";
const DASH_TILE_ICON =
  "flex size-8 shrink-0 items-center justify-center rounded-lg";
const DASH_TILE_TITLE = "text-sm font-semibold leading-tight";
const DASH_TILE_SUB =
  "mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground";
const DASH_TILE_TRAIL =
  "flex h-7 w-[4.75rem] shrink-0 items-center justify-end";

function colleagueInitials(name: string | null) {
  const parts = (name ?? "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

export function DepartmentColleaguesCard({
  profile,
}: {
  profile: { id: string; department_id?: string | null; department_name?: string | null };
}) {
  const getColleaguesFn = useServerFn(getDepartmentColleaguesForViewer);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["dept-colleagues", profile.id],
    enabled: !!profile.department_id,
    staleTime: 60_000,
    queryFn: () => getColleaguesFn(),
  });

  if (!profile.department_id) return null;

  const colleagues = q.data?.colleagues ?? [];
  const departmentName = q.data?.departmentName ?? profile.department_name ?? null;
  const count = colleagues.length;

  const subtitle = q.isLoading
    ? i18n.t("common.loading")
    : count === 0
      ? i18n.t("dashboard.noColleagues")
      : i18n.t("dashboard.colleaguesCardSubtitle").replace("{n}", String(count));

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${DASH_TILE} overflow-hidden hover:bg-accent/30 cursor-pointer`}
      >
        <div className="flex items-stretch gap-1 w-full">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 text-right">
            <div className={`${DASH_TILE_ICON} bg-primary/10 text-primary`}>
              <Users className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className={DASH_TILE_TITLE}>{i18n.t("dashboard.departmentColleagues")}</h2>
              <p className={DASH_TILE_SUB}>{subtitle}</p>
              {departmentName && (
                <Badge variant="outline" className="mt-1.5 rounded-full text-[10px] font-normal">
                  {departmentName}
                </Badge>
              )}
            </div>
          </div>
          <div className={DASH_TILE_TRAIL}>
            <ChevronLeft className="size-4 text-muted-foreground" aria-hidden />
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {i18n.t("dashboard.colleaguesDialogTitle")}
              {departmentName && (
                <Badge variant="outline" className="rounded-full text-xs font-normal">
                  {departmentName}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {q.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : colleagues.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {i18n.t("dashboard.noColleagues")}
            </p>
          ) : (
            <ul className="divide-y overflow-y-auto -mx-1 px-1">
              {colleagues.map((c) => {
                const onLeave = isEmployeeCurrentlyOnLeave(c);
                return (
                  <li key={c.id} className="flex items-start gap-3 py-3">
                    <Avatar className="size-10 shrink-0">
                      <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                        {colleagueInitials(c.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-medium">{c.full_name ?? "—"}</p>
                        {c.isDepartmentHead && (
                          <Badge variant="secondary" className="text-[10px] rounded-full shrink-0">
                            {i18n.t("dashboard.deptHeadBadge")}
                          </Badge>
                        )}
                        {onLeave && (
                          <Badge variant="outline" className="text-[10px] rounded-full shrink-0">
                            {i18n.t("dashboard.colleagueOnLeave")}
                          </Badge>
                        )}
                      </div>
                      {c.job_title && (
                        <p className="text-xs text-muted-foreground">{c.job_title}</p>
                      )}
                      <ContactActions phone={c.phone} size="sm" compact />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
