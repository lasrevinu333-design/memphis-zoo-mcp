import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import {
  employeeNotificationInternals,
  installEmployeeNotificationRoutes,
} from '../src/employee-notifications.js';

const root = new URL('../', import.meta.url);
const [source, manager, indexSource, migration, nativeKindsMigration, boundaryMigration, closureMigration] = await Promise.all([
  readFile(new URL('src/employee-notifications.js', root), 'utf8'),
  readFile(new URL('src/manager-notifications.js', root), 'utf8'),
  readFile(new URL('src/index.js', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260724010000_native_employee_event_delivery.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260731211500_native_employee_message_location_push.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260813141806_custodial_operational_boundary_closure.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260813210000_custodial_u4_ops_closure.sql', root), 'utf8'),
]);

assert.match(source, /const API_PREFIX = ['"]\/employee-notifications-api['"]/);
for (const route of ['register', 'events', 'opened', 'test']) {
  assert.ok(source.includes(`\${API_PREFIX}/${route}`), `missing ${route} route registration`);
}

assert.match(source, /messenger_fallback: false/);
assert.match(source, /employee-native-push\.v2/);
for (const kind of ['event_day_before', 'event_shift_plus_15', 'message', 'due_soon', 'overdue']) {
  assert.ok(source.includes(`'${kind}'`), `missing native employee notification kind ${kind}`);
}
assert.match(source, /makeDeviceCredentialMiddleware\(\{ supabase: db, runReadOnlySql \}\)/);
const canonicalCredentialId = '55555555-5555-4555-8555-555555555555';
assert.equal(
  employeeNotificationInternals.credentialId({
    memphisDeviceCredential: { credential_id: canonicalCredentialId },
    memphisDevice: { credential_id: 'wrong-device-shape' },
  }),
  canonicalCredentialId,
  'employee push registration must consume the credential object populated by device-auth middleware',
);
assert.equal(
  employeeNotificationInternals.credentialId({
    memphisDeviceAuth: { credential: { credential_id: canonicalCredentialId } },
  }),
  canonicalCredentialId,
  'employee push registration must retain the canonical auth-result fallback',
);
const testNotifications = Object.fromEntries(
  ['event', 'message', 'due_soon', 'overdue'].map((kind) => [
    kind,
    employeeNotificationInternals.buildManagerTestNotification(kind, {
      runId: '66666666-6666-4666-8666-666666666666',
      deviceIdentifier: 'KIOSK_08',
    }),
  ]),
);
assert.equal(testNotifications.event.channel_id, 'employee-events');
assert.equal(testNotifications.event.data_json.kind, 'employee_event');
assert.equal(testNotifications.message.channel_id, 'employee-messages');
assert.equal(testNotifications.message.data_json.kind, 'employee_message');
assert.equal(testNotifications.due_soon.channel_id, 'employee-due-soon');
assert.equal(testNotifications.due_soon.data_json.status_code, 'due_soon');
assert.equal(testNotifications.overdue.channel_id, 'employee-overdue');
assert.equal(testNotifications.overdue.data_json.status_code, 'overdue');
assert.ok(Object.values(testNotifications).every((item) => item.data_json.test_delivery === true));
assert.match(source, /\$\{API_PREFIX\}\/test`, requireManagerWrite/);
assert.match(source, /job_type: 'employee_native_push'/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*requireManager: requireOpsManagerWrite/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*registerOperationalJobHandler: registerOperationalNotificationJobHandler/);
assert.match(source, /registerOperationalJobHandler\('employee_event_push', deliverClaimedJob\)/);
assert.match(source, /registerOperationalJobHandler\('employee_native_push', deliverClaimedJob\)/);
assert.match(source, /device_auth_resolver_configured: authReadConfigured/);
assert.match(source, /employee_notification_auth_ready/);
assert.match(source, /claim_operational_notification_job_by_key/);
assert.doesNotMatch(source, /claim_operational_notification_jobs/);
assert.match(source, /channelId = 'employee-events'/);
assert.match(source, /employee_native_push/);
assert.match(source, /mz_enqueue_employee_location_pushes/);
assert.match(source, /payload\.channel_id/);
assert.match(source, /notification_key/);
assert.match(source, /error\?\.permanent[\s\S]*push_token_rejected/);
assert.match(source, /mz_record_employee_push_delivery/);
assert.match(source, /mz_claim_employee_event_push_delivery/);
assert.match(source, /mz_release_employee_event_push_delivery/);
assert.match(source, /mz_record_employee_event_push_delivery/);
assert.match(source, /push_registration_superseded_after_provider_dispatch/);
assert.match(closureMigration, /last_successful_delivery_at=case[\s\S]*token_hash=excluded\.token_hash[\s\S]*else null/);
assert.match(manager, /export function createPushRuntime/);
assert.match(manager, /channel_id: channelId/);
assert.match(manager, /getClientConfig, send, sweep/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*runReadOnlySql:[\s\S]*runSupabaseReadOnlySql/);

for (const contract of [
  'employee_push_registrations',
  'event_push_instances',
  'assignment_epoch',
  'day_before',
  'shift_plus_15',
  'employee_event_push',
  'mz_enqueue_employee_event_pushes',
  'mz_register_employee_push',
  'mz_mark_employee_event_opened',
]) assert.ok(migration.includes(contract), `missing migration contract ${contract}`);

assert.match(migration, /08:00:00 America\/Chicago/);
assert.match(migration, /shift_start::text\|\|' America\/Chicago'\)::timestamptz \+ interval '15 minutes'/);
assert.match(migration, /status='dead'/);
assert.doesNotMatch(migration, /operational_notification_jobs[\s\S]{0,240}status='cancelled'/);

for (const contract of [
  'mz_enqueue_employee_message_push',
  'trg_mz_enqueue_employee_message_push',
  'mz_enqueue_employee_location_pushes',
  'employee_native_push',
  'employee-messages',
  'employee-due-soon',
  'employee-overdue',
  'device_notification_acknowledgements',
  'assignment_epoch',
]) assert.ok(nativeKindsMigration.includes(contract), `missing native employee push contract ${contract}`);
assert.match(nativeKindsMigration, /status\.status_code in \('due_soon','overdue'\)/);
assert.match(nativeKindsMigration, /job_type in \('employee_event_push','employee_native_push'\)/);
assert.doesNotMatch(nativeKindsMigration, /messenger_fallback|presentation_demo/);
assert.match(boundaryMigration, /mz_enqueue_employee_location_pushes\(timestamp with time zone\)/);
assert.match(boundaryMigration, /v_service_date date:=public\.sch_service_date\(p_now\)/);

const registeredWorkerTypes = [];
installEmployeeNotificationRoutes(express(), {
  supabase: {},
  pushRuntime: { configured: true },
  registerOperationalJobHandler: (jobType, handler) => {
    assert.equal(typeof handler, 'function');
    registeredWorkerTypes.push(jobType);
  },
});
assert.deepEqual(registeredWorkerTypes.sort(), ['employee_event_push', 'employee_native_push']);

async function checkHealth(options) {
  const app = express();
  installEmployeeNotificationRoutes(app, options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/employee-notifications-api/health`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const healthy = await checkHealth({
  supabase: {},
  pushRuntime: { configured: true },
  runReadOnlySql: async () => [{ employee_notification_auth_ready: true }],
});
assert.equal(healthy.status, 200);
assert.equal(healthy.body.ok, true);
assert.deepEqual(healthy.body.dependencies, {
  database_reachable: true,
  device_auth_resolver_configured: true,
  push_provider_configured: true,
});

const missingAuthResolver = await checkHealth({
  supabase: {},
  pushRuntime: { configured: true },
});
assert.equal(missingAuthResolver.status, 503);
assert.equal(missingAuthResolver.body.ok, false);
assert.equal(missingAuthResolver.body.dependencies.device_auth_resolver_configured, false);

const claimedJob = {
  job_id: '77777777-7777-4777-8777-777777777771',
  job_key: 'employee-message:revocation-boundary',
  job_type: 'employee_native_push',
  source_id: '77777777-7777-4777-8777-777777777772',
  lease_token: '77777777-7777-4777-8777-777777777773',
  payload_json: {
    credential_id: canonicalCredentialId,
    employee_id: '77777777-7777-4777-8777-777777777774',
    device_id: '77777777-7777-4777-8777-777777777775',
    assignment_epoch: 4,
    channel_id: 'employee-messages',
    title: 'Revocation boundary',
    body: 'This must not cross a revoked credential boundary.',
    data_json: { notification_type: 'message' },
  },
};
const authorizedRegistration = {
  registration_id: '77777777-7777-4777-8777-777777777776',
  credential_id: canonicalCredentialId,
  employee_id: claimedJob.payload_json.employee_id,
  device_id: claimedJob.payload_json.device_id,
  assignment_epoch: 4,
  fcm_token: `contract-fcm-${'x'.repeat(40)}`,
  active: true,
};

let sendCount = 0;
let resolveCount = 0;
let credentialRevoked = false;
const revokeAfterClaimDb = {
  async rpc(name) {
    if (name === 'mz_get_employee_native_push_delivery_receipt') {
      return { data: { current: true, already_recorded: false, recorded: false }, error: null };
    }
    assert.equal(name, 'mz_resolve_employee_push_delivery');
    resolveCount += 1;
    return credentialRevoked
      ? { data: { ok: false, terminal: true, reason: 'device_credential_revoked' }, error: null }
      : { data: { ok: true, registration: authorizedRegistration }, error: null };
  },
};
const revokeAfterClaimRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: revokeAfterClaimDb,
  pushRuntime: {
    configured: true,
    async send() { sendCount += 1; return 'provider-message-must-not-exist'; },
  },
  beforeFinalDeliveryCheck: async () => { credentialRevoked = true; },
});
await assert.rejects(
  () => revokeAfterClaimRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'device_credential_revoked',
  'revocation after claim and before send must be a terminal delivery outcome',
);
assert.equal(resolveCount, 2, 'delivery must revalidate once after claim and once immediately before FCM');
assert.equal(sendCount, 0, 'FCM must not be called after credential revocation');

let preClaimResolveCount = 0;
const revokedBeforeClaimRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        return { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      assert.equal(name, 'mz_resolve_employee_push_delivery');
      preClaimResolveCount += 1;
      return { data: { ok: false, terminal: true, reason: 'device_credential_expired' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() { sendCount += 1; return 'provider-message-must-not-exist'; },
  },
});
await assert.rejects(
  () => revokedBeforeClaimRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'device_credential_expired',
  'a job claimed after credential expiry must fail closed',
);
// Restarting a worker against the same durable job must repeat the authority
// check and remain terminal instead of attempting provider delivery.
await assert.rejects(
  () => revokedBeforeClaimRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'device_credential_expired',
);
assert.equal(preClaimResolveCount, 2);
assert.equal(sendCount, 0);

let recordedBinding = null;
const rotatedDuringProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name, args) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        return { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_prepare_employee_native_push_delivery') {
        return { data: { current: true, dispatch_authorized: true, already_prepared: false }, error: null };
      }
      assert.equal(name, 'mz_record_employee_native_push_delivery');
      recordedBinding = args;
      return { data: { current: false, recorded: false, reason: 'push_registration_superseded' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() { return 'provider-message-for-superseded-token'; },
  },
});
await assert.rejects(
  () => rotatedDuringProviderRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'push_registration_superseded_after_provider_dispatch',
  'a provider result cannot be committed after the exact FCM token generation rotates',
);
assert.equal(recordedBinding.p_registration_id, authorizedRegistration.registration_id);
assert.equal(recordedBinding.p_token_hash, createHash('sha256').update(authorizedRegistration.fcm_token).digest('hex'));
assert.equal(recordedBinding.p_job_id, claimedJob.job_id);
assert.equal(recordedBinding.p_lease_token, claimedJob.lease_token);

let nativeReceiptRecorded = false;
let nativeDispatchPrepared = false;
let nativeReplaySendCount = 0;
const nativeReplayRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        return nativeReceiptRecorded
          ? { data: { current: true, already_recorded: true, recorded: true, provider_message_id: 'provider-native-once' }, error: null }
          : { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_prepare_employee_native_push_delivery') {
        assert.equal(nativeDispatchPrepared, false);
        nativeDispatchPrepared = true;
        return { data: { current: true, dispatch_authorized: true, already_prepared: false }, error: null };
      }
      assert.equal(name, 'mz_record_employee_native_push_delivery');
      nativeReceiptRecorded = true;
      return { data: { current: true, already_recorded: false, recorded: true, provider_message_id: 'provider-native-once' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() { nativeReplaySendCount += 1; return 'provider-native-once'; },
  },
});
assert.deepEqual(await nativeReplayRuntime.deliverClaimedJob(claimedJob), { provider_message_id: 'provider-native-once' });
assert.deepEqual(await nativeReplayRuntime.deliverClaimedJob(claimedJob), { provider_message_id: 'provider-native-once', replayed: true });
assert.equal(nativeReplaySendCount, 1, 'a durable native delivery receipt must suppress provider replay after response loss');

