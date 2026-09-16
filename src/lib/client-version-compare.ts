/** Web and Windows desktop share this version. Native apps use Capacitor App.getInfo. */
export const WEB_APP_VERSION = "1.0.0";

function parseVersionParts(version: string): [number, number, number] {
  const parts = version.trim().split(".");
  const major = Number.parseInt(parts[0] ?? "0", 10);
  const minor = Number.parseInt(parts[1] ?? "0", 10);
  const patch = Number.parseInt(parts[2] ?? "0", 10);
  return [
    Number.isFinite(major) ? major : 0,
    Number.isFinite(minor) ? minor : 0,
    Number.isFinite(patch) ? patch : 0,
  ];
}

/** Negative when `current` is older than `minimum`. */
export function compareClientVersions(current: string, minimum: string): number {
  const a = parseVersionParts(current);
  const b = parseVersionParts(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function isClientOlderThanMin(current: string, minimum: string): boolean {
  return compareClientVersions(current, minimum) < 0;
}
