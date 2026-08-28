import type { AuthProfile } from "@/lib/use-auth";
import { OnlinePresenceCard } from "@/components/online-presence-card";
import { useOnlinePresenceViewerAccess } from "@/lib/use-online-presence-access";

export function OnlinePresenceDashboardSection({ profile }: { profile: AuthProfile }) {
  const accessQ = useOnlinePresenceViewerAccess(profile.id, profile.roles);

  if (accessQ.data?.viewerScope !== "branch" && accessQ.data?.viewerScope !== "company") {
    return null;
  }

  return (
    <div className="max-w-sm">
      <OnlinePresenceCard access={accessQ.data} loading={accessQ.isLoading} />
    </div>
  );
}
