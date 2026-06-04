#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import dotenv from 'dotenv';
import { createSupabaseAdminClient } from '../src/supabase/client.js';

const DEFAULT_API_BASE = 'https://memphis-zoo-mcp.onrender.com/messaging-api';
const DEFAULT_FULLY_CONFIG = '~/.hermes/profiles/omega/api-keys/memphis-zoo/fully-kiosk-devices.json';
const DEFAULT_STREAMS = [1, 2, 3, 4, 5, 9, 10]; // system, ring, music, alarm, notification, TTS, accessibility
const DEFAULT_VOLUME = 0;
const DEFAULT_TIMEOUT_MS = 8000;

const FALLBACK_DEVICE_ROWS = [
  { device_id: '1e74fe4c-dc20b3b9', msg_user_id: '7f5cb599-4d6a-4747-8f61-5bcf2ba2ecb5', display_name: 'Ops Manager', role: 'manager', user_active: true },
  { device_id: 'KIOSK_01', msg_user_id: '7f5cb599-4d6a-4747-8f61-5bcf2ba2ecb5', display_name: 'Ops Manager', role: 'manager', user_active: true },
  { device_id: 'KIOSK_1', msg_user_id: '7f5cb599-4d6a-4747-8f61-5bcf2ba2ecb5', display_name: 'Ops Manager', role: 'manager', user_active: true },
  { device_id: 'KIOSK_02', msg_user_id: '7134fcc4-cf43-426c-bf1c-82c39d8e4845', display_name: 'Alijah Collins', role: 'employee', user_active: true },
  { device_id: 'KIOSK_03', msg_user_id: '46025e10-967d-4dc7-97ad-f8f6f3cd96c0', display_name: 'Michael McWright', role: 'employee', user_active: true },
  { device_id: 'KIOSK_04', msg_user_id: '2a7ea7ee-f757-4a8e-beec-0955317381e2', display_name: 'Tammy Miller', role: 'employee', user_active: true },
  { device_id: 'KIOSK_05', msg_user_id: '331eb51a-7d8d-458e-b299-679adcfba332', display_name: 'Daniel Morgan', role: 'employee', user_active: true },
  { device_id: 'KIOSK_06', msg_user_id: 'cf550fdd-7dc8-45e3-adde-f514806867b5', display_name: 'Kinnaye Peete', role: 'employee', user_active: true },
  { device_id: 'KIOSK_07', msg_user_id: 'f155947f-5e56-47e9-9fbc-0a643bef608b', display_name: 'Kathy Phelps', role: 'employee', user_active: true },
  { device_id: 'KIOSK_08', msg_user_id: 'ffa815ce-c1dc-4c41-b696-2320825044a0', display_name: 'Karen Robinson', role: 'employee', user_active: true },
  { device_id: 'KIOSK_09', msg_user_id: 'fd41bf52-7d5b-40d4-a576-4d28f28c675a', display_name: 'Markiesha Warren', role: 'employee', user_active: true },
  { device_id: 'KIOSK_10', msg_user_id: 'eb80f4ef-215e-4f08-8627-e87468722332', display_name: 'Sherita Wilbon', role: 'employee', user_active: true },
];

const KNOWN_ENV_PATHS = [
  '.env',
  '.env.local',
  '~/.hermes/profiles/omega/api-keys/runtime/connectors.env',
  '~/.hermes/profiles/omega/api-keys/memphis-zoo/.env',
  '~/.hermes/profiles/omega/api-keys/memphis-zoo/supabase.env',
];

function loadEnvFiles() {
  for (const candidate of KNOWN_ENV_PATHS) {
    const resolved = expandHome(candidate);
    if (fs.existsSync(resolved)) dotenv.config({ path: resolved, override: false, quiet: true });
  }
}

