import { createFileRoute } from "@tanstack/react-router";
import {
  buildPwaManifest,
  resolveAppLanguageFromAcceptLanguage,
} from "@/lib/pwa-manifest";

export const Route = createFileRoute("/api/pwa-manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const lang = resolveAppLanguageFromAcceptLanguage(request.headers.get("accept-language"));
        let iconUrl: string | null = null;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("platform_settings")
            .select("pwa_icon_url")
            .eq("id", 1)
            .maybeSingle();
          iconUrl = data?.pwa_icon_url?.trim() || null;
        } catch {
          /* use default icons if settings unavailable */
        }

        const body = JSON.stringify(buildPwaManifest({ lang, iconUrl }));
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            Vary: "Accept-Language",
          },
        });
      },
    },
  },
});
