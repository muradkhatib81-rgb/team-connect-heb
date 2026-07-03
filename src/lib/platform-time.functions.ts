import { createServerFn } from "@tanstack/react-start";

/**
 * Authoritative server clock. Clients call this once on mount to compute
 * their local offset so the app's "now" is aligned to the server regardless
 * of device clock skew or device time zone.
 */
export const getServerNow = createServerFn({ method: "GET" }).handler(async () => {
  return { nowISO: new Date().toISOString() };
});
