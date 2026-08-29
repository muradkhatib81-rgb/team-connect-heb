/**
 * Quick login with device fingerprint (Touch ID on iPhone, fingerprint on Android).
 * Face ID / face unlock are intentionally excluded.
 *
 * Native Capacitor plugins are loaded lazily so a missing/outdated APK shell
 * never blocks the login screen or the rest of the app.
 *
 * iOS (future): after `npx cap add ios`, add to Info.plist:
 *   NSFaceIDUsageDescription — only if App Store review requires it;
 *   this app rejects Face ID devices and uses Touch ID only when available.
 */
import type { CheckBiometryResult } from "@aparajita/capacitor-biometric-auth";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native-app";
import {
  BIOMETRIC_LOGIN_ID_NUMBER_KEY,
  BIOMETRIC_LOGIN_OPT_IN_KEY,
  BIOMETRIC_REFRESH_TOKEN_KEY,
} from "@/lib/biometric-login.constants";
import i18n from "@/i18n";

export type BiometricLoginState = {
  supported: boolean;
  enabled: boolean;
  idNumber: string | null;
  /** True when hardware is Face ID / face-only (not offered). */
  blockedByFaceOnly: boolean;
};

type NativePlugins = {
  BiometricAuth: {
    checkBiometry: () => Promise<CheckBiometryResult>;
    authenticate: (options?: Record<string, unknown>) => Promise<void>;
  };
  BiometryErrorType: { userCancel: string };
  BiometryType: {
    touchId: number;
    faceId: number;
    fingerprintAuthentication: number;
    faceAuthentication: number;
    irisAuthentication: number;
  };
  SecureStorage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, data: string) => Promise<void>;
    remove: (key: string) => Promise<boolean>;
  };
  Preferences: {
    get: (opts: { key: string }) => Promise<{ value: string | null }>;
    set: (opts: { key: string; value: string }) => Promise<void>;
    remove: (opts: { key: string }) => Promise<void>;
  };
};

/** undefined = not tried; null = unavailable on this APK/device. */
let nativePlugins: NativePlugins | null | undefined;

async function getNativePlugins(): Promise<NativePlugins | null> {
  if (!isNativeApp()) return null;
  if (nativePlugins !== undefined) return nativePlugins;
  try {
    const [bio, storage, prefs] = await Promise.all([
      import("@aparajita/capacitor-biometric-auth"),
      import("@aparajita/capacitor-secure-storage"),
      import("@capacitor/preferences"),
    ]);
    nativePlugins = {
      BiometricAuth: bio.BiometricAuth,
      BiometryErrorType: bio.BiometryErrorType,
      BiometryType: bio.BiometryType,
      SecureStorage: storage.SecureStorage,
      Preferences: prefs.Preferences,
    };
    return nativePlugins;
  } catch {
    nativePlugins = null;
    return null;
  }
}

function fingerprintBiometry(result: CheckBiometryResult, BiometryType: NativePlugins["BiometryType"]): boolean {
  const t = result.biometryType;
  if (t === BiometryType.faceId || t === BiometryType.faceAuthentication) return false;
  if (t === BiometryType.irisAuthentication) return false;
  return t === BiometryType.touchId || t === BiometryType.fingerprintAuthentication;
}

function faceOnlyDevice(result: CheckBiometryResult, BiometryType: NativePlugins["BiometryType"]): boolean {
  const t = result.biometryType;
  return t === BiometryType.faceId || t === BiometryType.faceAuthentication;
}

export async function checkFingerprintBiometry(): Promise<CheckBiometryResult | null> {
  const plugins = await getNativePlugins();
  if (!plugins) return null;
  try {
    return await plugins.BiometricAuth.checkBiometry();
  } catch {
    return null;
  }
}