let releaseLeaseExpirySend;
let markLeaseExpirySendStarted;
let preparedLease = null;
let currentLease = claimedJob.lease_token;
let leaseExpirySendCount = 0;
const leaseExpirySendStarted = new Promise((resolve) => { markLeaseExpirySendStarted = resolve; });
const leaseExpirySendRelease = new Promise((resolve) => { releaseLeaseExpirySend = resolve; });
const reclaimedJob = { ...claimedJob, lease_token: '77777777-7777-4777-8777-777777777799' };
const leaseExpiryRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name, args) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        if (preparedLease) {
          return { data: { current: true, terminal: true, already_recorded: false, recorded: false,
            dispatch_prepared: true, delivery_outcome_unknown: true, reason: 'native_push_delivery_outcome_unknown' }, error: null };
        }
        return { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_prepare_employee_native_push_delivery') {
        assert.equal(args.p_lease_token, currentLease);
        assert.equal(preparedLease, null);
        preparedLease = args.p_lease_token;
        return { data: { current: true, dispatch_authorized: true, already_prepared: false }, error: null };
      }
      assert.equal(name, 'mz_record_employee_native_push_delivery');
      return args.p_lease_token === currentLease
        ? { data: { current: true, recorded: true }, error: null }
        : { data: { current: false, recorded: false, reason: 'employee_native_push_lease_superseded' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      leaseExpirySendCount += 1;
      markLeaseExpirySendStarted();
      await leaseExpirySendRelease;
      return 'provider-native-lease-expiry';
    },
  },
});
const staleWorkerDelivery = leaseExpiryRuntime.deliverClaimedJob(claimedJob);
await leaseExpirySendStarted;
currentLease = reclaimedJob.lease_token;
await assert.rejects(
  () => leaseExpiryRuntime.deliverClaimedJob(reclaimedJob),
  (error) => error?.terminal === true && error?.code === 'native_push_delivery_outcome_unknown',
  'a reclaimed worker must not cross an unresolved provider dispatch boundary',
);
releaseLeaseExpirySend();
await assert.rejects(
  () => staleWorkerDelivery,
  (error) => error?.terminal === true && error?.code === 'employee_native_push_lease_superseded_after_provider_dispatch',
);
assert.equal(leaseExpirySendCount, 1, 'lease expiry during FCM must not permit a second provider dispatch');

