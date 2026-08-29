/**
 * Quick login with device fingerprint (Touch ID on iPhone, fingerprint on Android).
 * Face ID / face unlock are intentionally excluded.
 *
 * iOS (future): after `npx cap add ios`, add to Info.plist:
 *   NSFaceIDUsageDescription — only needed if Apple review requires the key;
 *   this app rejects Face ID devices and uses Touch ID only when available.
 */
import { Preferences } from "@capacitor/preferences";
import {
  BiometricAuth,
  BiometryError,
  BiometryErrorType,
  BiometryType,
  type CheckBiometryResult,
} from "@aparajita/capacitor-biometric-auth";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
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

function fingerprintBiometry(result: CheckBiometryResult): boolean {
  const t = result.biometryType;
  if (t === BiometryType.faceId || t === BiometryType.faceAuthentication) return false;
  if (t === BiometryType.irisAuthentication) return false;
  return t === BiometryType.touchId || t === BiometryType.fingerprintAuthentication;
}

function faceOnlyDevice(result: CheckBiometryResult): boolean {
  const t = result.biometryType;
  return t === BiometryType.faceId || t === BiometryType.faceAuthentication;
}

export async function checkFingerprintBiometry(): Promise<CheckBiometryResult | null> {
  if (!isNativeApp()) return null;
  try {
    return await BiometricAuth.checkBiometry();
  } catch {
    return null;
  }
}

/** Device supports fingerprint quick login (native app, enrolled, not Face ID). */
export async function isBiometricLoginSupported(): Promise<boolean> {
  const bio = await checkFingerprintBiometry();
  if (!bio?.isAvailable) return false;
  return fingerprintBiometry(bio);
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { value } = await Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    if (value !== "1") return false;
    const token = await SecureStorage.get(BIOMETRIC_REFRESH_TOKEN_KEY);
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}

export async function getBiometricLoginIdNumber(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export async function getBiometricLoginState(): Promise<BiometricLoginState> {
  if (!isNativeApp()) {
    return { supported: false, enabled: false, idNumber: null, blockedByFaceOnly: false };
  }
  const bio = await checkFingerprintBiometry();
  const blockedByFaceOnly = !!bio && faceOnlyDevice(bio) && bio.isAvailable;
  const supported = !!bio && bio.isAvailable && fingerprintBiometry(bio);
  const enabled = supported && (await isBiometricLoginEnabled());
  const idNumber = enabled ? await getBiometricLoginIdNumber() : null;
  return { supported, enabled, idNumber, blockedByFaceOnly };
}

async function persistSession(refreshToken: string, idNumber: string): Promise<void> {
  await SecureStorage.set(BIOMETRIC_REFRESH_TOKEN_KEY, refreshToken);
  await Preferences.set({ key: BIOMETRIC_LOGIN_OPT_IN_KEY, value: "1" });
  await Preferences.set({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY, value: idNumber });
}

/** After a normal password login, refresh the stored refresh token when opt-in is on. */
export async function syncBiometricLoginSession(idNumber: string): Promise<void> {
  if (!(await isBiometricLoginEnabled())) return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.refresh_token;
  if (!token) return;
  await persistSession(token, idNumber.trim());
}

export async function enableBiometricLogin(idNumber: string): Promise<void> {
  if (!(await isBiometricLoginSupported())) {
    throw new Error(i18n.t("biometricLogin.unsupported"));
  }
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
    await SecureStorage.remove(BIOMETRIC_REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  await Preferences.remove({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
  await Preferences.remove({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
}

export async function clearBiometricLogin(): Promise<void> {
  await disableBiometricLogin();
}

export type BiometricQuickLoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "cancelled" | "expired" | "failed" };

export async function biometricQuickLogin(): Promise<BiometricQuickLoginResult> {
  if (!(await isBiometricLoginEnabled())) {
    return { ok: false, reason: "failed" };
  }

  try {
    await BiometricAuth.authenticate({
      reason: i18n.t("biometricLogin.quickLoginReason"),
      cancelTitle: i18n.t("common.cancel"),
      allowDeviceCredential: false,
    });
  } catch (err) {
    if (err instanceof BiometryError && err.code === BiometryErrorType.userCancel) {
      return { ok: false, reason: "cancelled" };
    }
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
    const idNumber = (await getBiometricLoginIdNumber()) ?? "";
    await persistSession(data.session.refresh_token, idNumber);
  }

  return { ok: true, userId: data.session.user.id };
}

export function isBiometricUserCancel(err: unknown): boolean {
  return err instanceof BiometryError && err.code === BiometryErrorType.userCancel;
}
