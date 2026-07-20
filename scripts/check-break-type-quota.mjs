import { readFileSync } from "fs";
import { execFileSync } from "child_process";

const ref = "qvuxttguepaeqjginodf";

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

const mig = await dbQuery(
  token,
  `SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20260720200000', '20260720210000') ORDER BY version;`,
);
console.log("migrations", mig.text);

const fn = await dbQuery(
  token,
  `SELECT p.proname,
          pg_get_functiondef(p.oid) ILIKE '%validate_break_type_once_per_shift%' AS has_validator,
          position('skip type quota' in lower(pg_get_functiondef(p.oid))) > 0 AS skips_without_shift
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'validate_break_type_once_per_shift';`,
);
console.log("validator_fn", fn.text);

const policy = await dbQuery(
  token,
  `SELECT position('validate_break_type_once_per_shift' in pg_get_functiondef(p.oid)) > 0 AS calls_quota
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'break_requests_apply_policy';`,
);
console.log("apply_policy", policy.text);
