import { createFileRoute } from "@tanstack/react-router";
import { generateDueRecurringTasks } from "@/lib/tasks.functions";

export const Route = createFileRoute("/api/public/hooks/generate-recurring-tasks")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await generateDueRecurringTasks();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? "failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
