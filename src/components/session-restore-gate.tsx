import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { hasStoredBrowserAuthToken, waitForClientSession } from "@/lib/session-restore";

/**
 * While a web auth token is still in localStorage, keep a spinner — never
 * the login card — until supabase finishes recovering the session.
 * Native has no stored token (persistSession:false); this is a no-op there.
 */
export function SessionRestoreGate({ children }: { children: ReactNode }) {
  const [hold, setHold] = useState(() => hasStoredBrowserAuthToken());

  useEffect(() => {
    if (!hold) return;
    let cancelled = false;
    void waitForClientSession().finally(() => {
      if (!cancelled) setHold(false);
    });
    return () => {
      cancelled = true;
    };
  }, [hold]);

  if (!hold) return children;

  return (
    <div className="app-viewport flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
    </div>
  );
}