/** Device supports fingerprint quick login (native app, enrolled, not Face ID). */
export async function isBiometricLoginSupported(): Promise<boolean> {
  const plugins = await getNativePlugins();
  if (!plugins) return false;
  const bio = await checkFingerprintBiometry();
  if (!bio?.isAvailable) return false;
  return fingerprintBiometry(bio, plugins.BiometryType);
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  const plugins = await getNativePlugins();
  if (!plugins) return false;
  try {
    const { value } = await plugins.Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    if (value !== "1") return false;
    const token = await plugins.SecureStorage.get(BIOMETRIC_REFRESH_TOKEN_KEY);
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}

export async function getBiometricLoginIdNumber(): Promise<string | null> {
  const plugins = await getNativePlugins();
  if (!plugins) return null;
  try {
    const { value } = await plugins.Preferences.get({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export async function getBiometricLoginState(): Promise<BiometricLoginState> {
  const empty: BiometricLoginState = {
    supported: false,
    enabled: false,
    idNumber: null,
    blockedByFaceOnly: false,
  };
  if (!isNativeApp()) return empty;

  try {
    const plugins = await getNativePlugins();
    if (!plugins) return empty;

    const bio = await checkFingerprintBiometry();
    const blockedByFaceOnly = !!bio && faceOnlyDevice(bio, plugins.BiometryType) && bio.isAvailable;
    const supported = !!bio && bio.isAvailable && fingerprintBiometry(bio, plugins.BiometryType);
    const enabled = supported && (await isBiometricLoginEnabled());
    const idNumber = enabled ? await getBiometricLoginIdNumber() : null;
    return { supported, enabled, idNumber, blockedByFaceOnly };
  } catch {
    return empty;
  }
}

async function persistSession(refreshToken: string, idNumber: string): Promise<void> {
  const plugins = await getNativePlugins();
  if (!plugins) throw new Error(i18n.t("biometricLogin.unsupported"));
  await plugins.SecureStorage.set(BIOMETRIC_REFRESH_TOKEN_KEY, refreshToken);
  await plugins.Preferences.set({ key: BIOMETRIC_LOGIN_OPT_IN_KEY, value: "1" });
  await plugins.Preferences.set({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY, value: idNumber });
}

/** After a normal password login, refresh the stored refresh token when opt-in is on. */
export async function syncBiometricLoginSession(idNumber: string): Promise<void> {
  try {
    if (!(await isBiometricLoginEnabled())) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.refresh_token;
    if (!token) return;
    await persistSession(token, idNumber.trim());
  } catch {
    /* never block password login */
  }
}

export async function enableBiometricLogin(idNumber: string): Promise<void> {
  if (!(await isBiometricLoginSupported())) {
    throw new Error(i18n.t("biometricLogin.unsupported"));
  }
  const plugins = await getNativePlugins();
  if (!plugins) throw new Error(i18n.t("biometricLogin.unsupported"));

  const { data } = await supabase.auth.getSession();
  const token = data.session?.refresh_token;
  if (!token) throw new Error(i18n.t("biometricLogin.noSession"));

  await plugins.BiometricAuth.authenticate({
    reason: i18n.t("biometricLogin.authenticateReason"),
    cancelTitle: i18n.t("common.cancel"),
    allowDeviceCredential: false,
  });
  await persistSession(token, idNumber.trim());
}

export async function disableBiometricLogin(): Promise<void> {
  const plugins = await getNativePlugins();
  if (!plugins) return;
  try {
    await plugins.SecureStorage.remove(BIOMETRIC_REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    await plugins.Preferences.remove({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    await plugins.Preferences.remove({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
  } catch {
    /* ignore */
  }
}

export async function clearBiometricLogin(): Promise<void> {
  await disableBiometricLogin();
}

export type BiometricQuickLoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "cancelled" | "expired" | "failed" };

export async function biometricQuickLogin(): Promise<BiometricQuickLoginResult> {
  const plugins = await getNativePlugins();
  if (!plugins || !(await isBiometricLoginEnabled())) {
    return { ok: false, reason: "failed" };
  }

  try {
    await plugins.BiometricAuth.authenticate({
      reason: i18n.t("biometricLogin.quickLoginReason"),
      cancelTitle: i18n.t("common.cancel"),
      allowDeviceCredential: false,
    });
  } catch (err) {
    if (isBiometricUserCancel(err)) return { ok: false, reason: "cancelled" };
    throw err;
  }

  const stored = await plugins.SecureStorage.get(BIOMETRIC_REFRESH_TOKEN_KEY);
  const refreshToken = typeof stored === "string" ? stored : null;
  if (!refreshToken) {
    await disableBiometricLogin();
    return { ok: false, reason: "failed" };
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session?.user) {
    await disableBiometricLogin();
    return { ok: false, reason: "expired" };
  }

  if (data.session.refresh_token && data.session.refresh_token !== refreshToken) {
    const idNumber = (await getBiometricLoginIdNumber()) ?? "";
    await persistSession(data.session.refresh_token, idNumber);
  }

  return { ok: true, userId: data.session.user.id };
}

export function isBiometricUserCancel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "userCancel" || code === "appCancel" || code === "systemCancel";
}
