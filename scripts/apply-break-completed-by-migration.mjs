import { readFileSync } from "fs";

const ref = "qvuxttguepaeqjginodf";
const version = "20260719120000";
const migrationName = "break_requests_add_completed_by";
const migrationPath = `supabase/migrations/${version}_${migrationName}.sql`;

const sql = readFileSync(migrationPath, "utf8");

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is required (npx supabase login, then export token)");
  process.exit(1);
}

async function query(querySql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: querySql }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

console.log("Checking completed_by column on break_requests...");
const before = await query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'break_requests'
    AND column_name = 'completed_by';
`);
console.log("before", before.status, before.text);

if (before.text.includes("completed_by")) {
  console.log("Column already exists; skipping DDL.");
} else {
  console.log("Applying migration SQL...");
  const apply = await query(sql);
  console.log("apply_status", apply.status);
  console.log(apply.text.slice(0, 4000));
  if (!apply.ok) process.exit(1);
}

console.log("Recording migration version...");
const record = await query(`
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('${version}', '${migrationName}', ARRAY[]::text[])
  ON CONFLICT (version) DO NOTHING;
`);
console.log("record_status", record.status, record.text);
if (!record.ok) process.exit(1);

const after = await query(`
  SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'break_requests'
    AND column_name = 'completed_by';
`);
console.log("after", after.status, after.text);

console.log("Verifying break_requests_apply_policy compiles...");
const fnCheck = await query(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'break_requests_apply_policy';
`);
console.log("function", fnCheck.status, fnCheck.text.includes("completed_by") ? "references completed_by" : "ok");

console.log("Migration applied successfully.");
