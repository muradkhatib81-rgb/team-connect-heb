import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const ref = "qvuxttguepaeqjginodf";

const MIGRATIONS = [
  { version: "20260719210000", name: "break_requests_fix_completed_by_refs" },
  { version: "20260719220000", name: "break_requests_align_functions_to_schema" },
];

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

function getSupabaseAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();

  try {
    const token = execFileSync(
      "powershell",
      ["-NoProfile", "-File", "scripts/read-supabase-cli-token.ps1"],
      { encoding: "utf8", cwd: process.cwd() }
    ).trim();
    return token || null;
  } catch {
    return null;
  }
}

async function dbQuery(token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function fail(step, detail) {
  console.error(`FAIL_${step}`, detail);
  process.exit(1);
}

const token = getSupabaseAccessToken();
if (!token) fail("AUTH", "No Supabase access token (env or Windows Credential Manager)");

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !serviceKey || !anonKey) fail("ENV", "Missing SUPABASE_URL / SERVICE_ROLE / PUBLISHABLE key in .env");

for (const mig of MIGRATIONS) {
  const migrationPath = `supabase/migrations/${mig.version}_${mig.name}.sql`;
  console.log(`STEP: Check migration ${mig.version}`);
  const existing = await dbQuery(
    token,
    `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '${mig.version}';`
  );
  console.log("migration_row", existing.status, existing.text.slice(0, 300));

  if (!existing.text.includes(mig.version)) {
    console.log(`STEP: Apply migration ${mig.version}`);
    const sql = readFileSync(migrationPath, "utf8");
    const apply = await dbQuery(token, sql);
    console.log("apply_status", apply.status, apply.text.slice(0, 2000));
    if (!apply.ok) fail("APPLY", apply.text);

    console.log(`STEP: Record migration ${mig.version}`);
    const record = await dbQuery(
      token,
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ('${mig.version}', '${mig.name}', ARRAY[]::text[])
       ON CONFLICT (version) DO NOTHING;`
    );
    console.log("record_status", record.status, record.text.slice(0, 300));
    if (!record.ok) fail("RECORD", record.text);
  } else {
    console.log(`Migration ${mig.version} already applied; skipping DDL.`);
  }
}

console.log("STEP: Verify no completed_by in break-related functions");
const fnCheck = await dbQuery(
  token,
  `SELECT count(*)::int AS c
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND (
       p.proname LIKE '%break%'
       OR pg_get_functiondef(p.oid) ILIKE '%break_requests%'
     )
     AND pg_get_functiondef(p.oid) ILIKE '%completed_by%';`
);
console.log("completed_by_refs", fnCheck.status, fnCheck.text);
if (!fnCheck.ok) fail("FN_CHECK", fnCheck.text);
const fnCount = JSON.parse(fnCheck.text)[0]?.c ?? -1;
if (fnCount !== 0) fail("FN_CHECK", `Expected 0 rows, got count=${fnCount}`);

console.log("STEP: Verify function bodies use end_verified_by");
for (const fn of ["break_requests_apply_policy", "end_my_break", "manual_end_break"]) {
  const q = await dbQuery(
    token,
    `SELECT pg_get_functiondef(p.oid) AS def
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = '${fn}'
     ORDER BY pg_get_function_identity_arguments(p.oid)
     LIMIT 1;`
  );
  if (!q.ok) fail("FN_DEF", q.text);
  const def = q.text;
  if (def.includes("completed_by")) fail("FN_DEF", `${fn} still references completed_by`);
  if (!def.includes("end_verified_by")) fail("FN_DEF", `${fn} missing end_verified_by`);
  if (def.includes("planned_start")) fail("FN_DEF", `${fn} still references planned_start`);
  console.log(`${fn}: ok`);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("STEP: End-to-end break workflow tests");

const suffix = String(Date.now()).slice(-8);
const employeeEmail = `break-e2e-emp-${suffix}@example.com`;
const managerEmail = `break-e2e-mgr-${suffix}@example.com`;
const password = "BreakTest123!";

const { data: dept } = await admin.from("departments").select("id, branch_id").limit(1).maybeSingle();
if (!dept?.id) fail("SETUP", "No department found");

const { data: breakSetting } = await admin
  .from("break_settings")
  .select("id, duration_minutes")
  .limit(1)
  .maybeSingle();
if (!breakSetting?.id) fail("SETUP", "No break_settings row found");

const { data: policyBefore } = await admin.from("break_policy").select("requires_approval").limit(1).maybeSingle();
const originalRequiresApproval = policyBefore?.requires_approval ?? true;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: "Break",
      last_name: role,
      id_number: `9${String(Date.now()).slice(-8)}`,
      department_id: dept.id,
      role,
    },
  });
  if (error) fail("CREATE_USER", `${email}: ${error.message}`);
  return data.user;
}

const employee = await createUser(employeeEmail, "employee");
const manager = await createUser(managerEmail, "manager");

await admin.from("user_roles").upsert(
  { user_id: manager.id, role: "manager", branch_id: dept.branch_id },
  { onConflict: "user_id,role,branch_id" }
);
await admin.from("user_task_permissions").upsert(
  { user_id: manager.id, can_manage_breaks: true },
  { onConflict: "user_id" }
);

const signIn = async (email) => {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) fail("SIGN_IN", `${email}: ${error.message}`);
  return client;
};

await admin.from("break_policy").update({ requires_approval: true }).neq("id", "00000000-0000-0000-0000-000000000000");

const employeeClient = await signIn(employeeEmail);
const plannedStart = new Date(Date.now() + 2 * 60 * 1000).toISOString();

const { data: inserted, error: insertErr } = await employeeClient
  .from("break_requests")
  .insert({
    user_id: employee.id,
    department_id: dept.id,
    branch_id: dept.branch_id,
    break_setting_id: breakSetting.id,
    requested_at: plannedStart,
    duration_minutes: breakSetting.duration_minutes ?? 15,
    note: "e2e break request",
    status: "pending",
  })
  .select("id, status, end_verified_by, ending_verified_at, last_modified_at")
  .single();

if (insertErr) fail("INSERT", insertErr.message);
console.log("INSERT_OK", inserted);
if (inserted.status !== "pending") fail("INSERT", `Expected pending, got ${inserted.status}`);
if (inserted.end_verified_by !== null || inserted.ending_verified_at !== null) {
  fail("INSERT", "end verification fields should be null on insert");
}

const managerClient = await signIn(managerEmail);
const { error: approveErr } = await managerClient
  .from("break_requests")
  .update({
    status: "approved",
    approved_at_time: plannedStart,
    approved_by: manager.id,
    approval_decided_at: new Date().toISOString(),
  })
  .eq("id", inserted.id);
if (approveErr) fail("APPROVE", approveErr.message);
console.log("APPROVE_OK");

const { data: afterApprove } = await admin
  .from("break_requests")
  .select("status")
  .eq("id", inserted.id)
  .single();
if (afterApprove?.status !== "approved") {
  fail("APPROVE", `Unexpected status after approve: ${afterApprove?.status}`);
}

await admin
  .from("break_requests")
  .update({ requested_at: new Date(Date.now() - 60_000).toISOString(), approved_at_time: new Date(Date.now() - 60_000).toISOString() })
  .eq("id", inserted.id);

const { data: activatedCount, error: activateErr } = await admin.rpc("activate_due_break_requests");
if (activateErr) fail("ACTIVATE", activateErr.message);
console.log("ACTIVATE_OK", activatedCount);

const { data: activeRow } = await admin
  .from("break_requests")
  .select("status, started_at, ends_at")
  .eq("id", inserted.id)
  .single();
if (activeRow?.status !== "active") fail("ACTIVATE", `Expected active, got ${activeRow?.status}`);
console.log("SCHEDULED_START_OK", activeRow);

const { error: endErr } = await employeeClient.rpc("end_my_break", { _id: inserted.id });
if (endErr) fail("EMPLOYEE_END", endErr.message);

const { data: completedRow } = await admin
  .from("break_requests")
  .select("status, end_verified_by, ending_verified_at, last_modified_at, completed_at")
  .eq("id", inserted.id)
  .single();
if (completedRow?.status !== "completed") fail("EMPLOYEE_END", `status=${completedRow?.status}`);
if (completedRow?.end_verified_by !== employee.id) fail("EMPLOYEE_END", "end_verified_by mismatch");
if (!completedRow?.ending_verified_at || !completedRow?.last_modified_at) {
  fail("EMPLOYEE_END", "missing ending_verified_at or last_modified_at");
}
console.log("EMPLOYEE_END_OK", completedRow);

await admin.from("break_policy").update({ requires_approval: false }).neq("id", "00000000-0000-0000-0000-000000000000");

const { data: inserted2, error: insert2Err } = await employeeClient
  .from("break_requests")
  .insert({
    user_id: employee.id,
    department_id: dept.id,
    branch_id: dept.branch_id,
    break_setting_id: breakSetting.id,
    requested_at: new Date(Date.now() - 60_000).toISOString(),
    duration_minutes: breakSetting.duration_minutes ?? 15,
    note: "e2e manager end",
    status: "pending",
  })
  .select("id")
  .single();
if (insert2Err) fail("INSERT2", insert2Err.message);

await admin.rpc("activate_due_break_requests");
const { error: mgrEndErr } = await managerClient.rpc("manual_end_break", {
  _id: inserted2.id,
  _reason: "e2e manager force return",
});
if (mgrEndErr) fail("MANAGER_END", mgrEndErr.message);

const { data: mgrEnded } = await admin
  .from("break_requests")
  .select("status, end_verified_by, ending_verified_at")
  .eq("id", inserted2.id)
  .single();
if (mgrEnded?.status !== "ended_by_manager") fail("MANAGER_END", `status=${mgrEnded?.status}`);
if (mgrEnded?.end_verified_by !== manager.id) fail("MANAGER_END", "end_verified_by mismatch");
console.log("MANAGER_END_OK", mgrEnded);

const { data: auditRows, error: auditErr } = await admin
  .from("break_audit_log")
  .select("action, actor_id, break_request_id")
  .eq("break_request_id", inserted2.id)
  .eq("action", "manual_end");
if (auditErr) fail("AUDIT", auditErr.message);
if (!auditRows?.length) fail("AUDIT", "No manual_end audit log row");
console.log("AUDIT_OK", auditRows[0]);

await admin
  .from("break_policy")
  .update({ requires_approval: originalRequiresApproval })
  .neq("id", "00000000-0000-0000-0000-000000000000");
await admin.from("break_requests").delete().in("id", [inserted.id, inserted2.id]);
await admin.auth.admin.deleteUser(employee.id);
await admin.auth.admin.deleteUser(manager.id);

console.log("ALL_DEPLOY_CHECKS_PASSED");
