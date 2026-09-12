import { createFileRoute } from "@tanstack/react-router";
import { runGenerateDueRecurringTasks } from "@/lib/tasks.functions";
import { bearerMatchesCron, secretsEqual } from "@/lib/hook-secret.server";

/** Fail closed unless RECURRING_TASKS_SECRET header or Vercel cron Bearer. */
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
  if (!authorizeRecurringHook(request)) return unauthorized();
  try {
    const result = await runGenerateDueRecurringTasks();
    return Response.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "failed";
    return new Response(JSON.stringify({ ok: false, error: message }), {
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