function realHomeDir() {
  if (process.env.REAL_HOME && fs.existsSync(process.env.REAL_HOME)) return process.env.REAL_HOME;
  const envHome = process.env.HOME || os.homedir();
  if (envHome && !envHome.includes('/.hermes/profiles/') && fs.existsSync(envHome)) return envHome;
  if (fs.existsSync('/home/eric')) return '/home/eric';
  return os.homedir();
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return realHomeDir();
  if (value.startsWith('~/')) return path.join(realHomeDir(), value.slice(2));
  return value;
}

function parseArgs(argv) {
  const args = {
    apiBase: process.env.MEMPHIS_MESSAGING_API_BASE || DEFAULT_API_BASE,
    target: 'active',
    dryRun: true,
    sendPopup: false,
    verifyApi: true,
    includeBootstrap: false,
    includeManagers: true,
    body: '',
    notificationKind: 'morning_of',
    runId: `popup-test-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    cleanupRunId: '',
    fullyConfig: process.env.FULLY_KIOSK_DEVICES_FILE || DEFAULT_FULLY_CONFIG,
    fullyCheck: false,
    fullyPopup: false,
    fullyLockVolume: false,
    fullyApplyLockSettings: false,
    fullyEnforceSeconds: 0,
    fullyIntervalSeconds: 15,
    fullyVolume: DEFAULT_VOLUME,
    fullyStreams: DEFAULT_STREAMS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--api-base') args.apiBase = next();
    else if (arg === '--target' || arg === '--device' || arg === '--devices') args.target = next();
    else if (arg === '--include-bootstrap') args.includeBootstrap = true;
    else if (arg === '--exclude-managers') args.includeManagers = false;
    else if (arg === '--send-popup-test' || arg === '--send-popup') { args.sendPopup = true; args.dryRun = false; }
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--no-api-verify') args.verifyApi = false;
    else if (arg === '--body') args.body = next();
    else if (arg === '--kind') args.notificationKind = next();
    else if (arg === '--run-id') args.runId = next();
    else if (arg === '--cleanup-run-id') { args.cleanupRunId = next(); args.dryRun = false; }
    else if (arg === '--fully-config') args.fullyConfig = next();
    else if (arg === '--fully-check') args.fullyCheck = true;
    else if (arg === '--fully-popup') args.fullyPopup = true;
    else if (arg === '--fully-lock-volume') args.fullyLockVolume = true;
    else if (arg === '--fully-apply-lock-settings') args.fullyApplyLockSettings = true;
    else if (arg === '--fully-enforce-seconds') args.fullyEnforceSeconds = Number(next());
    else if (arg === '--fully-interval-seconds') args.fullyIntervalSeconds = Number(next());
    else if (arg === '--fully-volume') args.fullyVolume = Number(next());
    else if (arg === '--fully-streams') args.fullyStreams = String(next()).split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
    else if (arg === '--timeout-ms') args.timeoutMs = Number(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.fullyVolume) || args.fullyVolume < 0 || args.fullyVolume > 100) {
    throw new Error('--fully-volume must be 0-100.');
  }
  if (!args.fullyStreams.length || args.fullyStreams.some((stream) => stream < 0 || stream > 10)) {
    throw new Error('--fully-streams must be comma-separated stream numbers in the 0-10 range.');
  }
  return args;
}

function printHelp() {
  console.log(`Memphis Zoo device popup + Fully Kiosk test harness

Purpose:
  1) Send synthetic event-reminder messages that trigger the existing MemphisDeviceReminders popup on every kiosk device.
  2) Exercise Fully Kiosk Remote Admin commands for overlay/TTS/audio/volume locking without storing secrets in git.

Safe default:
  node scripts/device-popup-fully-kiosk-test.mjs
    Lists target devices and shows what would happen. No database writes, no phone commands.

