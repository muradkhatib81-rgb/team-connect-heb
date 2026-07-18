/**
 * Restore Platform Owner password after accidental E2E overwrite.
 * Target: main_admin 000000001 only. Requires PLATFORM_OWNER_PASSWORD env var.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function parseEnv(path) {
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const TARGET_ID = "000000001";
const NEW_PASSWORD = process.env.PLATFORM_OWNER_PASSWORD;
if (!NEW_PASSWORD) {
  console.error("Set PLATFORM_OWNER_PASSWORD to the intended Platform Owner password.");
  process.exit(1);
}

const env = parseEnv(".env");
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
const email = `${TARGET_ID}@employees.ramilevy.local`;

const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: roles } = await admin
  .from("user_roles")
  .select("user_id, role")
  .eq("role", "main_admin")
  .limit(1);
const userId = roles?.[0]?.user_id;
if (!userId) throw new Error("main_admin not found");

const { data: profile } = await admin.from("profiles").select("id_number").eq("id", userId).single();
if (profile?.id_number !== TARGET_ID) {
  throw new Error(`Refusing to update non-platform-owner user ${userId}`);
}

const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
  password: NEW_PASSWORD,
  user_metadata: { must_change_password: false },
});
if (updateErr) throw updateErr;

const beforeWrong = await pub.auth.signInWithPassword({ email, password: "VerifyE2E2026!" });
const after = await pub.auth.signInWithPassword({ email, password: NEW_PASSWORD });

console.log(
  JSON.stringify({
    restored_user_id: userId,
    id_number: TARGET_ID,
    old_e2e_password_still_works: !beforeWrong.error,
    expected_password_works: !after.error,
  }),
);

if (after.error) {
  process.exit(1);
}
