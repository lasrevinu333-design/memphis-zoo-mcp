import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, openSync, writeFileSync, closeSync, realpathSync, statSync, constants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import express from 'express';
import { createEventsAdminRouter, createEventsEmployeeRouter } from '../src/events-api.js';

const fixturePath = process.argv[2] === '--fixture-output' && process.argv.length === 4 ? process.argv[3] : '';
if (!fixturePath || !isAbsolute(fixturePath)) throw new Error('Pass --fixture-output with a new absolute caller-owned file path.');
const fixtureParent = dirname(fixturePath);
if (realpathSync(fixtureParent) !== fixtureParent || !statSync(fixtureParent).isDirectory()) {
  throw new Error('Fixture parent must be an existing real directory, not a symlink.');
}

const EVENT_ID = '81000000-0000-4000-8000-000000000003';
const OPERATION_ID = '81000000-0000-4000-8000-000000000004';
const VENUE_ID = '81000000-0000-4000-8000-000000000005';
const GROUP_ID = '81000000-0000-4000-8000-000000000006';
const MANAGER_ID = '81000000-0000-4000-8000-000000000007';
const EMPLOYEE_ID = '81000000-0000-4000-8000-000000000008';
const COUNT = 237;
const GATE_COUNT = 1409; // Distinct current zoo gate entries; never copied into Event attendance.
const EVENT_DATE = '2099-09-14';
const PRIVATE_NOTE = 'Manager-only staffing source details must not reach employee Events.';
const group = { location_group_id: GROUP_ID, group_code: 'EVENT_CENTER', group_name: 'Event Center',
  included_locations: ['Event Center'], eligible_event_venue: true, eligible_event_scope: false,
  eligible_custodial_coverage: true, eligible_staffing_assignment: true, public_restroom: false,
  staff_restroom: false };
const venue = { venue_id: VENUE_ID, venue_code: 'EVENT_CENTER', display_name: 'Event Center',
  event_scope: 'SINGLE_VENUE', location_group_id: GROUP_ID, group_code: group.group_code,
  group_name: group.group_name, eligible_event_venue: true, eligible_event_scope: false,
  aliases: ['Event Center'], active: true };
const sqlReads = [];
const writes = [];
let saved = null;
const runReadOnlySql = async (sql) => {
  const query = String(sql);
  sqlReads.push(query);
  if (/from public\.location_groups lg/i.test(query)) return [group];
  if (/from public\.event_venues ev/i.test(query) && !/from public\.events_app_events e/i.test(query)) return [venue];
  if (/custodial_place_event_venue_overlay/i.test(query)) return [{ overlay: { venues: [{
    venue_id: VENUE_ID, mapping_status: 'UNMAPPED', event_eligible: true,
    capability_authority: 'LEGACY_UNMAPPED', raw_legacy: { venue_code: 'EVENT_CENTER' },
  }] } }];
  if (/from public\.event_default_rules edr/i.test(query)) return [];
  if (/from public\.events_app_events e/i.test(query)) return saved ? [{ ...saved }] : [];
  throw new Error(`Unexpected synthetic read shape: ${query.slice(0, 120)}`);
};
const runCommand = async (name, payload) => {
  assert.equal(name, 'event_create', 'only the existing typed Event command may save');
  assert.equal(saved, null, 'one candidate only');
  assert.equal(payload.record.actor_manager_id, MANAGER_ID);
  assert.equal(payload.record.attendee_count, COUNT);
  assert.equal(payload.record.operation_id, OPERATION_ID);
  assert.equal(payload.record.status, 'SCHEDULED');
  assert.equal(payload.record.needs_review, false);
  assert.equal(payload.record.primary_venue_id, VENUE_ID);
  writes.push({ name, record: payload.record });
  saved = { ...payload.record, id: EVENT_ID, revision: 1, event_title: payload.record.event_name,
    venue_name: 'Event Center', group_name: 'Event Center', event_timezone: 'America/Chicago',
    created_at: '2026-10-03T12:00:00Z', updated_at: '2026-10-03T12:00:00Z' };
  return [saved];
};
const app = express();
app.use(express.json());
const managerAuth = (req, res, next) => {
  if (req.get('x-test-manager-session') !== 'named-manager') return res.status(401).json({ ok: false, error: 'named manager required' });
  req.memphisAuth = { manager_id: MANAGER_ID, manager_display_name: 'Fixture Manager' };
  next();
};
app.use('/admin-api/events', createEventsAdminRouter({
  runReadOnlySql, runCommand, buildHealthPayload: () => ({}), appVersion: 'att003-fixture',
  releaseId: 'synthetic', maintenanceController: { kick() {} },
  requireAdminApiAuth: managerAuth, requireAdminApiWrite: managerAuth,
}));
app.use('/employee-events-api', createEventsEmployeeRouter({
  runReadOnlySql, appVersion: 'att003-fixture', releaseId: 'synthetic',
  requireDeviceAccess: (req, res, next) => {
    if (req.get('x-test-device-credential') !== 'enrolled-current-employee') {
      return res.status(401).json({ ok: false, error: 'enrolled device required' });
    }
    req.memphisDevice = { canonical_device_id: 'KIOSK_08', assigned_employee_id: EMPLOYEE_ID, assignment_epoch: 7 };
    req.memphisDeviceCredential = { credential_id: 'fixture-credential-kiosk-08' };
    next();
  },
}));

