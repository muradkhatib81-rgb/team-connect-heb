import { readFileSync } from "fs";
import { execSync } from "child_process";

const ref = "qvuxttguepaeqjginodf";
const version = "20260720170000";
const migrationName = "fix_profiles_update_rls_recursion";
const migrationPath = `supabase/migrations/${version}_${migrationName}.sql`;
const sql = readFileSync(migrationPath, "utf8");

const token = execSync(
  'powershell -NoProfile -File "scripts/read-supabase-cli-token.ps1"',
  { encoding: "utf8" }
)
  .trim()
  .split("\n")[0]
  .trim();

async function query(querySql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: querySql }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

const existing = await query(
  `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '${version}';`
);
console.log("existing", existing.text);

if (!existing.text.includes(version)) {
  console.log("Applying migration...");
  const apply = await query(sql);
  console.log("apply", apply.status, apply.text.slice(0, 2000));
  if (!apply.ok) process.exit(1);

  const record = await query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('${version}', '${migrationName}', ARRAY[]::text[])
    ON CONFLICT (version) DO NOTHING;
  `);
  console.log("record", record.status, record.text);
}

console.log("Done.");
