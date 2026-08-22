import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dispatchPushNotification } from "@/lib/push-dispatch.server";

const payloadSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  message: z.string().trim().min(1).max(1000),
  scheduleId: z.string().uuid().nullable().optional(),
  weekStart: z.string().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().max(500).optional(),
  messageId: z.string().uuid().optional(),
  tag: z.string().trim().max(120).optional(),
});

function authorizePushHook(request: Request): boolean {
  const expected = process.env.PUSH_DISPATCH_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("x-push-secret")?.trim();
  return !!header && header === expected;
}

export const Route = createFileRoute("/api/public/hooks/dispatch-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePushHook(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const json = await request.json();
          const data = payloadSchema.parse(json);
          const result = await dispatchPushNotification({
            userIds: data.userIds,
            message: data.message,
            scheduleId: data.scheduleId,
            weekStart: data.weekStart,
            title: data.title,
            url: data.url,
            messageId: data.messageId,
            tag: data.tag,
          });
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          return new Response(
            JSON.stringify({ ok: false, error: (e as Error)?.message ?? "failed" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
