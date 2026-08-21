import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";

export const PWA_BRANDING_BUCKET = "platform-branding";
export const PWA_ICON_PATH = "pwa-icon.png";
export const DEFAULT_PWA_ICON_192 = "/icons/icon-192.png";
export const DEFAULT_PWA_ICON_512 = "/icons/icon-512.png";

const MANIFEST_QUERY_KEY = ["platform-pwa-icon"] as const;

let lastManifestObjectUrl: string | null = null;

export { MANIFEST_QUERY_KEY as PWA_ICON_QUERY_KEY };

function setOrCreateMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setOrCreateLink(rel: string, href: string, attrs?: Record<string, string>) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
  }
}

/** Resolve public URL for the platform-owner PWA icon (or null = use defaults). */
export async function fetchPlatformPwaIconUrl(): Promise<string | null> {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("pwa_icon_url")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.warn("[pwa] failed to load icon url", error.message);
    return null;
  }
  const url = data?.pwa_icon_url?.trim();
  return url || null;
}

export function getPlatformBrandingPublicUrl(): string {
  const { data } = supabase.storage.from(PWA_BRANDING_BUCKET).getPublicUrl(PWA_ICON_PATH);
  return data.publicUrl;
}

/** Apply install name (from current i18n language) + icon to manifest / apple tags. */
export function applyPwaBranding(iconUrl?: string | null) {
  if (typeof document === "undefined") return;

  const langRaw = i18n.language;
  const lang = langRaw === "en" || langRaw === "ar" ? langRaw : "he";
  const dir = lang === "en" ? "ltr" : "rtl";
  const name = i18n.t("common.appName");
  const shortName = i18n.t("common.appShortName");
  const description = i18n.t("common.appDescription");

  const icon192 = iconUrl || DEFAULT_PWA_ICON_192;
  const icon512 = iconUrl || DEFAULT_PWA_ICON_512;

  const manifest = {
    id: "/",
    name,
    short_name: shortName,
    description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#0d8c8c",
    lang,
    dir,
    icons: [
      { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const objectUrl = URL.createObjectURL(blob);

  let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  if (lastManifestObjectUrl) {
    URL.revokeObjectURL(lastManifestObjectUrl);
  }
  lastManifestObjectUrl = objectUrl;
  link.href = objectUrl;

  setOrCreateMeta("apple-mobile-web-app-title", name);
  document.title = name;

  setOrCreateLink("apple-touch-icon", icon192);
  setOrCreateLink("icon", icon192, { sizes: "192x192", type: "image/png" });
}

/** Resize an image file to a square PNG (browser canvas). */
export async function resizeImageToPng(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.clearRect(0, 0, size, size);
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
      "image/png",
      1,
    );
  });
}

/** Upload PWA icon (platform owner). Returns public URL with cache-buster. */
export async function uploadPlatformPwaIcon(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("יש להעלות קובץ תמונה");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("גודל הקובץ מוגבל ל־5MB");
  }

  const png = await resizeImageToPng(file, 512);
  const { error: upErr } = await supabase.storage
    .from(PWA_BRANDING_BUCKET)
    .upload(PWA_ICON_PATH, png, { upsert: true, contentType: "image/png", cacheControl: "3600" });
  if (upErr) throw upErr;

  const publicUrl = getPlatformBrandingPublicUrl();
  const withBust = `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

  const { error: dbErr } = await supabase
    .from("platform_settings")
    .update({ pwa_icon_url: withBust })
    .eq("id", 1);
  if (dbErr) throw dbErr;

  return withBust;
}
