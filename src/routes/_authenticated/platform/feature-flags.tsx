import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { usePlatformContext } from "@/platform";

export const Route = createFileRoute("/_authenticated/platform/feature-flags")({
  component: PlatformFeatureFlagsPage,
});

const FLAGS_QUERY_KEY = ["platform-feature-flags"] as const;

function PlatformFeatureFlagsPage() {
  const { runtime } = usePlatformContext();
  const qc = useQueryClient();

  const flagsQuery = useQuery({
    queryKey: FLAGS_QUERY_KEY,
    queryFn: () => runtime.listFeatureFlags(),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      runtime.setFeatureFlagEnabled(key, enabled);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY }),
  });

  const flags = flagsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Flag className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">דגלי פיצ'רים (Feature Flags)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            הפעלה/כיבוי של דגלים בהיקף פלטפורמה — דרך ה-Feature Flag Manager הקיים
          </p>
        </div>
      </header>

      <Card className="card-elevated overflow-hidden">
        {flagsQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground text-center">טוען…</div>
        ) : flags.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            אין דגלי פיצ'רים רשומים
          </div>
        ) : (
          <ul className="divide-y">
            {flags.map((flag) => (
              <li key={flag.key} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium" dir="ltr">
                      {flag.key}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {flag.scope}
                    </Badge>
                  </div>
                </div>
                <Switch
                  checked={flag.enabled}
                  disabled={toggleMut.isPending}
                  onCheckedChange={(checked) =>
                    toggleMut.mutate({ key: flag.key, enabled: checked })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
