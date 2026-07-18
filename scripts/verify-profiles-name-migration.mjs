import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

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

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rows, error: selectErr } = await sb
  .from("profiles")
  .select("id, first_name, last_name, full_name")
  .limit(3);
if (selectErr) {
  console.error("SELECT_FAIL", selectErr.message);
  process.exit(1);
}
console.log("SELECT_OK", JSON.stringify(rows));

const { count, error: countErr } = await sb
  .from("profiles")
  .select("id", { count: "exact", head: true });
if (countErr) {
  console.error("COUNT_FAIL", countErr.message);
  process.exit(1);
}
console.log("PROFILE_COUNT", count);

const testId = `999${String(Date.now()).slice(-6)}`;
const { data: dept } = await sb.from("departments").select("id").limit(1).maybeSingle();
if (!dept?.id) {
  console.error("NO_DEPARTMENT");
  process.exit(1);
}

const suffix = String(Date.now()).slice(-6);
const email = `name-test-${suffix}@example.com`;
const { data: authUser, error: authErr } = await sb.auth.admin.createUser({
  email,
  password: "TestPass123!",
  email_confirm: true,
  user_metadata: {
    first_name: "TestFirst",
    last_name: "TestLast",
    id_number: testId,
    department_id: dept.id,
    role: "employee",
  },
});
if (authErr) {
  console.error("CREATE_USER_FAIL", authErr.message);
  process.exit(1);
}

const { data: created, error: readErr } = await sb
  .from("profiles")
  .select("id, first_name, last_name, full_name")
  .eq("id", authUser.user.id)
  .single();
if (readErr) {
  console.error("READ_CREATED_FAIL", readErr.message);
  process.exit(1);
}
console.log("CREATE_OK", JSON.stringify(created));

const { data: edited, error: editErr } = await sb
  .from("profiles")
  .update({ first_name: "EditedFirst", last_name: "EditedLast" })
  .eq("id", authUser.user.id)
  .select("id, first_name, last_name, full_name")
  .single();
if (editErr) {
  console.error("EDIT_FAIL", editErr.message);
  process.exit(1);
}
console.log("EDIT_OK", JSON.stringify(edited));
if (edited.full_name !== "EditedFirst EditedLast") {
  console.error("FULL_NAME_SYNC_FAIL", edited.full_name);
  process.exit(1);
}

const { data: search, error: searchErr } = await sb
  .from("profiles")
  .select("id, first_name, last_name, full_name")
  .or("first_name.ilike.%EditedFirst%,last_name.ilike.%EditedLast%")
  .eq("id", authUser.user.id);
if (searchErr) {
  console.error("SEARCH_FAIL", searchErr.message);
  process.exit(1);
}
console.log("SEARCH_OK", search.length === 1);

await sb.auth.admin.deleteUser(authUser.user.id);
console.log("CLEANUP_OK");
console.log("ALL_CHECKS_PASSED");
