import { useCallback, useEffect, useState } from "react";

/** Build a stable signature from pending item ids (order-independent). */
export function attentionSignatureFromIds(ids: readonly string[]): string {
  if (!ids.length) return "";
  return [...ids].sort().join(",");
}

function storageKey(userId: string, cardKey: string) {
  return `dash-card-seen:${userId}:${cardKey}`;
}

function readSeen(userId: string, cardKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(storageKey(userId, cardKey)) ?? "";
  } catch {
    return "";
  }
}

function writeSeen(userId: string, cardKey: string, signature: string) {
  try {
    localStorage.setItem(storageKey(userId, cardKey), signature);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Dashboard tile turns "attention" (e.g. red) when the signature changes
 * until the user opens the card (markSeen). Permissions unchanged.
 */
export function useDashboardCardAttention(
  userId: string | null | undefined,
  cardKey: string,
  signature: string | null | undefined,
) {
  const sig = signature?.trim() ? signature.trim() : "";
  const [seen, setSeen] = useState(() => (userId ? readSeen(userId, cardKey) : ""));

  useEffect(() => {
    if (!userId) {
      setSeen("");
      return;
    }
    setSeen(readSeen(userId, cardKey));
  }, [userId, cardKey]);

  const needsAttention = !!userId && !!sig && seen !== sig;

  const markSeen = useCallback(() => {
    if (!userId || !sig) return;
    writeSeen(userId, cardKey, sig);
    setSeen(sig);
  }, [userId, cardKey, sig]);

  return { needsAttention, markSeen };
}
