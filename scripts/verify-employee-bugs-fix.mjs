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
  return { ok: res.ok, text: await res.text() };
}

const ownerId = "fda93cf2-704a-49d0-9fee-826453b0801a";
const branchId = "fe96cb68-d7df-47e3-9d8a-6471e17f0db2";

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
  console.log("No test employee");
  process.exit(0);
}

const ctx = `
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${ownerId}')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-active-branch', '${branchId}')::text, true);
`;

const deactivate = await query(`DO $$ BEGIN ${ctx}
  PERFORM public.set_employee_active('${employee.id}', false, 'verify-bug1');
END $$;`);
console.log("deactivate", deactivate.ok ? "OK" : deactivate.text.slice(0, 300));

const verify = await query(`DO $$
  DECLARE v_active boolean;
BEGIN ${ctx}
  SELECT is_active INTO v_active FROM public.profiles WHERE id = '${employee.id}';
  IF COALESCE(v_active, true) THEN RAISE EXCEPTION 'still active'; END IF;
END $$;`);
console.log("verify inactive", verify.ok ? "OK" : verify.text.slice(0, 300));

await query(`DO $$ BEGIN ${ctx}
  PERFORM public.set_employee_active('${employee.id}', true, 'verify-reactivate');
END $$;`);
console.log("reactivated", employee.full_name);

// Orphan auth check for murad id
const orphan = await query(`
  SELECT ea.id_number,
    (SELECT count(*) FROM auth.users u WHERE u.email = ea.id_number || '@employees.ramilevy.local') AS auth_count,
    (SELECT count(*) FROM public.profiles p WHERE p.id_number = ea.id_number) AS profile_count
  FROM public.employee_archive ea
  WHERE ea.id_number = '914120993';
`);
console.log("orphan 914120993", orphan.text);
