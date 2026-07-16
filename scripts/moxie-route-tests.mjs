import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";

process.env.MOXIE_WEB_PASSWORD = "memzoo";
process.env.MOXIE_WEB_COOKIE_SECRET = "moxie-route-test-cookie-secret-32-bytes-minimum";
process.env.MOXIE_GEMINI_API_KEY = "test-only-key";
process.env.MOXIE_PREFIX = "/moxie";
process.env.MOXIE_AUTH_REQUIRED = "false";

const { createMoxieRouter } = await import("../src/routes/moxie.js");

function makeSupabaseStub() {
  const state = { id: "default", history: [], saved_chats: [], updated_at: "2026-07-15T00:00:00.000Z" };
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
  assert.equal(response.status, 200, "GET /moxie must render directly in operations-first mode");

  response = await fetch(`${base}/moxie/`, { redirect: "manual" });
  assert.equal(response.status, 200, "GET /moxie/ must render directly in operations-first mode");

  response = await fetch(`${base}/moxie/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.area, "moxie");
  assert.equal(health.configured, true);
  assert.equal(health.auth_required, false);

  response = await fetch(`${base}/moxie/login`, { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/moxie/");

  response = await fetch(`${base}/moxie/assets/moxie-avatar.jpg`);
  assert.equal(response.status, 200, "Moxie static assets must be served below the route prefix");
  assert.match(String(response.headers.get("content-type") || ""), /^image\//);

  response = await fetch(`${base}/moxie/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "anything" }),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/moxie/");
  assert.equal(response.headers.get("set-cookie"), null);

  response = await fetch(`${base}/moxie/`);
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Moxie/);
  assert.match(page, /private work assistant/i);

  response = await fetch(`${base}/moxie`);
  assert.equal(response.status, 200, "trailing-slash-free path must render Moxie");

  const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(indexSource, /createMoxieRouter/);
  assert.match(indexSource, /app\.use\(MOXIE_MOUNT_PATH,\s*createMoxieRouter/);
  assert.match(indexSource, /public\/moxie-assets/);

  console.log("MOXIE_ROUTE_TESTS_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
