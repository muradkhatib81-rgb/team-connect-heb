/**
 * Fingerprint quick login only (Touch ID / Android fingerprint).
 * Face ID / face unlock are never offered.
 *
 * Capacitor biometric packages are loaded only via dynamic import() —
 * never at module top-level (that crashed APK auth).
 *
 * Do NOT call Capacitor.isPluginAvailable before importing the plugin:
 * the plugin registers itself on import, so a pre-check always fails.
 */
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native-app";
import {
  BIOMETRIC_LOGIN_ID_NUMBER_KEY,
  BIOMETRIC_LOGIN_OPT_IN_KEY,
  BIOMETRIC_REFRESH_TOKEN_KEY,
} from "@/lib/biometric-login.constants";
import i18n from "@/i18n";

/** Mirror of aparajita BiometryType — avoid static package import. */
const BiometryType = {
  none: 0,
  touchId: 1,
  faceId: 2,
  fingerprintAuthentication: 3,
  faceAuthentication: 4,
  irisAuthentication: 5,
} as const;

/** Mirror of AndroidBiometryStrength.strong — fingerprint, not weak face unlock. */
const ANDROID_BIOMETRY_STRONG = 1;

type CheckBiometryResult = {
  isAvailable: boolean;
  strongBiometryIsAvailable?: boolean;
  biometryType: number;
  biometryTypes?: number[];
};

export type BiometricLoginState = {
  supported: boolean;
  enabled: boolean;
  idNumber: string | null;
  blockedByFaceOnly: boolean;
  /** Native plugin missing from this APK build (needs android:sync + rebuild). */
  needsAppUpdate: boolean;
};

type BiometricAuthApi = {
  checkBiometry: () => Promise<CheckBiometryResult>;
  authenticate: (options?: Record<string, unknown>) => Promise<void>;
};

type SecureStorageApi = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, data: string) => Promise<void>;
  remove: (key: string) => Promise<boolean>;
};

type PreferencesApi = {
  get: (opts: { key: string }) => Promise<{ value: string | null }>;
  set: (opts: { key: string; value: string }) => Promise<void>;
  remove: (opts: { key: string }) => Promise<void>;
};

async function loadPreferences(): Promise<PreferencesApi | null> {
  if (!isNativeApp()) return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    return Preferences;
  } catch {
    return null;
  }
}

async function loadBiometricAuth(): Promise<BiometricAuthApi | null> {
  if (!isNativeApp()) return null;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    return BiometricAuth;
  } catch {
    return null;
  }
}

async function loadSecureStorage(): Promise<SecureStorageApi | null> {
  if (!isNativeApp()) return null;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    return SecureStorage;
  } catch {
    return null;
  }
}

function allTypes(result: CheckBiometryResult): number[] {
  if (result.biometryTypes && result.biometryTypes.length > 0) return result.biometryTypes;
  return [result.biometryType];
}

function hasFingerprintHardware(result: CheckBiometryResult): boolean {
  return allTypes(result).some(
    (t) => t === BiometryType.touchId || t === BiometryType.fingerprintAuthentication,
  );
}

function hasOnlyFaceHardware(result: CheckBiometryResult): boolean {
  const types = allTypes(result).filter((t) => t !== BiometryType.none);
  if (types.length === 0) return false;
  if (hasFingerprintHardware(result)) return false;
  return types.every(
    (t) => t === BiometryType.faceId || t === BiometryType.faceAuthentication,
  );
}

/** Fingerprint enrolled / usable — never treat face-only as supported. */
function fingerprintUsable(result: CheckBiometryResult): boolean {
  if (!hasFingerprintHardware(result)) return false;
  if (hasOnlyFaceHardware(result)) return false;
  // Prefer strong biometry (fingerprint on most Androids); fall back to isAvailable
  // when the primary type is already fingerprint/Touch ID.
  if (result.strongBiometryIsAvailable) return true;
  const primary = result.biometryType;
  return (
    !!result.isAvailable &&
    (primary === BiometryType.touchId || primary === BiometryType.fingerprintAuthentication)
  );
}

const authOptions = () => ({
  reason: i18n.t("biometricLogin.authenticateReason"),
  cancelTitle: i18n.t("common.cancel"),
  allowDeviceCredential: false,
  /** Reject weak face unlock; require fingerprint-class biometry on Android. */
  androidBiometryStrength: ANDROID_BIOMETRY_STRONG,
});

const quickAuthOptions = () => ({
  ...authOptions(),
  reason: i18n.t("biometricLogin.quickLoginReason"),
});

/** Auth-safe: Preferences opt-in only. */
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
  const state = await getBiometricLoginState();
  return state.supported;
}

export async function getBiometricLoginState(): Promise<BiometricLoginState> {
  const empty: BiometricLoginState = {
    supported: false,
    enabled: false,
    idNumber: null,
    blockedByFaceOnly: false,
    needsAppUpdate: false,
  };
  if (!isNativeApp()) return empty;

  try {
    const BiometricAuth = await loadBiometricAuth();
    if (!BiometricAuth) {
      return { ...empty, needsAppUpdate: true };
    }

    let bio: CheckBiometryResult;
    try {
      bio = await BiometricAuth.checkBiometry();
    } catch {
      // Native bridge missing / unimplemented → APK needs rebuild with plugins.
      return { ...empty, needsAppUpdate: true };
    }

    const blockedByFaceOnly = hasOnlyFaceHardware(bio) && bio.isAvailable;
    const supported = fingerprintUsable(bio);

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
    return { supported, enabled, idNumber, blockedByFaceOnly, needsAppUpdate: false };
  } catch {
    return empty;
  }
}

async function persistSession(refreshToken: string, idNumber: string): Promise<void> {
  const SecureStorage = await loadSecureStorage();
  const Preferences = await loadPreferences();
  if (!SecureStorage || !Preferences) {
    throw new Error(i18n.t("biometricLogin.needsAppUpdate"));
  }
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
  const state = await getBiometricLoginState();
  if (state.needsAppUpdate) throw new Error(i18n.t("biometricLogin.needsAppUpdate"));
  if (state.blockedByFaceOnly) throw new Error(i18n.t("biometricLogin.faceIdNotSupported"));
  if (!state.supported) throw new Error(i18n.t("biometricLogin.unsupported"));

  const BiometricAuth = await loadBiometricAuth();
  if (!BiometricAuth) throw new Error(i18n.t("biometricLogin.needsAppUpdate"));

  const { data } = await supabase.auth.getSession();
  const token = data.session?.refresh_token;
  if (!token) throw new Error(i18n.t("biometricLogin.noSession"));

  await BiometricAuth.authenticate(authOptions());
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
    await BiometricAuth.authenticate(quickAuthOptions());
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
