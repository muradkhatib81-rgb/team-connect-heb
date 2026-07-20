import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const ref = "qvuxttguepaeqjginodf";
const version = "20260720200000";
const name = "validate_break_type_once_per_shift";
const path = `supabase/migrations/${version}_${name}.sql`;

function getToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  return execFileSync("powershell", ["-NoProfile", "-File", "scripts/read-supabase-cli-token.ps1"], {
    encoding: "utf8",
    cwd: process.cwd(),
  }).trim();
}

function loadEnv() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
  }
  return out;
}

async function dbQuery(token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

const token = getToken();
if (!token) {
  console.error("No Supabase token");
  process.exit(1);
}

const existing = await dbQuery(
  token,
  `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '${version}';`,
);
if (existing.text.includes(version)) {
  console.log("SKIP already applied", version);
} else {
  console.log("APPLY", path);
  const sql = readFileSync(path, "utf8");
  const apply = await dbQuery(token, sql);
  console.log("apply_status", apply.status);
  if (!apply.ok) {
    console.error(apply.text);
    process.exit(1);
  }
  const record = await dbQuery(
    token,
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ('${version}', '${name}', ARRAY[]::text[])
     ON CONFLICT (version) DO NOTHING;`,
  );
  if (!record.ok) {
    console.error(record.text);
    process.exit(1);
  }
  console.log("RECORDED", version);
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error("Missing .env keys");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: dept } = await admin.from("departments").select("id, branch_id").limit(1).maybeSingle();
const { data: breakSetting } = await admin.from("break_settings").select("id, duration_minutes").limit(1).maybeSingle();
if (!dept?.id || !breakSetting?.id) {
  console.error("Missing dept or break_settings");
  process.exit(1);
}

const suffix = String(Date.now()).slice(-8);
const email = `break-quota-${suffix}@example.com`;
const password = "BreakTest123!";
const { data: userData, error: userErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    first_name: "Quota",
    last_name: "Test",
    id_number: `8${suffix}`,
    department_id: dept.id,
    role: "employee",
  },
});
if (userErr) {
  console.error("create user", userErr.message);
  process.exit(1);
}
const userId = userData.user.id;
await admin.from("profiles").update({ branch_id: dept.branch_id, department_id: dept.id }).eq("id", userId);

const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signErr } = await client.auth.signInWithPassword({ email, password });
if (signErr) {
  console.error("sign in", signErr.message);
  process.exit(1);
}

const t1 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const t2 = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

const { error: firstErr } = await client.from("break_requests").insert({
  user_id: userId,
  department_id: dept.id,
  break_setting_id: breakSetting.id,
  requested_at: t1,
  planned_start: t1,
  duration_minutes: breakSetting.duration_minutes ?? 15,
  planned_duration: breakSetting.duration_minutes ?? 15,
});
if (firstErr) {
  console.error("first insert should succeed", firstErr.message);
  process.exit(1);
}

const { error: dupErr } = await client.from("break_requests").insert({
  user_id: userId,
  department_id: dept.id,
  break_setting_id: breakSetting.id,
  requested_at: t2,
  planned_start: t2,
  duration_minutes: breakSetting.duration_minutes ?? 15,
  planned_duration: breakSetting.duration_minutes ?? 15,
});
if (!dupErr) {
  console.error("FAIL duplicate same type was allowed");
  process.exit(1);
}
console.log("DUPLICATE_BLOCKED_OK", dupErr.message);

await admin.auth.admin.deleteUser(userId);
console.log("ALL_OK");
