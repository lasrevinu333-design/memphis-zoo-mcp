import assert from "node:assert/strict";
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
]) assert.ok(moduleSource.includes(route), `missing manager notification route ${route}`);

assert.match(moduleSource, /FIREBASE_SERVICE_ACCOUNT_JSON/);
assert.match(moduleSource, /fcm\.googleapis\.com\/v1\/projects/);
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
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log("MANAGER_NOTIFICATION_CONTRACT_PASS");
