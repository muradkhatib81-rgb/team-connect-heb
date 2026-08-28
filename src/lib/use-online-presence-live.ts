import { useEffect, useMemo, useState } from "react";
import {
  acquireOnlinePresenceViewer,
  getOnlinePresenceSnapshot,
  subscribeOnlinePresenceSnapshot,
} from "@/lib/online-presence-hub";
import {
  dedupePresenceUsers,
  filterPresencesForViewer,
  type OnlinePresencePayload,
  type OnlinePresenceViewerAccess,
} from "@/lib/online-presence";

export function useOnlinePresenceLive(access: OnlinePresenceViewerAccess | undefined) {
  const [raw, setRaw] = useState<OnlinePresencePayload[]>([]);

  useEffect(() => {
    if (!access?.canView) {
      setRaw([]);
      return;
    }
    const release = acquireOnlinePresenceViewer();
    const refresh = () => setRaw(getOnlinePresenceSnapshot());
    refresh();
    const unsub = subscribeOnlinePresenceSnapshot(refresh);
    return () => {
      unsub();
      release();
    };
  }, [access?.canView]);

  const users = useMemo(() => {
    if (!access?.canView) return [];
    return dedupePresenceUsers(filterPresencesForViewer(raw, access));
  }, [raw, access]);

  return { count: users.length, users };
}
