/** Pure storage-quota helpers (safe for client + server). */

export const MB = 1024 * 1024;

/** Fallback catalog when DB entitlements table is not installed yet. */
export const DEFAULT_STORAGE_QUOTA_MB: Record<"free" | "standard" | "enterprise", number | null> = {
  free: 512,
  standard: 10240,
  enterprise: null,
};

/** UI uses GB; DB stores MB. Empty / null = unlimited. */
export function gbToMb(gb: number | null): number | null {
  if (gb == null) return null;
  return Math.round(gb * 1024);
}

export function mbToGbLabel(mb: number | null | undefined, unlimitedLabel = "∞"): string {
  if (mb == null) return unlimitedLabel;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

export function mbToGbInput(mb: number | null | undefined): string {
  if (mb == null) return "";
  const gb = mb / 1024;
  return Number.isInteger(gb) ? String(gb) : String(Math.round(gb * 100) / 100);
}

export function formatUsedBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < MB * 1024) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (MB * 1024)).toFixed(2)} GB`;
}