Backend popup tests:
  node scripts/device-popup-fully-kiosk-test.mjs --send-popup-test --target active
  node scripts/device-popup-fully-kiosk-test.mjs --send-popup-test --target KIOSK_02,KIOSK_04
  node scripts/device-popup-fully-kiosk-test.mjs --send-popup-test --target employees --exclude-managers
  node scripts/device-popup-fully-kiosk-test.mjs --cleanup-run-id popup-test-YYYY-MM-DDTHH-MM-SS-000Z

Fully Kiosk Remote Admin tests:
  node scripts/device-popup-fully-kiosk-test.mjs --fully-check
  node scripts/device-popup-fully-kiosk-test.mjs --fully-popup --target KIOSK_02
  node scripts/device-popup-fully-kiosk-test.mjs --fully-lock-volume --fully-volume 0 --target active
  node scripts/device-popup-fully-kiosk-test.mjs --fully-lock-volume --fully-enforce-seconds 300 --fully-interval-seconds 10

Fully config file (local secret; do not commit):
  ${DEFAULT_FULLY_CONFIG}

Repo template you can copy:
  config/fully-kiosk-devices.example.json

Example config JSON:
  {
    "password": "REMOTE_ADMIN_PASSWORD_USED_BY_ALL_DEVICES_IF_SAME",
    "devices": [
      { "device_id": "KIOSK_02", "name": "Alijah Collins", "host": "192.168.1.42", "password": "optional per-device override" }
    ]
  }

Notes:
  - Memphis popup path uses /messaging-api/device-event-reminders and metadata source=events_app.
  - Fully REST docs confirm Remote Admin base http://device-ip:2323 plus commands getDeviceInfo, listSettings,
    setOverlayMessage, textToSpeech, setAudioVolume, playSound, setBooleanSetting, setStringSetting.
  - Real volume locking depends on Android/Fully permissions. The script can set audio streams repeatedly, and can
    inspect/apply matching Fully settings when present. True hardware-volume lock may require provisioned/device-owner
    mode or Fully's "Mute Audio and Disable Volume Buttons"/Android no_adjust_volume restriction on the phone.
`);
}

function sqlEscape(value) {
  return String(value ?? '').replace(/'/g, "''");
}

async function rpcOrThrow(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function selectOrThrow(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label} failed: ${error.message}`);
  return data || [];
}

async function loadDeviceRows(supabase) {
  const { data, error } = await supabase
    .from('msg_device_assignments')
    .select('device_identifier,is_active,msg_users!inner(id,display_name,role,is_active,active)')
    .eq('is_active', true)
    .order('device_identifier', { ascending: true });
  if (error) throw new Error(`Load device assignments failed: ${error.message}`);
  const rows = (data || []).map((row) => ({
    device_id: row.device_identifier,
    msg_user_id: row.msg_users?.id,
    display_name: row.msg_users?.display_name || row.device_identifier,
    role: row.msg_users?.role || '',
    user_active: row.msg_users?.is_active !== false && row.msg_users?.active !== false,
  })).filter((row) => row.device_id && row.msg_user_id && row.user_active);
  return rows;
}

function filterTargets(rows, args) {
  const requested = String(args.target || 'active').trim();
  let filtered = rows;
  if (requested === 'active' || requested === 'all') {
    filtered = rows;
  } else if (requested === 'employees') {
    filtered = rows.filter((row) => row.role === 'employee');
  } else if (requested === 'managers') {
    filtered = rows.filter((row) => row.role === 'manager');
  } else {
    const wanted = new Set(requested.split(',').map((x) => x.trim()).filter(Boolean));
    filtered = rows.filter((row) => wanted.has(row.device_id) || wanted.has(row.display_name));
    const found = new Set(filtered.map((row) => row.device_id));
    const missing = [...wanted].filter((id) => !found.has(id) && !filtered.some((row) => row.display_name === id));
    if (missing.length) throw new Error(`Requested target(s) not found: ${missing.join(', ')}`);
  }
  if (!args.includeBootstrap) filtered = filtered.filter((row) => row.device_id !== '1e74fe4c-dc20b3b9');
  if (!args.includeManagers) filtered = filtered.filter((row) => row.role !== 'manager');
  const deduped = [];
  const seen = new Set();
  for (const row of filtered) {
    if (seen.has(row.device_id)) continue;
    seen.add(row.device_id);
    deduped.push(row);
  }
  return deduped;
}

