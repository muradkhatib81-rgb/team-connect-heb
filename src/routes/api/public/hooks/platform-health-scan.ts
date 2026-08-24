import { createFileRoute } from "@tanstack/react-router";
import { runPlatformHealthScan } from "@/lib/platform-health.server";

function authorizeHealthHook(request: Request): boolean {
  const expected = process.env.PLATFORM_HEALTH_SECRET?.trim() || process.env.PUSH_DISPATCH_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("x-platform-health-secret")?.trim();
  return !!header && header === expected;
}

export const Route = createFileRoute("/api/public/hooks/platform-health-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeHealthHook(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const result = await runPlatformHealthScan();
          return Response.json(result);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "failed";
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: async ({ request }) => {
        // Vercel Cron uses GET by default unless configured otherwise.
        if (!authorizeHealthHook(request)) {
          const cronHeader = request.headers.get("authorization")?.trim();
          const cronSecret = process.env.CRON_SECRET?.trim();
          const okCron = !!cronSecret && cronHeader === `Bearer ${cronSecret}`;
          if (!okCron) {
            return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        try {
          const result = await runPlatformHealthScan();
          return Response.json(result);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "failed";
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
