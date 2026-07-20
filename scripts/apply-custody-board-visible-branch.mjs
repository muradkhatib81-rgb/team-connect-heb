import { readFileSync } from "fs";
import { execFileSync } from "child_process";

const ref = "qvuxttguepaeqjginodf";
const version = "20260720250000";
const name = "custody_board_visible_branch";
const path = `supabase/migrations/${version}_${name}.sql`;

function getToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  return execFileSync("powershell", ["-NoProfile", "-File", "scripts/read-supabase-cli-token.ps1"], {
    encoding: "utf8",
    cwd: process.cwd(),
  }).trim();
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
    `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${name}') ON CONFLICT DO NOTHING;`,
  );
  if (!record.ok) {
    console.error("record failed", record.text);
    process.exit(1);
  }
  console.log("RECORDED", version);
}

const verify = await dbQuery(
  token,
  `SELECT pg_get_function_identity_arguments(p.oid) AS args
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'is_custody_board_visible';`,
);
if (!verify.text.includes("_branch_id uuid")) {
  console.error("VERIFY_FAIL is_custody_board_visible missing _branch_id");
  console.error(verify.text);
  process.exit(1);
}
console.log("VERIFY_OK is_custody_board_visible(_branch_id)");
console.log("ALL_OK");
