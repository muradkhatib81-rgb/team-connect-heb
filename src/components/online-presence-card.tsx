import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useOnlinePresenceLive } from "@/lib/use-online-presence-live";
import { useOnlinePresenceLocationLabels } from "@/lib/use-online-presence-location-labels";
import { groupPresenceByLocation, type OnlinePresenceViewerAccess } from "@/lib/online-presence";

type OnlinePresenceCardProps = {
  access: OnlinePresenceViewerAccess | undefined;
  loading?: boolean;
  className?: string;
  /** Platform owner: optional subtitle for company/branch filter context */
  filterHint?: string | null;
  /** Platform owner: group the expanded list by company → branch */
  groupByLocation?: boolean;
};

export function OnlinePresenceCard({
  access,
  loading = false,
  className,
  filterHint,
  groupByLocation = false,
}: OnlinePresenceCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const live = useOnlinePresenceLive(access);

  const branchIds = useMemo(
    () => live.users.map((u) => u.branch_id).filter(Boolean) as string[],
    [live.users],
  );
  const labelsQ = useOnlinePresenceLocationLabels(groupByLocation ? branchIds : []);

  const grouped = useMemo(() => {
    if (!groupByLocation) return null;
    return groupPresenceByLocation(live.users, labelsQ.data);
  }, [groupByLocation, live.users, labelsQ.data]);

  if (loading) {
    return <OnlinePresenceCardSkeleton className={className} />;
  }

  if (!access?.canView) return null;

  const count = live.count;
  const toggle = () => setExpanded((v) => !v);
  const unassignedCompany = t("onlinePresence.unassignedCompany");
  const unassignedBranch = t("onlinePresence.unassignedBranch");

  return (
    <Card
      className={cn(
        "card-elevated overflow-hidden transition-shadow",
        expanded && "ring-1 ring-primary/20",
        groupByLocation && "max-w-md",
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full p-4 flex items-center gap-3 text-start hover:bg-muted/40 transition-colors"
        aria-expanded={expanded}
      >
        <div className="size-10 rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 flex items-center justify-center shrink-0">
          <Users className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            {t("onlinePresence.cardTitle")}
          </p>
          <p className="text-2xl font-bold tabular-nums">{count}</p>
          {filterHint ? (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{filterHint}</p>
          ) : null}
        </div>
        <div className="text-muted-foreground shrink-0">
          {expanded ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
        </div>
      </button>

      {expanded ? (
        <div className="border-t px-4 py-3 max-h-72 overflow-y-auto">
          {count === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("onlinePresence.noOneOnline")}
            </p>
          ) : groupByLocation && grouped ? (
            <div className="space-y-4">
              {grouped.map((company) => (
                <section key={company.companyId ?? "unassigned"}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {company.companyName || unassignedCompany}
                    <span className="ms-1.5 tabular-nums font-normal normal-case">
                      ({company.userCount})
                    </span>
                  </h3>
                  <div className="space-y-3 ps-1">
                    {company.branches.map((branch) => (
                      <div key={branch.branchId ?? "unassigned"}>
                        <p className="text-sm font-medium text-foreground/90 mb-1.5">
                          {branch.branchName || unassignedBranch}
                          <span className="ms-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                            ({branch.users.length})
                          </span>
                        </p>
                        <ul className="space-y-1 ps-2 border-s border-border/60">
                          {branch.users.map((u) => (
                            <li
                              key={u.user_id}
                              className="text-sm py-1 px-2 rounded-md bg-muted/50 truncate"
                              title={u.full_name}
                            >
                              {u.full_name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {live.users.map((u) => (
                <li
                  key={u.user_id}
                  className="text-sm py-1.5 px-2 rounded-md bg-muted/50 truncate"
                  title={u.full_name}
                >
                  {u.full_name}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function OnlinePresenceCardSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Card className={cn("card-elevated p-4 flex items-center gap-3", className)}>
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">{t("onlinePresence.loading")}</span>
    </Card>
  );
}
