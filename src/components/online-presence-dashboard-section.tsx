import type { AuthProfile } from "@/lib/use-auth";
import { OnlinePresenceCard } from "@/components/online-presence-card";
import { useOnlinePresenceViewerAccess } from "@/lib/use-online-presence-access";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";

export function OnlinePresenceDashboardSection({ profile }: { profile: AuthProfile }) {
  const flags = usePlatformFeatureFlagState();
  const accessQ = useOnlinePresenceViewerAccess(profile.id, profile.roles);

  if (!flags.realtime) return null;
  if (accessQ.data?.viewerScope !== "branch" && accessQ.data?.viewerScope !== "company") {
    return null;
  }

  return (
    <div className="max-w-sm">
      <OnlinePresenceCard access={accessQ.data} loading={accessQ.isLoading} />
    </div>
  );
}
