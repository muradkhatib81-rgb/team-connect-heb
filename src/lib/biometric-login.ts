/**
 * Quick login with device fingerprint (Touch ID on iPhone, fingerprint on Android).
 * Face ID / face unlock are intentionally excluded.
 *
 * Architecture (critical for APK stability):
 * - Login screen must NEVER call BiometricAuth or SecureStorage on mount.
 * - Auth only reads Capacitor Preferences (opt-in flag + display ID) for the hint button.
 * - BiometricAuth + SecureStorage run only on an explicit user gesture
 *   (tap quick-login, or toggle in profile).
 * - All native calls are gated with isPluginAvailable + hard timeouts so a
 *   stuck OEM bridge cannot freeze the WebView into a "static screenshot".
 *
 * iOS (future): after `npx cap add ios`, add to Info.plist:
 *   NSFaceIDUsageDescription — only if App Store review requires it;
 *   this app rejects Face ID devices and uses Touch ID only when available.
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

/** Aparajita registers as BiometricAuthNative (not BiometricAuth). */
const PLUGIN_BIOMETRIC = "BiometricAuthNative";
const PLUGIN_SECURE_STORAGE = "SecureStorage";
const PLUGIN_PREFERENCES = "Preferences";

const NATIVE_CALL_MS = 4_000;
const HEAVY_CALL_MS = 12_000;

/** Local biometry type codes — mirror aparajita enum; avoid importing the package at module load. */
const BiometryType = {
  none: 0,
  touchId: 1,
  faceId: 2,
  fingerprintAuthentication: 3,
  faceAuthentication: 4,
  irisAuthentication: 5,
} as const;

type CheckBiometryResult = {
  isAvailable: boolean;
  biometryType: number;
};

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

let heavyPlugins: NativePlugins | null | undefined;
let prefsOnly: NativePlugins["Preferences"] | null | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`[biometric] timeout: ${label}`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function pluginsReady(names: string[]): boolean {
  try {
    return names.every((n) => Capacitor.isPluginAvailable(n));
  } catch {
    return false;
  }
}

/** Preferences only — safe to call during auth first paint. */
async function getPreferences(): Promise<NativePlugins["Preferences"] | null> {
  if (!isNativeApp()) return null;
  if (prefsOnly !== undefined) return prefsOnly;
  if (!pluginsReady([PLUGIN_PREFERENCES])) {
    prefsOnly = null;
    return null;
  }
  try {
    const mod = await withTimeout(
      import("@capacitor/preferences"),
      NATIVE_CALL_MS,
      "import Preferences",
    );
    prefsOnly = mod.Preferences;
    return prefsOnly;
  } catch {
    prefsOnly = null;
    return null;
  }
}

/**
 * Heavy native stack (biometric + keystore). Only load after a user gesture,
 * never on auth mount.
 */
async function getHeavyPlugins(): Promise<NativePlugins | null> {
  if (!isNativeApp()) return null;
  if (heavyPlugins !== undefined) return heavyPlugins;
  if (!pluginsReady([PLUGIN_BIOMETRIC, PLUGIN_SECURE_STORAGE, PLUGIN_PREFERENCES])) {
    heavyPlugins = null;
    return null;
  }
  try {
    const [bio, storage, prefs] = await withTimeout(
      Promise.all([
        import("@aparajita/capacitor-biometric-auth"),
        import("@aparajita/capacitor-secure-storage"),
        import("@capacitor/preferences"),
      ]),
      NATIVE_CALL_MS,
      "import heavy plugins",
    );
    heavyPlugins = {
      BiometricAuth: bio.BiometricAuth,
      SecureStorage: storage.SecureStorage,
      Preferences: prefs.Preferences,
    };
    prefsOnly = prefs.Preferences;
    return heavyPlugins;
  } catch {
    heavyPlugins = null;
    return null;
  }
}

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

/**
 * Auth-screen safe peek: Preferences opt-in only.
 * Does NOT call BiometricAuth or SecureStorage (those freeze some Android WebViews).
 */
export async function peekQuickLoginHint(): Promise<{
  ready: boolean;
  idNumber: string | null;
}> {
  const empty = { ready: false, idNumber: null as string | null };
  if (!isNativeApp()) return empty;
  try {
    const Preferences = await getPreferences();
    if (!Preferences) return empty;
    const { value: optIn } = await withTimeout(
      Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY }),
      NATIVE_CALL_MS,
      "Preferences.get opt-in",
    );
    if (optIn !== "1") return empty;
    const { value: id } = await withTimeout(
      Preferences.get({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY }),
      NATIVE_CALL_MS,
      "Preferences.get id",
    );
    return { ready: true, idNumber: id?.trim() || null };
  } catch {
    return empty;
  }
}

