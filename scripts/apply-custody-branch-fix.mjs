import { readFileSync } from "fs";
import { execFileSync } from "child_process";

const ref = "qvuxttguepaeqjginodf";
const version = "20260720230000";
const name = "custody_resolve_branch_for_platform_owner";
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

const fnCheck = await dbQuery(
  token,
  `SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'custody_resolve_branch';`,
);
if (!fnCheck.ok || !fnCheck.text.includes("custody_resolve_branch")) {
  console.error("VERIFY_FAIL custody_resolve_branch", fnCheck.text);
  process.exit(1);
}
console.log("VERIFY_OK custody_resolve_branch");

const upsertCheck = await dbQuery(
  token,
  `SELECT pg_get_function_identity_arguments(p.oid) AS args
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'upsert_custody_item_type';`,
);
if (!upsertCheck.ok || !upsertCheck.text.includes("_branch_id")) {
  console.error("VERIFY_FAIL upsert_custody_item_type branch param", upsertCheck.text);
  process.exit(1);
}
console.log("VERIFY_OK upsert_custody_item_type(_branch_id)");

console.log("ALL_OK");
