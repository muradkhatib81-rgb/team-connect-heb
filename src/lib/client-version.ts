import { App } from "@capacitor/app";
import { nativePlatform } from "./native-app";
import { WEB_APP_VERSION } from "./client-version-compare";

export {
  WEB_APP_VERSION,
  compareClientVersions,
  isClientOlderThanMin,
} from "./client-version-compare";

export type RunningClientPlatform = "android" | "ios" | "web";

export type RunningClientInfo = {
  platform: RunningClientPlatform;
  version: string;
};

export async function getRunningClientInfo(): Promise<RunningClientInfo> {
  // Native Android/iOS use the store app version. Windows/PWA/web use WEB_APP_VERSION
  // (force-update UI labels `web` as Windows).
  const platform = nativePlatform();
  if (platform === "android" || platform === "ios") {
    try {
      const info = await App.getInfo();
      return {
        platform,
        version: (info.version || WEB_APP_VERSION).trim() || WEB_APP_VERSION,
      };
    } catch {
      return { platform, version: WEB_APP_VERSION };
    }
  }
  return { platform: "web", version: WEB_APP_VERSION };
}