async function getOpsManagerUserId(supabase) {
  const rows = await selectOrThrow(
    supabase.from('msg_users').select('id,display_name,role').eq('is_active', true).eq('role', 'manager').order('display_name', { ascending: true }).limit(1),
    'Load manager sender'
  );
  if (!rows.length) throw new Error('No active manager msg_user found for sender.');
  return rows[0].id;
}

function normalizeThreadId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return normalizeThreadId(value[0]);
  return value.thread_id || value.id || value.msg_thread_id || '';
}

async function createOrGetThreadForTarget(supabase, senderUserId, target) {
  if (target.msg_user_id === senderUserId) {
    const title = `Device Popup Test ${new Date().toISOString()}`;
    const data = await rpcOrThrow(supabase, 'msg_create_group_thread', {
      p_created_by_user_id: senderUserId,
      p_title: title,
      p_member_user_ids: [senderUserId],
    });
    const threadId = normalizeThreadId(data);
    if (!threadId) throw new Error(`Could not resolve self-test group thread for ${target.device_id}`);
    return threadId;
  }
  const data = await rpcOrThrow(supabase, 'msg_get_or_create_direct_thread', {
    p_user_a: senderUserId,
    p_user_b: target.msg_user_id,
  });
  const threadId = normalizeThreadId(data);
  if (!threadId) throw new Error(`Could not resolve direct thread for ${target.device_id}`);
  return threadId;
}

function buildPopupBody(target, args) {
  if (args.body) return args.body;
  return `POPUP TEST for ${target.device_id} / ${target.display_name}. If you see this, press Dismiss. Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}.`;
}

async function sendPopupTests(supabase, targets, args) {
  const senderUserId = await getOpsManagerUserId(supabase);
  const results = [];
  for (const target of targets) {
    const threadId = await createOrGetThreadForTarget(supabase, senderUserId, target);
    const metadata = {
      source: 'events_app',
      notification_kind: args.notificationKind,
      device_popup_test: true,
      run_id: args.runId,
      target_device_id: target.device_id,
      target_display_name: target.display_name,
      created_by: 'scripts/device-popup-fully-kiosk-test.mjs',
    };
    const message = await rpcOrThrow(supabase, 'msg_send_message', {
      p_thread_id: threadId,
      p_sender_user_id: senderUserId,
      p_body: buildPopupBody(target, args),
      p_message_type: 'bot_response',
      p_metadata_json: metadata,
    });
    results.push({
      device_id: target.device_id,
      display_name: target.display_name,
      thread_id: threadId,
      message_id: message?.id || message?.message_id || null,
    });
  }
  return results;
}

async function verifyDeviceReminderApi(targets, args) {
  const results = [];
  for (const target of targets) {
    const url = `${args.apiBase}/device-event-reminders?device_id=${encodeURIComponent(target.device_id)}&limit=20`;
    try {
      const response = await fetchWithTimeout(url, { timeoutMs: args.timeoutMs });
      const payload = await response.json().catch(() => null);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const matching = rows.find((row) => row?.metadata_json?.run_id === args.runId || row?.metadata_json?.target_device_id === target.device_id);
      results.push({
        device_id: target.device_id,
        ok: response.ok && Boolean(payload?.ok),
        status: response.status,
        visible_test_message: Boolean(matching),
        unread_count: rows.length,
        error: payload?.error || null,
      });
    } catch (error) {
      results.push({ device_id: target.device_id, ok: false, status: 0, visible_test_message: false, unread_count: 0, error: error.message });
    }
  }
  return results;
}

