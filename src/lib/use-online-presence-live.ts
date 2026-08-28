import { useEffect, useMemo, useState } from "react";
import {
  acquireOnlinePresenceViewer,
  getOnlinePresenceSnapshot,
  subscribeOnlinePresenceSnapshot,
} from "@/lib/online-presence-hub";
import {
  dedupePresenceUsers,
  filterPresencesForViewer,
  ONLINE_PRESENCE_VIEWER_TICK_MS,
  type OnlinePresencePayload,
  type OnlinePresenceViewerAccess,
} from "@/lib/online-presence";

export function useOnlinePresenceLive(access: OnlinePresenceViewerAccess | undefined) {
  const [raw, setRaw] = useState<OnlinePresencePayload[]>([]);
  const [staleTick, setStaleTick] = useState(0);

  useEffect(() => {
    if (!access?.canView) {
      setRaw([]);
      return;
    }
    const release = acquireOnlinePresenceViewer();
    const refresh = () => setRaw(getOnlinePresenceSnapshot());
    refresh();
    const unsub = subscribeOnlinePresenceSnapshot(refresh);
    const tick = window.setInterval(() => setStaleTick((n) => n + 1), ONLINE_PRESENCE_VIEWER_TICK_MS);
    return () => {
      window.clearInterval(tick);
      unsub();
      release();
    };
  }, [access?.canView]);

  const users = useMemo(() => {
    if (!access?.canView) return [];
    return dedupePresenceUsers(filterPresencesForViewer(raw, access));
  }, [raw, access, staleTick]);

  return { count: users.length, users };
}
