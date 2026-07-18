import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";

process.env.NODE_ENV = "test";
process.env.MOXIE_WEB_PASSWORD = "test-moxie-password";
process.env.MOXIE_WEB_COOKIE_SECRET = "moxie-route-test-cookie-secret-32-bytes-minimum";
process.env.MOXIE_GEMINI_API_KEY = "test-only-key";
process.env.MOXIE_PREFIX = "/moxie";
process.env.MOXIE_AUTH_REQUIRED = "true";

const {
  buildLogContext,
  createMoxieRouter,
  extractContactsFromText,
  extractRemindersFromText,
} = await import("../src/routes/moxie.js");

const sampleIntake = [
  "From: Maria Lopez - City Maintenance Supervisor - (901) 555-1234 - maria.lopez@memphistn.gov",
  "Please follow up with Maria tomorrow about the restroom water valve.",
].join("\n");

const parsedContacts = extractContactsFromText(sampleIntake);
assert.equal(parsedContacts.length, 1, "Annie intake should find named contacts with phone/email details");
assert.equal(parsedContacts[0].name, "Maria Lopez");
assert.equal(parsedContacts[0].phone, "(901) 555-1234");
assert.equal(parsedContacts[0].email, "maria.lopez@memphistn.gov");
assert.match(parsedContacts[0].title, /City Maintenance Supervisor/);

const parsedReminders = extractRemindersFromText(sampleIntake);
assert.equal(parsedReminders.length, 1, "Annie intake should find likely follow-up reminders");
assert.match(parsedReminders[0].content, /follow up with Maria/i);
assert.equal(parsedReminders[0].due, "tomorrow");

const queryAwareContext = buildLogContext(
  [{ content: "Maria said the restroom water valve needs a city maintenance update.", created_at: "2026-07-18T00:00:00.000Z" }],
  [{ content: "Follow up with Maria about the restroom water valve.", due: "tomorrow", done: false }],
  [{ name: "Maria Lopez", phone: "(901) 555-1234", email: "maria.lopez@memphistn.gov", notes: "City Maintenance Supervisor" }],
  "What do we know about Maria and the water valve?",
);
assert.match(queryAwareContext, /Query-matched private memory/);
assert.match(queryAwareContext, /Maria Lopez/);
assert.match(queryAwareContext, /restroom water valve/);