const server = await new Promise((ok) => { const listener = app.listen(0, '127.0.0.1', () => ok(listener)); });
let savedReply, managerReply, employeeReply;
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { event_name: 'Attendance Authority Fixture', event_scope: 'SINGLE_VENUE',
    primary_venue_id: VENUE_ID, venue_ids: [VENUE_ID], location_group_id: GROUP_ID,
    event_date: EVENT_DATE, start_time: '10:00', end_time: '11:00',
    attendee_count: String(COUNT), notes: PRIVATE_NOTE, custodial_public_notes: 'Bring trash boxes.',
    operation_id: OPERATION_ID };
  const deniedSave = await fetch(`${base}/admin-api/events/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(deniedSave.status, 401);
  assert.equal(writes.length, 0);
  const save = await fetch(`${base}/admin-api/events/`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-manager-session': 'named-manager' }, body: JSON.stringify(body) });
  assert.equal(save.status, 200);
  savedReply = await save.json();
  assert.equal(savedReply.ok, true);
  assert.equal(savedReply.data.id, EVENT_ID);
  assert.equal(savedReply.data.revision, 1);
  assert.equal(savedReply.data.attendee_count, COUNT);
  assert.equal(writes.length, 1);

  const deniedManagerRead = await fetch(`${base}/admin-api/events/`);
  assert.equal(deniedManagerRead.status, 401);
  const managerRead = await fetch(`${base}/admin-api/events/`, { headers: { 'x-test-manager-session': 'named-manager' } });
  assert.equal(managerRead.status, 200);
  managerReply = await managerRead.json();
  assert.equal(managerReply.ok, true);
  assert.equal(managerReply.data.length, 1);
  assert.equal(managerReply.data[0].id, EVENT_ID);
  assert.equal(managerReply.data[0].revision, 1);
  assert.equal(managerReply.data[0].attendee_count, COUNT);
  assert.equal(managerReply.data[0].notes, PRIVATE_NOTE);

  const deniedEmployeeRead = await fetch(`${base}/employee-events-api?window_days=30`);
  assert.equal(deniedEmployeeRead.status, 401);
  const employeeRead = await fetch(`${base}/employee-events-api?window_days=30`, {
    headers: { 'x-test-device-credential': 'enrolled-current-employee' },
  });
  assert.equal(employeeRead.status, 200);
  employeeReply = await employeeRead.json();
  assert.equal(employeeReply.ok, true);
  assert.equal(employeeReply.data.length, 1);
  assert.equal(employeeReply.data[0].id, EVENT_ID);
  assert.equal(employeeReply.data[0].attendee_count, COUNT);
  assert.equal(employeeReply.data[0].notes, 'Bring trash boxes.');
  assert.equal('revision' in employeeReply.data[0], false, 'current narrow employee Event projection omits revision');
  assert.equal('created_by' in employeeReply.data[0], false);
  assert.equal(JSON.stringify(employeeReply).includes(PRIVATE_NOTE), false);
  assert.equal(employeeReply.meta.employee_id, EMPLOYEE_ID);
  assert.equal(employeeReply.meta.assignment_epoch, 7);
  assert.equal(employeeRead.headers.get('cache-control'), 'private, no-store');
  assert.equal(sqlReads.filter((sql) => /from public\.events_app_events e/i.test(sql)).length, 2);
  assert.ok(sqlReads.some((sql) => /coalesce\(e\.status, 'SCHEDULED'\) in \('SCHEDULED', 'CANCELLED', 'SUPERSEDED'\)/i.test(sql)
    && /place\.authority->>'admissible'/i.test(sql)), 'employee query keeps current admission predicate');
  assert.equal(COUNT === GATE_COUNT, false, 'Event expected count is not the current zoo gate count');
} finally {
  await new Promise((ok, fail) => server.close((error) => error ? fail(error) : ok()));
}

const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const fixture = {
  schema: 'att003-event-count-synthetic-route-fixture.v1',
  provenance: { synthetic: true, actual_express_routes: true, real_database: false, live_provider: false,
    authorization: 'injected named-manager and enrolled-device middleware',
    sql: 'mocked stateful read and typed command; admission predicate inspected, not executed by PostgreSQL',
    browser_transport: 'to be mocked by the consuming Playwright test',
    backend_source_sha256: hash(resolve(import.meta.dirname, '../src/events-api.js')),
    producer_script_sha256: hash(new URL(import.meta.url)),
  },
  identity: { event_id: EVENT_ID, event_revision: 1, expected_guests: COUNT,
    separate_home_gate_entries: GATE_COUNT, employee_id: EMPLOYEE_ID, device_id: 'KIOSK_08' },
  accepted_save: savedReply.data,
  manager_read: managerReply.data,
  employee_read: employeeReply.data,
  employee_meta: employeeReply.meta,
};
// No default path, no overwrite, and no symlink target. Caller owns the parent.
const fd = openSync(fixturePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
try { writeFileSync(fd, `${JSON.stringify(fixture, null, 2)}\n`); } finally { closeSync(fd); }
console.log(JSON.stringify({ status: 'ATT003_SYNTHETIC_ROUTE_PASS', event_id: EVENT_ID, revision: 1,
  expected_guests: COUNT, separate_gate_entries: GATE_COUNT, writes: writes.length,
  fixture_path: fixturePath, fixture_sha256: hash(fixturePath), database: false, browser: false }));
