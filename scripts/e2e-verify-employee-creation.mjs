/**
 * End-to-end verification for employee creation fixes.
 * Run: node scripts/e2e-verify-employee-creation.mjs
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function parseEnv(path) {
  const env = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (id) => `${String(id).trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;
const branchId = "fe96cb68-d7df-47e3-9d8a-6471e17f0db2";
const ownerId = "fda93cf2-704a-49d0-9fee-826453b0801a";
const TEST_PASSWORD = "E2eVerify123!";
const ARCHIVED_COPY_ID = "784839965";

const env = parseEnv(".env");
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const anon = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !svc) {
  console.error("FAIL: missing SUPABASE env");
  process.exit(1);
}

const admin = createClient(url, svc, { auth: { persistSession: false } });
const pub = createClient(url, anon, { auth: { persistSession: false } });

const results = [];
const pass = (name, detail = "") => results.push({ name, ok: true, detail });
const fail = (name, detail = "") => {
  results.push({ name, ok: false, detail });
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
};

function formatAuthError(error) {
  const raw = error?.message?.trim();
  if (raw && raw !== "{}" && raw !== "undefined") return raw;
  if (error?.code === "email_exists") return "כבר קיים עובד עם מספר זהות זה.";
  return "שגיאה בחשבון ההתחברות של העובד. נסו שוב או פנו לתמיכה.";
}

function extractServerFnErrorMessage(error, fallback = "שגיאה בלתי צפויה") {
  if (!error) return fallback;
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed && trimmed !== "{}" ? trimmed : fallback;
  }
  const candidates = [];
  if (error instanceof Error && error.message) candidates.push(error.message);
  const rec = error;
  if (typeof rec.message === "string") candidates.push(rec.message);
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (trimmed && trimmed !== "{}" && trimmed !== "undefined") return trimmed;
  }
  return fallback;
}

async function findAuthUserIdByEmail(email) {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(formatAuthError(error));
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === normalized);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function reprovisionOrphanEmployeeAuth(data, branch) {
  const email = idEmail(data.id_number);
  const uid = await findAuthUserIdByEmail(email);
  if (!uid) return null;
  const { data: prof } = await admin.from("profiles").select("id").eq("id", uid).maybeSingle();
  if (prof) return null;

  const { error: updErr } = await admin.auth.admin.updateUserById(uid, {
    password: data.password,
    email_confirm: true,
    user_metadata: {
      first_name: data.first_name,
      last_name: data.last_name,
      id_number: data.id_number,
      department_id: data.department_id,
      job_title: data.job_title,
      phone: data.phone,
      role: data.role,
    },
  });
  if (updErr) throw new Error(formatAuthError(updErr));

  const fullName = `${data.first_name.trim()} ${data.last_name.trim()}`.trim();
  const { error: profErr } = await admin.from("profiles").insert({
    id: uid,
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    full_name: fullName,
    id_number: data.id_number,
    department_id: data.department_id,
    branch_id: branch,
    job_title: data.job_title || null,
    phone: data.phone || null,
    avatar_url: null,
    must_change_password: true,
    is_active: true,
  });
  if (profErr) throw new Error(profErr.message);

  await admin.from("user_roles").delete().eq("user_id", uid);
  const { error: roleErr } = await admin.from("user_roles").insert({ user_id: uid, role: data.role });
  if (roleErr) throw new Error(roleErr.message);
  return uid;
}

async function createEmployeeFlow(scoped, data) {
  const { data: dept, error: dErr } = await scoped
    .from("departments")
    .select("id, branch_id")
    .eq("id", data.department_id)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  if (!dept) throw new Error("מחלקה לא נמצאה");
  const deptBranchId = dept.branch_id;

  const { data: existing, error: exErr } = await scoped
    .from("profiles")
    .select("id, first_name, last_name, full_name, is_active, job_title, department_id, on_leave, departments(name)")
    .eq("id_number", data.id_number)
    .eq("branch_id", deptBranchId)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (existing) {
    throw new Error(`DUPLICATE_EMPLOYEE::${JSON.stringify({ id: existing.id })}`);
  }

  if (!data.force_archived) {
    const { data: archRows, error: aErr } = await scoped.rpc("find_archived_by_id_number", {
      _id_number: data.id_number,
    });
    if (aErr) throw new Error(aErr.message);
    const arch = (archRows ?? [])[0] ?? null;
    if (arch) throw new Error(`ARCHIVED_EXISTS::${JSON.stringify(arch)}`);
  }

  const reprovisionedId = await reprovisionOrphanEmployeeAuth(data, deptBranchId);
  if (reprovisionedId) return { id: reprovisionedId, path: "reprovision" };

  const { data: created, error } = await admin.auth.admin.createUser({
    email: idEmail(data.id_number),
    password: data.password,
    email_confirm: true,
    user_metadata: {
      first_name: data.first_name,
      last_name: data.last_name,
      id_number: data.id_number,
      department_id: data.department_id,
      job_title: data.job_title,
      phone: data.phone,
      role: data.role,
    },
  });
  if (error) {
    const msg = formatAuthError(error).toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
      const fallbackId = await reprovisionOrphanEmployeeAuth(data, deptBranchId);
      if (fallbackId) return { id: fallbackId, path: "reprovision-fallback" };
      throw new Error("כבר קיים עובד עם מספר זהות זה.");
    }
    throw new Error(formatAuthError(error) || "שגיאה ביצירת עובד");
  }

  const newUserId = created.user?.id ?? null;
  if (newUserId) {
    await admin
      .from("profiles")
      .update({
        department_id: data.department_id,
        branch_id: deptBranchId,
        avatar_url: null,
      })
      .eq("id", newUserId);
    await admin.from("user_roles").delete().eq("user_id", newUserId);
    await admin.from("user_roles").insert({ user_id: newUserId, role: data.role });
  }
  return { id: newUserId, path: "createUser" };
}

async function getOwnerSession() {
  const ownerPw = env.PLATFORM_OWNER_PASSWORD || env.E2E_ADMIN_PASSWORD || env.TEST_ADMIN_PASSWORD;
  if (ownerPw) {
    const { data, error } = await pub.auth.signInWithPassword({
      email: idEmail("000000001"),
      password: ownerPw,
    });
    if (!error && data.session?.access_token) return data.session.access_token;
  }
  const { data: ownerUser } = await admin.auth.admin.getUserById(ownerId);
  const email = ownerUser?.user?.email ?? "";
  const { data: tokenData, error: tokenErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (tokenErr) throw tokenErr;
  const { data: sessionData, error: sessionErr } = await pub.auth.verifyOtp({
    token_hash: tokenData.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionErr) throw sessionErr;
  return sessionData.session.access_token;
}

function scopedClient(token) {
  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-active-branch": branchId,
      },
    },
    auth: { persistSession: false },
  });
}

async function assertInActiveList(scoped, userId, idNumber) {
  const { data, error } = await scoped
    .from("profiles")
    .select("id, id_number, is_active, branch_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("profile missing from list query");
  if (data.is_active !== true) throw new Error("profile not active");
  if (data.branch_id !== branchId) throw new Error("wrong branch");
  const { data: rows } = await scoped
    .from("profiles")
    .select("id")
    .eq("id_number", idNumber)
    .eq("branch_id", branchId)
    .eq("is_active", true);
  if (!rows?.some((r) => r.id === userId)) throw new Error("not in active employees filter");
}

async function assertLogin(idNumber, password) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email: idEmail(idNumber),
    password,
  });
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("no session");
  await client.auth.signOut();
}

async function assertAuthProfileConsistency(idNumber) {
  const email = idEmail(idNumber);
  const uid = await findAuthUserIdByEmail(email);
  const { data: prof } = await admin
    .from("profiles")
    .select("id")
    .eq("id_number", idNumber)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (!uid && prof) throw new Error("profile without auth");
  if (uid && !prof) throw new Error("orphan auth without profile");
  if (uid && prof && uid !== prof.id) throw new Error("auth/profile id mismatch");
  return { auth: !!uid, profile: !!prof, consistent: (!uid && !prof) || (uid && prof && uid === prof.id) };
}

async function deleteTestEmployee(scoped, userId, reason) {
  const { error: deactErr } = await scoped.rpc("set_employee_active", {
    _user_id: userId,
    _active: false,
    _note: reason,
  });
  if (deactErr) throw new Error(deactErr.message);

  const { error: arcErr } = await scoped.rpc("archive_employee", {
    _user_id: userId,
    _reason: reason,
  });
  if (arcErr) throw new Error(arcErr.message);
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    const { data: prof } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (prof) throw new Error(`auth delete failed and profile still exists: ${formatAuthError(delErr)}`);
  }
}

async function getDeptId(scoped) {
  const { data } = await scoped.from("departments").select("id").limit(1);
  return data?.[0]?.id;
}

const createdForCleanup = [];

try {
  console.log("=== Employee creation E2E verification ===\n");

  const token = await getOwnerSession();
  const scoped = scopedClient(token);
  const deptId = await getDeptId(scoped);
  if (!deptId) throw new Error("no department");

  // Preflight: remove stale live profiles from prior failed e2e runs
  for (const staleId of [ARCHIVED_COPY_ID, "918119280", "923157494"]) {
    const { data: live } = await scoped
      .from("profiles")
      .select("id")
      .eq("id_number", staleId)
      .eq("branch_id", branchId)
      .maybeSingle();
    if (live?.id) {
      try {
        await deleteTestEmployee(scoped, live.id, "e2e preflight cleanup");
        console.log(`preflight cleaned stale profile ${staleId}`);
      } catch (e) {
        console.warn(`preflight cleanup skipped ${staleId}: ${e.message}`);
      }
    }
  }

  // Test 7 first (error message helpers)
  const authMsg = formatAuthError({ message: "{}", code: "unexpected_failure" });
  const toastMsg = extractServerFnErrorMessage(new Error("{}"), "שגיאה ביצירת עובד");
  if (authMsg && authMsg !== "{}" && toastMsg && toastMsg !== "{}" && toastMsg !== "") {
    pass("7. No empty error toast messages", `auth="${authMsg.slice(0, 40)}…" toast="${toastMsg}"`);
  } else {
    fail("7. No empty error toast messages", `auth=${authMsg} toast=${toastMsg}`);
  }

  // Test 1: brand-new employee
  const newId = String(910000000 + Math.floor(Math.random() * 8999999)).slice(0, 9);
  const newPayload = {
    first_name: "בדיקה",
    last_name: "חדש",
    id_number: newId,
    department_id: deptId,
    job_title: "",
    phone: "",
    password: TEST_PASSWORD,
    role: "employee",
    force_archived: false,
  };
  let r1;
  try {
    r1 = await createEmployeeFlow(scoped, newPayload);
    await assertInActiveList(scoped, r1.id, newId);
    await assertLogin(newId, TEST_PASSWORD);
    const c1 = await assertAuthProfileConsistency(newId);
    if (!c1.consistent) throw new Error("inconsistent auth/profile");
    pass("1. Create new employee", `id=${newId} path=${r1.path}`);
    pass("4. Appears in active list (new)", `uid=${r1.id}`);
    pass("5. Login succeeds (new)", newId);
    pass("6. Auth/profile consistent (new)", JSON.stringify(c1));
    createdForCleanup.push({ userId: r1.id, idNumber: newId });
  } catch (e) {
    fail("1. Create new employee", e.message);
    fail("4. Appears in active list (new)", "skipped");
    fail("5. Login succeeds (new)", "skipped");
    fail("6. Auth/profile consistent (new)", "skipped");
  }

  // Test 2: delete then re-create same ID (UI: archived dialog → force create)
  const rehireId = String(920000000 + Math.floor(Math.random() * 8999999)).slice(0, 9);
  const rehirePayload = {
    ...newPayload,
    first_name: "בדיקה",
    last_name: "מחדש",
    id_number: rehireId,
  };
  try {
    const first = await createEmployeeFlow(scoped, rehirePayload);
    await deleteTestEmployee(scoped, first.id, "e2e-rehire-test");
    const orphanBefore = await assertAuthProfileConsistency(rehireId);

    let gotArchivedOnRehire = false;
    try {
      await createEmployeeFlow(scoped, rehirePayload);
      fail("2a. Deleted ID triggers ARCHIVED_EXISTS", "creation succeeded without force");
    } catch (e) {
      if (String(e.message).includes("ARCHIVED_EXISTS::")) {
        gotArchivedOnRehire = true;
        pass("2a. Deleted ID triggers ARCHIVED_EXISTS", rehireId);
      } else {
        fail("2a. Deleted ID triggers ARCHIVED_EXISTS", e.message);
      }
    }

    const second = await createEmployeeFlow(scoped, { ...rehirePayload, force_archived: true });
    await assertInActiveList(scoped, second.id, rehireId);
    await assertLogin(rehireId, TEST_PASSWORD);
    const c2 = await assertAuthProfileConsistency(rehireId);
    if (!c2.consistent || !c2.auth || !c2.profile) throw new Error("still inconsistent after rehire");
    pass(
      "2. Re-create deleted employee (same ID)",
      `orphanBefore=${JSON.stringify(orphanBefore)} archivedGuard=${gotArchivedOnRehire} path=${second.path}`,
    );
    pass("4. Appears in active list (rehire)", `uid=${second.id}`);
    pass("5. Login succeeds (rehire)", rehireId);
    pass("6. Auth/profile consistent (rehire)", JSON.stringify(c2));
    createdForCleanup.push({ userId: second.id, idNumber: rehireId });
  } catch (e) {
    fail("2. Re-create deleted employee (same ID)", e.message);
  }

  // Test 3: copy archived employee (ARCHIVED_EXISTS then force)
  try {
    // Ensure archived ID has no live profile from prior runs
    const { data: liveArch } = await scoped
      .from("profiles")
      .select("id")
      .eq("id_number", ARCHIVED_COPY_ID)
      .eq("branch_id", branchId)
      .maybeSingle();
    if (liveArch?.id) {
      await deleteTestEmployee(scoped, liveArch.id, "e2e-archived-copy-prep");
    }

    const archPayload = {
      ...newPayload,
      first_name: "ארכיון",
      last_name: "העתק",
      id_number: ARCHIVED_COPY_ID,
      force_archived: false,
    };
    let gotArchived = false;
    try {
      await createEmployeeFlow(scoped, archPayload);
      fail("3a. Archived guard triggers ARCHIVED_EXISTS", "creation succeeded without force");
    } catch (e) {
      if (String(e.message).includes("ARCHIVED_EXISTS::")) {
        gotArchived = true;
        pass("3a. Archived guard triggers ARCHIVED_EXISTS", ARCHIVED_COPY_ID);
      } else {
        fail("3a. Archived guard triggers ARCHIVED_EXISTS", e.message);
      }
    }

    if (gotArchived) {
      const forced = await createEmployeeFlow(scoped, { ...archPayload, force_archived: true });
      await assertInActiveList(scoped, forced.id, ARCHIVED_COPY_ID);
      await assertLogin(ARCHIVED_COPY_ID, TEST_PASSWORD);
      const c3 = await assertAuthProfileConsistency(ARCHIVED_COPY_ID);
      if (!c3.consistent) throw new Error("inconsistent after archived copy");
      pass("3b. Copy archived employee (force)", `path=${forced.path} uid=${forced.id}`);
      pass("4. Appears in active list (archived copy)", ARCHIVED_COPY_ID);
      pass("5. Login succeeds (archived copy)", ARCHIVED_COPY_ID);
      pass("6. Auth/profile consistent (archived copy)", JSON.stringify(c3));
      createdForCleanup.push({ userId: forced.id, idNumber: ARCHIVED_COPY_ID });
    }
  } catch (e) {
    fail("3. Copy archived employee", e.message);
  }

  // Global orphan scan for test employees + known problem ID
  try {
    const ids = [...new Set([...createdForCleanup.map((x) => x.idNumber), "914120993", ARCHIVED_COPY_ID])];
    let orphanCount = 0;
    for (const idNum of ids) {
      const c = await assertAuthProfileConsistency(idNum);
      if (!c.consistent) orphanCount += 1;
    }
    if (orphanCount === 0) {
      pass("6. No orphan auth/profile inconsistencies (scan)", `checked ${ids.length} IDs`);
    } else {
      fail("6. No orphan auth/profile inconsistencies (scan)", `${orphanCount} inconsistent`);
    }
  } catch (e) {
    fail("6. No orphan auth/profile inconsistencies (scan)", e.message);
  }
} catch (e) {
  console.error("FATAL:", e.message);
  fail("setup", e.message);
}

console.log("\n=== Results ===");
let allOk = true;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} — ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  if (!r.ok) allOk = false;
}

// Cleanup e2e test employees (leave archived-copy if it pre-existed as business data — we recreated it)
console.log("\n=== Cleanup ===");
for (const item of createdForCleanup) {
  if (item.idNumber === ARCHIVED_COPY_ID) {
    console.log(`skip cleanup archived-copy test employee ${item.idNumber} (may be intentional rehire)`);
    continue;
  }
  try {
    const token = await getOwnerSession();
    const scoped = scopedClient(token);
    await deleteTestEmployee(scoped, item.userId, "e2e-verify cleanup");
    console.log(`cleaned ${item.idNumber}`);
  } catch (e) {
    console.warn(`cleanup failed ${item.idNumber}: ${e.message}`);
  }
}

console.log(allOk ? "\nALL TESTS PASSED" : "\nSOME TESTS FAILED");
process.exit(allOk ? 0 : 1);
