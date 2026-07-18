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

const { createMoxieRouter } = await import("../src/routes/moxie.js");

function makeSupabaseStub() {
  const state = { id: "default", history: [], saved_chats: [], updated_at: "2026-07-16T00:00:00.000Z" };
  return {
    from(table) {
      assert.ok(String(table).startsWith("annie_"), `unexpected Moxie table: ${table}`);
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        single() { return Promise.resolve({ data: state, error: null }); },
        upsert(payload) { Object.assign(state, payload); return Promise.resolve({ data: state, error: null }); },
        insert() { return Promise.resolve({ data: null, error: null }); },
        update() { return query; },
        delete() { return query; },
      };
      return query;
    },
  };
}

const app = express();
app.use(express.json());
const staticDir = fileURLToPath(new URL("../public/moxie-assets/", import.meta.url));
assert.equal(existsSync(staticDir), true, "Moxie asset directory must exist");
app.use("/moxie", createMoxieRouter({ supabase: makeSupabaseStub(), staticDir }));

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
  const cookie = setCookie.split(";")[0];

  response = await fetch(`${base}/moxie/`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Moxie/);
  assert.match(page, /private work assistant/i);
  assert.match(page, /Back to Ops Hub/);
  assert.match(page, /\/moxie\/assets\/frog-on-log-writing-pad\.png/);
  assert.match(page, /\/moxie\/assets\/reminders-woodland-animal\.png/);
  assert.match(page, /\/moxie\/assets\/contacts-creekside-animal\.png/);
  assert.match(page, /\/moxie\/assets\/settings-woodland-cog\.png/);
  assert.doesNotMatch(page, /Ops Hub shortcuts/);
  assert.doesNotMatch(page, /ops-hub-grid/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-dashboard\.png/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-schedule\.png/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-events\.png/);
  assert.doesNotMatch(page, /\/moxie\/assets\/ops-messaging\.png/);
  assert.match(page, /image-action-button::before/);
  assert.match(page, /content:none!important/);
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
  assert.match(routeSource, /clearSessionCookie\(res, req\)/);
  assert.match(routeSource, /Cache-Control", "no-store/);
  const shortcutSource = templateSource.match(/function shortcutTile[\s\S]*?\n}/)?.[0] || "";
  assert.match(shortcutSource, /assetUrl\(iconFile\)/);
  assert.doesNotMatch(shortcutSource, /_iconDataUris/);

  console.log("MOXIE_AUTH_LOGOUT_UI_CONTRACT_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
