import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseClientFromRequest } from "@/integrations/supabase/request-auth.server";
import { createAiChatSseResponse } from "@/lib/ai-stream.server";

export const Route = createFileRoute("/api/ai/chat-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabase } = await createSupabaseClientFromRequest(request);
          const body = await request.json();
          return createAiChatSseResponse(supabase, body);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          const status = message === "Unauthorized" ? 401 : 500;
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
