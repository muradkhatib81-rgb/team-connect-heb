import { createFileRoute } from "@tanstack/react-router";
import { runGenerateDueRecurringTasks } from "@/lib/tasks.functions";
import { bearerMatchesCron, secretsEqual } from "@/lib/hook-secret.server";
import {
  allowHookRequest,
  clientKeyFromRequest,
  rateLimitedResponse,
} from "@/lib/hook-rate-limit.server";

function authorizeRecurringHook(request: Request): boolean {
  const expected = process.env.RECURRING_TASKS_SECRET?.trim();
  const header = request.headers.get("x-recurring-tasks-secret")?.trim();
  if (secretsEqual(header, expected)) return true;
  return bearerMatchesCron(
    request.headers.get("authorization"),
    process.env.CRON_SECRET?.trim(),
  );
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

async function handle(request: Request) {
  if (
    !allowHookRequest(clientKeyFromRequest(request, "recurring-tasks"), 30, 60_000)
  ) {
    return rateLimitedResponse();
  }
  if (!authorizeRecurringHook(request)) return unauthorized();
  try {
    const result = await runGenerateDueRecurringTasks();
    return Response.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.warn("[recurring-tasks] hook failed:", e instanceof Error ? e.name : "error");
    return new Response(JSON.stringify({ ok: false, error: "failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/generate-recurring-tasks")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
