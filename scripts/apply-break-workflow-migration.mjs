import { readFileSync } from "fs";

const ref = "qvuxttguepaeqjginodf";
const version = "20260718140000";
const migrationName = "scheduled_break_workflow";
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

console.log("Checking break_request_status enum...");
const before = await query(`
  SELECT typname FROM pg_type WHERE typname = 'break_request_status';
`);
console.log("before", before.status, before.text);

const existing = await query(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version = '${version}';
`);
console.log("migration_row", existing.status, existing.text);

if (before.text.includes("break_request_status")) {
  console.log("Enum already exists; skipping DDL.");
} else {
  console.log("Applying migration SQL...");
  const apply = await query(sql);
  console.log("apply_status", apply.status);
  console.log(apply.text.slice(0, 8000));
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
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'break_requests'
    AND column_name IN ('planned_start', 'ended_by', 'overtime_minutes')
  ORDER BY column_name;
`);
console.log("after_columns", after.status, after.text);

console.log("Migration applied successfully.");
