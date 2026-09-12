import { timingSafeEqual } from "node:crypto";

/** Constant-time compare for shared hook secrets. Empty values never match. */
export function secretsEqual(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerMatchesCron(
  authorizationHeader: string | null | undefined,
  cronSecret: string | null | undefined,
): boolean {
  if (!authorizationHeader || !cronSecret) return false;
  const expected = `Bearer ${cronSecret}`;
  return secretsEqual(authorizationHeader.trim(), expected);
}
