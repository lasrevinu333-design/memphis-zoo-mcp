import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { makeDeviceCredentialMiddleware } from './auth/device-credential-auth.js';

const runtimeByApp = new WeakMap();
const API_PREFIX = '/employee-notifications-api';
const SWEEP_MS = 15_000;

function createSupabase(env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function clip(value, max) { return String(value ?? '').trim().slice(0, max); }
function credentialId(req) {
  return String(
    req.memphisDeviceCredential?.credential_id
      || req.memphisDeviceAuth?.credential?.credential_id
      || req.memphisDevice?.credential_id
      || req.memphisDevice?.credentialId
      || req.memphisAuth?.credential_id
      || '',
  ).trim();
}
function terminalDeliveryError(reason) {
  const normalized = clip(reason, 160) || 'employee_push_recipient_superseded';
  const error = new Error(`Employee push delivery cancelled: ${normalized}.`);
  error.code = normalized;
  error.terminal = true;
  error.permanent = true;
  return error;
}
function deferredDeliveryError(reason) {
  const normalized = clip(reason, 160) || 'employee_push_delivery_in_flight';
  const error = new Error(`Employee push delivery remains in flight: ${normalized}.`);
  error.code = normalized;
  error.deferFinish = true;
  return error;
}
const EMPLOYEE_TEST_KINDS = new Set(['event', 'message', 'due_soon', 'overdue']);
function buildManagerTestNotification(kind, { runId, deviceIdentifier }) {
  const notificationKey = `manager-test:${runId}:${kind}:${deviceIdentifier}`;
  if (kind === 'event') return {
    channel_id: 'employee-events',
    title: 'Assigned event reminder',
    body: 'Custodial notification verification — Memphis Zoo',
    data_json: {
      kind: 'employee_event', notification_type: 'event', notification_kind: 'test',
      notification_key: notificationKey, route: 'events.html?hub=employee', test_delivery: true,
    },
  };
  if (kind === 'message') return {
    channel_id: 'employee-messages',
    title: 'Operations Manager',
    body: 'Notification verification message for this custodial phone.',
    data_json: {
      kind: 'employee_message', notification_type: 'message',
      notification_key: notificationKey, route: 'messages.html?hub=employee', test_delivery: true,
    },
  };
  const overdue = kind === 'overdue';
  return {
    channel_id: overdue ? 'employee-overdue' : 'employee-due-soon',
    title: `Notification Test Location is ${overdue ? 'overdue' : 'due soon'}`,
    body: overdue
      ? 'Notification Test Location on your assigned route needs attention now.'
      : 'Notification Test Location on your assigned route is approaching its cleaning window.',
    data_json: {
      kind: 'employee_location_status', notification_type: 'location_status',
      notification_key: notificationKey, status_code: kind,
      location_name: 'Notification Test Location', route: 'employee-schedule.html?hub=employee',
      test_delivery: true,
    },
  };
}
export const employeeNotificationInternals = Object.freeze({ credentialId, buildManagerTestNotification, terminalDeliveryError });
function setCors(req, res) {
  const allowed = new Set(['https://lasrevinu333-design.github.io', 'https://localhost', 'capacitor://localhost']);
  const origin = String(req.headers.origin || '').trim();
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Id, X-Device-Credential, X-Memphis-Device-Credential');
  res.setHeader('Vary', 'Origin');
}
function fail(res, error) {
  const message = clip(error?.message || 'Employee notification request failed.', 1000);
  const status = error?.status || (/not found/i.test(message) ? 404 : /credential|assigned|unauthor/i.test(message) ? 403 : /required|valid/i.test(message) ? 422 : 500);
  res.status(status).json({ ok: false, error: message });
}

export function installEmployeeNotificationRoutes(app, {
  env = process.env,
  supabase = null,
  pushRuntime = null,
  runReadOnlySql = null,
  requireManager = null,
  registerOperationalJobHandler = null,
  beforeFinalDeliveryCheck = null,
} = {}) {
  if (!app || runtimeByApp.has(app)) return runtimeByApp.get(app) || null;
  const db = supabase || createSupabase(env);
  const authReadConfigured = typeof runReadOnlySql === 'function';
  const requireEmployee = makeDeviceCredentialMiddleware({ supabase: db, runReadOnlySql });
  const requireManagerWrite = typeof requireManager === 'function'
    ? requireManager
    : (_req, res) => res.status(503).json({ ok: false, error: 'Manager authorization is not configured.' });
  const workerId = `employee-native-push-${process.pid}-${crypto.randomUUID()}`;
  let inFlight = false;

  async function resolveAuthorizedDelivery(credential, assignmentEpoch) {
    const result = await db.rpc('mz_resolve_employee_push_delivery', {
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    if (!result.data?.ok) throw terminalDeliveryError(result.data?.reason);
    const registration = result.data.registration;
    if (!registration?.registration_id || !registration?.fcm_token) {
      throw terminalDeliveryError('push_registration_missing');
    }
    return registration;
  }

  async function recordRegistrationDelivery(registration, { succeeded, permanent = false, error = null } = {}) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    if (!registration?.registration_id || !/^[0-9a-f]{64}$/.test(tokenHash)
      || (registration.token_hash && registration.token_hash !== tokenHash)) {
      throw terminalDeliveryError('push_registration_binding_invalid');
    }
    const result = await db.rpc('mz_record_employee_push_delivery', {
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
      p_succeeded: succeeded === true,
      p_permanent: permanent === true,
      p_error: error ? clip(error, 2000) : null,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    return result.data?.current === true;
  }

  async function claimEventDelivery(job, instance, credential, assignmentEpoch, registration) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    if (!registration?.registration_id || !/^[0-9a-f]{64}$/.test(tokenHash)
      || (registration.token_hash && registration.token_hash !== tokenHash)) {
      throw terminalDeliveryError('push_registration_binding_invalid');
    }
    const result = await db.rpc('mz_claim_employee_event_push_delivery', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_instance_id: instance.instance_id,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    if (!result.data?.ok) {
      if (result.data?.defer_finish === true) {
        throw deferredDeliveryError(result.data?.reason || 'event_push_delivery_in_flight');
      }
      throw terminalDeliveryError(result.data?.reason || 'event_push_instance_superseded');
    }
    return result.data;
  }

  async function recordEventDelivery(job, instance, credential, assignmentEpoch, registration, providerMessageId) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    if (!registration?.registration_id || !/^[0-9a-f]{64}$/.test(tokenHash)
      || (registration.token_hash && registration.token_hash !== tokenHash)) {
      throw terminalDeliveryError('push_registration_binding_invalid');
    }
    const result = await db.rpc('mz_record_employee_event_push_delivery', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_instance_id: instance.instance_id,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
      p_provider_message_id: providerMessageId,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    if (result.data?.current !== true || result.data?.recorded !== true) {
      throw terminalDeliveryError(`${result.data?.reason || 'event_push_instance_superseded'}_after_provider_dispatch`);
    }
    return true;
  }

  async function releaseEventDelivery(job, instance, credential, assignmentEpoch, registration, errorMessage) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    const result = await db.rpc('mz_release_employee_event_push_delivery', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_instance_id: instance.instance_id,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
      p_error: errorMessage,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    return result.data?.current === true && result.data?.released === true;
  }

  async function getNativeDeliveryReceipt(job, credential, assignmentEpoch) {
    const result = await db.rpc('mz_get_employee_native_push_delivery_receipt', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
    });
    if (result.error) throw result.error;
    if (result.data?.current !== true) {
      throw terminalDeliveryError(result.data?.reason || 'employee_native_push_job_superseded');
    }
    return result.data;
  }

  async function releaseNativeDelivery(job, credential, assignmentEpoch, registration) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    const result = await db.rpc('mz_release_employee_native_push_delivery', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
    });
    if (result.error) throw result.error;
    return result.data?.current === true && result.data?.released === true;
  }

  async function prepareNativeDelivery(job, credential, assignmentEpoch, registration) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    if (!registration?.registration_id || !/^[0-9a-f]{64}$/.test(tokenHash)
      || (registration.token_hash && registration.token_hash !== tokenHash)) {
      throw terminalDeliveryError('push_registration_binding_invalid');
    }
    const result = await db.rpc('mz_prepare_employee_native_push_delivery', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    if (result.data?.already_recorded === true) return result.data;
    if (result.data?.current !== true || result.data?.dispatch_authorized !== true) {
      throw terminalDeliveryError(result.data?.reason || 'native_push_delivery_not_authorized');
    }
    return result.data;
  }

  async function recordNativeDelivery(job, credential, assignmentEpoch, registration, providerMessageId) {
    const tokenHash = crypto.createHash('sha256').update(String(registration?.fcm_token || '')).digest('hex');
    if (!registration?.registration_id || !/^[0-9a-f]{64}$/.test(tokenHash)
      || (registration.token_hash && registration.token_hash !== tokenHash)) {
      throw terminalDeliveryError('push_registration_binding_invalid');
    }
    const result = await db.rpc('mz_record_employee_native_push_delivery', {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_credential_id: credential,
      p_assignment_epoch: assignmentEpoch,
      p_registration_id: registration.registration_id,
      p_token_hash: tokenHash,
      p_provider_message_id: providerMessageId,
      p_now: new Date().toISOString(),
    });
    if (result.error) throw result.error;
    if (result.data?.current !== true || result.data?.recorded !== true) {
      throw terminalDeliveryError(`${result.data?.reason || 'employee_native_push_job_superseded'}_after_provider_dispatch`);
    }
    return true;
  }

  app.use(API_PREFIX, (req, res, next) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.get(`${API_PREFIX}/health`, async (_req, res) => {
    let databaseReachable = false;
    if (db && authReadConfigured) {
      try {
        const rows = await runReadOnlySql('select true as employee_notification_auth_ready');
        databaseReachable = rows?.[0]?.employee_notification_auth_ready === true;
      } catch {
        databaseReachable = false;
      }
    }
    const ok = Boolean(db && pushRuntime?.configured && authReadConfigured && databaseReachable);
    res.status(ok ? 200 : 503).json({
      ok,
      contract_version: 'employee-native-push.v2',
      provider: 'fcm',
      messenger_fallback: false,
      notification_kinds: ['event_day_before', 'event_shift_plus_15', 'message', 'due_soon', 'overdue'],
      swipe_dismissal: 'local_only',
      dependencies: {
        database_reachable: databaseReachable,
        device_auth_resolver_configured: authReadConfigured,
        push_provider_configured: Boolean(pushRuntime?.configured),
      },
    });
  });

  app.post(`${API_PREFIX}/register`, requireEmployee, async (req, res) => {
    try {
      const id = credentialId(req);
      if (!id) throw Object.assign(new Error('An active employee device credential is required.'), { status: 403 });
      const token = clip(req.body?.token, 4096);
      const platform = clip(req.body?.platform, 16).toLowerCase();
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await db.rpc('mz_register_employee_push', {
        p_credential_id: id,
        p_token: token,
        p_token_hash: tokenHash,
        p_platform: platform,
        p_app_version: clip(req.body?.app_version, 80) || null,
        p_app_build: clip(req.body?.app_build, 120) || null,
      });
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      res.status(200).json({ ok: true, data: {
        registration_id: row.registration_id,
        employee_id: row.employee_id,
        device_id: row.device_id,
        assignment_epoch: row.assignment_epoch,
        registered_at: row.registered_at,
      } });
    } catch (error) { fail(res, error); }
  });

  app.delete(`${API_PREFIX}/register`, requireEmployee, async (req, res) => {
    try {
      const id = credentialId(req);
      const result = await db.from('employee_push_registrations').update({
        active: false, revoked_at: new Date().toISOString(), revoked_reason: 'client_unregistered', updated_at: new Date().toISOString(),
      }).eq('credential_id', id).eq('active', true);
      if (result.error) throw result.error;
      res.status(200).json({ ok: true, data: { unregistered: true } });
    } catch (error) { fail(res, error); }
  });

  app.get(`${API_PREFIX}/events`, requireEmployee, async (req, res) => {
    try {
      const id = credentialId(req);
      const result = await db.from('event_push_instances')
        .select('notification_key,event_id,notification_kind,scheduled_for,state,sent_at,opened_at')
        .eq('credential_id', id).order('scheduled_for', { ascending: false }).limit(100);
      if (result.error) throw result.error;
      res.status(200).json({ ok: true, data: result.data || [] });
    } catch (error) { fail(res, error); }
  });

  app.post(`${API_PREFIX}/opened`, requireEmployee, async (req, res) => {
    try {
      const result = await db.rpc('mz_mark_employee_event_opened', {
        p_credential_id: credentialId(req),
        p_notification_key: clip(req.body?.notification_key, 240),
      });
      if (result.error) throw result.error;
      res.status(200).json({ ok: true, data: { opened: true } });
    } catch (error) { fail(res, error); }
  });

  app.post(`${API_PREFIX}/test`, requireManagerWrite, async (req, res) => {
    try {
      if (!db || !pushRuntime?.configured) {
        throw Object.assign(new Error('Employee push delivery is not configured.'), { status: 503 });
      }
      const deviceIdentifier = clip(req.body?.device_id, 80).toUpperCase();
      if (!/^KIOSK_(0[2-9]|10)$/.test(deviceIdentifier)) {
        throw Object.assign(new Error('A canonical custodial KIOSK device ID is required.'), { status: 422 });
      }
      const requestedKinds = Array.isArray(req.body?.kinds) && req.body.kinds.length
        ? [...new Set(req.body.kinds.map((value) => clip(value, 40).toLowerCase()))]
        : [...EMPLOYEE_TEST_KINDS];
      if (requestedKinds.some((kind) => !EMPLOYEE_TEST_KINDS.has(kind))) {
        throw Object.assign(new Error('Notification kinds must be event, message, due_soon, or overdue.'), { status: 422 });
      }
      const deviceResult = await db.from('devices')
        .select('id,device_id,device_name,assigned_employee_id,assignment_epoch')
        .eq('device_id', deviceIdentifier).eq('active', true).single();
      if (deviceResult.error) throw deviceResult.error;
      const device = deviceResult.data;
      if (!device?.assigned_employee_id || !Number.isSafeInteger(Number(device.assignment_epoch))) {
        throw Object.assign(new Error('The target phone does not have an active employee assignment.'), { status: 409 });
      }
      const registrationResult = await db.from('employee_push_registrations')
        .select('registration_id,credential_id,device_id,employee_id,assignment_epoch,last_seen_at')
        .eq('device_id', device.id).eq('employee_id', device.assigned_employee_id)
        .eq('assignment_epoch', Number(device.assignment_epoch))
        .eq('active', true).is('revoked_at', null)
        .order('last_seen_at', { ascending: false }).limit(1).maybeSingle();
      if (registrationResult.error) throw registrationResult.error;
      const registration = registrationResult.data;
      if (!registration) {
        throw Object.assign(new Error('The target phone has not registered for employee notifications.'), { status: 409 });
      }
      const runId = crypto.randomUUID();
      const now = new Date().toISOString();
      const jobs = requestedKinds.map((kind) => {
        const notification = buildManagerTestNotification(kind, { runId, deviceIdentifier });
        return {
          job_key: `employee-manager-test:${runId}:${kind}:${registration.credential_id}`,
          job_type: 'employee_native_push',
          source_id: crypto.randomUUID(),
          available_at: now,
          payload_json: {
            credential_id: registration.credential_id,
            employee_id: registration.employee_id,
            device_id: registration.device_id,
            device_identifier: deviceIdentifier,
            assignment_epoch: Number(registration.assignment_epoch),
            channel_id: notification.channel_id,
            title: notification.title,
            body: notification.body,
            data_json: notification.data_json,
          },
        };
      });
      const inserted = await db.from('operational_notification_jobs')
        .insert(jobs).select('job_id,job_key,status,payload_json');
      if (inserted.error) throw inserted.error;
      const delivery = await sweep({ limit: Math.max(25, jobs.length) });
      res.status(202).json({ ok: true, data: {
        run_id: runId,
        device_id: deviceIdentifier,
        kinds: requestedKinds,
        jobs: (inserted.data || []).map((job) => ({
          job_id: job.job_id,
          job_key: job.job_key,
          status: job.status,
          channel_id: job.payload_json?.channel_id,
          notification_type: job.payload_json?.data_json?.notification_type,
        })),
        delivery,
      } });
    } catch (error) { fail(res, error); }
  });

  async function deliverClaimedJob(job) {
    let registration = null;
    let eventInstance = null;
    let credential = null;
    let assignmentEpoch = null;
    let providerBoundaryPrepared = false;
    try {
      let push;
      let channelId;
      if (job.job_type === 'employee_event_push') {
        const instanceResult = await db.from('event_push_instances').select('*,events_app_events(event_name,display_location)')
          .eq('instance_id', job.source_id).single();
        if (instanceResult.error) throw instanceResult.error;
        eventInstance = instanceResult.data;
        const event = eventInstance.events_app_events || {};
        credential = eventInstance.credential_id;
        assignmentEpoch = eventInstance.assignment_epoch;
        channelId = 'employee-events';
        push = {
          title: eventInstance.notification_kind === 'day_before' ? 'Event tomorrow' : 'Assigned event reminder',
          body: `${event.event_name || 'Zoo event'}${event.display_location ? ` — ${event.display_location}` : ''}`,
          data_json: {
            kind: 'employee_event',
            notification_type: 'event',
            event_id: eventInstance.event_id,
            notification_key: eventInstance.notification_key,
            notification_kind: eventInstance.notification_kind,
            route: `events.html?hub=employee&event_id=${eventInstance.event_id}`,
          },
        };
      } else if (job.job_type === 'employee_native_push') {
        const payload = job.payload_json && typeof job.payload_json === 'object' ? job.payload_json : {};
        credential = clip(payload.credential_id, 80);
        assignmentEpoch = Number(payload.assignment_epoch);
        channelId = clip(payload.channel_id, 80) || 'employee-messages';
        push = {
          title: clip(payload.title, 180) || 'Memphis Zoo',
          body: clip(payload.body, 1000) || 'You have a new notification.',
          data_json: payload.data_json && typeof payload.data_json === 'object' ? payload.data_json : {},
        };
      } else {
        throw new Error(`Unsupported employee notification job type: ${clip(job.job_type, 120)}`);
      }
      if (!credential || !Number.isSafeInteger(assignmentEpoch) || assignmentEpoch < 1) {
        throw new Error('Employee native push job is missing its assignment-bound recipient.');
      }
      if (!eventInstance) {
        const receipt = await getNativeDeliveryReceipt(job, credential, assignmentEpoch);
        if (receipt.already_recorded === true) return { provider_message_id: receipt.provider_message_id, replayed: true };
        if (receipt.delivery_outcome_unknown === true) {
          throw terminalDeliveryError(receipt.reason || 'native_push_delivery_outcome_unknown');
        }
      }
      // A job can outlive either its credential or employee assignment.  Check
      // once after claim, then again immediately before the provider boundary.
      // The database resolver also reconciles stale registration state.
      registration = await resolveAuthorizedDelivery(credential, assignmentEpoch);
      if (typeof beforeFinalDeliveryCheck === 'function') {
        await beforeFinalDeliveryCheck({ job, credential, assignmentEpoch, registration });
      }
      registration = await resolveAuthorizedDelivery(credential, assignmentEpoch);
      if (eventInstance) {
        const claimed = await claimEventDelivery(job, eventInstance, credential, assignmentEpoch, registration);
        if (claimed.already_recorded === true) {
          return { provider_message_id: claimed.provider_message_id, replayed: true };
        }
        providerBoundaryPrepared = true;
      } else {
        const prepared = await prepareNativeDelivery(job, credential, assignmentEpoch, registration);
        if (prepared.already_recorded === true) {
          return { provider_message_id: prepared.provider_message_id, replayed: true };
        }
        providerBoundaryPrepared = true;
      }
      const providerMessageId = await pushRuntime.send(push, registration, { channelId });
      const recorded = eventInstance
        ? await recordEventDelivery(job, eventInstance, credential, assignmentEpoch, registration, providerMessageId)
        : await recordNativeDelivery(job, credential, assignmentEpoch, registration, providerMessageId);
      if (!recorded) {
        throw terminalDeliveryError('push_registration_superseded_after_provider_dispatch');
      }
      return { provider_message_id: providerMessageId };
    } catch (error) {
      const errorMessage = clip(error?.message || 'FCM provider request failed.', 2000);
      if (error?.deferFinish === true) throw error;
      if (providerBoundaryPrepared && error?.deliveryNotAccepted === true) {
        const released = eventInstance
          ? await releaseEventDelivery(job, eventInstance, credential, assignmentEpoch, registration, errorMessage)
          : await releaseNativeDelivery(job, credential, assignmentEpoch, registration);
        if (!released) {
          throw terminalDeliveryError(eventInstance
            ? 'event_push_delivery_release_superseded'
            : 'native_push_delivery_release_superseded');
        }
        providerBoundaryPrepared = false;
      }
      if (providerBoundaryPrepared && error?.deliveryNotAccepted !== true && error?.terminal !== true) {
        error.terminal = true;
        error.permanent = true;
        error.code = eventInstance ? 'event_push_delivery_outcome_unknown' : 'native_push_delivery_outcome_unknown';
      }
      const authorityTerminal = error?.terminal === true;
      let providerResultSuperseded = false;
      if (registration?.registration_id && !authorityTerminal) {
        const current = await recordRegistrationDelivery(registration, {
          succeeded: false,
          permanent: error?.permanent === true,
          error: errorMessage,
        });
        if (!current) {
          providerResultSuperseded = true;
          error.permanent = false;
          error.terminal = false;
          error.code = 'push_registration_rotated_after_provider_failure';
        }
      }
      if (job.job_type === 'employee_event_push') {
        const eventUpdate = error?.terminal === true
          ? { state: 'cancelled', cancelled_at: new Date().toISOString(), last_error: errorMessage, updated_at: new Date().toISOString() }
          : {
            state: 'failed', dispatch_job_id: null, dispatch_lease_token: null, dispatch_registration_id: null,
            dispatch_token_hash: null, dispatch_started_at: null, last_error: errorMessage, updated_at: new Date().toISOString(),
          };
        const eventResult = await db.from('event_push_instances').update(eventUpdate)
          .eq('instance_id', job.source_id).in('state', ['pending', 'leased', 'failed'])
          .select('instance_id').maybeSingle();
        if (eventResult.error) throw eventResult.error;
      }
      if (error?.permanent === true && !authorityTerminal && !providerResultSuperseded) {
        error.terminal = true;
        error.code ||= 'push_token_rejected';
      }
      throw error;
    }
  }

  async function sweep({ limit = 25 } = {}) {
    if (!db || !pushRuntime?.configured || inFlight) return { ok: false, skipped: inFlight ? 'in_flight' : 'not_configured' };
    inFlight = true;
    try {
      const now = new Date().toISOString();
      const [eventsEnqueued, locationsEnqueued] = await Promise.all([
        db.rpc('mz_enqueue_employee_event_pushes', { p_now: now }),
        db.rpc('mz_enqueue_employee_location_pushes', { p_now: now }),
      ]);
      if (eventsEnqueued.error) throw eventsEnqueued.error;
      if (locationsEnqueued.error) throw locationsEnqueued.error;
      const ready = await db.from('operational_notification_jobs').select('job_key')
        .in('job_type', ['employee_event_push', 'employee_native_push']).in('status', ['pending', 'leased'])
        .lte('available_at', now).order('available_at').limit(limit);
      if (ready.error) throw ready.error;
      const jobs = [];
      for (const candidate of ready.data || []) {
        const claimed = await db.rpc('claim_operational_notification_job_by_key', {
          p_job_key: candidate.job_key, p_worker_id: workerId, p_lease_seconds: 120,
        });
        if (claimed.error) throw claimed.error;
        const job = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
        if (['employee_event_push', 'employee_native_push'].includes(job?.job_type)) jobs.push(job);
      }
      for (const job of jobs) {
        let succeeded = false;
        let errorMessage = null;
        let terminal = false;
        let deferFinish = false;
        try {
          await deliverClaimedJob(job);
          succeeded = true;
        } catch (error) {
          errorMessage = clip(error?.message || 'FCM provider request failed.', 2000);
          terminal = error?.terminal === true;
          deferFinish = error?.deferFinish === true;
        }
        if (deferFinish) continue;
        const finished = terminal
          ? await db.rpc('finish_operational_notification_job_terminal', {
            p_job_id: job.job_id, p_lease_token: job.lease_token, p_error: errorMessage,
          })
          : await db.rpc('finish_operational_notification_job', {
            p_job_id: job.job_id, p_lease_token: job.lease_token, p_succeeded: succeeded,
            p_error: errorMessage, p_retry_seconds: 120,
          });
        if (finished.error) throw finished.error;
      }
      return {
        ok: true,
        enqueued: { events: eventsEnqueued.data, locations: locationsEnqueued.data },
        claimed: jobs.length,
      };
    } finally { inFlight = false; }
  }

  if (typeof registerOperationalJobHandler === 'function') {
    registerOperationalJobHandler('employee_event_push', deliverClaimedJob);
    registerOperationalJobHandler('employee_native_push', deliverClaimedJob);
  }

  const timer = setInterval(() => { void sweep().catch((error) => console.error('employee native push sweep failed:', error)); }, SWEEP_MS);
  timer.unref?.();
  const runtime = { sweep, deliverClaimedJob, configured: Boolean(db && pushRuntime?.configured) };
  runtimeByApp.set(app, runtime);
  return runtime;
}
