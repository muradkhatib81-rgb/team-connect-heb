import { useAuth } from "@/lib/use-auth";
import { OnlinePresenceCard } from "@/components/online-presence-card";
import { useOnlinePresenceViewerAccess } from "@/lib/use-online-presence-access";
import { isPlatformOwner } from "@/lib/constants";
import { useTranslation } from "react-i18next";

export function OnlinePresencePlatformSection() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const accessQ = useOnlinePresenceViewerAccess(profile?.id, profile?.roles);

  if (!profile || !isPlatformOwner(profile.roles)) return null;

  return (
    <OnlinePresenceCard
      access={accessQ.data}
      loading={accessQ.isLoading}
      className="max-w-sm"
      filterHint={t("onlinePresence.platformScopeHint")}
    />
  );
}
