import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dispatchPushNotification } from "@/lib/push-dispatch.server";

const payloadSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  message: z.string().trim().min(1).max(1000),
  scheduleId: z.string().uuid().nullish(),
  weekStart: z.string().nullish(),
  branchId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().max(500).optional(),
  messageId: z.string().uuid().optional(),
  tag: z.string().trim().max(120).optional(),
  eventKey: z.string().trim().max(80).nullish(),
  tone: z.enum(["break_start", "break_end", "break_late", "default"]).nullish(),
});

const HOLDER_ONLY_BREAK = new Set(["break_start", "break_end", "break_late"]);

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
          const eventKey = data.eventKey ?? null;
          const tone = data.tone ?? null;
          // Break start/end/late: never deliver to anyone except the holder.
          const userIds =
            HOLDER_ONLY_BREAK.has(eventKey ?? "") || HOLDER_ONLY_BREAK.has(tone ?? "")
              ? data.userIds.slice(0, 1)
              : data.userIds;
          const result = await dispatchPushNotification({
            userIds,
            message: data.message,
            scheduleId: data.scheduleId ?? null,
            weekStart: data.weekStart ?? null,
            branchId: data.branchId ?? null,
            title: data.title,
            url: data.url,
            messageId: data.messageId,
            tag: data.tag,
            eventKey,
            tone,
          });
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.warn("[push] dispatch-push hook skipped:", e);
          return Response.json({ ok: true, sent: 0, failed: 0, skipped: true });
        }
      },
    },
  },
});
