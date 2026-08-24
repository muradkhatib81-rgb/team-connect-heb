import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { PlatformProvider } from "@/platform";
import { registerPwaServiceWorker } from "@/lib/register-pwa";
import { initNativePush, isNativePushOptedIn, type NativePushToken } from "@/lib/native-push";
import { NATIVE_FCM_TOKEN_EVENT } from "@/lib/fcm-endpoints";
import { isNativeApp } from "@/lib/native-app";
import { saveFcmToken } from "@/lib/push.functions";
import { applyPwaBranding, fetchPlatformPwaIconUrl } from "@/lib/pwa-branding";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">העמוד לא נמצא</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          העמוד שחיפשת לא קיים או הועבר למיקום אחר.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">העמוד לא נטען</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          משהו השתבש. נסה לרענן או לחזור לדף הבית.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            נסה שוב
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            דף הבית
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { name: "theme-color", content: "#0d8c8c" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: i18n.t("common.appName") },
      { title: i18n.t("common.appName") },
      { name: "description", content: i18n.t("common.appDescription") },
      { property: "og:title", content: i18n.t("common.appName") },
      { name: "twitter:title", content: i18n.t("common.appName") },
      {
        property: "og:description",
        content: i18n.t("common.appDescription"),
      },
      {
        name: "twitter:description",
        content: i18n.t("common.appDescription"),
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1cb15dcf-5754-4f67-a008-a2d957fe4ee5/id-preview-c505c325--79a8729b-2939-401b-8703-2e45f7227352.lovable.app-1782178387382.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1cb15dcf-5754-4f67-a008-a2d957fe4ee5/id-preview-c505c325--79a8729b-2939-401b-8703-2e45f7227352.lovable.app-1782178387382.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/api/pwa-manifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "icon", href: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap",
      },
    ],
    scripts: [
      {
        // Stale-chunk guard only. Does NOT unregister the installability SW (/sw.js).
        // Legacy/workbox workers are pruned in registerPwaServiceWorker().
        children: `(function(){try{
  function bustReload(){
    try {
      var key='__lov_chunk_reload';
      var now = Date.now();
      var last = parseInt(sessionStorage.getItem(key)||'0',10);
      if (last && now-last < 30000) return;
      sessionStorage.setItem(key, String(now));
    } catch(e){}
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('__v', String(Date.now()));
      window.location.replace(u.toString());
    } catch(e){ window.location.reload(); }
  }
  function isStaleChunkMsg(m){
    return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(m||'');
  }
  window.addEventListener('error', function(e){
    var m = (e && (e.message||'')) + ' ' + ((e && e.error && e.error.message) || '');
    var tgt = e && e.target;
    if (tgt && (tgt.tagName === 'SCRIPT' || tgt.tagName === 'LINK')) {
      var src = tgt.src || tgt.href || '';
      if (/\\/assets\\/.+\\.(js|css|mjs)(\\?|$)/.test(src)) { bustReload(); return; }
    }
    if (isStaleChunkMsg(m)) bustReload();
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason; var m = (r && (r.message||String(r))) || '';
    if (isStaleChunkMsg(m)) bustReload();
  });
  try {
    var key='__lov_chunk_reload';
    var t = parseInt(sessionStorage.getItem(key)||'0',10);
    if (t && Date.now()-t > 30000) sessionStorage.removeItem(key);
  } catch(e){}
  try {
    setTimeout(function(){
      var root = document.getElementById('root') || document.body;
      if (root && root.children && root.children.length === 0) bustReload();
    }, 8000);
  } catch(e){}
}catch(e){}})();`,
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState(() => {
    const current = i18n.language;
    return current === "en" || current === "ar" ? current : "he";
  });
  const [pwaIconUrl, setPwaIconUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchPlatformPwaIconUrl().then((url) => {
        if (!cancelled) setPwaIconUrl(url);
      });
    };
    // Don't compete with first paint / auth for a branding icon.
    const t = window.setTimeout(load, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const onChange = (lng: string) => {
      const next = lng === "en" || lng === "ar" ? lng : "he";
      setLang(next);
      document.documentElement.dir = next === "en" ? "ltr" : "rtl";
      document.documentElement.lang = next;
      document.title = i18n.t("common.appName");
    };
    i18n.on("languageChanged", onChange);
    onChange(i18n.language);
    return () => {
      i18n.off("languageChanged", onChange);
    };
  }, []);

  useEffect(() => {
    applyPwaBranding(pwaIconUrl);
  }, [pwaIconUrl]);
  const dir = lang === "en" ? "ltr" : "rtl";
  return (
    <html lang={lang} dir={dir}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const run = () => void registerPwaServiceWorker();
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 1200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;

    const persistToken = async (token: NativePushToken) => {
      try {
        await saveFcmToken({ data: { token: token.value, platform: token.platform } });
      } catch {
        /* signed-out or network */
      }
    };

    const onToken = (event: Event) => {
      const detail = (event as CustomEvent<NativePushToken>).detail;
      if (detail?.value) void persistToken(detail);
    };
    window.addEventListener(NATIVE_FCM_TOKEN_EVENT, onToken);

    let cancelled = false;
    const register = () => {
      if (!isNativePushOptedIn()) return;
      void (async () => {
        const token = await initNativePush();
        if (!token || cancelled) return;
        await persistToken(token);
      })();
    };

    const t = window.setTimeout(register, 800);
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") register();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener(NATIVE_FCM_TOKEN_EVENT, onToken);
      auth.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <PlatformProvider>
          <Outlet />
          <Toaster position="top-center" richColors closeButton />
        </PlatformProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