function makeSupabaseStub() {
  const state = { id: "default", history: [], saved_chats: [], revision: 1, updated_at: "2026-07-16T00:00:00.000Z" };
  const tables = {
    annie_log_notes: [],
    annie_log_reminders: [],
    annie_log_suggested_reminders: [],
    annie_contacts: [],
    annie_suggested_contacts: [],
    moxie_auth_credentials: [],
  };
  const seededTime = "2026-07-18T12:00:00.000Z";

  function rowsFor(table) {
    if (table === "annie_chat_state") return [state];
    if (!tables[table]) tables[table] = [];
    return tables[table];
  }

  return {
    from(table) {
      assert.ok(String(table).startsWith("annie_") || table === "moxie_auth_credentials", `unexpected Moxie table: ${table}`);
      const filters = [];
      let orderSpec = null;
      let pending = null;

      function currentRows() {
        let rows = rowsFor(table).filter((row) => filters.every(([field, value]) => row[field] === value));
        if (orderSpec) {
          rows = rows.slice().sort((a, b) => {
            const av = a[orderSpec.field] || "";
            const bv = b[orderSpec.field] || "";
            if (av === bv) return 0;
            const result = av > bv ? 1 : -1;
            return orderSpec.ascending ? result : -result;
          });
        } else {
          rows = rows.slice();
        }
        return rows;
      }

      async function executePending() {
        if (!pending) return { data: currentRows(), error: null };
        const targetRows = currentRows();
        if (pending.type === "update") {
          for (const row of targetRows) Object.assign(row, pending.payload, { updated_at: pending.payload.updated_at || row.updated_at || seededTime });
        }
        if (pending.type === "delete") {
          const doomed = new Set(targetRows);
          tables[table] = rowsFor(table).filter((row) => !doomed.has(row));
        }
        return { data: targetRows, error: null };
      }

      const query = {
        select() { return query; },
        eq(field, value) {
          filters.push([field, value]);
          return pending ? executePending() : query;
        },
        order(field, options = {}) {
          orderSpec = { field, ascending: options.ascending !== false };
          return query;
        },
        limit(limitCount) {
          return Promise.resolve({ data: currentRows().slice(0, limitCount), error: null });
        },
        single() {
          const row = currentRows()[0];
          if (row) return Promise.resolve({ data: row, error: null });
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "not found" } });
        },
        maybeSingle() {
          return Promise.resolve({ data: currentRows()[0] || null, error: null });
        },
        upsert(payload) {
          if (table === "annie_chat_state") {
            Object.assign(state, payload);
            return Promise.resolve({ data: state, error: null });
          }
          const rows = rowsFor(table);
          const existing = rows.find((row) => row.id && payload.id && row.id === payload.id);
          if (existing) Object.assign(existing, payload, { updated_at: seededTime });
          else rows.push({ ...payload, created_at: payload.created_at || seededTime, updated_at: payload.updated_at || seededTime });
          return Promise.resolve({ data: payload, error: null });
        },
        insert(payload) {
          const rows = rowsFor(table);
          const inserted = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
            created_at: seededTime,
            updated_at: seededTime,
            ...row,
          }));
          rows.push(...inserted);
          return Promise.resolve({ data: inserted, error: null });
        },
        update(payload) {
          pending = { type: "update", payload };
          return query;
        },
        delete() {
          pending = { type: "delete" };
          return query;
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "rotate_moxie_auth_credential", `unexpected Moxie RPC: ${name}`);
      const rows = tables.moxie_auth_credentials;
      const existing = rows.find((row) => row.credential_key === args.p_credential_key);
      const expectedVersion = Number(args.p_expected_version);
      if ((expectedVersion === 0 && existing) || (expectedVersion > 0 && Number(existing?.password_version) !== expectedVersion)) {
        return { data: null, error: { code: "40001", message: "Moxie credential changed concurrently" } };
      }
      const passwordVersion = expectedVersion + 1;
      const updatedAt = "2026-07-18T12:01:00.000Z";
      const payload = {
        credential_key: args.p_credential_key,
        password_salt: args.p_password_salt,
        password_hash: args.p_password_hash,
        password_version: passwordVersion,
        updated_by: args.p_updated_by,
        updated_at: updatedAt,
      };
      if (existing) Object.assign(existing, payload);
      else rows.push({ created_at: updatedAt, ...payload });
      return { data: [{ password_version: passwordVersion, updated_at: updatedAt }], error: null };
    },
    __tables: tables,
  };
}

const app = express();
app.use(express.json());
const staticDir = fileURLToPath(new URL("../public/moxie-assets/", import.meta.url));
assert.equal(existsSync(staticDir), true, "Moxie asset directory must exist");
const supabaseStub = makeSupabaseStub();
app.use("/moxie", createMoxieRouter({ supabase: supabaseStub, staticDir }));

const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});

