/**
 * Fingerprint quick login (Touch ID / Android fingerprint only — no Face ID).
 *
 * Critical: Capacitor plugin packages are NEVER imported at module top-level.
 * Top-level imports were what crashed the APK auth screen (plugins evaluated
 * when the auth JS chunk loaded). All native plugins load only inside functions,
 * and BiometricAuth/SecureStorage run only on an explicit user action
 * (profile toggle or quick-login tap) — never while painting /auth.
 */
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native-app";
import {
  BIOMETRIC_LOGIN_ID_NUMBER_KEY,
  BIOMETRIC_LOGIN_OPT_IN_KEY,
  BIOMETRIC_REFRESH_TOKEN_KEY,
} from "@/lib/biometric-login.constants";
import i18n from "@/i18n";

const BiometryType = {
  touchId: 1,
  faceId: 2,
  fingerprintAuthentication: 3,
  faceAuthentication: 4,
  irisAuthentication: 5,
} as const;

type CheckBiometryResult = { isAvailable: boolean; biometryType: number };

export type BiometricLoginState = {
  supported: boolean;
  enabled: boolean;
  idNumber: string | null;
  blockedByFaceOnly: boolean;
};

async function loadPreferences() {
  if (!isNativeApp() || !Capacitor.isPluginAvailable("Preferences")) return null;
  const { Preferences } = await import("@capacitor/preferences");
  return Preferences;
}

async function loadBiometricAuth() {
  if (!isNativeApp() || !Capacitor.isPluginAvailable("BiometricAuthNative")) return null;
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  return BiometricAuth;
}

async function loadSecureStorage() {
  if (!isNativeApp() || !Capacitor.isPluginAvailable("SecureStorage")) return null;
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  return SecureStorage;
}

function isFingerprint(result: CheckBiometryResult): boolean {
  const t = result.biometryType;
  if (t === BiometryType.faceId || t === BiometryType.faceAuthentication) return false;
  if (t === BiometryType.irisAuthentication) return false;
  return t === BiometryType.touchId || t === BiometryType.fingerprintAuthentication;
}

function isFaceOnly(result: CheckBiometryResult): boolean {
  const t = result.biometryType;
  return t === BiometryType.faceId || t === BiometryType.faceAuthentication;
}

/** Auth-safe: Preferences opt-in only. Does not touch BiometricAuth / SecureStorage. */
export async function peekQuickLoginHint(): Promise<{ ready: boolean; idNumber: string | null }> {
  try {
    const Preferences = await loadPreferences();
    if (!Preferences) return { ready: false, idNumber: null };
    const { value: opt } = await Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    if (opt !== "1") return { ready: false, idNumber: null };
    const { value: id } = await Preferences.get({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
    return { ready: true, idNumber: id?.trim() || null };
  } catch {
    return { ready: false, idNumber: null };
  }
}

export async function isBiometricLoginSupported(): Promise<boolean> {
  try {
    const BiometricAuth = await loadBiometricAuth();
    if (!BiometricAuth) return false;
    const bio = await BiometricAuth.checkBiometry();
    return !!bio?.isAvailable && isFingerprint(bio);
  } catch {
    return false;
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
    const BiometricAuth = await loadBiometricAuth();
    if (!BiometricAuth) return empty;
    const bio = await BiometricAuth.checkBiometry();
    const blockedByFaceOnly = !!bio && isFaceOnly(bio) && bio.isAvailable;
    const supported = !!bio && bio.isAvailable && isFingerprint(bio);
    const Preferences = await loadPreferences();
    const { value: opt } = Preferences
      ? await Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY })
      : { value: null };
    const enabled = supported && opt === "1";
    let idNumber: string | null = null;
    if (opt === "1" && Preferences) {
      const { value } = await Preferences.get({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
      idNumber = value?.trim() || null;
    }
    return { supported, enabled, idNumber, blockedByFaceOnly };
  } catch {
    return empty;
  }
}

async function persistSession(refreshToken: string, idNumber: string): Promise<void> {
  const SecureStorage = await loadSecureStorage();
  const Preferences = await loadPreferences();
  if (!SecureStorage || !Preferences) throw new Error(i18n.t("biometricLogin.unsupported"));
  await SecureStorage.set(BIOMETRIC_REFRESH_TOKEN_KEY, refreshToken);
  await Preferences.set({ key: BIOMETRIC_LOGIN_OPT_IN_KEY, value: "1" });
  await Preferences.set({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY, value: idNumber });
}

export async function syncBiometricLoginSession(idNumber: string): Promise<void> {
  try {
    const Preferences = await loadPreferences();
    if (!Preferences) return;
    const { value } = await Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    if (value !== "1") return;
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
  const BiometricAuth = await loadBiometricAuth();
  if (!BiometricAuth) throw new Error(i18n.t("biometricLogin.unsupported"));

  const { data } = await supabase.auth.getSession();
  const token = data.session?.refresh_token;
  if (!token) throw new Error(i18n.t("biometricLogin.noSession"));

  await BiometricAuth.authenticate({
    reason: i18n.t("biometricLogin.authenticateReason"),
    cancelTitle: i18n.t("common.cancel"),
    allowDeviceCredential: false,
  });
  await persistSession(token, idNumber.trim());
}

export async function disableBiometricLogin(): Promise<void> {
  try {
    const SecureStorage = await loadSecureStorage();
    await SecureStorage?.remove(BIOMETRIC_REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  try {
    const Preferences = await loadPreferences();
    await Preferences?.remove({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    await Preferences?.remove({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
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

/** Call only from a user tap — never from auth mount. */
export async function biometricQuickLogin(): Promise<BiometricQuickLoginResult> {
  const hint = await peekQuickLoginHint();
  if (!hint.ready) return { ok: false, reason: "failed" };

  const BiometricAuth = await loadBiometricAuth();
  const SecureStorage = await loadSecureStorage();
  if (!BiometricAuth || !SecureStorage) return { ok: false, reason: "failed" };

  try {
    await BiometricAuth.authenticate({
      reason: i18n.t("biometricLogin.quickLoginReason"),
      cancelTitle: i18n.t("common.cancel"),
      allowDeviceCredential: false,
    });
  } catch (err) {
    if (isBiometricUserCancel(err)) return { ok: false, reason: "cancelled" };
    throw err;
  }

  const stored = await SecureStorage.get(BIOMETRIC_REFRESH_TOKEN_KEY);
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
    await persistSession(data.session.refresh_token, hint.idNumber ?? "");
  }

  return { ok: true, userId: data.session.user.id };
}

export function isBiometricUserCancel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "userCancel" || code === "appCancel" || code === "systemCancel";
}
