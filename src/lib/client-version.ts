import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
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
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      const native = Capacitor.getPlatform();
      return {
        platform: native === "ios" ? "ios" : "android",
        version: (info.version || WEB_APP_VERSION).trim() || WEB_APP_VERSION,
      };
    } catch {
      return { platform: "web", version: WEB_APP_VERSION };
    }
  }
  return { platform: "web", version: WEB_APP_VERSION };
}
