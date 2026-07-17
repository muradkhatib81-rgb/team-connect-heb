/**
 * Platform Context — makes the active Platform globally available.
 *
 * The Platform is the root of the multi-tenant hierarchy
 * (Platform -> Companies -> Branches -> Departments -> Employees). This
 * provider wraps the whole application (see routes/__root.tsx) without
 * changing any existing route or component behavior.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Platform } from "../modules/platform";
import { DEFAULT_PLATFORM, PlatformRuntimeService } from "./platform-runtime.service";

export interface PlatformContextValue {
  platform: Platform;
  runtime: PlatformRuntimeService;
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PlatformContextValue>(() => {
    const runtime = new PlatformRuntimeService(DEFAULT_PLATFORM);
    return { platform: DEFAULT_PLATFORM, runtime };
  }, []);

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatformContext(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) {
    throw new Error("usePlatformContext must be used within a PlatformProvider");
  }
  return ctx;
}