try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  let response = await fetch(`${base}/moxie`, { redirect: "manual" });
  assert.equal(response.status, 302, "Moxie must fail closed before login");
  assert.equal(response.headers.get("location"), "/moxie/login");

  response = await fetch(`${base}/moxie/`, { redirect: "manual" });
  assert.equal(response.status, 302, "Moxie trailing-slash path must fail closed before login");
  assert.equal(response.headers.get("location"), "/moxie/login");
  assert.match(String(response.headers.get("cache-control") || ""), /no-store/);

  response = await fetch(`${base}/moxie/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.area, "moxie");
  assert.equal(health.configured, true);
  assert.equal(health.auth_required, true);

  response = await fetch(`${base}/moxie/login`, { redirect: "manual" });
  assert.equal(response.status, 200);
  const loginHtml = await response.text();
  assert.match(loginHtml, /class="ops-hub-link"[^>]*>Back to Ops Hub</);
  assert.match(loginHtml, /type="password"/);
  assert.match(loginHtml, /autocomplete="new-password"/);
  assert.match(loginHtml, /id="moxie-secret-entry"[\s\S]*value=""/);
  assert.match(loginHtml, /readonly/);
  assert.match(loginHtml, /data-lpignore="true"/);
  assert.match(loginHtml, /data-1p-ignore="true"/);
  assert.doesNotMatch(loginHtml, /value="test-moxie-password"/);
  assert.doesNotMatch(loginHtml, />test-moxie-password</);

  response = await fetch(`${base}/moxie/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "wrong-password" }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(await response.text(), /Wrong password/i);

  response = await fetch(`${base}/moxie/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "test-moxie-password" }),
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/moxie/");
  const setCookie = String(response.headers.get("set-cookie") || "");
  assert.match(setCookie, /^moxie_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/moxie/i);
  let cookie = setCookie.split(";")[0];

  response = await fetch(`${base}/moxie/`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Moxie/);
  assert.match(page, /private work assistant/i);
  assert.match(page, /Back to Ops Hub/);
  assert.match(page, /aria-label="Annie workspace tools"/);
  assert.match(page, /\/moxie\/assets\/frog-on-log-writing-pad\.png/);
  assert.match(page, /\/moxie\/assets\/reminders-woodland-animal\.png/);
  assert.match(page, /\/moxie\/assets\/contacts-creekside-animal\.png/);
  assert.match(page, /\/moxie\/assets\/settings-woodland-cog\.png/);
  assert.match(page, /href="\/moxie\/log"/);
  assert.match(page, /href="\/moxie\/reminders"/);
  assert.match(page, /href="\/moxie\/contacts"/);
  assert.match(page, /href="\/moxie\/settings"/);
  assert.match(page, /chat-tools|quick-actions-cluster|shortcut-tile|image-action-button/);
  assert.doesNotMatch(page, /Ops Hub shortcuts/);
  assert.doesNotMatch(page, /ops-hub-grid/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-dashboard\.png/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-schedule\.png/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-events\.png/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-messaging\.png/);
  assert.match(page, /clearChatButton\.addEventListener\("click",showModal\)/);
  assert.match(page, /saveClearChat\.addEventListener\("click",saveChat\)/);
  assert.match(page, /deleteClearChat\.addEventListener\("click",deleteChat\)/);
  assert.match(page, /cancelClearChat\.addEventListener\("click",hideModal\)/);
  assert.doesNotMatch(page, /Main Dashboard|Custodial Scheduler|Events Input Console|Memphis Messenger/);
  assert.match(String(response.headers.get("cache-control") || ""), /no-store/);

  response = await fetch(`${base}/moxie`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(response.status, 200, "authenticated trailing-slash-free path must render Moxie");

  for (const asset of [
    "moxie-avatar.jpg",
    "frog-on-log-writing-pad.png",
    "reminders-woodland-animal.png",
    "contacts-creekside-animal.png",
    "settings-woodland-cog.png",
  ]) {
    response = await fetch(`${base}/moxie/assets/${asset}`);
    assert.equal(response.status, 200, `${asset} must be served from the static Moxie asset path`);
    assert.match(String(response.headers.get("content-type") || ""), /^image\//);
  }

  response = await fetch(`${base}/moxie/log`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const logHtml = await response.text();
  assert.match(logHtml, /class="ops-hub-link"[^>]*>Back to Ops Hub</);
  assert.match(logHtml, /Paste or import communication/);
  assert.match(logHtml, /id="intake-form"/);
  assert.match(logHtml, /id="intake-file" type="file"/);
  assert.match(logHtml, /Process into Annie's Log/);
  assert.match(logHtml, /Auto-add detected contacts/);
  assert.match(logHtml, /Create likely follow-up reminders/);
  assert.doesNotMatch(logHtml, /onclick=/);
  assert.doesNotMatch(logHtml, /r\.json\(\)\)\.then/);

  response = await fetch(`${base}/moxie/log/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      source_type: "maintenance",
      source_label: "City Maintenance",
      subject: "Water valve",
      content: sampleIntake,
    }),
  });
  assert.equal(response.status, 200);
  const intakeResult = await response.json();
  assert.equal(intakeResult.ok, true);
  assert.ok(intakeResult.noteId);
  assert.equal(intakeResult.contactsDetected.length, 1);
  assert.equal(intakeResult.contactsAdded.length, 1);
  assert.equal(intakeResult.contactsAdded[0].name, "Maria Lopez");
  assert.equal(intakeResult.remindersDetected.length, 1);
  assert.equal(intakeResult.remindersAdded.length, 1);
  assert.match(intakeResult.remindersAdded[0].content, /follow up with Maria/i);
  assert.equal(supabaseStub.__tables.annie_contacts.length, 1);
  assert.equal(supabaseStub.__tables.annie_log_reminders.length, 1);
  assert.equal(supabaseStub.__tables.annie_log_notes.length, 1);

  response = await fetch(`${base}/moxie/log/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      source_type: "maintenance",
      source_label: "City Maintenance",
      subject: "Water valve",
      content: sampleIntake,
    }),
  });
  assert.equal(response.status, 200);
  const duplicateIntake = await response.json();
  assert.equal(duplicateIntake.contactsAdded.length, 0, "duplicate contact must not be inserted");
  assert.equal(duplicateIntake.contactsSkipped.length, 1);
  assert.equal(duplicateIntake.remindersAdded.length, 0, "duplicate reminder must not be inserted");
  assert.equal(duplicateIntake.remindersSkipped.length, 1);

  response = await fetch(`${base}/moxie/contacts`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const contactsHtml = await response.text();
  assert.match(contactsHtml, /class="ops-hub-link"[^>]*>Back to Ops Hub</);
  assert.match(contactsHtml, /Maria Lopez/);
  assert.match(contactsHtml, /City Maintenance Supervisor/);
  assert.match(contactsHtml, /id="contacts-page-form"/);
  assert.doesNotMatch(contactsHtml, /onclick=/);

  response = await fetch(`${base}/moxie/reminders`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const remindersHtml = await response.text();
  assert.match(remindersHtml, /class="ops-hub-link"[^>]*>Back to Ops Hub</);
  assert.match(remindersHtml, /Follow up with Maria/i);
  assert.match(remindersHtml, /id="reminders-page-form"/);
  assert.doesNotMatch(remindersHtml, /onclick=/);

  response = await fetch(`${base}/moxie/settings`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const settingsHtml = await response.text();
  assert.match(settingsHtml, /class="ops-hub-link"[^>]*>Back to Ops Hub</);
  assert.match(settingsHtml, /Moxie Settings/);
  assert.match(settingsHtml, /id="moxie-password-form"/);
  assert.match(settingsHtml, /id="moxie-current-password"/);
  assert.match(settingsHtml, /id="moxie-new-password"/);
  assert.match(settingsHtml, /id="moxie-confirm-password"/);
  assert.match(settingsHtml, /Change password/);
  assert.match(settingsHtml, /Private workspace/);
  assert.match(settingsHtml, /Sign out of Moxie/);
  assert.doesNotMatch(settingsHtml, /test-moxie-password/);
  assert.doesNotMatch(settingsHtml, /localStorage|sessionStorage/);
  const csrfMatch = settingsHtml.match(/const csrf=("[^"]+");/);
  assert.ok(csrfMatch, "Settings must bind a session-specific CSRF token");
  const csrf = JSON.parse(csrfMatch[1]);

  response = await fetch(`${base}/moxie/settings/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      current_password: "test-moxie-password",
      new_password: "new-test-moxie-passphrase-2026",
      confirm_password: "new-test-moxie-passphrase-2026",
    }),
  });
  assert.equal(response.status, 403, "password change must require session-bound CSRF");

  response = await fetch(`${base}/moxie/settings/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-Moxie-CSRF": csrf },
    body: JSON.stringify({
      current_password: "wrong-current-password",
      new_password: "new-test-moxie-passphrase-2026",
      confirm_password: "new-test-moxie-passphrase-2026",
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /current password is incorrect/i);

  response = await fetch(`${base}/moxie/settings/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-Moxie-CSRF": csrf },
    body: JSON.stringify({
      current_password: "test-moxie-password",
      new_password: "too-short",
      confirm_password: "too-short",
    }),
  });
  assert.equal(response.status, 422);

  response = await fetch(`${base}/moxie/settings/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-Moxie-CSRF": csrf },
    body: JSON.stringify({
      current_password: "test-moxie-password",
      new_password: "new-test-moxie-passphrase-2026",
      confirm_password: "new-test-moxie-passphrase-2026",
    }),
  });
  assert.equal(response.status, 200);
  const changed = await response.json();
  assert.equal(changed.ok, true);
  assert.equal(changed.password_version, 1);
  const rotatedSetCookie = String(response.headers.get("set-cookie") || "");
  assert.match(rotatedSetCookie, /^moxie_session=/);
  assert.match(rotatedSetCookie, /HttpOnly/i);
  assert.match(rotatedSetCookie, /SameSite=Lax/i);
  assert.match(rotatedSetCookie, /Path=\/moxie/i);
  const rotatedCookie = rotatedSetCookie.split(";")[0];
  const credential = supabaseStub.__tables.moxie_auth_credentials[0];
  assert.equal(credential.credential_key, "moxie_web");
  assert.equal(credential.password_version, 1);
  assert.match(credential.password_salt, /^[0-9a-f]{64}$/);
  assert.match(credential.password_hash, /^[0-9a-f]{128}$/);
  assert.doesNotMatch(JSON.stringify(credential), /test-moxie-password|new-test-moxie-passphrase-2026/);

  response = await fetch(`${base}/moxie/`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(response.status, 302, "password rotation must revoke the previous Moxie session");
  assert.equal(response.headers.get("location"), "/moxie/login");
  response = await fetch(`${base}/moxie/`, { headers: { Cookie: rotatedCookie } });
  assert.equal(response.status, 200, "the changing browser must remain signed in with its rotated session");

  response = await fetch(`${base}/moxie/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "test-moxie-password" }),
  });
  assert.equal(response.status, 401, "the bootstrap password must stop working after the first rotation");

  response = await fetch(`${base}/moxie/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "new-test-moxie-passphrase-2026" }),
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/moxie/");
  assert.match(String(response.headers.get("set-cookie") || ""), /^moxie_session=/);
  cookie = rotatedCookie;

  response = await fetch(`${base}/moxie/password`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/moxie/settings");

  response = await fetch(`${base}/moxie/logout`, {
    redirect: "manual",
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/moxie/login?logged_out=1");
  const clearCookie = String(response.headers.get("set-cookie") || "");
  assert.match(clearCookie, /^moxie_session=/);
  assert.match(clearCookie, /Path=\/moxie/i);
  assert.match(clearCookie, /Expires=Thu, 01 Jan 1970|Max-Age=0/i);

  response = await fetch(`${base}/moxie/`, { redirect: "manual" });
  assert.equal(response.status, 302, "protected Moxie must remain inaccessible after logout");
  assert.equal(response.headers.get("location"), "/moxie/login");

  response = await fetch(`${base}/moxie/login?logged_out=1`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Signed out\. Enter the password to open Moxie again\./);

  const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../src/routes/moxie.js", import.meta.url), "utf8");
  const templateSource = readFileSync(new URL("../src/routes/moxie-templates.js", import.meta.url), "utf8");
  assert.match(indexSource, /createMoxieRouter/);
  assert.match(indexSource, /app\.use\(MOXIE_MOUNT_PATH,\s*createMoxieRouter/);
  assert.match(indexSource, /public\/moxie-assets/);
  assert.match(routeSource, /isProductionLike\(\)[\s\S]*MOXIE_AUTH_REQUIRED/);
  assert.match(routeSource, /crypto\.scrypt/);
  assert.match(routeSource, /rotate_moxie_auth_credential/);
  assert.match(routeSource, /router\.post\("\/settings\/password"/);
  assert.match(routeSource, /clearSessionCookie\(res, req\)/);
  assert.match(routeSource, /Cache-Control", "no-store/);
  const shortcutSource = templateSource.match(/function shortcutTile[\s\S]*?\n}/)?.[0] || "";
  assert.match(shortcutSource, /assetUrl\(iconFile\)/);
  assert.doesNotMatch(shortcutSource, /_iconDataUris/);
  assert.doesNotMatch(templateSource, /function opsHubButtons/);
  assert.match(templateSource, /\.ops-hub-link\{/);
  assert.match(templateSource, /prefers-reduced-motion/);

  console.log("MOXIE_AUTH_LOGOUT_UI_CONTRACT_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