const eventClaimedJob = {
  ...claimedJob,
  job_id: '88888888-8888-4888-8888-888888888881',
  job_key: 'employee-event:cancel-boundary',
  job_type: 'employee_event_push',
  source_id: '88888888-8888-4888-8888-888888888882',
};
const eventInstance = {
  instance_id: eventClaimedJob.source_id,
  event_id: '88888888-8888-4888-8888-888888888883',
  event_revision: 1,
  notification_key: 'event:cancel-boundary',
  notification_kind: 'day_before',
  credential_id: canonicalCredentialId,
  assignment_epoch: 4,
  state: 'pending',
  events_app_events: { event_name: 'Cancelled event', display_location: 'Zoo Footprint' },
};
function eventInstanceQuery(row, { onUpdate = null } = {}) {
  const query = {
    select() { return query; },
    update() { onUpdate?.(); return query; },
    eq() { return query; },
    in() { return query; },
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return query;
}

let cancelledEventSendCount = 0;
const cancelledBeforeProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      assert.equal(name, 'mz_claim_employee_event_push_delivery');
      return { data: { ok: false, terminal: true, reason: 'event_push_instance_cancelled' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance);
    },
  },
  pushRuntime: {
    configured: true,
    async send() { cancelledEventSendCount += 1; return 'provider-message-must-not-exist'; },
  },
});
await assert.rejects(
  () => cancelledBeforeProviderRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal === true && error?.code === 'event_push_instance_cancelled',
  'an event cancelled after job claim must fail the database-bound pre-provider check',
);
assert.equal(cancelledEventSendCount, 0, 'FCM must not receive an event that is cancelled before provider dispatch');

