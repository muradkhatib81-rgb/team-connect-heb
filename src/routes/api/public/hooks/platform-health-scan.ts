import { createFileRoute } from "@tanstack/react-router";
import { runPlatformHealthScan } from "@/lib/platform-health.server";
import { bearerMatchesCron, secretsEqual } from "@/lib/hook-secret.server";

/** Fail closed unless PLATFORM_HEALTH_SECRET header (POST/GET) or cron Bearer (GET). */
function authorizeHealthSecret(request: Request): boolean {
  const expected = process.env.PLATFORM_HEALTH_SECRET?.trim();
  const header = request.headers.get("x-platform-health-secret")?.trim();
  return secretsEqual(header, expected);
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/platform-health-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeHealthSecret(request)) return unauthorized();
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
        const okSecret = authorizeHealthSecret(request);
        const okCron = bearerMatchesCron(
          request.headers.get("authorization"),
          process.env.CRON_SECRET?.trim(),
        );
        if (!okSecret && !okCron) return unauthorized();
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
