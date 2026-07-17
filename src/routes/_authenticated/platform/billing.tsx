import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { CreditCard, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlatformContext, useCompanyContext } from "@/platform";
import type { BillingPlan } from "@/core/managers/billing-manager";
import type { UUID } from "@/core";

export const Route = createFileRoute("/_authenticated/platform/billing")({
  component: PlatformBillingPage,
});

const PLAN_LABELS: Record<BillingPlan, string> = {
  free: "חינמי (Free)",
  standard: "רגיל (Standard)",
  enterprise: "מיזם (Enterprise)",
};

const PLAN_TONES: Record<BillingPlan, string> = {
  free: "bg-muted text-muted-foreground",
  standard: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-500",
};

const SUBSCRIPTION_QUERY_KEY = ["platform-subscription"] as const;
const COMPANY_PLANS_QUERY_KEY = ["platform-company-billing-plans"] as const;

function PlatformBillingPage() {
  const { runtime } = usePlatformContext();
  const { companies, isLoading: companiesLoading } = useCompanyContext();
  const qc = useQueryClient();

  const subscriptionQuery = useQuery({
    queryKey: SUBSCRIPTION_QUERY_KEY,
    queryFn: () => runtime.getSubscriptionOverview(),
  });

  const companyPlansQuery = useQuery({
    queryKey: [...COMPANY_PLANS_QUERY_KEY, companies.map((c) => c.id).join(",")],
    queryFn: () => {
      const map: Record<string, BillingPlan> = {};
      for (const company of companies) {
        map[company.id] = runtime.getCompanyBillingPlan(company.id);
      }
      return map;
    },
    enabled: companies.length > 0,
  });

  const setPlatformPlanMut = useMutation({
    mutationFn: async (plan: BillingPlan) => runtime.setSubscriptionPlan(plan),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY }),
  });

  const setCompanyPlanMut = useMutation({
    mutationFn: async ({ companyId, plan }: { companyId: UUID; plan: BillingPlan }) =>
      runtime.setCompanyBillingPlan(companyId, plan),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMPANY_PLANS_QUERY_KEY }),
  });

  const companyPlans = companyPlansQuery.data ?? {};

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CreditCard className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">
            חיוב ומנויים (Billing &amp; Subscriptions)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            תוכנית המנוי של הפלטפורמה וכל חברה — דרך ה-Billing Manager הקיים. ללא ספק תשלומים מחובר.
          </p>
        </div>
      </header>

      <Card className="card-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">מנוי הפלטפורמה</h2>
        <div className="flex flex-wrap items-center gap-3">
          {subscriptionQuery.data && (
            <Badge className={PLAN_TONES[subscriptionQuery.data.plan]}>
              {PLAN_LABELS[subscriptionQuery.data.plan]}
            </Badge>
          )}
          <Select
            value={subscriptionQuery.data?.plan ?? "free"}
            onValueChange={(value) => setPlatformPlanMut.mutate(value as BillingPlan)}
            disabled={setPlatformPlanMut.isPending || subscriptionQuery.isLoading}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PLAN_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="card-elevated overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Building2 className="size-4" />
            תוכנית מנוי לפי חברה
          </h2>
        </div>
        {companiesLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">טוען…</div>
        ) : companies.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין עדיין חברות בפלטפורמה
          </div>
        ) : (
          <ul className="divide-y">
            {companies.map((company) => {
              const plan = companyPlans[company.id] ?? "free";
              return (
                <li key={company.id} className="flex items-center gap-3 p-4">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {company.name}
                  </span>
                  <Badge className={PLAN_TONES[plan]}>{PLAN_LABELS[plan]}</Badge>
                  <Select
                    value={plan}
                    onValueChange={(value) =>
                      setCompanyPlanMut.mutate({
                        companyId: company.id,
                        plan: value as BillingPlan,
                      })
                    }
                    disabled={setCompanyPlanMut.isPending}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLAN_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
