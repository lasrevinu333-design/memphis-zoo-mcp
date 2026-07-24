import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import { installManagerNotificationRoutes } from "../src/manager-notifications.js";

const root = new URL("../", import.meta.url);
const [moduleSource, migration, bootstrap] = await Promise.all([
  readFile(new URL("src/manager-notifications.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260721203000_manager_mobile_notifications.sql", root), "utf8"),
  readFile(new URL("src/mcp-schema-bootstrap.js", root), "utf8"),
]);

for (const route of [
  "/manager-notifications-api/preferences",
  "/manager-notifications-api/register",
  "/manager-notifications-api/test",
  "/manager-notifications-api/client-config/:platform",
]) assert.ok(moduleSource.includes(route), `missing manager notification route ${route}`);

assert.match(moduleSource, /FIREBASE_SERVICE_ACCOUNT_JSON/);
assert.match(moduleSource, /fcm\.googleapis\.com\/v1\/projects/);
assert.match(moduleSource, /firebase\.googleapis\.com\/v1beta1/);
assert.match(moduleSource, /firebase\.readonly/);
assert.match(moduleSource, /cloud-platform/);
assert.match(moduleSource, /method: "POST"/);
assert.match(moduleSource, /configFileContents/);
assert.match(moduleSource, /google-services\.json/);
assert.match(moduleSource, /GoogleService-Info\.plist/);
assert.match(moduleSource, /notificationActionPerformed|data_json/);
assert.match(moduleSource, /makeOpsAccessMiddleware/);
assert.doesNotMatch(moduleSource, /employee-hub|KIOSK_\d|device credential/i, "manager notification runtime must not target employee kiosk devices");
assert.match(bootstrap, /installManagerNotificationRoutes/);

assert.match(migration, /messages_enabled boolean not null default true/);
assert.match(migration, /event_reminders_enabled boolean not null default false/);
assert.match(migration, /due_soon_enabled boolean not null default false/);
assert.match(migration, /overdue_enabled boolean not null default false/);
assert.match(migration, /event_reminder_weekdays smallint\[\]/);
assert.match(migration, /event_reminder_time time without time zone/);
assert.match(migration, /ops_manager_enqueue_message_push/);
assert.match(migration, /ops_manager_enqueue_scheduled_notifications/);
assert.match(migration, /ops_manager_claim_notification_jobs/);
assert.match(migration, /employee kiosk devices are not eligible/);