async function cleanupRun(supabase, runId) {
  const { data, error } = await supabase
    .from('msg_messages')
    .update({ is_deleted: true })
    .contains('metadata_json', { device_popup_test: true, run_id: runId })
    .select('id,thread_id');
  if (error) throw new Error(`Cleanup failed: ${error.message}`);
  return data || [];
}

function loadFullyConfig(filePath) {
  const resolved = expandHome(filePath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, exists: false, devices: [], password: process.env.FULLY_KIOSK_PASSWORD || '' };
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const config = JSON.parse(raw);
  return {
    path: resolved,
    exists: true,
    password: config.password || process.env.FULLY_KIOSK_PASSWORD || '',
    devices: Array.isArray(config.devices) ? config.devices : [],
  };
}

function matchFullyTargets(config, targets) {
  const wanted = new Set(targets.map((target) => target.device_id));
  return config.devices
    .filter((device) => wanted.has(device.device_id) || wanted.has(device.id))
    .map((device) => ({
      device_id: device.device_id || device.id,
      name: device.name || device.device_name || device.device_id || device.id,
      host: device.host || device.ip || device.base_url || '',
      password: device.password || config.password || '',
    }))
    .filter((device) => device.device_id && device.host && device.password);
}

function fullyBaseUrl(device) {
  const host = String(device.host || '').trim();
  if (!host) throw new Error(`Missing host for ${device.device_id}`);
  if (host.startsWith('http://') || host.startsWith('https://')) return host.replace(/\/$/, '');
  return `http://${host}:2323`;
}

async function fullyCmd(device, cmd, params = {}, args = {}) {
  const url = new URL(fullyBaseUrl(device));
  url.searchParams.set('cmd', cmd);
  url.searchParams.set('password', device.password);
  url.searchParams.set('type', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetchWithTimeout(url.toString(), { timeoutMs: args.timeoutMs || DEFAULT_TIMEOUT_MS });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_err) {}
  return { ok: response.ok, status: response.status, cmd, payload, text: payload ? undefined : text.slice(0, 500) };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function flattenKeys(value, prefix = '') {
  const keys = [];
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    keys.push({ key: full, leaf: key, value: child });
    if (child && typeof child === 'object' && !Array.isArray(child)) keys.push(...flattenKeys(child, full));
  }
  return keys;
}

function findAudioLockCandidates(settingsPayload) {
  const flattened = flattenKeys(settingsPayload);
  return flattened.filter(({ key }) => /volume|audio|mute|restriction|kiosk/i.test(key)).slice(0, 80);
}

async function runFullyChecks(devices, args) {
  const results = [];
  for (const device of devices) {
    const deviceResult = { device_id: device.device_id, name: device.name, commands: [] };
    try {
      const info = await fullyCmd(device, 'getDeviceInfo', {}, args);
      deviceResult.commands.push(info);
      const settings = await fullyCmd(device, 'listSettings', {}, args);
      deviceResult.commands.push({ ...settings, audio_lock_candidates: findAudioLockCandidates(settings.payload || {}) });
    } catch (error) {
      deviceResult.error = error.message;
    }
    results.push(deviceResult);
  }
  return results;
}

async function runFullyPopup(devices, args) {
  const results = [];
  const text = `Memphis popup test ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`;
  for (const device of devices) {
    const commands = [];
    try {
      commands.push(await fullyCmd(device, 'screenOn', {}, args));
      commands.push(await fullyCmd(device, 'toForeground', {}, args));
      commands.push(await fullyCmd(device, 'setOverlayMessage', { text }, args));
      commands.push(await fullyCmd(device, 'textToSpeech', { text: 'Memphis popup test. If you hear this, audio works.', queue: 0 }, args));
    } catch (error) {
      commands.push({ ok: false, error: error.message });
    }
    results.push({ device_id: device.device_id, name: device.name, commands });
  }
  return results;
}

