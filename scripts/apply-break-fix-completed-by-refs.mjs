import { readFileSync } from "fs";

const ref = "qvuxttguepaeqjginodf";
const version = "20260719210000";
const migrationName = "break_requests_fix_completed_by_refs";
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

console.log("Checking break_requests audit columns...");
const before = await query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'break_requests'
    AND column_name IN ('completed_by', 'end_verified_by', 'ending_verified_at', 'last_modified_at')
  ORDER BY column_name;
`);
console.log("before", before.status, before.text);

const existing = await query(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version = '${version}';
`);
console.log("migration_row", existing.status, existing.text);

if (existing.text.includes(version)) {
  console.log("Migration already recorded; skipping apply.");
} else {
  console.log("Applying migration SQL...");
  const apply = await query(sql);
  console.log("apply_status", apply.status);
  console.log(apply.text.slice(0, 8000));
  if (!apply.ok) process.exit(1);

  console.log("Recording migration version...");
  const record = await query(`
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('${version}', '${migrationName}', ARRAY[]::text[])
    ON CONFLICT (version) DO NOTHING;
  `);
  console.log("record_status", record.status, record.text);
  if (!record.ok) process.exit(1);
}

console.log("Verifying no break-related functions reference completed_by...");
const fnCheck = await query(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname LIKE '%break%'
      OR pg_get_functiondef(p.oid) ILIKE '%break_requests%'
    )
    AND pg_get_functiondef(p.oid) ~* '\\mcompleted_by\\M';
`);
console.log("completed_by_refs", fnCheck.status, fnCheck.text);

const cols = await query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'break_requests'
    AND column_name IN ('completed_by', 'end_verified_by', 'ending_verified_at', 'last_modified_at')
  ORDER BY column_name;
`);
console.log("after_columns", cols.status, cols.text);

const policy = await query(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'break_requests_apply_policy';
`);
console.log(
  "break_requests_apply_policy",
  policy.text.includes("end_verified_by") && !policy.text.includes("completed_by") ? "ok" : policy.text.slice(0, 2000)
);

console.log("Migration verification complete.");