let duplicateClaimEventUpdates = 0;
let duplicateClaimEventSends = 0;
const duplicateSameLeaseClaimRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      assert.equal(name, 'mz_claim_employee_event_push_delivery');
      return { data: { ok: false, terminal: false, defer_finish: true,
        reason: 'event_push_delivery_in_flight', state: 'leased' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance, { onUpdate: () => { duplicateClaimEventUpdates += 1; } });
    },
  },
  pushRuntime: {
    configured: true,
    async send() { duplicateClaimEventSends += 1; return 'provider-message-must-not-exist'; },
  },
});
await assert.rejects(
  () => duplicateSameLeaseClaimRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.deferFinish === true && error?.terminal !== true && error?.code === 'event_push_delivery_in_flight',
  'an exact same-lease event claim retry must leave the original provider boundary untouched',
);
assert.equal(duplicateClaimEventSends, 0);
assert.equal(duplicateClaimEventUpdates, 0);

let crossingEventSendCount = 0;
const cancelledAcrossProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        return { data: { ok: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      assert.equal(name, 'mz_record_employee_event_push_delivery');
      return { data: { current: false, recorded: false, reason: 'event_or_revision_superseded' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance);
    },
  },
  pushRuntime: {
    configured: true,
    async send() { crossingEventSendCount += 1; return 'provider-message-cancelled-at-boundary'; },
  },
});
await assert.rejects(
  () => cancelledAcrossProviderRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal === true && error?.code === 'event_or_revision_superseded_after_provider_dispatch',
  'a cancellation crossing the provider boundary cannot be recorded as a successful event delivery',
);
assert.equal(crossingEventSendCount, 1);

