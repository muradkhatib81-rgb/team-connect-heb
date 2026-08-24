import { createFileRoute } from "@tanstack/react-router";
import { runGenerateDueRecurringTasks } from "@/lib/tasks.functions";

/** Same pattern as platform-health-scan: fail closed unless secret or Vercel cron Bearer. */
function authorizeRecurringHook(request: Request): boolean {
  const expected =
    process.env.RECURRING_TASKS_SECRET?.trim() ||
    process.env.PUSH_DISPATCH_SECRET?.trim();
  if (expected) {
    const header = request.headers.get("x-recurring-tasks-secret")?.trim();
    if (header && header === expected) return true;
  }
  const cronSecret = process.env.CRON_SECRET?.trim();
  const cronHeader = request.headers.get("authorization")?.trim();
  return !!cronSecret && cronHeader === `Bearer ${cronSecret}`;
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/generate-recurring-tasks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
      },
      GET: async ({ request }) => {
        // Vercel Cron uses GET by default unless configured otherwise.
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
      },
    },
  },
});
