import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native Android/iOS shell loads the live production app.
 * Canonical host is www (apex team-connect-app.com 308-redirects here).
 * Local `www/` is a solid-color fallback (no logo) until the remote URL loads.
 */
const config: CapacitorConfig = {
  appId: "com.teamconnect.heb",
  appName: "Team Connect",
  webDir: "www",
  server: {
    url: "https://www.team-connect-app.com",
    cleartext: false,
    allowNavigation: [
      "www.team-connect-app.com",
      "team-connect-app.com",
      "team-connect-heb.vercel.app",
      "*.supabase.co",
      "*.googleapis.com",
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f172a",
    // CSS --app-safe-* / env(safe-area-inset-*) handle the status bar.
    adjustMarginsForEdgeToEdge: "disable",
  },
  ios: {
    backgroundColor: "#0f172a",
    // Edge-to-edge; header/modals pad with env(safe-area-inset-top).
    contentInset: "never",
  },
  plugins: {
    SplashScreen: {
      // Solid #0f172a only. Logo grow is a single web overlay (NativeBootSplash).
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#0f172a",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;