const app = express();
installManagerNotificationRoutes(app, { env: {} });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/manager-notifications-api/health`);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.manager_only, true);
  assert.equal(payload.employee_kiosk_notifications, false);
  assert.equal(payload.defaults.messages_enabled, true);
  assert.equal(payload.defaults.event_reminders_enabled, false);
  assert.equal(payload.defaults.due_soon_enabled, false);
  assert.equal(payload.defaults.overdue_enabled, false);
  assert.equal(payload.client_config_artifacts, null);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const androidConfig = {
  project_info: { project_number: "123456789", project_id: "memphis-zoo-custodial-program" },
  client: [{ client_info: { mobilesdk_app_id: "1:123456789:android:test", android_client_info: { package_name: "org.memphiszoo.ops" } }, api_key: [{ current_key: "test-firebase-client-key" }] }],
  configuration_version: "1",
};
const custodialAndroidConfig = {
  project_info: { project_number: "123456789", project_id: "memphis-zoo-custodial-program" },
  client: [{ client_info: { mobilesdk_app_id: "1:123456789:android:custodial", android_client_info: { package_name: "org.memphiszoo.custodial" } }, api_key: [{ current_key: "test-firebase-client-key" }] }],
  configuration_version: "1",
};
const iosConfig = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>GOOGLE_APP_ID</key><string>1:123456789:ios:test</string><key>BUNDLE_ID</key><string>org.memphiszoo.ops</string><key>PROJECT_ID</key><string>memphis-zoo-custodial-program</string></dict></plist>`;
const originalFetch = globalThis.fetch;
const calls = [];
let custodialProvisioned = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (/^https?:\/\/127\.0\.0\.1/.test(url)) return originalFetch(input, init);
  calls.push({ url, method: String(init.method || "GET"), authorization: String(init.headers?.Authorization || init.headers?.authorization || "") });
  if (url === "https://oauth2.googleapis.com/token") {
    return new Response(JSON.stringify({ access_token: "test-firebase-oauth-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/projects/memphis-zoo-custodial-program/androidApps?pageSize=100")) {
    return new Response(JSON.stringify({ apps: [
      { name: "projects/memphis-zoo-custodial-program/androidApps/1:123456789:android:test", appId: "1:123456789:android:test", packageName: "org.memphiszoo.ops", state: "ACTIVE" },
      { name: "projects/memphis-zoo-custodial-program/androidApps/1:123456789:android:custodial", appId: "1:123456789:android:custodial", packageName: "org.memphiszoo.custodial", state: "ACTIVE" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/projects/memphis-zoo-custodial-program/androidApps/1:123456789:android:test/config")) {
    return new Response(JSON.stringify({ configFilename: "google-services.json", configFileContents: Buffer.from(JSON.stringify(androidConfig)).toString("base64") }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/projects/memphis-zoo-custodial-program/androidApps/1:123456789:android:custodial/config")) {
    return new Response(JSON.stringify({ configFilename: "google-services.json", configFileContents: Buffer.from(JSON.stringify(custodialAndroidConfig)).toString("base64") }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/projects/memphis-zoo-custodial-program/iosApps?pageSize=100")) {
    return new Response(JSON.stringify({ apps: [{ name: "projects/memphis-zoo-custodial-program/iosApps/1:123456789:ios:test", appId: "1:123456789:ios:test", bundleId: "org.memphiszoo.ops", state: "ACTIVE" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/projects/memphis-zoo-custodial-program/iosApps/1:123456789:ios:test/config")) {
    return new Response(JSON.stringify({ configFilename: "GoogleService-Info.plist", configFileContents: Buffer.from(iosConfig).toString("base64") }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: { message: `Unexpected test URL: ${url}` } }), { status: 500, headers: { "Content-Type": "application/json" } });
};

const configuredApp = express();
installManagerNotificationRoutes(configuredApp, {
  env: {
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account",
      project_id: "memphis-zoo-custodial-program",
      client_email: "firebase-adminsdk-test@memphis-zoo-custodial-program.iam.gserviceaccount.com",
      private_key: privateKey,
    }),
  },
});
const configuredServer = configuredApp.listen(0, "127.0.0.1");
await new Promise((resolve) => configuredServer.once("listening", resolve));
try {
  const base = `http://127.0.0.1:${configuredServer.address().port}`;
  const healthResponse = await originalFetch(`${base}/manager-notifications-api/health`);
  const health = await healthResponse.json();
  assert.equal(health.provider_configured, true);
  assert.equal(health.project_id, "memphis-zoo-custodial-program");
  assert.equal(health.client_config_artifacts.android, "/manager-notifications-api/client-config/android");
  assert.equal(health.client_config_artifacts.ios, "/manager-notifications-api/client-config/ios");

  const androidResponse = await originalFetch(`${base}/manager-notifications-api/client-config/android`);
  assert.equal(androidResponse.status, 200);
  assert.match(androidResponse.headers.get("content-disposition") || "", /google-services\.json/);
  assert.deepEqual(await androidResponse.json(), androidConfig);

  const custodialAndroidResponse = await originalFetch(`${base}/manager-notifications-api/client-config/android?app_identifier=org.memphiszoo.custodial`);
  assert.equal(custodialAndroidResponse.status, 200);
  assert.deepEqual(await custodialAndroidResponse.json(), custodialAndroidConfig);

  const rejectedAndroidResponse = await originalFetch(`${base}/manager-notifications-api/client-config/android?app_identifier=org.example.unapproved`);
  assert.equal(rejectedAndroidResponse.status, 400);

  const androidMetadataResponse = await originalFetch(`${base}/manager-notifications-api/client-config/android?format=json`);
  const androidMetadata = await androidMetadataResponse.json();
  assert.equal(androidMetadata.ok, true);
  assert.equal(androidMetadata.data.package_or_bundle, "org.memphiszoo.ops");
  assert.equal(androidMetadata.data.app_id, "1:123456789:android:test");
  assert.ok(Buffer.from(androidMetadata.data.contents_base64, "base64").toString("utf8").includes("org.memphiszoo.ops"));
  assert.equal(JSON.stringify(androidMetadata).includes("private_key"), false);
  assert.equal(JSON.stringify(androidMetadata).includes("client_email"), false);

  const iosResponse = await originalFetch(`${base}/manager-notifications-api/client-config/ios`);
  assert.equal(iosResponse.status, 200);
  assert.match(iosResponse.headers.get("content-disposition") || "", /GoogleService-Info\.plist/);
  assert.equal(await iosResponse.text(), iosConfig);
  assert.ok(calls.some((call) => call.url.includes("firebase.googleapis.com/v1beta1/projects/memphis-zoo-custodial-program/androidApps")));
  assert.ok(calls.some((call) => call.authorization === "Bearer test-firebase-oauth-token"));
} finally {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => configuredServer.close((error) => error ? reject(error) : resolve()));
}

console.log("MANAGER_NOTIFICATION_CONTRACT_PASS");