let releaseEventLeaseExpirySend;
let markEventLeaseExpirySendStarted;
let preparedEventLease = null;
let currentEventLease = eventClaimedJob.lease_token;
let eventLeaseExpirySendCount = 0;
const eventLeaseExpirySendStarted = new Promise((resolve) => { markEventLeaseExpirySendStarted = resolve; });
const eventLeaseExpirySendRelease = new Promise((resolve) => { releaseEventLeaseExpirySend = resolve; });
const reclaimedEventJob = { ...eventClaimedJob, lease_token: '88888888-8888-4888-8888-888888888899' };
const eventLeaseExpiryRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name, args) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        if (preparedEventLease) {
          return { data: { ok: false, terminal: true, dispatch_authorized: false,
            reason: 'event_push_delivery_outcome_unknown' }, error: null };
        }
        preparedEventLease = args.p_lease_token;
        return { data: { ok: true, dispatch_authorized: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      assert.equal(name, 'mz_record_employee_event_push_delivery');
      return args.p_lease_token === currentEventLease
        ? { data: { current: true, recorded: true }, error: null }
        : { data: { current: false, recorded: false, reason: 'employee_event_push_lease_superseded' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance);
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      eventLeaseExpirySendCount += 1;
      markEventLeaseExpirySendStarted();
      await eventLeaseExpirySendRelease;
      return 'provider-event-lease-expiry';
    },
  },
});
const staleEventWorkerDelivery = eventLeaseExpiryRuntime.deliverClaimedJob(eventClaimedJob);
await eventLeaseExpirySendStarted;
currentEventLease = reclaimedEventJob.lease_token;
await assert.rejects(
  () => eventLeaseExpiryRuntime.deliverClaimedJob(reclaimedEventJob),
  (error) => error?.terminal === true && error?.code === 'event_push_delivery_outcome_unknown',
  'a reclaimed event worker must not repeat an unresolved provider dispatch',
);
releaseEventLeaseExpirySend();
await assert.rejects(
  () => staleEventWorkerDelivery,
  (error) => error?.terminal === true && error?.code === 'employee_event_push_lease_superseded_after_provider_dispatch',
);
assert.equal(eventLeaseExpirySendCount, 1, 'lease expiry during event FCM must not permit a second provider dispatch');

