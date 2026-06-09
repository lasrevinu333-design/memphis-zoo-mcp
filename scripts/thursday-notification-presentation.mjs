#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://memphis-zoo-mcp.onrender.com/messaging-api';
const DEFAULT_MANAGER_DEVICE = 'KIOSK_01';
const DEFAULT_INTERVAL_SECONDS = 60;
const SERVICE_DATE = '2026-06-11';

export const DEMO_PLAN = [
  {
    sequence: 1,
    device_id: 'KIOSK_02',
    employee_name: 'Alijah Collins',
    kind: 'direct_message',
    label: 'normal message notification',
    body: 'Alijah, demo message notification: this is how an Ops Manager message will alert on your phone. Please press Dismiss after you hear it.'
  },
  {
    sequence: 2,
    device_id: 'KIOSK_04',
    employee_name: 'Tammy Miller',
    kind: 'event_reminder',
    label: 'event notification',
    event_name: 'Expo custodial system demo',
    location_name: 'Expo',
    body: 'Tammy, event reminder demo: Expo custodial system demo is scheduled today. Please check the event location and your assigned coverage.'
  },
  {
    sequence: 3,
    device_id: 'KIOSK_05',
    employee_name: 'Daniel Morgan',
    kind: 'location_status',
    label: 'restroom due soon notification',
    status_code: 'due_soon',
    form_type: 'restroom',
    group_code: 'SPLASH_PAD_RESTROOMS',
    group_name: 'Splash Pad Restrooms',
    location_code: 'SPLASH_PAD_RESTROOMS',
    location_name: 'Splash Pad Restrooms',
    body: 'Daniel, demo assigned location alert: Splash Pad Restrooms are due soon on your route.'
  },
  {
    sequence: 4,
    device_id: 'KIOSK_06',
    employee_name: 'Kinnaye Peete',
    kind: 'location_status',
    label: 'restroom overdue notification',
    status_code: 'overdue',
    form_type: 'restroom',
    group_code: 'COURTYARD_RESTROOMS',
    group_name: 'Courtyard Restrooms',
    location_code: 'COURTYARD_RESTROOMS',
    location_name: 'Courtyard Restrooms',
    body: 'Kinnaye, demo assigned location alert: Courtyard Restrooms are overdue on your route.'
  },
  {
    sequence: 5,
    device_id: 'KIOSK_07',
    employee_name: 'Kathy Phelps',
    kind: 'location_status',
    label: 'exhibit or area due soon notification',
    status_code: 'due_soon',
    form_type: 'exhibit',
    group_code: 'EXPO',
    group_name: 'Expo',
    location_code: 'EXPO',
    location_name: 'Expo',
    body: 'Kathy, demo assigned area alert: Expo is due soon on your route.'
  },
  {
    sequence: 6,
    device_id: 'KIOSK_09',
    employee_name: 'Markiesha Warren',
    kind: 'location_status',
    label: 'exhibit overdue notification',
    status_code: 'overdue',
    form_type: 'exhibit',
    group_code: 'TETON',
    group_name: 'Teton',
    location_code: 'TETON',
    location_name: 'Teton',
    body: 'Markiesha, demo assigned area alert: Teton is overdue on your route.'
  },
  {
    sequence: 7,
    device_id: 'KIOSK_10',
    employee_name: 'Sherita Wilbon',
    kind: 'location_status',
    label: 'second exhibit due soon notification',
    status_code: 'due_soon',
    form_type: 'exhibit',
    group_code: 'ZAMBEZI',
    group_name: 'Zambezi',
    location_code: 'ZAMBEZI',
    location_name: 'Zambezi',
    body: 'Sherita, demo assigned area alert: Zambezi is due soon on your route.'
  }
];

