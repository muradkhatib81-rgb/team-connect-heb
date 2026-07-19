import { execSync } from "child_process";

const ref = "qvuxttguepaeqjginodf";
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
  return { ok: res.ok, text };
}

const ownerId = "fda93cf2-704a-49d0-9fee-826453b0801a";
const branchId = "fe96cb68-d7df-47e3-9d8a-6471e17f0db2";

// Pick an active employee in branch
const employees = JSON.parse(
  (
    await query(`
      SELECT p.id, p.full_name, p.is_active
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'employee'::public.app_role
      WHERE p.branch_id = '${branchId}' AND COALESCE(p.is_active, true) = true
      LIMIT 1;
    `)
  ).text
);
const employee = employees[0];
if (!employee) {
  console.log("No active employee found for test");
  process.exit(1);
}
console.log("Test employee:", employee);

const testId = `e2e-deact-${Date.now()}`;

const steps = [
  {
    name: "update_profile_fields",
    sql: `
DO $$
DECLARE v_err text;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${ownerId}')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-active-branch', '${branchId}')::text, true);
  BEGIN
    UPDATE public.profiles SET on_leave = on_leave WHERE id = '${employee.id}';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE EXCEPTION 'update failed: %', v_err;
  END;
END $$;`,
  },
  {
    name: "deactivate_via_rpc",
    sql: `
DO $$
DECLARE v_err text;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${ownerId}')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-active-branch', '${branchId}')::text, true);
  BEGIN
    PERFORM public.set_employee_active('${employee.id}', false, '${testId}');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE EXCEPTION 'deactivate failed: %', v_err;
  END;
END $$;`,
  },
  {
    name: "verify_inactive_after_reload",
    sql: `
DO $$
DECLARE v_active boolean; v_err text;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${ownerId}')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-active-branch', '${branchId}')::text, true);
  SELECT is_active INTO v_active FROM public.profiles WHERE id = '${employee.id}';
  IF COALESCE(v_active, true) THEN
    RAISE EXCEPTION 'employee still active after deactivation';
  END IF;
END $$;`,
  },
];

for (const step of steps) {
  const r = await query(step.sql);
  console.log(step.name, r.ok ? "OK" : r.text.slice(0, 300));
  if (!r.ok) process.exit(1);
}

// Reactivate test employee so we do not leave prod mutated
await query(`
  SELECT public.set_employee_active('${employee.id}', true, 'e2e-reactivate');
`);
console.log("Reactivated test employee");

console.log("All RLS/deactivation checks passed.");