let rotatedFailureEventUpdates = 0;
const rotatedDuringProviderFailureRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        return { data: { ok: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      if (name === 'mz_release_employee_event_push_delivery') {
        return { data: { current: true, released: true, state: 'failed' }, error: null };
      }
      assert.equal(name, 'mz_record_employee_push_delivery');
      return { data: { current: false, recorded: false, reason: 'push_registration_superseded' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance, { onUpdate: () => { rotatedFailureEventUpdates += 1; } });
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      throw Object.assign(new Error('old provider token rejected'), { permanent: true, deliveryNotAccepted: true });
    },
  },
});
await assert.rejects(
  () => rotatedDuringProviderFailureRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal !== true && error?.permanent !== true
    && error?.code === 'push_registration_rotated_after_provider_failure',
  'an old-token provider failure must remain retryable against the replacement token',
);
assert.equal(rotatedFailureEventUpdates, 1, 'a stale provider failure must transition the leased event to retryable failed state');

let ambiguousReleaseCalls = 0;
let ambiguousEventUpdates = 0;
const ambiguousProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        return { data: { ok: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      if (name === 'mz_release_employee_event_push_delivery') {
        ambiguousReleaseCalls += 1;
        return { data: { current: true, released: true }, error: null };
      }
      throw new Error(`unexpected ambiguous-provider RPC ${name}`);
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance, { onUpdate: () => { ambiguousEventUpdates += 1; } });
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      throw Object.assign(new Error('FCM returned HTTP 200.'), { deliveryNotAccepted: false });
    },
  },
});
await assert.rejects(
  () => ambiguousProviderRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal === true && error?.permanent === true
    && error?.code === 'event_push_delivery_outcome_unknown',
  'an ambiguous FCM 200 must terminally preserve the prepared at-most-once marker',
);
assert.equal(ambiguousReleaseCalls, 0, 'ambiguous provider acceptance must never release the durable dispatch marker');
assert.equal(ambiguousEventUpdates, 1, 'ambiguous provider acceptance terminally cancels the event instead of creating a retryable state');

assert.match(source, /resolveAuthorizedDelivery\(credential, assignmentEpoch\)[\s\S]*beforeFinalDeliveryCheck[\s\S]*resolveAuthorizedDelivery\(credential, assignmentEpoch\)/);
assert.match(source, /claimEventDelivery\(job, eventInstance, credential, assignmentEpoch, registration\)[\s\S]*pushRuntime\.send/);
assert.match(source, /recordEventDelivery\(job, eventInstance, credential, assignmentEpoch, registration, providerMessageId\)/);
assert.match(source, /mz_get_employee_native_push_delivery_receipt/);
assert.match(source, /mz_prepare_employee_native_push_delivery/);
assert.match(source, /mz_release_employee_native_push_delivery/);
assert.match(source, /mz_record_employee_native_push_delivery/);
assert.match(source, /providerResultSuperseded[\s\S]*push_registration_rotated_after_provider_failure/);
assert.match(source, /\.in\('state', \['pending', 'leased', 'failed'\]\)[\s\S]*maybeSingle/);
assert.match(source, /finish_operational_notification_job_terminal/);
assert.match(indexSource, /error\?\.terminal === true[\s\S]*finish_operational_notification_job_terminal/);
assert.match(source, /deferFinish[\s\S]*if \(deferFinish\) continue/);
assert.match(indexSource, /deferFinish[\s\S]*deferred: true[\s\S]*continue/);

console.log('EMPLOYEE_NATIVE_NOTIFICATION_CONTRACT_PASS');