function uniqueList(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function buildRunPlan({ skip = [] } = {}) {
  const skipSet = new Set(uniqueList(skip));
  return DEMO_PLAN
    .filter((item) => !skipSet.has(item.device_id) && !skipSet.has(item.employee_name))
    .map((item, index) => ({ ...item, sequence: index + 1 }));
}

function parseArgs(argv) {
  const args = {
    apiBase: process.env.MEMPHIS_MESSAGING_API_BASE || DEFAULT_API_BASE,
    managerDevice: DEFAULT_MANAGER_DEVICE,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    dryRun: true,
    send: false,
    verifyTargets: false,
    json: false,
    skip: [],
    runId: `custodial-demo-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--api-base') args.apiBase = next();
    else if (arg === '--manager-device') args.managerDevice = next();
    else if (arg === '--interval-seconds') args.intervalSeconds = Number(next());
    else if (arg === '--skip') args.skip.push(...String(next() || '').split(','));
    else if (arg === '--skip-daniel') args.skip.push('KIOSK_05');
    else if (arg === '--run-id') args.runId = next();
    else if (arg === '--verify-targets') args.verifyTargets = true;
    else if (arg === '--send' || arg === '--live' || arg === '--start') { args.send = true; args.dryRun = false; }
    else if (arg === '--dry-run') { args.dryRun = true; args.send = false; }
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.intervalSeconds) || args.intervalSeconds < 0) {
    throw new Error('--interval-seconds must be a non-negative number.');
  }
  args.skip = uniqueList(args.skip);
  return args;
}

function printHelp() {
  console.log(`Memphis Zoo Thursday custodial notification presentation runner

Safe dry run, no sends:
  node scripts/thursday-notification-presentation.mjs --json

Verify mapped device identities without sending:
  node scripts/thursday-notification-presentation.mjs --verify-targets --json

Live run, one phone per minute:
  node scripts/thursday-notification-presentation.mjs --send

Morning test with shorter spacing:
  node scripts/thursday-notification-presentation.mjs --send --interval-seconds 15

Skip Daniel if PTO/attendance changes:
  node scripts/thursday-notification-presentation.mjs --send --skip-daniel

Targets are intentionally limited to KIOSK_02, KIOSK_04, KIOSK_05, KIOSK_06, KIOSK_07, KIOSK_09, KIOSK_10.
Excluded: Ops Manager/KIOSK_01, Michael/KIOSK_03, Karen/KIOSK_08.
`);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(`${response.status} ${payload?.error || response.statusText || 'request failed'}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function apiUrl(apiBase, path) {
  return `${String(apiBase || DEFAULT_API_BASE).replace(/\/$/, '')}${path}`;
}

function normalizeThreadId(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return normalizeThreadId(data[0]);
  return data.thread_id || data.id || data.msg_thread_id || '';
}

function normalizeUserId(data) {
  if (!data) return '';
  return data.msg_user_id || data.id || data.user_id || '';
}

async function getIdentity(apiBase, deviceId) {
  const payload = await fetchJson(apiUrl(apiBase, `/me/by-device?device_id=${encodeURIComponent(deviceId)}`), { method: 'GET' });
  const data = payload?.data || null;
  const userId = normalizeUserId(data);
  if (!userId) throw new Error(`Could not resolve msg user for ${deviceId}`);
  return { ...data, msg_user_id: userId };
}

async function createDirectThread(apiBase, managerDevice, managerUserId, targetUserId) {
  const payload = await fetchJson(apiUrl(apiBase, '/thread/direct'), {
    method: 'POST',
    body: JSON.stringify({
      created_by_user_id: managerUserId,
      other_user_id: targetUserId,
      device_id: managerDevice
    })
  });
  const threadId = normalizeThreadId(payload?.data);
  if (!threadId) throw new Error(`Could not resolve direct thread for target ${targetUserId}`);
  return threadId;
}

function buildMetadata(item, runId) {
  if (item.kind === 'direct_message') return {};
  const base = {
    source: 'events_app',
    notification_kind: 'morning_of',
    presentation_demo: true,
    run_id: runId,
    target_device_id: item.device_id,
    target_display_name: item.employee_name,
    demo_kind: item.kind,
    demo_label: item.label,
    created_by: 'scripts/thursday-notification-presentation.mjs'
  };
  if (item.kind === 'event_reminder') {
    return {
      ...base,
      event_name: item.event_name,
      location_name: item.location_name
    };
  }
  if (item.kind === 'location_status') {
    return {
      ...base,
      demo_alert_kind: 'location_status',
      service_date: SERVICE_DATE,
      status_code: item.status_code,
      form_type: item.form_type,
      group_code: item.group_code,
      group_name: item.group_name,
      location_code: item.location_code,
      location_name: item.location_name,
      employee_name: item.employee_name
    };
  }
  return base;
}

async function sendPlanItem({ apiBase, managerDevice, managerUserId, item, runId }) {
  const targetIdentity = await getIdentity(apiBase, item.device_id);
  const targetUserId = normalizeUserId(targetIdentity);
  const threadId = await createDirectThread(apiBase, managerDevice, managerUserId, targetUserId);
  const metadata = buildMetadata(item, runId);
  const messageType = item.kind === 'direct_message' ? 'text' : 'bot_response';
  const payload = await fetchJson(apiUrl(apiBase, `/thread/${encodeURIComponent(threadId)}/message`), {
    method: 'POST',
    body: JSON.stringify({
      sender_user_id: managerUserId,
      body: item.body,
      message_type: messageType,
      metadata_json: metadata
    })
  });
  return {
    sequence: item.sequence,
    device_id: item.device_id,
    employee_name: item.employee_name,
    kind: item.kind,
    label: item.label,
    thread_id: threadId,
    message_id: payload?.data?.id || payload?.data?.message_id || null
  };
}

async function verifyTargets(apiBase, plan, managerDevice) {
  const rows = [];
  const manager = await getIdentity(apiBase, managerDevice).catch((error) => ({ error: error.message }));
  rows.push({ device_id: managerDevice, expected: 'Ops Manager sender', ok: !manager.error, display_name: manager.display_name || null, error: manager.error || null });
  for (const item of plan) {
    const identity = await getIdentity(apiBase, item.device_id).catch((error) => ({ error: error.message }));
    rows.push({
      device_id: item.device_id,
      expected: item.employee_name,
      ok: !identity.error,
      display_name: identity.display_name || null,
      msg_user_id: identity.msg_user_id || null,
      error: identity.error || null
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const plan = buildRunPlan({ skip: args.skip });
  const output = {
    ok: true,
    dry_run: args.dryRun,
    send: args.send,
    api_base: args.apiBase,
    manager_device: args.managerDevice,
    interval_seconds: args.intervalSeconds,
    run_id: args.runId,
    excluded: ['Ops Manager/KIOSK_01', 'Michael McWright/KIOSK_03', 'Karen Robinson/KIOSK_08'],
    skipped: args.skip,
    plan
  };

  if (args.verifyTargets || args.send) {
    output.target_verification = await verifyTargets(args.apiBase, plan, args.managerDevice);
  }

  if (!args.send) {
    if (args.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`Dry run only. ${plan.length} presentation notifications ready. Add --send to start.`);
      for (const item of plan) console.log(`${item.sequence}. ${item.device_id} ${item.employee_name} — ${item.label}`);
    }
    return;
  }

  const managerIdentity = await getIdentity(args.apiBase, args.managerDevice);
  const managerUserId = normalizeUserId(managerIdentity);
  output.sent = [];
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const sent = await sendPlanItem({ apiBase: args.apiBase, managerDevice: args.managerDevice, managerUserId, item, runId: args.runId });
    output.sent.push({ ...sent, sent_at: new Date().toISOString() });
    const line = `${sent.sequence}/${plan.length} sent ${sent.label} to ${sent.employee_name} (${sent.device_id})`;
    if (args.json) console.log(JSON.stringify({ ok: true, run_id: args.runId, ...sent }, null, 2));
    else console.log(line);
    if (index < plan.length - 1 && args.intervalSeconds > 0) await sleep(args.intervalSeconds * 1000);
  }
  output.completed_at = new Date().toISOString();
  if (args.json) console.log(JSON.stringify({ ok: true, summary: output }, null, 2));
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
