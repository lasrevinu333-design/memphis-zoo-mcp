import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import { createPushRuntime, installManagerNotificationRoutes } from "../src/manager-notifications.js";

const root = new URL("../", import.meta.url);
const [moduleSource, migration, closureMigration, boundaryMigration, u4Migration, indexSource] = await Promise.all([
  readFile(new URL("src/manager-notifications.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260721203000_manager_mobile_notifications.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260813050000_offline_snapshot_operational_truth_closure.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260813141806_custodial_operational_boundary_closure.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260813210000_custodial_u4_ops_closure.sql", root), "utf8"),
  readFile(new URL("src/index.js", root), "utf8"),
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
assert.match(moduleSource, /configFileContents/);
assert.match(moduleSource, /google-services\.json/);
assert.match(moduleSource, /GoogleService-Info\.plist/);
assert.match(moduleSource, /notificationActionPerformed|data_json/);
assert.match(moduleSource, /makeOpsAccessMiddleware/);
assert.doesNotMatch(moduleSource, /employee-hub|KIOSK_\d|device credential/i, "manager notification runtime must not target employee kiosk devices");
assert.match(indexSource, /installManagerNotificationRoutes\(app/);

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
assert.match(closureMigration, /ops_manager_notification_job_is_current/);
assert.match(closureMigration, /custodial_ops_manager_notification_binding_is_current/);
assert.match(closureMigration, /p_push_device_id uuid,p_credential_id uuid,p_manager_id uuid,p_fcm_token_sha256 text/);
assert.match(closureMigration, /encode\(extensions\.digest\(convert_to\(pd\.fcm_token,'UTF8'\),'sha256'\),'hex'\)=p_fcm_token_sha256/);
assert.match(boundaryMigration, /ops_manager_enqueue_scheduled_notifications\(timestamp with time zone\)/);
assert.match(boundaryMigration, /v_local_date date:=public\.sch_service_date\(p_now\)/);
assert.match(boundaryMigration, /extract\(dow from v_local_date\)/);
assert.match(moduleSource, /beforeSend:\s*async[\s\S]*ops_manager_prepare_notification_dispatch/);
assert.match(u4Migration, /dispatch_lease_token uuid/);
assert.match(u4Migration, /ops_manager_prepare_notification_dispatch/);
assert.match(u4Migration, /provider delivery outcome unknown after manager notification worker interruption/);
assert.match(u4Migration, /q\.dispatch_started_at is null and q\.attempts<q\.max_attempts/);
assert.match(moduleSource, /p_push_device_id:\s*pushDeviceId/);
assert.match(moduleSource, /p_fcm_token_sha256:\s*fcmTokenSha256/);
assert.match(moduleSource, /ops_manager_push_devices"\)\.update\(\{ last_seen_at:[\s\S]*\.eq\("push_device_id", pushDeviceId\)\.eq\("fcm_token", fcmToken\)/);

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
let oauthDelayMs = 0;
let oauthCompleted = false;
let fcmResponseMode = "accepted";
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (/^https?:\/\/127\.0\.0\.1/.test(url)) return originalFetch(input, init);
  calls.push({ url, method: String(init.method || "GET"), authorization: String(init.headers?.Authorization || init.headers?.authorization || ""), body: String(init.body || "") });
  if (url === "https://oauth2.googleapis.com/token") {
    if (oauthDelayMs) await new Promise((resolve) => setTimeout(resolve, oauthDelayMs));
    oauthCompleted = true;
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
  if (url.endsWith("/v1/projects/memphis-zoo-custodial-program/messages:send")) {
    if (fcmResponseMode === "transport-error") {
      throw new Error("Simulated transport loss after dispatch began");
    }
    if (fcmResponseMode === "ambiguous-200") {
      return new Response("{truncated", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (fcmResponseMode === "rejected-400") {
      return new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "Rejected test token" } }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ name: "projects/memphis-zoo-custodial-program/messages/test-provider-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
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

  const pushRuntime = createPushRuntime({
    db: {},
    env: {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: "memphis-zoo-custodial-program",
        client_email: "firebase-adminsdk-test@memphis-zoo-custodial-program.iam.gserviceaccount.com",
        private_key: privateKey,
      }),
    },
  });
  await pushRuntime.send({ title: "Event", body: "Event body", data_json: { notification_type: "event" } }, { fcm_token: "test-fcm-token" }, { channelId: "employee-events" });
  await pushRuntime.send({ title: "Message", body: "Message body", data_json: { notification_type: "message" } }, { fcm_token: "test-fcm-token" }, { channelId: "employee-messages" });
  fcmResponseMode = "ambiguous-200";
  await assert.rejects(
    () => pushRuntime.send({ title: "Ambiguous", body: "Do not retry", data_json: {} }, { fcm_token: "test-fcm-token" }),
    (error) => error?.deliveryNotAccepted === false && error?.permanent !== true,
    "an unreadable HTTP 200 is an ambiguous provider outcome, not a proven rejection",
  );
  fcmResponseMode = "transport-error";
  await assert.rejects(
    () => pushRuntime.send({ title: "Transport loss", body: "Do not retry", data_json: {} }, { fcm_token: "test-fcm-token" }),
    (error) => error?.deliveryNotAccepted === false && error?.permanent !== true,
    "transport loss after dispatch begins is an ambiguous provider outcome, not a proven rejection",
  );
  fcmResponseMode = "rejected-400";
  await assert.rejects(
    () => pushRuntime.send({ title: "Rejected", body: "May retry", data_json: {} }, { fcm_token: "test-fcm-token" }),
    (error) => error?.deliveryNotAccepted === true && error?.permanent === true,
    "an explicit FCM rejection may release the prepared dispatch marker",
  );
  const ambiguousQueue = {
    status: "pending",
    providerCallsBefore: calls.filter((call) => call.url.endsWith("/messages:send")).length,
    prepareArgs: [],
    finishArgs: [],
  };
  const ambiguousJob = {
    queue_id: "00000000-0000-4000-8000-000000000101",
    lease_token: "00000000-0000-4000-8000-000000000102",
    credential_id: "00000000-0000-4000-8000-000000000103",
    manager_id: "00000000-0000-4000-8000-000000000104",
    notification_type: "test",
    title: "Ambiguous manager push",
    body: "Must not be sent twice",
    data_json: {},
  };
  const ambiguousPushDevice = {
    push_device_id: "00000000-0000-4000-8000-000000000105",
    credential_id: ambiguousJob.credential_id,
    manager_id: ambiguousJob.manager_id,
    fcm_token: "ambiguous-manager-fcm-token",
    platform: "android",
    enabled: true,
    revoked_at: null,
  };
  const resolvedQuery = () => {
    const query = {
      eq: () => query,
      is: () => query,
      then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return query;
  };
  const ambiguousDb = {
    async rpc(name, args) {
      if (name === "ops_manager_enqueue_scheduled_notifications") return { data: null, error: null };
      if (name === "ops_manager_claim_notification_jobs") {
        if (ambiguousQueue.status !== "pending") return { data: [], error: null };
        ambiguousQueue.status = "leased";
        return { data: [ambiguousJob], error: null };
      }
      if (name === "ops_manager_prepare_notification_dispatch") {
        ambiguousQueue.prepareArgs.push(args);
        return { data: true, error: null };
      }
      if (name === "ops_manager_finish_notification_job") {
        ambiguousQueue.finishArgs.push(args);
        assert.equal(args.p_delivery_outcome_unknown, true);
        assert.equal(args.p_succeeded, false);
        ambiguousQueue.status = "failed";
        return { data: { status: "failed" }, error: null };
      }
      throw new Error(`Unexpected manager sweep RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, "ops_manager_push_devices");
      return {
        select() {
          const query = {
            eq: () => query,
            is: () => query,
            maybeSingle: async () => ({ data: ambiguousPushDevice, error: null }),
          };
          return query;
        },
        update: resolvedQuery,
      };
    },
  };
  const ambiguousSweepRuntime = createPushRuntime({
    db: ambiguousDb,
    env: {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: "memphis-zoo-custodial-program",
        client_email: "firebase-adminsdk-ambiguous@memphis-zoo-custodial-program.iam.gserviceaccount.com",
        private_key: privateKey,
      }),
    },
  });
  fcmResponseMode = "ambiguous-200";
  const firstAmbiguousSweep = await ambiguousSweepRuntime.sweep();
  const secondAmbiguousSweep = await ambiguousSweepRuntime.sweep();
  assert.equal(firstAmbiguousSweep.claimed, 1);
  assert.equal(firstAmbiguousSweep.results[0].delivery_outcome_unknown, true);
  assert.equal(secondAmbiguousSweep.claimed, 0);
  assert.equal(ambiguousQueue.status, "failed");
  assert.equal(ambiguousQueue.prepareArgs.length, 1);
  assert.equal(ambiguousQueue.finishArgs.length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/messages:send")).length, ambiguousQueue.providerCallsBefore + 1,
    "an ambiguous manager provider outcome must produce one provider call across repeated sweeps");
  fcmResponseMode = "accepted";
  await assert.rejects(() => pushRuntime.send({
    notification_type: "event_digest", title: "Expired event", body: "Must not send",
    data_json: { next_event_starts_at: new Date(Date.now() - 1000).toISOString() },
  }, { fcm_token: "test-fcm-token" }), /no longer upcoming/i);
  const beforeCrossingSend = calls.filter((call) => call.url.endsWith("/messages:send")).length;
  oauthDelayMs = 80;
  const crossingRuntime = createPushRuntime({
    db: {},
    env: {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: "memphis-zoo-custodial-program",
        client_email: "firebase-adminsdk-crossing@memphis-zoo-custodial-program.iam.gserviceaccount.com",
        private_key: privateKey,
      }),
    },
  });
  await assert.rejects(() => crossingRuntime.send({
    notification_type: "event_digest", title: "Crossing event", body: "Must not send",
    data_json: { next_event_starts_at: new Date(Date.now() + 30).toISOString() },
  }, { fcm_token: "test-fcm-token" }), /no longer upcoming/i);
  oauthDelayMs = 0;
  assert.equal(calls.filter((call) => call.url.endsWith("/messages:send")).length, beforeCrossingSend);
  oauthDelayMs = 40;
  oauthCompleted = false;
  let canonicalChecks = 0;
  const canonicalRuntime = createPushRuntime({
    db: {},
    env: {
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: "memphis-zoo-custodial-program",
        client_email: "firebase-adminsdk-canonical@memphis-zoo-custodial-program.iam.gserviceaccount.com",
        private_key: privateKey,
      }),
    },
  });
  await assert.rejects(() => canonicalRuntime.send({
    notification_type: "event_digest", title: "Cancelled event", body: "Must not send",
    data_json: { next_event_starts_at: new Date(Date.now() + 60_000).toISOString() },
  }, { fcm_token: "test-fcm-token" }, {
    beforeSend: async () => {
      canonicalChecks += 1;
      assert.equal(oauthCompleted, true, "canonical validation must run after provider authentication");
      return false;
    },
  }), /no longer current/i);
  oauthDelayMs = 0;
  assert.equal(canonicalChecks, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/messages:send")).length, beforeCrossingSend);
  const sentPushes = calls.filter((call) => call.url.endsWith("/messages:send")).map((call) => JSON.parse(call.body));
  const collapseKeys = new Set(sentPushes.map((push) => push.message.android.collapse_key));
  assert.equal(collapseKeys.has("memphis-employee-events"), true);
  assert.equal(collapseKeys.has("memphis-employee-messages"), true);
} finally {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => configuredServer.close((error) => error ? reject(error) : resolve()));
}

console.log("MANAGER_NOTIFICATION_CONTRACT_PASS");
