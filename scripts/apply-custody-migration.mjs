import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const ref = "qvuxttguepaeqjginodf";
const version = "20260720220000";
const name = "custody_management";
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
if (!url || !serviceKey) {
  console.error("Missing .env keys");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const checks = [
  { table: "custody_item_types", label: "custody_item_types" },
  { table: "custody_checkouts", label: "custody_checkouts" },
  { table: "custody_branch_settings", label: "custody_branch_settings" },
];

for (const c of checks) {
  const tableCheck = await dbQuery(
    token,
    `SELECT to_regclass('public.${c.table}') AS reg;`,
  );
  if (!tableCheck.ok || !tableCheck.text.includes(c.table)) {
    console.error("VERIFY_FAIL", c.label, tableCheck.text);
    process.exit(1);
  }
  console.log("VERIFY_OK", c.label);
}

const permCheck = await dbQuery(
  token,
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_task_permissions'
     AND column_name IN ('can_create_custody','can_edit_custody','can_delete_custody');`,
);
if (!permCheck.ok || !permCheck.text.includes("can_create_custody")) {
  console.error("VERIFY_FAIL permission columns", permCheck.text);
  process.exit(1);
}
console.log("VERIFY_OK permission columns (additive)");

const rpcCheck = await dbQuery(
  token,
  `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname IN ('checkout_custody_item','is_custody_board_visible');`,
);
if (!rpcCheck.ok || !rpcCheck.text.includes("checkout_custody_item")) {
  console.error("VERIFY_FAIL RPCs", rpcCheck.text);
  process.exit(1);
}
console.log("VERIFY_OK RPCs");

console.log("ALL_OK");
