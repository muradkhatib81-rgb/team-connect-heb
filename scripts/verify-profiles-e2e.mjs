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

// Find a regular employee (not manager) for archive test
const employees = JSON.parse(
  (
    await query(`
      SELECT p.id, p.full_name
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'employee'::public.app_role
      WHERE p.branch_id = '${branchId}' AND COALESCE(p.is_active, true) = true
      LIMIT 1;
    `)
  ).text
);
const employee = employees[0];
if (!employee) {
  console.log("No active employee found");
  process.exit(1);
}
console.log("Archive test employee:", employee.id, employee.full_name);

const ctx = `
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${ownerId}')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-active-branch', '${branchId}')::text, true);
`;

const steps = [
  {
    name: "update_profile_no_recursion",
    sql: `DO $$ BEGIN ${ctx}
      UPDATE public.profiles SET on_leave = on_leave WHERE id = '${employee.id}';
    END $$;`,
  },
  {
    name: "deactivate_employee",
    sql: `DO $$ BEGIN ${ctx}
      PERFORM public.set_employee_active('${employee.id}', false, 'e2e-archive-test');
    END $$;`,
  },
  {
    name: "reload_shows_inactive",
    sql: `DO $$
      DECLARE v_active boolean;
    BEGIN ${ctx}
      SELECT is_active INTO v_active FROM public.profiles WHERE id = '${employee.id}';
      IF COALESCE(v_active, true) THEN RAISE EXCEPTION 'still active'; END IF;
    END $$;`,
  },
  {
    name: "archive_employee",
    sql: `DO $$
      DECLARE v_arch uuid;
    BEGIN ${ctx}
      v_arch := public.archive_employee('${employee.id}', 'e2e archive test');
      IF v_arch IS NULL THEN RAISE EXCEPTION 'archive returned null'; END IF;
    END $$;`,
  },
  {
    name: "profile_deleted",
    sql: `DO $$
      DECLARE v_cnt int;
    BEGIN ${ctx}
      SELECT count(*) INTO v_cnt FROM public.profiles WHERE id = '${employee.id}';
      IF v_cnt > 0 THEN RAISE EXCEPTION 'profile still exists'; END IF;
    END $$;`,
  },
  {
    name: "unauthorized_cross_branch_update_blocked",
    sql: `DO $$
      DECLARE v_err text; v_other uuid;
    BEGIN
      SELECT id INTO v_other FROM public.profiles
       WHERE branch_id IS NOT NULL AND branch_id <> '${branchId}'
       LIMIT 1;
      IF v_other IS NULL THEN RETURN; END IF;
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', '${ownerId}')::text, true);
      PERFORM set_config('request.headers', json_build_object('x-active-branch', '${branchId}')::text, true);
      BEGIN
        UPDATE public.profiles SET on_leave = true WHERE id = v_other;
        RAISE EXCEPTION 'cross-branch update should have been blocked';
      EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%row-level security%' OR v_err LIKE '%permission%' THEN
          NULL;
        ELSE
          RAISE;
        END IF;
      END;
    END $$;`,
  },
];

for (const step of steps) {
  const r = await query(step.sql);
  console.log(step.name, r.ok ? "OK" : r.text.slice(0, 400));
  if (!r.ok) process.exit(1);
}

console.log("Full E2E verification passed.");
