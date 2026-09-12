import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dispatchPushNotification } from "@/lib/push-dispatch.server";
import { secretsEqual } from "@/lib/hook-secret.server";
import {
  allowHookRequest,
  clientKeyFromRequest,
  rateLimitedResponse,
} from "@/lib/hook-rate-limit.server";

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
  const header = request.headers.get("x-push-secret")?.trim();
  return secretsEqual(header, expected);
}

export const Route = createFileRoute("/api/public/hooks/dispatch-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          !allowHookRequest(clientKeyFromRequest(request, "dispatch-push"), 120, 60_000)
        ) {
          return rateLimitedResponse();
        }
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
          console.warn("[push] dispatch-push hook failed:", e instanceof Error ? e.name : "error");
          const isClientError = e instanceof z.ZodError || e instanceof SyntaxError;
          return new Response(
            JSON.stringify({
              ok: false,
              error: isClientError ? "invalid_payload" : "dispatch_failed",
            }),
            {
              status: isClientError ? 400 : 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
