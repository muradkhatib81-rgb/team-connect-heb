import { createFileRoute } from "@tanstack/react-router";
import { runPlatformHealthScan } from "@/lib/platform-health.server";
import { bearerMatchesCron, secretsEqual } from "@/lib/hook-secret.server";
import {
  allowHookRequest,
  clientKeyFromRequest,
  rateLimitedResponse,
} from "@/lib/hook-rate-limit.server";

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

async function run(request: Request, allowCron: boolean) {
  if (
    !allowHookRequest(clientKeyFromRequest(request, "platform-health"), 30, 60_000)
  ) {
    return rateLimitedResponse();
  }
  const okSecret = authorizeHealthSecret(request);
  const okCron =
    allowCron &&
    bearerMatchesCron(
      request.headers.get("authorization"),
      process.env.CRON_SECRET?.trim(),
    );
  if (!okSecret && !okCron) return unauthorized();
  try {
    const result = await runPlatformHealthScan();
    return Response.json(result);
  } catch (e: unknown) {
    console.warn("[platform-health] hook failed:", e instanceof Error ? e.name : "error");
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/platform-health-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => run(request, false),
      GET: async ({ request }) => run(request, true),
    },
  },
});
