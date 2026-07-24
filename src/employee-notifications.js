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
  return String(req.memphisDevice?.credential_id || req.memphisDevice?.credentialId || req.memphisAuth?.credential_id || '').trim();
}
function setCors(req, res) {
  const allowed = new Set(['https://lasrevinu333-design.github.io', 'https://localhost', 'capacitor://localhost']);
  const origin = String(req.headers.origin || '').trim();
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Id, X-Device-Credential, X-Memphis-Device-Credential');
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
} = {}) {
  if (!app || runtimeByApp.has(app)) return runtimeByApp.get(app) || null;
  const db = supabase || createSupabase(env);
  const requireEmployee = makeDeviceCredentialMiddleware({ supabase: db });
  const workerId = `employee-event-push-${process.pid}-${crypto.randomUUID()}`;
  let inFlight = false;

  app.use(API_PREFIX, (req, res, next) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.get(`${API_PREFIX}/health`, (_req, res) => {
    res.status(db && pushRuntime?.configured ? 200 : 503).json({
      ok: Boolean(db && pushRuntime?.configured),
      contract_version: 'employee-event-push.v1',
      provider: 'fcm',
      messenger_fallback: false,
      notification_kinds: ['day_before', 'shift_plus_15'],
      swipe_dismissal: 'local_only',
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

  async function sweep({ limit = 25 } = {}) {
    if (!db || !pushRuntime?.configured || inFlight) return { ok: false, skipped: inFlight ? 'in_flight' : 'not_configured' };
    inFlight = true;
    try {
      const enqueued = await db.rpc('mz_enqueue_employee_event_pushes', { p_now: new Date().toISOString() });
      if (enqueued.error) throw enqueued.error;
      const claimed = await db.rpc('claim_operational_notification_jobs', { p_worker_id: workerId, p_limit: limit, p_lease_seconds: 120 });
      if (claimed.error) throw claimed.error;
      const jobs = (Array.isArray(claimed.data) ? claimed.data : []).filter((job) => job.job_type === 'employee_event_push');
      for (const job of jobs) {
        let succeeded = false;
        let errorMessage = null;
        let providerMessageId = null;
        try {
          const instanceResult = await db.from('event_push_instances').select('*,events_app_events(event_name,display_location)')
            .eq('instance_id', job.source_id).single();
          if (instanceResult.error) throw instanceResult.error;
          const instance = instanceResult.data;
          const registrationResult = await db.from('employee_push_registrations').select('*')
            .eq('credential_id', instance.credential_id).eq('assignment_epoch', instance.assignment_epoch)
            .eq('active', true).is('revoked_at', null).single();
          if (registrationResult.error) throw registrationResult.error;
          const event = instance.events_app_events || {};
          providerMessageId = await pushRuntime.send({
            title: instance.notification_kind === 'day_before' ? 'Event tomorrow' : 'Assigned event reminder',
            body: `${event.event_name || 'Zoo event'}${event.display_location ? ` — ${event.display_location}` : ''}`,
            data_json: {
              kind: 'employee_event',
              event_id: instance.event_id,
              notification_key: instance.notification_key,
              notification_kind: instance.notification_kind,
              route: `events.html?event_id=${instance.event_id}`,
            },
          }, registrationResult.data, { channelId: 'employee-events' });
          succeeded = true;
          await db.from('event_push_instances').update({
            state: 'sent', sent_at: new Date().toISOString(), provider_message_id: providerMessageId, last_error: null, updated_at: new Date().toISOString(),
          }).eq('instance_id', instance.instance_id);
          await db.from('employee_push_registrations').update({
            last_successful_delivery_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
          }).eq('registration_id', registrationResult.data.registration_id);
        } catch (error) {
          errorMessage = clip(error?.message || 'FCM provider request failed.', 2000);
          await db.from('event_push_instances').update({ state: 'failed', last_error: errorMessage, updated_at: new Date().toISOString() }).eq('instance_id', job.source_id);
        }
        const finished = await db.rpc('finish_operational_notification_job', {
          p_job_id: job.job_id, p_lease_token: job.lease_token, p_succeeded: succeeded,
          p_error: errorMessage, p_retry_seconds: 120,
        });
        if (finished.error) throw finished.error;
      }
      return { ok: true, enqueued: enqueued.data, claimed: jobs.length };
    } finally { inFlight = false; }
  }

  const timer = setInterval(() => { void sweep().catch((error) => console.error('employee event push sweep failed:', error)); }, SWEEP_MS);
  timer.unref?.();
  const runtime = { sweep, configured: Boolean(db && pushRuntime?.configured) };
  runtimeByApp.set(app, runtime);
  return runtime;
}
