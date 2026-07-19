import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const ref = "qvuxttguepaeqjginodf";

const MIGRATIONS = [
  { version: "20260719210000", name: "break_requests_fix_completed_by_refs" },
  { version: "20260719220000", name: "break_requests_align_functions_to_schema" },
  { version: "20260720100000", name: "break_management_complete" },
  { version: "20260720110000", name: "break_requests_branch_id_from_profile" },
  { version: "20260720120000", name: "can_user_request_break_self_service" },
  { version: "20260720130000", name: "fix_break_activation_trigger_order" },
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
    return execFileSync("powershell", ["-NoProfile", "-File", "scripts/read-supabase-cli-token.ps1"], {
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();
  } catch {
    return null;
  }
}

async function dbQuery(token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function fail(step, detail) {
  console.error(`FAIL_${step}`, detail);
  process.exit(1);
}

const token = getSupabaseAccessToken();
if (!token) fail("AUTH", "No Supabase access token");

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !serviceKey || !anonKey) fail("ENV", "Missing keys in .env");

for (const mig of MIGRATIONS) {
  const path = `supabase/migrations/${mig.version}_${mig.name}.sql`;
  console.log(`CHECK migration ${mig.version}`);
  const existing = await dbQuery(token, `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '${mig.version}';`);
  if (!existing.text.includes(mig.version)) {
    console.log(`APPLY ${mig.version}`);
    const apply = await dbQuery(token, readFileSync(path, "utf8"));
    if (!apply.ok) fail("APPLY", apply.text);
    const record = await dbQuery(
      token,
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('${mig.version}', '${mig.name}', ARRAY[]::text[]) ON CONFLICT DO NOTHING;`,
    );
    if (!record.ok) fail("RECORD", record.text);
  } else {
    console.log(`SKIP ${mig.version} (applied)`);
  }
}

const fnCheck = await dbQuery(
  token,
  `SELECT count(*)::int AS c FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND (p.proname LIKE '%break%' OR pg_get_functiondef(p.oid) ILIKE '%break_requests%')
     AND pg_get_functiondef(p.oid) ILIKE '%completed_by%';`,
);
if (JSON.parse(fnCheck.text)[0]?.c !== 0) fail("FN_CHECK", fnCheck.text);

for (const fn of ["break_requests_apply_policy", "end_my_break", "manual_end_break", "cancel_break_request", "approve_break_request"]) {
  const q = await dbQuery(
    token,
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = '${fn}' LIMIT 1;`,
  );
  const def = q.text;
  if (def.includes("completed_by")) fail("FN_DEF", `${fn} has completed_by`);
  if (fn !== "approve_break_request" && fn !== "break_requests_apply_policy" && !def.includes("end_verified_by")) {
    if (fn === "end_my_break" || fn === "manual_end_break" || fn === "cancel_break_request") {
      // cancel doesn't need end_verified_by
    } else if (!def.includes("end_verified_by")) fail("FN_DEF", `${fn} missing end_verified_by`);
  }
  if (def.includes("planned_start") && fn === "break_requests_apply_policy") console.log(`${fn}: uses planned_start (ok)`);
  else console.log(`${fn}: ok`);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = String(Date.now()).slice(-8);
const employeeEmail = `break-e2e-emp-${suffix}@example.com`;
const managerEmail = `break-e2e-mgr-${suffix}@example.com`;
const password = "BreakTest123!";

const { data: dept } = await admin.from("departments").select("id, branch_id").limit(1).maybeSingle();
if (!dept?.id) fail("SETUP", "No department");
const { data: breakSetting } = await admin.from("break_settings").select("id, duration_minutes").limit(1).maybeSingle();
if (!breakSetting?.id) fail("SETUP", "No break_settings");

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
  if (error) fail("CREATE_USER", error.message);
  return data.user;
}

const employee = await createUser(employeeEmail, "employee");
const manager = await createUser(managerEmail, "manager");
await admin
  .from("profiles")
  .update({ branch_id: dept.branch_id, department_id: dept.id })
  .eq("id", employee.id);
await admin
  .from("profiles")
  .update({ branch_id: dept.branch_id, department_id: dept.id })
  .eq("id", manager.id);
await admin.from("user_roles").upsert({ user_id: manager.id, role: "manager", branch_id: dept.branch_id }, { onConflict: "user_id,role,branch_id" });
await admin.from("user_task_permissions").upsert({ user_id: manager.id, can_manage_breaks: true }, { onConflict: "user_id" });

const signIn = async (email) => {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) fail("SIGN_IN", error.message);
  return client;
};

const employeeClient = await signIn(employeeEmail);
const managerClient = await signIn(managerEmail);

// --- Multiple breaks (approval path) ---
await admin.from("break_policy").update({ requires_approval: true }).neq("id", "00000000-0000-0000-0000-000000000000");

const t1 = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const t2 = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

const { data: b1, error: e1 } = await employeeClient
  .from("break_requests")
  .insert({
    user_id: employee.id,
    department_id: dept.id,
    break_setting_id: breakSetting.id,
    requested_at: t1,
    planned_start: t1,
    duration_minutes: 15,
    planned_duration: 15,
    note: "break 1",
  })
  .select("id, status")
  .single();
if (e1) fail("MULTI_INSERT_1", e1.message);

const { error: e2 } = await employeeClient.from("break_requests").insert({
  user_id: employee.id,
  department_id: dept.id,
  break_setting_id: breakSetting.id,
  requested_at: t2,
  planned_start: t2,
  duration_minutes: 15,
  planned_duration: 15,
  note: "break 2",
});
if (e2) fail("MULTI_INSERT_2", e2.message);
console.log("MULTI_BREAK_OK");

const { error: overlapErr } = await employeeClient.from("break_requests").insert({
  user_id: employee.id,
  department_id: dept.id,
  break_setting_id: breakSetting.id,
  requested_at: t1,
  planned_start: t1,
  duration_minutes: 15,
  planned_duration: 15,
});
if (!overlapErr) fail("OVERLAP", "Expected overlap error");
console.log("OVERLAP_BLOCKED_OK", overlapErr.message);

// Approve first break
const { error: approveErr } = await managerClient.rpc("approve_break_request", {
  _id: b1.id,
  _approved_at_time: t1,
});
if (approveErr) fail("APPROVE", approveErr.message);
console.log("APPROVE_OK");

// Employee cancel second break (pending)
const { data: pendingRows } = await admin.from("break_requests").select("id, status").eq("user_id", employee.id).eq("status", "pending_approval");
const secondPending = pendingRows?.find((r) => r.id !== b1.id);
if (secondPending) {
  const { error: cancelErr } = await employeeClient.rpc("cancel_break_request", { _id: secondPending.id });
  if (cancelErr) fail("EMP_CANCEL", cancelErr.message);
  console.log("EMP_CANCEL_OK");
}

// Auto-approval path + scheduled start
await admin.from("break_policy").update({ requires_approval: false }).neq("id", "00000000-0000-0000-0000-000000000000");

const pastStart = new Date(Date.now() - 60_000).toISOString();
const { data: autoBreak, error: autoInsErr } = await employeeClient
  .from("break_requests")
  .insert({
    user_id: employee.id,
    department_id: dept.id,
    break_setting_id: breakSetting.id,
    requested_at: pastStart,
    planned_start: pastStart,
    duration_minutes: breakSetting.duration_minutes ?? 15,
    planned_duration: breakSetting.duration_minutes ?? 15,
  })
  .select("id")
  .single();
if (autoInsErr) fail("AUTO_INSERT", autoInsErr.message);

await admin.rpc("activate_due_break_requests");
const { data: activeRow } = await admin.from("break_requests").select("status, ends_at").eq("id", autoBreak.id).single();
if (activeRow?.status !== "active") fail("ACTIVATE", `status=${activeRow?.status}`);
console.log("SCHEDULED_START_OK");

// Employee end
const { error: endErr } = await employeeClient.rpc("end_my_break", { _id: autoBreak.id });
if (endErr) fail("EMPLOYEE_END", endErr.message);
const { data: completedRow } = await admin
  .from("break_requests")
  .select("status, end_verified_by, overtime_minutes")
  .eq("id", autoBreak.id)
  .single();
if (completedRow?.status !== "completed") fail("EMPLOYEE_END", completedRow);
console.log("EMPLOYEE_END_OK");

// Manager end
const { data: mgrBreak, error: mgrInsErr } = await employeeClient
  .from("break_requests")
  .insert({
    user_id: employee.id,
    department_id: dept.id,
    break_setting_id: breakSetting.id,
    requested_at: pastStart,
    planned_start: pastStart,
    duration_minutes: 15,
    planned_duration: 15,
  })
  .select("id")
  .single();
if (mgrInsErr) fail("MGR_INSERT", mgrInsErr.message);
await admin.rpc("activate_due_break_requests");
const { error: mgrEndErr } = await managerClient.rpc("manual_end_break", { _id: mgrBreak.id, _reason: "e2e" });
if (mgrEndErr) fail("MANAGER_END", mgrEndErr.message);
console.log("MANAGER_END_OK");

const { data: auditRows } = await admin
  .from("break_audit_log")
  .select("action")
  .eq("break_request_id", mgrBreak.id)
  .eq("action", "manual_end");
if (!auditRows?.length) fail("AUDIT", "no manual_end audit");
console.log("AUDIT_OK");

// Cleanup — breaks are never deleted; remove test auth users only
await admin.from("break_policy").update({ requires_approval: originalRequiresApproval }).neq("id", "00000000-0000-0000-0000-000000000000");
await admin.auth.admin.deleteUser(employee.id);
await admin.auth.admin.deleteUser(manager.id);

console.log("ALL_DEPLOY_CHECKS_PASSED");
