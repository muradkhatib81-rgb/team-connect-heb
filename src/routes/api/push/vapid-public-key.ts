import { createFileRoute } from "@tanstack/react-router";
import { getVapidPublicKey } from "@/lib/web-push.server";

export const Route = createFileRoute("/api/push/vapid-public-key")({
  server: {
    handlers: {
      GET: async () => {
        const publicKey = getVapidPublicKey();
        if (!publicKey) {
          return new Response(JSON.stringify({ publicKey: null }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ publicKey }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