async function setFullyVolumeOnce(devices, args) {
  const results = [];
  for (const device of devices) {
    const commands = [];
    try {
      for (const stream of args.fullyStreams) {
        commands.push(await fullyCmd(device, 'setAudioVolume', { level: args.fullyVolume, stream }, args));
      }
      if (args.fullyApplyLockSettings) {
        const settings = await fullyCmd(device, 'listSettings', {}, args);
        const candidates = findAudioLockCandidates(settings.payload || {});
        const booleanCandidates = candidates
          .filter(({ leaf, value }) => typeof value === 'boolean' && /(disable.*volume|volume.*button|mute.*audio|audio.*mute|adjust.*volume|volume.*lock)/i.test(leaf))
          .map(({ leaf }) => leaf);
        for (const key of booleanCandidates) {
          commands.push(await fullyCmd(device, 'setBooleanSetting', { key, value: true }, args));
        }
        const restrictionCandidates = candidates
          .filter(({ leaf, value }) => typeof value === 'string' && /restriction/i.test(leaf))
          .map(({ leaf, value }) => ({ key: leaf, value }));
        for (const candidate of restrictionCandidates) {
          if (!String(candidate.value).includes('no_adjust_volume')) {
            const separator = String(candidate.value).trim() ? '\n' : '';
            commands.push(await fullyCmd(device, 'setStringSetting', { key: candidate.key, value: `${candidate.value}${separator}no_adjust_volume` }, args));
          }
        }
      }
    } catch (error) {
      commands.push({ ok: false, error: error.message });
    }
    results.push({ device_id: device.device_id, name: device.name, level: args.fullyVolume, streams: args.fullyStreams, commands });
  }
  return results;
}

async function enforceFullyVolume(devices, args) {
  const rounds = [];
  const endAt = Date.now() + Math.max(0, args.fullyEnforceSeconds) * 1000;
  let round = 0;
  do {
    round += 1;
    rounds.push({ round, at: new Date().toISOString(), results: await setFullyVolumeOnce(devices, args) });
    if (!args.fullyEnforceSeconds || Date.now() >= endAt) break;
    await sleep(Math.max(1, args.fullyIntervalSeconds) * 1000);
  } while (Date.now() < endAt);
  return rounds;
}

function summarizeCommand(command) {
  const status = command.ok ? 'ok' : 'FAIL';
  const extra = command.error ? ` error=${command.error}` : command.status ? ` http=${command.status}` : '';
  return `${command.cmd || 'cmd'}:${status}${extra}`;
}

