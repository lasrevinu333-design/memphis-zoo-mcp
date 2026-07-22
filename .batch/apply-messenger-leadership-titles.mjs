import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, oldText, newText) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`${path}: expected source block not found`);
  const next = source.replace(oldText, newText);
  if (next === source) throw new Error(`${path}: replacement did not change file`);
  await writeFile(path, next);
}

const messagingPath = 'src/messaging-api.js';
await replaceExact(
  messagingPath,
  `  async function getManagerMessagingIdentity(managerSession = {}) {`,
  `  function messagingRoleTitle(row = {}) {
    const explicit = String(row.role_title || row.job_title || "").trim();
    if (explicit) return explicit;
    const role = String(row.role || "").trim().toLowerCase();
    if (role === "bot") return "Memphis";
    if (["manager", "ops", "ops_manager", "operations_manager", "ops manager", "operations manager"].includes(role)) return "Operations Leadership";
    return "Employee";
  }

  async function getLeadershipProfilesForMessagingUsers(userIds = []) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => String(value || "").trim()).filter(isUuid))];
    if (!ids.length) return new Map();
    const rows = await runReadOnlySql(\`
      select
        u.id as msg_user_id,
        m.manager_id,
        m.display_name as manager_display_name,
        m.job_title,
        m.department_key,
        m.roles as manager_roles
      from public.msg_users u
      join public.ops_manager_managers m on m.manager_id = u.ops_manager_id
      where u.id in (\${ids.map((id) => \`'\${esc(id)}'::uuid\`).join(",")})
        and u.is_active = true
        and m.active = true
        and m.revoked_at is null
        and m.is_system_principal = false
    \`);
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.msg_user_id || "").trim(), row]));
  }

  async function getLeadershipProfileForMessagingUser(userId = "") {
    return (await getLeadershipProfilesForMessagingUsers([userId])).get(String(userId || "").trim()) || null;
  }

  async function enrichMessagingUsers(rows = []) {
    const users = Array.isArray(rows) ? rows : [];
    const profiles = await getLeadershipProfilesForMessagingUsers(users.map((row) => row?.id));
    return users.map((row) => {
      const profile = profiles.get(String(row?.id || "").trim()) || null;
      return {
        ...row,
        role_title: messagingRoleTitle({ ...row, ...(profile || {}) }),
        job_title: String(profile?.job_title || "").trim() || null,
        department_key: String(profile?.department_key || "").trim() || null,
        manager_roles: Array.isArray(profile?.manager_roles) ? profile.manager_roles : null,
      };
    });
  }

  async function getManagerMessagingIdentity(managerSession = {}) {`
);

await replaceExact(
  messagingPath,
  `    if (!isUuid(userId)) throw Object.assign(new Error("Authenticated manager has no server messaging principal."), { status: 403 });
    const sharedThreadData = await runRpc("msg_get_or_create_ops_manager_thread", { p_manager_id: managerId });`,
  `    if (!isUuid(userId)) throw Object.assign(new Error("Authenticated manager has no server messaging principal."), { status: 403 });
    const leadershipProfile = await getLeadershipProfileForMessagingUser(userId);
    const sharedThreadData = await runRpc("msg_get_or_create_ops_manager_thread", { p_manager_id: managerId });`
);

await replaceExact(
  messagingPath,
  `    if (!isUuid(sharedThreadId)) throw Object.assign(new Error("The shared Ops Manager chat is unavailable."), { status: 503 });`,
  `    if (!isUuid(sharedThreadId)) throw Object.assign(new Error("The Operations Leadership chat is unavailable."), { status: 503 });`
);

await replaceExact(
  messagingPath,
  `      display_name: String(row?.display_name || managerSession?.manager_display_name || "Ops Manager"),
      canonical_device_id: String(managerSession?.device_id || managerSession?.credential_id || "manager-session"),`,
  `      display_name: String(leadershipProfile?.manager_display_name || row?.display_name || managerSession?.manager_display_name || "Operations Leadership"),
      role_title: messagingRoleTitle({ ...row, ...(leadershipProfile || {}) }),
      job_title: String(leadershipProfile?.job_title || "").trim() || null,
      department_key: String(leadershipProfile?.department_key || "").trim() || null,
      manager_roles: Array.isArray(leadershipProfile?.manager_roles) ? leadershipProfile.manager_roles : [],
      canonical_device_id: String(managerSession?.device_id || managerSession?.credential_id || "manager-session"),`
);

await replaceExact(
  messagingPath,
  `      const rows = await runReadOnlySql(\`select * from public.msg_list_users('\${esc(viewer.effectiveUserId)}'::uuid)\`);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });`,
  `      const baseRows = await runReadOnlySql(\`select * from public.msg_list_users('\${esc(viewer.effectiveUserId)}'::uuid)\`);
      const rows = await enrichMessagingUsers(baseRows);
      res.status(200).json({ ok: true, data: rows, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });`
);

const testPath = 'scripts/messaging-manager-authority-tests.mjs';
await replaceExact(
  testPath,
  `async function runReadOnlySql(sql) {
  if (/select m\\.id, m\\.thread_id, m\\.sender_user_id, m\\.is_deleted/i.test(sql)) {`,
  `async function runReadOnlySql(sql) {
  if (/from public\\.msg_users u[\\s\\S]*join public\\.ops_manager_managers m/i.test(sql)) {
    return [{
      msg_user_id: MANAGER_USER_ID,
      manager_id: MANAGER_ID,
      manager_display_name: "Authority Test Manager",
      job_title: "Director of Test Operations",
      department_key: "operations",
      manager_roles: ["DIRECTOR"],
    }];
  }
  if (/msg_list_users/i.test(sql)) {
    return [
      { id: MANAGER_USER_ID, display_name: "Authority Test Manager", role: "manager", is_active: true },
      { id: FORGED_EMPLOYEE_ID, display_name: "Authority Test Employee", role: "employee", is_active: true },
    ];
  }
  if (/select m\\.id, m\\.thread_id, m\\.sender_user_id, m\\.is_deleted/i.test(sql)) {`
);

await replaceExact(
  testPath,
  `async function post(path, body) {
  const response = await fetch(\`\${origin}\${path}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {`,
  `async function post(path, body) {
  const response = await fetch(\`\${origin}\${path}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function get(path) {
  const response = await fetch(\`\${origin}\${path}\`);
  return { status: response.status, body: await response.json() };
}

try {
  const identity = await get("/messaging-api/me/by-device");
  assert.equal(identity.status, 200);
  assert.equal(identity.body.data.display_name, "Authority Test Manager");
  assert.equal(identity.body.data.role_title, "Director of Test Operations");
  assert.equal(identity.body.data.department_key, "operations");

  const users = await get("/messaging-api/users");
  assert.equal(users.status, 200);
  const managerContact = users.body.data.find((row) => row.id === MANAGER_USER_ID);
  assert.equal(managerContact.role_title, "Director of Test Operations");
  assert.equal(managerContact.job_title, "Director of Test Operations");
  const employeeContact = users.body.data.find((row) => row.id === FORGED_EMPLOYEE_ID);
  assert.equal(employeeContact.role_title, "Employee");`
);

console.log('Prepared Messenger leadership-title backend changes.');
