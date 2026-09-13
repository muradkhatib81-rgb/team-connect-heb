import { createFileRoute } from "@tanstack/react-router";
import {
  buildPwaManifest,
  resolveAppLanguageFromAcceptLanguage,
  type PwaLanguage,
} from "@/lib/pwa-manifest";

function parseLang(raw: string | null): PwaLanguage | null {
  if (raw === "he" || raw === "ar" || raw === "en") return raw;
  return null;
}

export const Route = createFileRoute("/api/pwa-manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const lang =
          parseLang(url.searchParams.get("lang")) ??
          resolveAppLanguageFromAcceptLanguage(request.headers.get("accept-language"));
        const iconOverride = url.searchParams.get("icon")?.trim() || null;
        let iconUrl: string | null = iconOverride;
        if (!iconUrl) {
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