export async function checkFingerprintBiometry(): Promise<CheckBiometryResult | null> {
  const plugins = await getHeavyPlugins();
  if (!plugins) return null;
  try {
    return await withTimeout(
      plugins.BiometricAuth.checkBiometry(),
      NATIVE_CALL_MS,
      "checkBiometry",
    );
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
  try {
    const Preferences = await getPreferences();
    if (!Preferences) return false;
    const { value } = await withTimeout(
      Preferences.get({ key: BIOMETRIC_LOGIN_OPT_IN_KEY }),
      NATIVE_CALL_MS,
      "Preferences.get enabled",
    );
    return value === "1";
  } catch {
    return false;
  }
}

export async function getBiometricLoginIdNumber(): Promise<string | null> {
  try {
    const Preferences = await getPreferences();
    if (!Preferences) return null;
    const { value } = await withTimeout(
      Preferences.get({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY }),
      NATIVE_CALL_MS,
      "Preferences.get idNumber",
    );
    return value?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Full state for profile settings (after the user is already signed in).
 * Still timeout-guarded so a bad OEM never hangs the profile page.
 */
export async function getBiometricLoginState(): Promise<BiometricLoginState> {
  const empty: BiometricLoginState = {
    supported: false,
    enabled: false,
    idNumber: null,
    blockedByFaceOnly: false,
  };
  if (!isNativeApp()) return empty;

  try {
    const bio = await checkFingerprintBiometry();
    const blockedByFaceOnly = !!bio && faceOnlyDevice(bio) && bio.isAvailable;
    const supported = !!bio && bio.isAvailable && fingerprintBiometry(bio);
    const optedIn = await isBiometricLoginEnabled();
    const enabled = supported && optedIn;
    const idNumber = optedIn ? await getBiometricLoginIdNumber() : null;
    return { supported, enabled, idNumber, blockedByFaceOnly };
  } catch {
    return empty;
  }
}

async function persistSession(refreshToken: string, idNumber: string): Promise<void> {
  const plugins = await getHeavyPlugins();
  if (!plugins) throw new Error(i18n.t("biometricLogin.unsupported"));
  await withTimeout(
    plugins.SecureStorage.set(BIOMETRIC_REFRESH_TOKEN_KEY, refreshToken),
    NATIVE_CALL_MS,
    "SecureStorage.set",
  );
  await withTimeout(
    plugins.Preferences.set({ key: BIOMETRIC_LOGIN_OPT_IN_KEY, value: "1" }),
    NATIVE_CALL_MS,
    "Preferences.set opt-in",
  );
  await withTimeout(
    plugins.Preferences.set({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY, value: idNumber }),
    NATIVE_CALL_MS,
    "Preferences.set id",
  );
}

/** After a normal password login, refresh the stored refresh token when opt-in is on. */
export async function syncBiometricLoginSession(idNumber: string): Promise<void> {
  try {
    if (!(await isBiometricLoginEnabled())) return;
    const plugins = await getHeavyPlugins();
    if (!plugins) return;
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
  const plugins = await getHeavyPlugins();
  if (!plugins) throw new Error(i18n.t("biometricLogin.unsupported"));

  const { data } = await supabase.auth.getSession();
  const token = data.session?.refresh_token;
  if (!token) throw new Error(i18n.t("biometricLogin.noSession"));

  await withTimeout(
    plugins.BiometricAuth.authenticate({
      reason: i18n.t("biometricLogin.authenticateReason"),
      cancelTitle: i18n.t("common.cancel"),
      allowDeviceCredential: false,
    }),
    HEAVY_CALL_MS,
    "authenticate enable",
  );
  await persistSession(token, idNumber.trim());
}

export async function disableBiometricLogin(): Promise<void> {
  try {
    const plugins = await getHeavyPlugins();
    if (plugins) {
      try {
        await withTimeout(
          plugins.SecureStorage.remove(BIOMETRIC_REFRESH_TOKEN_KEY),
          NATIVE_CALL_MS,
          "SecureStorage.remove",
        );
      } catch {
        /* ignore */
      }
      try {
        await withTimeout(
          plugins.Preferences.remove({ key: BIOMETRIC_LOGIN_OPT_IN_KEY }),
          NATIVE_CALL_MS,
          "Preferences.remove opt-in",
        );
        await withTimeout(
          plugins.Preferences.remove({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY }),
          NATIVE_CALL_MS,
          "Preferences.remove id",
        );
      } catch {
        /* ignore */
      }
      return;
    }
  } catch {
    /* fall through to prefs-only clear */
  }
  // Even without heavy plugins, clear the opt-in so auth stops offering quick login.
  try {
    const Preferences = await getPreferences();
    if (!Preferences) return;
    await Preferences.remove({ key: BIOMETRIC_LOGIN_OPT_IN_KEY });
    await Preferences.remove({ key: BIOMETRIC_LOGIN_ID_NUMBER_KEY });
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

/** User-gesture only — never call from auth mount. */
export async function biometricQuickLogin(): Promise<BiometricQuickLoginResult> {
  const plugins = await getHeavyPlugins();
  if (!plugins || !(await isBiometricLoginEnabled())) {
    return { ok: false, reason: "failed" };
  }

  try {
    await withTimeout(
      plugins.BiometricAuth.authenticate({
        reason: i18n.t("biometricLogin.quickLoginReason"),
        cancelTitle: i18n.t("common.cancel"),
        allowDeviceCredential: false,
      }),
      HEAVY_CALL_MS,
      "authenticate quick login",
    );
  } catch (err) {
    if (isBiometricUserCancel(err)) return { ok: false, reason: "cancelled" };
    throw err;
  }

  let refreshToken: string | null = null;
  try {
    const stored = await withTimeout(
      plugins.SecureStorage.get(BIOMETRIC_REFRESH_TOKEN_KEY),
      NATIVE_CALL_MS,
      "SecureStorage.get",
    );
    refreshToken = typeof stored === "string" ? stored : null;
  } catch {
    refreshToken = null;
  }

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
    try {
      await persistSession(data.session.refresh_token, idNumber);
    } catch {
      /* session already restored */
    }
  }

  return { ok: true, userId: data.session.user.id };
}

export function isBiometricUserCancel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "userCancel" || code === "appCancel" || code === "systemCancel";
}
