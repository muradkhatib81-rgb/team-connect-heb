import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native Android/iOS shell loads the live production app.
 * Local `www/` is only a brief offline/fallback splash until the remote URL loads.
 */
const config: CapacitorConfig = {
  appId: "com.teamconnect.heb",
  appName: "Team Connect",
  webDir: "www",
  server: {
    url: "https://team-connect-app.com",
    cleartext: false,
    allowNavigation: [
      "team-connect-app.com",
      "www.team-connect-app.com",
      "team-connect-heb.vercel.app",
      "*.supabase.co",
      "*.googleapis.com",
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f172a",
  },
  ios: {
    backgroundColor: "#0f172a",
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#0f172a",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;