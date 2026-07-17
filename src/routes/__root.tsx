import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { PlatformProvider } from "@/platform";

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
      { title: "מערכת ניהול עובדים" },
      { name: "description", content: "מערכת ניהול עובדים לניהול צוות, מחלקות ותפקידים בסניף." },
      { property: "og:title", content: "מערכת ניהול עובדים" },
      { name: "twitter:title", content: "מערכת ניהול עובדים" },
      {
        property: "og:description",
        content: "מערכת ניהול עובדים לניהול צוות, מחלקות ותפקידים בסניף.",
      },
      {
        name: "twitter:description",
        content: "מערכת ניהול עובדים לניהול צוות, מחלקות ותפקידים בסניף.",
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
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap",
      },
    ],
    scripts: [
      {
        // Stale-cache guard. Unregisters any leftover service worker,
        // clears Cache Storage, and — if a dynamic chunk fails to load
        // because the cached HTML points at a stale asset hash — reloads
        // once with a cache-busting query so the browser must refetch
        // index.html from the network instead of disk cache.
        children: `(function(){try{
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(rs){
      rs.forEach(function(r){ try { r.unregister(); } catch(e){} });
    }).catch(function(){});
    if (window.caches && caches.keys) {
      caches.keys().then(function(ks){ ks.forEach(function(k){ try { caches.delete(k); } catch(e){} }); }).catch(function(){});
    }
  }
  function bustReload(){
    try {
      var key='__lov_chunk_reload';
      var now = Date.now();
      var last = parseInt(sessionStorage.getItem(key)||'0',10);
      if (last && now-last < 30000) return; // already tried recently
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
    // Also catch <script>/<link> 404s for stale hashed assets.
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
  // Safety net: if nothing rendered after 8s on first load, force a bust reload.
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
  return (
    <html lang="he" dir="rtl">
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
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <PlatformProvider>
        <Outlet />
        <Toaster position="top-center" richColors closeButton />
      </PlatformProvider>
    </QueryClientProvider>
  );
}
