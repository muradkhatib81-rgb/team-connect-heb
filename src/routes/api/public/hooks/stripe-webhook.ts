import { createFileRoute } from "@tanstack/react-router";
import { getStripe, getStripeWebhookSecret } from "@/lib/billing-stripe.server";
import { beginWebhookEvent, finishWebhookEvent, processStripeEvent } from "@/lib/billing-store.server";

export const Route = createFileRoute("/api/public/hooks/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = getStripe();
        const secret = getStripeWebhookSecret();
        if (!stripe || !secret) {
          return Response.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
        }
        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          return Response.json({ ok: false, error: "missing_signature" }, { status: 400 });
        }
        const rawBody = await request.text();
        let event;
        try {
          event = stripe.webhooks.constructEvent(rawBody, signature, secret);
        } catch (err) {
          const message = err instanceof Error ? err.message : "invalid_signature";
          return Response.json({ ok: false, error: message }, { status: 400 });
        }

        try {
          const action = await beginWebhookEvent(event.id, event.type);
          if (action === "skip") {
            return Response.json({ ok: true, duplicate: true });
          }
          await processStripeEvent(event);
          await finishWebhookEvent(event.id);
          return Response.json({ ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : "webhook_failed";
          try {
            await finishWebhookEvent(event.id, message);
          } catch {
            /* non-fatal */
          }
          console.error("[billing] stripe webhook failed:", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