function printHumanReport(report) {
  console.log(`\nMemphis device popup/Fully Kiosk test report`);
  console.log(`run_id: ${report.run_id}`);
  if (report.cleanup) console.log(`cleanup: marked ${report.cleanup.deleted_count} popup-test message(s) deleted`);
  console.log(`targets: ${report.targets.length}`);
  for (const target of report.targets) {
    console.log(`- ${target.device_id}: ${target.display_name} (${target.role})`);
  }
  if (report.popup_sent?.length) {
    console.log('\nPopup test messages sent:');
    for (const row of report.popup_sent) console.log(`- ${row.device_id}: message=${row.message_id || 'unknown'} thread=${row.thread_id}`);
  }
  if (report.api_verify?.length) {
    console.log('\nDevice reminder API visibility:');
    for (const row of report.api_verify) {
      console.log(`- ${row.device_id}: api=${row.ok ? 'ok' : 'FAIL'} visible_test_message=${row.visible_test_message} unread_count=${row.unread_count}${row.error ? ` error=${row.error}` : ''}`);
    }
  }
  if (report.fully_config) {
    console.log(`\nFully config: ${report.fully_config.path} exists=${report.fully_config.exists} matched_devices=${report.fully_config.matched_devices}`);
  }
  if (report.fully_check?.length) {
    console.log('\nFully check:');
    for (const device of report.fully_check) {
      const commands = device.commands?.map(summarizeCommand).join(', ') || device.error || 'no commands';
      console.log(`- ${device.device_id}: ${commands}`);
      const candidates = device.commands?.flatMap((cmd) => cmd.audio_lock_candidates || []) || [];
      if (candidates.length) {
        console.log(`  audio/volume/mute setting candidates: ${candidates.slice(0, 10).map((x) => x.leaf).join(', ')}${candidates.length > 10 ? ' ...' : ''}`);
      }
    }
  }
  if (report.fully_popup?.length) {
    console.log('\nFully overlay/TTS popup commands:');
    for (const device of report.fully_popup) console.log(`- ${device.device_id}: ${(device.commands || []).map(summarizeCommand).join(', ')}`);
  }
  if (report.fully_volume?.length) {
    console.log('\nFully volume set/enforcement:');
    for (const round of report.fully_volume) {
      console.log(`round ${round.round} at ${round.at}`);
      for (const device of round.results) console.log(`- ${device.device_id}: ${(device.commands || []).map(summarizeCommand).join(', ')}`);
    }
  }
  if (report.notes?.length) {
    console.log('\nNotes:');
    for (const note of report.notes) console.log(`- ${note}`);
  }
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = { run_id: args.runId, targets: [], notes: [] };
  const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const needsSupabaseWrite = Boolean(args.cleanupRunId || args.sendPopup);
  if (needsSupabaseWrite && !hasSupabaseEnv) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --send-popup-test or --cleanup-run-id. Dry-run can use the built-in fallback device list.');
  }
  const supabase = hasSupabaseEnv ? createSupabaseAdminClient() : null;

  if (args.cleanupRunId) {
    const deleted = await cleanupRun(supabase, args.cleanupRunId);
    report.cleanup = { run_id: args.cleanupRunId, deleted_count: deleted.length, message_ids: deleted.map((row) => row.id) };
  }

  let allRows;
  if (supabase) {
    allRows = await loadDeviceRows(supabase);
  } else {
    allRows = FALLBACK_DEVICE_ROWS;
    report.notes.push('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY were not loaded; using the built-in fallback device list for dry-run/fully-config matching only.');
  }
  const targets = filterTargets(allRows, args);
  report.targets = targets;

  if (!targets.length) throw new Error('No target devices matched.');

  if (args.dryRun && !args.sendPopup) {
    report.notes.push('Dry run only. Add --send-popup-test to create live reminder messages. Add Fully flags to hit phone Remote Admin.');
  }

  if (args.sendPopup) {
    report.popup_sent = await sendPopupTests(supabase, targets, args);
    if (args.verifyApi) report.api_verify = await verifyDeviceReminderApi(targets, args);
  }

  if (args.fullyCheck || args.fullyPopup || args.fullyLockVolume) {
    const fullyConfig = loadFullyConfig(args.fullyConfig);
    const fullyDevices = matchFullyTargets(fullyConfig, targets);
    report.fully_config = { path: fullyConfig.path, exists: fullyConfig.exists, matched_devices: fullyDevices.length };
    if (!fullyConfig.exists) report.notes.push('Fully config file not found, so Remote Admin commands were skipped. Create the local JSON file shown in --help.');
    if (fullyConfig.exists && fullyDevices.length !== targets.length) {
      const matched = new Set(fullyDevices.map((device) => device.device_id));
      const missing = targets.filter((target) => !matched.has(target.device_id)).map((target) => target.device_id);
      report.notes.push(`Fully config missing host/password entries for: ${missing.join(', ')}`);
    }
    if (args.fullyCheck && fullyDevices.length) report.fully_check = await runFullyChecks(fullyDevices, args);
    if (args.fullyPopup && fullyDevices.length) report.fully_popup = await runFullyPopup(fullyDevices, args);
    if (args.fullyLockVolume && fullyDevices.length) report.fully_volume = await enforceFullyVolume(fullyDevices, args);
  }

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
