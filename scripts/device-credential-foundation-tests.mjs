import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateDeviceCredentialRequest,
  deviceCredentialInternals,
  installDeviceCredentialRoutes,
  makeDeviceCredentialMiddleware,
} from "../src/auth/device-credential-auth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => {
  const current = path.join(root, name);
  if (fs.existsSync(current)) return fs.readFileSync(current, "utf8");
  return fs.readFileSync(current.replace("/supabase/migrations/", "/supabase/legacy_migrations/"), "utf8");
};
// NEW opt-in actual installed SDK -> shipping coverage only. Fetch responses
// are synthetic transport data; this does NOT establish DB/role/auth authority.
if (process.argv.includes('--current-roster-sdk-coverage-only') || process.argv.includes('--current-roster-sdk-wrapper-only')) {
  const wrapped = process.argv.includes('--current-roster-sdk-wrapper-only');
  const { createDeviceCoverageFetch } = wrapped ? await import('../src/auth/device-credential-auth.js') : {};
  const { createClient } = await import('@supabase/supabase-js');
  const { createHash } = await import('node:crypto');
  const dependencyRoot = fs.realpathSync(path.join(root, 'node_modules'));
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const pins = {
    sdk: '265765df0ffc6fa0f1280ef8e907e49ef535a70f43d31d1a1dc75cb87f2d321c',
    postgrest: 'afda25f52b6722f40f70f845fa1569b0b978c23d3e92eb9e453327751b78c00e',
    auth: wrapped ? '28f2e1a6155fa5e954f5b5a099503e8315f2efc7c3ddfa5a0a4d66459a2e9310'
      : 'ba3933ace7270204ad7085d6cf60c9b5b41946f3d42ce859fe8621c8abcf7e0e',
  };
  const lock = JSON.parse(fs.readFileSync(path.join(path.dirname(dependencyRoot), 'package-lock.json'), 'utf8'));
  for (const name of ['supabase-js', 'postgrest-js']) {
    const version = JSON.parse(fs.readFileSync(path.join(dependencyRoot, '@supabase', name, 'package.json'), 'utf8')).version;
    assert.equal(version, '2.110.7'); assert.equal(lock.packages[`node_modules/@supabase/${name}`].version, version);
    assert.equal(hash(path.join(dependencyRoot, '@supabase', name, 'dist/index.mjs')), name === 'supabase-js' ? pins.sdk : pins.postgrest);
  }
  assert.equal(hash(path.join(root, 'src/auth/device-credential-auth.js')), pins.auth);
  if (wrapped) assert.equal(hash(path.join(root, 'src/index.js')), '1687f754d35ea10b7c172775b58de7445149dcf67659988e57270260bdf38f92');
  const now = new Date('2026-10-13T18:00:00.000Z');
  const id = n => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tables = ['employees', 'devices', 'device_auth_credentials'];
  const fixture = () => {
    const employees = Array.from({ length: 9 }, (_, index) => ({ id: id(index + 1), employee_code: `EMP${String(index + 1).padStart(3, '0')}`,
      display_name: `Synthetic SDK worker ${index + 1}`, role: 'staff', active: index < 6 }));
    const devices = employees.map((employee, index) => ({ id: id(20 + index), device_id: `KIOSK_${String(index + 2).padStart(2, '0')}`,
      device_name: `Synthetic SDK position ${index + 1}`, active: index < 6, assigned_employee_id: index < 6 ? employee.id : null,
      employees: index < 6 ? { ...employee } : null }));
    const device_auth_credentials = devices.slice(0, 6).map((device, index) => ({ credential_id: id(40 + index), device_id: device.id,
      confirmed_at: '2026-10-12T12:00:00Z', expires_at: '2027-10-13T12:00:00Z', revoked_at: null }));
    return { employees, devices, device_auth_credentials, headers: {}, denied: null, calls: [], observed: null,
      responses: [], cancelled: [] };
  };
  function sdk(source) {
    return createClient('https://synthetic-sdk-coverage.invalid', 'synthetic-unit-key-not-an-authenticated-admin', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (wrapped ? createDeviceCoverageFetch : fetch => fetch)(async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
        assert.equal(url.origin, 'https://synthetic-sdk-coverage.invalid');
        const table = url.pathname.replace('/rest/v1/', ''); assert.ok(tables.includes(table));
        assert.equal(init.method, 'GET'); const requestHeaders = new Headers(init.headers);
        assert.equal(requestHeaders.get('prefer'), 'count=exact');
        // Capture only nonsecret query/count metadata, never key/auth headers.
        const call = { table, method: init.method, path: url.pathname, query: Object.fromEntries(url.searchParams), prefer: requestHeaders.get('prefer') };
        source.calls.push(call);
        if (source.denied === table) return new Response(JSON.stringify({ code: '42501', message: 'synthetic table reader denied', details: null, hint: null }),
          { status: 403, headers: { 'Content-Type': 'application/json' } });
        const rows = source[table], count = Array.isArray(rows) ? rows.length : 9;
        const range = Object.hasOwn(source.headers, table) ? source.headers[table] : count ? `0-${count - 1}/${count}` : '*/0';
        call.content_range = range; const headers = { 'Content-Type': 'application/json' };
        if (range !== null) headers['Content-Range'] = range;
        const bytes = new TextEncoder().encode(JSON.stringify(rows));
        const body = wrapped ? new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); },
          cancel() { source.cancelled.push(table); } }) : JSON.stringify(rows);
        const response = new Response(body, { status: 200, headers }); source.responses.push(response); return response;
      }) },
    });
  }
  const cases = [];
  if (wrapped) {
    // Real SDK consumes the shipping terminal400 as a PostgREST error object,
    // not a retryable thrown fetch Error. No SDK retry settings are changed.
    const invalidCount = failure => failure?.code === 'custodial_coverage_invalid_count_header'
      && failure.message === 'Current coverage roster/registry/credential read is unavailable or incomplete (invalid exact-count header).'
      && failure.details === null && failure.hint === null;
    cases.push(['wrapperActualSdkValidCoverage', async source => {
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now });
      assert.equal(coverage.required_total, 6); assert.equal(coverage.ready, 6); assert.equal(coverage.ready_to_enforce, true);
      assert.deepEqual(coverage.devices.slice(6).map(row => row.coverage_required), [false, false, false]);
      assert.deepEqual(source.calls.map(call => call.table), tables); assert.deepEqual(source.cancelled, []);
      assert.deepEqual(source.responses.map(response => response.headers.get('content-range')), ['0-8/9', '0-8/9', '0-5/6']);
    }]);
    for (const table of tables) cases.push([`wrapperNumericPrefix_${table}`, async source => {
      const count = source[table].length; source.headers[table] = `0-${count - 1}/${count}junk`;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now }), invalidCount);
      assert.deepEqual(source.calls.map(call => call.table), tables.slice(0, tables.indexOf(table) + 1));
      assert.deepEqual(source.cancelled, [table]); // ONE bad-table GET; no retry/fallback.
      assert.equal(source.responses.at(-1).headers.get('content-range'), source.headers[table], 'no header repair');
      assert.equal(source.responses.at(-1).bodyUsed, true);
    }]);
    for (const [name, range] of [['decimal', '0-8/9.5'], ['extraSlash', '0-8/9/extra'], ['leadingZero', '0-8/09'],
      ['unsafeTotal', '0-8/9007199254740992'], ['malformedRange', 'oops/9']]) cases.push([`wrapperRawHeader_${name}`, async source => {
      source.headers.employees = range;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now }), invalidCount);
      assert.deepEqual(source.calls.map(call => call.table), ['employees']);
      assert.deepEqual(source.cancelled, ['employees']); assert.equal(source.responses[0].headers.get('content-range'), range);
    }]);
    cases.push(['wrapperActualSdkMissingCountStillRefuses', async source => {
      source.headers.employees = null;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now }), /unavailable or incomplete/);
      assert.deepEqual(source.cancelled, []); // Not repaired/minted by the wrapper.
    }]);
    cases.push(['wrapperTerminal400CancellationAndStaticCleanupUnknown', async () => {
      for (const throws of [false, true]) {
        let cancellations = 0, successfulCleanup = 0, requests = 0;
        const privateMarker = 'SYNTHETIC_PRIVATE_CONTEXT_NOT_FOR_ERROR_RESPONSE';
        const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(privateMarker)); },
          cancel() { cancellations++; if (throws) throw new Error(privateMarker); successfulCleanup++; } }), { headers: { 'Content-Range': '0-8/9junk' } });
        const fetch = createDeviceCoverageFetch(async () => { requests++; return response; });
        const terminal = await fetch('https://synthetic-sdk-coverage.invalid/rest/v1/employees', { method: throws ? 'HEAD' : 'GET', headers: { Prefer: 'count=exact' } });
        assert.equal(requests, 1); assert.equal(cancellations, 1); assert.equal(successfulCleanup, throws ? 0 : 1);
        assert.notEqual(terminal, response); assert.equal(terminal.status, 400); assert.equal(terminal.headers.get('content-range'), null);
        assert.equal(response.headers.get('content-range'), '0-8/9junk'); assert.equal(response.bodyUsed, true);
        const raw = await terminal.text(), error = JSON.parse(raw);
        assert.deepEqual(Object.keys(error).sort(), ['code', 'details', 'hint', 'message']);
        assert.equal(error.code, 'custodial_coverage_invalid_count_header');
        assert.equal(error.message, 'Current coverage roster/registry/credential read is unavailable or incomplete (invalid exact-count header).');
        assert.equal(error.details, throws ? 'Original response cleanup could not be confirmed.' : null); assert.equal(error.hint, null);
        assert.equal(raw.includes(privateMarker), false); // Neither rows nor secret-bearing raw cleanup context.
      }
    }]);
    cases.push(['wrapperOtherPurposesKeepOriginalResponse', async () => {
      for (const [method, pathname, prefer, status] of [['POST', 'employees', 'count=exact', 200], ['GET', 'other', 'count=exact', 200],
        ['GET', 'employees', 'count=planned', 200], ['GET', 'employees', 'count=exact', 403]]) {
        let cancellations = 0;
        const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); },
          cancel() { cancellations++; } }), { status, headers: { 'Content-Range': '0-8/9junk' } });
        assert.equal(await createDeviceCoverageFetch(async () => response)(`https://synthetic-sdk-coverage.invalid/rest/v1/${pathname}`,
          { method, headers: { Prefer: prefer } }), response);
        assert.equal(cancellations, 0); assert.equal(response.headers.get('content-range'), '0-8/9junk'); await response.body.cancel();
      }
    }]);
    for (const name of ['summaryValid', 'summaryMalformed', 'modeMalformed']) cases.push([`wrapperInstalledHandler_${name}`, async source => {
      if (name !== 'summaryValid') source.headers.employees = '0-8/9junk';
      let ordinaryCalls = 0, policyWrites = 0, policyReads = 0, audits = 0;
      const ordinary = createClient('https://synthetic-sdk-coverage.invalid', 'synthetic-unit-key-not-authenticated', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async () => { ordinaryCalls++; throw new Error('ordinary auth SDK must not supply coverage'); } },
      });
      const store = { async getPolicy() { policyReads++; return { mode: 'enroll' }; },
        async setPolicy() { policyWrites++; throw new Error('policy write forbidden'); }, async auditAuthEvent() { audits++; } };
      const app = fakeApp(); installDeviceCredentialRoutes(app, { supabase: ordinary, coverageSupabase: sdk(source), store,
        requireOpsAuth: (_req, _res, next) => next(), requireOpsWrite: (_req, _res, next) => next() });
      const response = responseCapture(); const mode = name === 'modeMalformed';
      await app.routes.get(mode ? 'POST /admin-api/device-auth/mode' : 'GET /admin-api/device-auth/summary').at(-1)(mode ? { body: { mode: 'enforce' } } : {}, response);
      assert.equal(ordinaryCalls, 0); assert.equal(policyWrites, 0); assert.equal(audits, 0); assert.equal(policyReads, 1);
      if (name === 'summaryValid') {
        assert.equal(response.code, 200); assert.equal(response.payload.data.coverage.ready_to_enforce, true);
        assert.equal(response.payload.data.policy.mode, 'enroll');
      } else {
        assert.equal(response.code, 500); assert.equal(response.payload.ok, false); assert.match(response.payload.error, /invalid exact-count header/);
        assert.deepEqual(source.calls.map(call => call.table), ['employees']); assert.deepEqual(source.cancelled, ['employees']);
      }
    }]);
  } else {
  cases.push(['sdkSixEligibleThreeExplicitVacancies', async source => {
    const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now });
    assert.equal(coverage.total, 9); assert.equal(coverage.ready, 6); assert.equal(coverage.required_total, 6);
    assert.equal(coverage.ready_to_enforce, true); assert.deepEqual(coverage.missing, []);
    assert.deepEqual(coverage.devices.slice(6).map(row => row.coverage_required), [false, false, false]);
    assert.deepEqual(source.calls.map(call => call.table), tables);
    assert.equal(source.calls[0].query.select, 'id,employee_code,display_name,active,role'); assert.equal(source.calls[0].query.order, 'id.asc');
    assert.equal(source.calls[1].query.select, 'id,device_id,device_name,active,assigned_employee_id,employees!devices_assigned_employee_id_fkey(id,display_name,employee_code,active,role)');
    assert.equal(source.calls[1].query.order, 'device_id.asc');
    assert.equal(source.calls[2].query.select, 'credential_id,device_id,device_label,created_at,confirmed_at,last_used_at,expires_at,revoked_at,revoked_reason');
    assert.equal(source.calls[2].query.revoked_at, 'is.null'); assert.equal(source.calls[2].query.expires_at, `gt.${now.toISOString()}`);
  }]);
  for (const table of tables) for (const mode of ['omitted', 'unknown', 'nonnumeric', 'partial']) {
    cases.push([`sdkCount_${table}_${mode}`, async source => {
      const count = source[table].length;
      source.headers[table] = mode === 'omitted' ? null : mode === 'unknown' ? `0-${count - 1}/*`
        : mode === 'nonnumeric' ? `0-${count - 1}/not-a-number` : `0-${count - 1}/${count + 1}`;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now }), /unavailable or incomplete/);
      assert.deepEqual(source.calls.map(call => call.table), tables);
    }]);
  }
  for (const table of tables) cases.push([`sdkDenied_${table}`, async source => {
    source.denied = table;
    await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now }), failure => failure.code === '42501');
    assert.deepEqual(source.calls.map(call => call.table), tables.slice(0, tables.indexOf(table) + 1));
  }]);
  cases.push(['sdkUnknownRosterRefuses', async source => {
    source.employees = null;
    await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now }), /unavailable or incomplete/);
  }]);
  cases.push(['sdkZeroRosterNeverReady', async source => {
    source.employees = []; source.device_auth_credentials = [];
    for (const device of source.devices) { device.active = false; device.assigned_employee_id = null; device.employees = null; }
    const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now });
    assert.equal(coverage.required_total, 0); assert.equal(coverage.ready_to_enforce, false);
    assert.ok(coverage.coverage_issues.includes('no_current_eligible_employees'));
  }]);
  // A valid numeric prefix is still a malformed exact-count transport. Keep
  // this expectation red if the real SDK erases that distinction; no SDK shim
  // or shipping auth change is permitted by this test-only reservation.
  for (const table of tables) cases.push([`sdkMalformedNumericPrefix_${table}`, async source => {
    const count = source[table].length; source.headers[table] = `0-${count - 1}/${count}junk`;
    let refusal = null;
    try {
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: sdk(source), now });
      source.observed = { total: coverage.total, required_total: coverage.required_total, ready: coverage.ready, ready_to_enforce: coverage.ready_to_enforce };
    } catch (error) { refusal = error; }
    assert.ok(refusal, 'Malformed numeric-prefix Content-Range must not become complete coverage');
    assert.match(refusal.message, /unavailable or incomplete/);
  }]);
  }
  const selected = process.argv.find(value => value.startsWith('--current-roster-sdk-case='))?.slice('--current-roster-sdk-case='.length);
  const entries = cases.filter(([name]) => !selected || selected.split(',').includes(name)); assert.ok(entries.length);
  const passed = [];
  for (const [name, run] of entries) {
    const source = fixture();
    try { await run(source); passed.push(name); console.log(JSON.stringify({ name, status: 'PASS_SDK_SYNTHETIC_FETCH', requests: source.calls })); }
    catch (failure) {
      console.error(JSON.stringify({ name, status: 'FAIL_SDK_SYNTHETIC_FETCH', passed, failure: failure.message, observed: source.observed, requests: source.calls,
        limits: 'Real installed SDK with synthetic transport only; no DB, restricted role, current roster, authentication, policy or rollout proof.' }));
      process.exitCode = 1; break;
    }
  }
  assert.equal(hash(path.join(root, 'src/auth/device-credential-auth.js')), pins.auth);
  if (wrapped) assert.equal(hash(path.join(root, 'src/index.js')), '1687f754d35ea10b7c172775b58de7445149dcf67659988e57270260bdf38f92');
  console.log(JSON.stringify({ selector: wrapped ? '--current-roster-sdk-wrapper-only' : '--current-roster-sdk-coverage-only', sdk_version: '2.110.7', passed_count: passed.length,
    status: process.exitCode ? 'FAIL_RETAINED_PRODUCT_BOUNDARY' : 'PASS_SDK_SYNTHETIC_FETCH_ONLY', pins, limits: 'No old coverage/auth groups, network, listeners, real keys, role/DB or rollout qualification.' }));
  process.exit(process.exitCode || 0);
}
if (process.argv.includes('--current-roster-coverage-new-only') || process.argv.includes('--current-roster-mode-refusal-only')) {
  const now = new Date('2026-10-13T18:00:00.000Z');
  const id = n => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const fixture = () => {
    const employees = Array.from({ length: 9 }, (_, index) => ({ id: id(index + 1),
      employee_code: `EMP${String(index + 1).padStart(3, '0')}`, display_name: `Synthetic current worker ${index + 1}`,
      role: 'staff', active: index < 6 }));
    const devices = employees.map((employee, index) => ({ id: id(20 + index),
      device_id: `KIOSK_${String(index + 2).padStart(2, '0')}`, device_name: `Stable synthetic position ${index + 1}`,
      active: index < 6, assigned_employee_id: index < 6 ? employee.id : null,
      employees: index < 6 ? { ...employee } : null }));
    const credentials = devices.slice(0, 6).map((device, index) => ({ credential_id: id(40 + index),
      device_id: device.id, confirmed_at: '2026-10-12T12:00:00Z', expires_at: '2027-10-13T12:00:00Z', revoked_at: null }));
    return { employees, devices, device_auth_credentials: credentials, calls: [], errors: {}, counts: {} };
  };
  const client = source => ({ from(table) {
    const calls = source.calls; calls.push({ table });
    const filters = [];
    return {
      select(fields, options) { calls.at(-1).fields = fields; calls.at(-1).options = options; return this; },
      in(field, values) { filters.push(row => values.includes(row[field])); return this; },
      eq(field, value) { filters.push(row => row[field] === value); return this; },
      like(field, pattern) { assert.equal(pattern, 'EMP%'); filters.push(row => String(row[field] || '').startsWith('EMP')); return this; },
      is() { return this; }, gt() { return this; }, order() { return this; },
      then(resolve, reject) {
        const rows = source[table];
        const data = Array.isArray(rows) ? rows.filter(row => filters.every(filter => filter(row))) : rows;
        return Promise.resolve({ data, error: source.errors[table] || null,
          count: Object.hasOwn(source.counts, table) ? source.counts[table] : Array.isArray(data) ? data.length : null }).then(resolve, reject);
      },
    };
  } });
  const cases = {
    async sixActiveExplicitVacancies() {
      const source = fixture();
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      console.log(`NEW coverage actual function: fleet=${coverage.total} ready=${coverage.ready} enforce=${coverage.ready_to_enforce}`);
      assert.equal(coverage.total, 9); assert.equal(coverage.devices.length, 9); assert.equal(coverage.ready, 6);
      assert.equal(coverage.ready_to_enforce, true, 'All six current eligible assigned workers are confirmed; three explicit inactive/unassigned positions are diagnostic, not required phones');
      assert.deepEqual(coverage.missing, []);
      assert.equal(coverage.required_total, 6);
      assert.deepEqual(coverage.devices.slice(6).map(row => row.coverage_required), [false, false, false]);
    },
    async currentSeventhEmployeeRequiresItsOwnPhone() {
      const source = fixture(), employee = source.employees[6], device = source.devices[6];
      employee.active = true; device.active = true; device.assigned_employee_id = employee.id; device.employees = { ...employee };
      source.device_auth_credentials.push({ ...source.device_auth_credentials[0], credential_id: id(46), device_id: device.id });
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.required_total, 7); assert.equal(coverage.ready, 7); assert.equal(coverage.ready_to_enforce, true);
    },
    async normalEligibleOtherRoleNotSilentlyOmitted() {
      const source = fixture(); source.employees[0].role = 'supervisor'; source.devices[0].employees.role = 'supervisor';
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.required_total, 6); assert.equal(coverage.devices[0].coverage_required, true);
      assert.equal(coverage.ready_to_enforce, true, 'Coverage adds no role permission; it follows existing active EMP device eligibility');
    },
    async unassignedEligibleOtherRoleStillRequired() {
      const source = fixture(); source.employees[0].role = 'supervisor';
      source.devices[0].assigned_employee_id = null; source.devices[0].employees = null; source.devices[0].active = false;
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.required_total, 6); assert.equal(coverage.ready_to_enforce, false);
      assert.ok(coverage.coverage_issues.includes('active_employee_not_uniquely_assigned_to_active_canonical_device'));
    },
    async caseInsensitiveEligibleCodeNotHidden() {
      const source = fixture(); source.employees[6].active = true; source.employees[6].employee_code = 'emp007';
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.required_total, 7); assert.equal(coverage.ready_to_enforce, false);
    },
    async unrelatedNonEmployeeRosterRowGrantsNothing() {
      const source = fixture(); source.employees.push({ id: id(97), employee_code: null,
        display_name: 'Synthetic non-employee actor', role: 'manager', active: true });
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.required_total, 6); assert.equal(coverage.ready_to_enforce, true);
      assert.equal(coverage.devices.length, 9);
    },
    async zeroExpectedRosterNeverReady() {
      const source = fixture(); source.employees = [];
      for (const device of source.devices) { device.active = false; device.assigned_employee_id = null; device.employees = null; }
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.devices.length, 9); assert.equal(coverage.required_total, 0); assert.equal(coverage.ready_to_enforce, false);
      assert.ok(coverage.coverage_issues.includes('no_current_eligible_employees'));
    },
    async unavailableRosterRefuses() {
      const source = fixture(); source.employees = null;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now }), /unavailable or incomplete/);
    },
    async truncatedRosterRefuses() {
      const source = fixture(); source.counts.employees = 10;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now }), /unavailable or incomplete/);
    },
    async deniedRosterNoFallback() {
      const source = fixture(), error = new Error('synthetic intended roster reader denied'); source.errors.employees = error;
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now }), failure => failure === error);
      assert.deepEqual(source.calls.map(call => call.table), ['employees']);
    },
    async ambiguousRosterRefuses() {
      const source = fixture(); source.employees.push({ ...source.employees[0] });
      await assert.rejects(deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now }), /employee roster is ambiguous/);
    },
    async activeUnassignedPersonNotVacancy() {
      const source = fixture(); source.employees[6].active = true;
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.required_total, 7); assert.equal(coverage.ready_to_enforce, false);
      assert.ok(coverage.coverage_issues.includes('active_employee_not_uniquely_assigned_to_active_canonical_device'));
    },
    async noncanonicalActiveAssignmentRefuses() {
      const source = fixture(); source.devices[0].device_id = 'KIOSK_01';
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.ok(coverage.missing.includes('KIOSK_02'));
    },
    async conflictingAssignmentOutsideFleetRefuses() {
      const source = fixture(); source.devices.push({ ...source.devices[0], id: id(99), device_id: 'OTHER_SYNTHETIC_PHONE' });
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.equal(coverage.devices[0].assignment_valid, false);
    },
    async missingVacantRegistryNotAssumedVacancy() {
      const source = fixture(); source.devices.pop();
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.devices.length, 9); assert.equal(coverage.ready, 6); assert.equal(coverage.ready_to_enforce, false);
      assert.equal(coverage.devices[8].registry_present, false); assert.ok(coverage.missing.includes('KIOSK_10'));
    },
    async joinedEligibilityChangedRefuses() {
      const source = fixture(); source.devices[0].employees.active = false;
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.equal(coverage.devices[0].assignment_valid, false);
    },
    async revokedCredentialNotConfirmedCoverage() {
      const source = fixture(); source.device_auth_credentials[0].revoked_at = '2026-10-13T17:00:00Z';
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.equal(coverage.devices[0].confirmed, false);
      assert.ok(coverage.missing.includes('KIOSK_02'));
    },
    async expiredCredentialNotCoverage() {
      const source = fixture(); source.device_auth_credentials[0].expires_at = '2026-10-13T17:00:00Z';
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.equal(coverage.devices[0].enrolled, false);
    },
    async unconfirmedCredentialNotCoverage() {
      const source = fixture(); source.device_auth_credentials[0].confirmed_at = null;
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.equal(coverage.devices[0].enrolled, true);
      assert.equal(coverage.devices[0].ready, false);
    },
    async missingCredentialRefuses() {
      const source = fixture(); source.device_auth_credentials.shift();
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.ok(coverage.missing.includes('KIOSK_02'));
    },
    async ambiguousCurrentCredentialRefuses() {
      const source = fixture(); source.device_auth_credentials.push({ ...source.device_auth_credentials[0], credential_id: id(98) });
      const coverage = await deviceCredentialInternals.activeDeviceCoverage({ supabase: client(source), now });
      assert.equal(coverage.ready_to_enforce, false); assert.ok(coverage.coverage_issues.includes('active_device_credential_conflict'));
    },
    async modeRefusesUnassignedRosterWithExplicitReasonAndNoPolicyWrite() {
      const source = fixture(); source.employees[6].active = true;
      const app = fakeApp(); let writes = 0;
      const store = { async getPolicy() { return { mode: 'enroll' }; },
        async setPolicy() { writes++; throw new Error('Policy writes forbidden in refusal fixture'); } };
      installDeviceCredentialRoutes(app, { supabase: client(source), store,
        requireOpsAuth: (_req, _res, next) => next(), requireOpsWrite: (_req, _res, next) => next() });
      const response = responseCapture();
      await app.routes.get('POST /admin-api/device-auth/mode').at(-1)({ body: { mode: 'enforce' } }, response);
      assert.equal(response.code, 409); assert.equal(writes, 0);
      assert.equal(response.payload.required_total, 7); assert.deepEqual(response.payload.missing_devices, []);
      assert.ok(response.payload.coverage_issues.includes('active_employee_not_uniquely_assigned_to_active_canonical_device'));
      assert.match(response.payload.error, /Current eligible employees/);
      assert.doesNotMatch(response.payload.error, /nine/);
    },
    async modeRefusesRevokedCredentialWithoutPolicyWrite() {
      const source = fixture(); source.device_auth_credentials[0].revoked_at = '2026-10-13T17:00:00Z';
      const app = fakeApp(); let writes = 0;
      const store = { async getPolicy() { return { mode: 'enroll' }; },
        async setPolicy() { writes++; throw new Error('Policy writes forbidden in refusal fixture'); } };
      installDeviceCredentialRoutes(app, { supabase: client(source), store,
        requireOpsAuth: (_req, _res, next) => next(), requireOpsWrite: (_req, _res, next) => next() });
      const response = responseCapture();
      await app.routes.get('POST /admin-api/device-auth/mode').at(-1)({ body: { mode: 'enforce-ready' } }, response);
      assert.equal(response.code, 409); assert.equal(writes, 0);
      assert.equal(response.payload.required_total, 6); assert.deepEqual(response.payload.missing_devices, ['KIOSK_02']);
      assert.match(response.payload.error, /Current eligible employees/);
    },
    async actualSummaryHandlerUsesCurrentCoverage() {
      const source = fixture(), app = fakeApp(), store = { async getPolicy() { return { mode: 'enroll' }; } };
      installDeviceCredentialRoutes(app, { supabase: client(source), store,
        requireOpsAuth: (_req, _res, next) => next(), requireOpsWrite: (_req, _res, next) => next() });
      const response = responseCapture();
      await app.routes.get('GET /admin-api/device-auth/summary').at(-1)({}, response);
      assert.equal(response.code, 200); assert.equal(response.payload.data.coverage.ready_to_enforce, true);
      assert.equal(response.payload.data.coverage.required_total, 6); assert.equal(response.payload.data.coverage.devices.length, 9);
      assert.equal(response.payload.data.policy.mode, 'enroll', 'Read-only summary does not activate policy');
    },
  };
  const selected = process.argv.find(value => value.startsWith('--current-roster-coverage-case='))?.split('=')[1];
  const entries = Object.entries(cases).filter(([name]) => (!selected || name === selected)
    && (!process.argv.includes('--current-roster-mode-refusal-only') || name.startsWith('modeRefuses')));
  assert.ok(entries.length, 'Unknown current-roster coverage case');
  for (const [name, run] of entries) { await run(); console.log(`NEW current-roster coverage ${name} PASS (source/synthetic query fixture only)`); }
  process.exit(0);
}

const env = {
  NODE_ENV: "production",
  RENDER: "true",
  DEVICE_CREDENTIAL_SECRET: "device-credential-foundation-test-secret",
  DEVICE_CREDENTIAL_TTL_DAYS: "3650",
};
const currentSecretKeyId = deviceCredentialInternals.deviceCredentialSecretKeyId(env);
assert.match(currentSecretKeyId, /^[0-9a-f]{64}$/);
assert.notEqual(
  currentSecretKeyId,
  deviceCredentialInternals.deviceCredentialSecretKeyId({ ...env, DEVICE_CREDENTIAL_SECRET: "rotated-device-credential-foundation-secret" }),
  "a secret rotation must produce a distinct non-secret key generation identity",
);
assert.deepEqual(deviceCredentialInternals.deviceCredentialSecretMetadata(env), {
  credential_secret_contract: "device-credential-hmac.v1",
  credential_secret_key_id: currentSecretKeyId,
});
for (const wrongSecretClass of [
  { NODE_ENV: "production", OPS_MANAGER_SESSION_SECRET: "manager-secret-is-not-a-device-secret" },
  { NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "service-role-is-not-a-device-secret" },
]) {
  assert.throws(
    () => deviceCredentialInternals.tokenHash("presented-device-token", wrongSecretClass),
    /dedicated device credential secret is not configured/i,
    "another secret class must never substitute for DEVICE_CREDENTIAL_SECRET",
  );
}
const deviceA = {
  requested_device_id: "KIOSK_06",
  matched_by: "canonical",
  canonical_device_pk: "11111111-1111-4111-8111-111111111111",
  canonical_device_id: "KIOSK_06",
  device_id: "KIOSK_06",
  device_name: "Kinnaye Peete",
  device_active: true,
  assigned_employee_id: "22222222-2222-4222-8222-222222222222",
  assigned_employee_name: "Kinnaye Peete",
  employee_code: "EMP005",
  role: "staff",
  employee_active: true,
  assignment_valid: true,
  assignment_epoch: 7,
};
const deviceB = {
  ...deviceA,
  requested_device_id: "KIOSK_07",
  canonical_device_pk: "33333333-3333-4333-8333-333333333333",
  canonical_device_id: "KIOSK_07",
  device_id: "KIOSK_07",
};
const managerDevice = {
  requested_device_id: "KIOSK_01",
  matched_by: "alias",
  canonical_device_pk: "77777777-7777-4777-8777-777777777777",
  canonical_device_id: "1e74fe4c-dc20b3b9",
  device_id: "1e74fe4c-dc20b3b9",
  device_name: "Custodial Phone 1",
  device_active: true,
  assigned_employee_id: null,
  assigned_employee_name: null,
  employee_code: null,
  employee_active: false,
  assignment_valid: false,
};

function request({ deviceId = "KIOSK_06", cookie = "", authorization = "", body = {}, query = {} } = {}) {
  const headers = {
    "x-device-id": deviceId,
    cookie,
    authorization,
    "user-agent": "Device Credential Test",
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-proto": "https",
  };
  return {
    body: { ...body }, query: { ...query }, headers, ip: "127.0.0.1", secure: true,
    header(name) { return headers[String(name).toLowerCase()] || ""; },
  };
}

function resolver(sql) {
  const upper = String(sql).toUpperCase();
  if (upper.includes("KIOSK_01") || upper.includes("1E74FE4C-DC20B3B9")) return [managerDevice];
  if (upper.includes("KIOSK_07")) return [deviceB];
  if (upper.includes("KIOSK_06")) return [deviceA];
  return [];
}

function storeFor({ mode = "enroll", credential = null } = {}) {
  const auditEvents = [];
  const touches = [];
  const consumeCalls = [];
  return {
    auditEvents,
    touches,
    consumeCalls,
    async getPolicy() { return { mode, updated_at: null, updated_by: null }; },
    async findCredential() { return credential; },
    async touchCredential(credentialId, patch) { touches.push({ credentialId, patch }); },
    async audit(event) { auditEvents.push(event); },
    async consumeEnrollmentCode(args) { consumeCalls.push(args); return { ok: true, ...args, expires_at: args.expiresAt }; },
    async issueEnrollmentCode(args) { return { enrollment_id: "44444444-4444-4444-8444-444444444444", device_id: args.devicePk, expires_at: args.expiresAt }; },
    async revokeCredential() { return null; },
    async revokeByTokenHash() { return null; },
    async setPolicy(nextMode) { mode = nextMode; return { mode }; },
  };
}

let result = await authenticateDeviceCredentialRequest(request(), { env, store: storeFor({ mode: "enroll" }), runReadOnlySql: resolver });
assert.equal(result.ok, true);
assert.equal(result.legacy, true);
assert.equal(result.enrollment_required, true);

result = await authenticateDeviceCredentialRequest(request(), { env, store: storeFor({ mode: "observe" }), runReadOnlySql: resolver });
assert.equal(result.ok, true);
assert.equal(result.enrollment_required, false);

result = await authenticateDeviceCredentialRequest(request(), {
  env,
  store: storeFor({ mode: "observe" }),
  runReadOnlySql: resolver,
  requireEnrolledCredential: true,
});
assert.equal(result.ok, false, "personal employee services must not treat observe mode as authorization");
assert.equal(result.status, 401);
assert.equal(result.code, "device_credential_required");
assert.equal(result.enrollment_required, true);

result = await authenticateDeviceCredentialRequest(request({ deviceId: "KIOSK_01" }), { env, store: storeFor({ mode: "enroll" }), runReadOnlySql: resolver });
assert.equal(result.ok, false);
assert.equal(result.code, "device_not_eligible");
assert.equal(deviceCredentialInternals.isEligibleEmployeeDevice(managerDevice), false);
assert.equal(deviceCredentialInternals.isEligibleEmployeeDevice(deviceA), true);

result = await authenticateDeviceCredentialRequest(request(), { env, store: storeFor({ mode: "enforce" }), runReadOnlySql: resolver });
assert.equal(result.ok, false);
assert.equal(result.code, "device_credential_required");
assert.equal(result.status, 401);

const credentialId = "55555555-5555-4555-8555-555555555555";
const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-";
const credential = {
  credential_id: credentialId,
  device_id: deviceA.canonical_device_pk,
  token_hash: deviceCredentialInternals.tokenHash(secret, env),
  created_at: "2026-07-15T20:00:00.000Z",
  last_used_at: "2026-07-15T20:00:00.000Z",
  expires_at: "2036-07-15T20:00:00.000Z",
  revoked_at: null,
};
const cookie = `memphis_device_credential=${credentialId}.${secret}`;
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env, store: storeFor({ mode: "enforce", credential }), runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, true);
assert.equal(result.credentialed, true);
assert.equal(result.device.canonical_device_id, "KIOSK_06");

const legacyCredentialStore = storeFor({ mode: "enforce", credential });
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env, store: legacyCredentialStore, runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, true);
assert.equal(
  legacyCredentialStore.touches.at(-1)?.patch?.metadata_json?.credential_secret_key_id,
  currentSecretKeyId,
  "a successfully proven legacy credential must be stamped with the current secret generation",
);

const recentlyUsedLegacyCredentialStore = storeFor({
  mode: "enforce",
  credential: { ...credential, last_used_at: "2026-07-15T20:59:00.000Z" },
});
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env, store: recentlyUsedLegacyCredentialStore, runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, true);
assert.equal(recentlyUsedLegacyCredentialStore.touches.length, 1,
  "generation stamping must bypass the ordinary last-used write throttle");
assert.equal(
  recentlyUsedLegacyCredentialStore.touches[0].patch.metadata_json.credential_secret_key_id,
  currentSecretKeyId,
  "a recently used proven credential must become release-ready immediately",
);

const rotatedEnv = { ...env, DEVICE_CREDENTIAL_SECRET: "rotated-device-credential-foundation-secret" };
const previousGenerationCredential = {
  ...credential,
  metadata_json: deviceCredentialInternals.deviceCredentialSecretMetadata(env),
};
const rotatedStore = storeFor({ mode: "enforce", credential: previousGenerationCredential });
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env: rotatedEnv, store: rotatedStore, runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, false);
assert.equal(result.code, "device_credential_recovery_required");
assert.equal(result.recovery_required, true);
assert.match(result.error, /Saved work remains on this phone/i);
assert.equal(rotatedStore.auditEvents.at(-1)?.reason, "credential_secret_generation_mismatch");

const readinessRows = [{
  credential_id: credentialId,
  device_id: deviceA.canonical_device_pk,
  confirmed_at: "2026-07-15T20:01:00.000Z",
  expires_at: "2036-07-15T20:00:00.000Z",
  revoked_at: null,
  metadata_json: deviceCredentialInternals.deviceCredentialSecretMetadata(env),
}];
assert.deepEqual(
  deviceCredentialInternals.evaluateDeviceCredentialSecretReadiness(readinessRows, env, new Date("2026-07-15T21:00:00.000Z")),
  {
    contract_version: "device-credential-secret-readiness.v1",
    ready: true,
    active_credentials: 1,
    confirmed_credentials: 1,
    unconfirmed_credentials: 0,
    matching_credentials: 1,
    unmarked_credentials: 0,
    mismatched_credentials: 0,
    reason: "credential_secret_generation_current",
  },
);
assert.equal(
  deviceCredentialInternals.evaluateDeviceCredentialSecretReadiness(
    [{ ...readinessRows[0], confirmed_at: null }], env, new Date("2026-07-15T21:00:00.000Z"),
  ).ready,
  false,
  "an unconfirmed credential must not satisfy canary credential readiness",
);
assert.equal(
  deviceCredentialInternals.evaluateDeviceCredentialSecretReadiness(
    [{ ...readinessRows[0], metadata_json: {} }], env, new Date("2026-07-15T21:00:00.000Z"),
  ).ready,
  false,
  "an unmarked active credential must block exact secret cutover admission",
);
assert.equal(
  deviceCredentialInternals.evaluateDeviceCredentialSecretReadiness(
    readinessRows, rotatedEnv, new Date("2026-07-15T21:00:00.000Z"),
  ).mismatched_credentials,
  1,
  "an active credential from another secret generation must be detected before canary admission",
);

const enrollmentOperationId = "56565656-5656-4565-8565-565656565656";
const operationCredential = {
  ...credential,
  confirmed_at: null,
  metadata_json: {
    enrollment_operation_id: enrollmentOperationId,
    enrollment_flow: "enrollment",
  },
};
const unconfirmedOperationStore = storeFor({ mode: "enforce", credential: operationCredential });
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env, store: unconfirmedOperationStore, runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, false, "an operation-bound credential must not auto-confirm through an ordinary employee request");
assert.equal(result.status, 409);
assert.equal(result.code, "device_enrollment_confirmation_required");
assert.equal(unconfirmedOperationStore.touches.length, 0, "ordinary auth must not persist confirmation for an operation-bound credential");
assert.equal(unconfirmedOperationStore.auditEvents.at(-1)?.reason, "enrollment_operation_unconfirmed");

const confirmedOperationStore = storeFor({
  mode: "enforce",
  credential: { ...operationCredential, confirmed_at: "2026-07-15T20:59:00.000Z" },
});
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env, store: confirmedOperationStore, runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, true, "the explicit confirmation boundary must activate the same credential");
assert.equal(result.credentialed, true);

result = await authenticateDeviceCredentialRequest(request({ deviceId: "KIOSK_07", cookie }), {
  env, store: storeFor({ mode: "enforce", credential }), runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, false);
assert.equal(result.code, "device_credential_required");

assert.equal(deviceCredentialInternals.credentialTokenParts("not-a-token"), null);
assert.equal(deviceCredentialInternals.credentialTokenParts(`${credentialId}.${secret}`)?.credentialId, credentialId);
assert.equal(deviceCredentialInternals.requestDeviceIdentifier(request({ body: { args: { p_device_identifier: "kiosk-6" } }, deviceId: "" })), "KIOSK_06");

let middlewareNext = false;
let middlewareStatus = 200;
let middlewarePayload = null;
const middleware = makeDeviceCredentialMiddleware({ env, store: storeFor({ mode: "enroll" }), runReadOnlySql: resolver });
await middleware(request(), {
  setHeader() {},
  status(code) { middlewareStatus = code; return this; },
  json(payload) { middlewarePayload = payload; return this; },
}, () => { middlewareNext = true; });
assert.equal(middlewareNext, true);
assert.equal(middlewareStatus, 200);
assert.equal(middlewarePayload, null);

let strictMiddlewareNext = false;
let strictMiddlewareStatus = 200;
let strictMiddlewarePayload = null;
const strictEmployeeMiddleware = makeDeviceCredentialMiddleware({
  env,
  store: storeFor({ mode: "observe" }),
  runReadOnlySql: resolver,
  requireEnrolledCredential: true,
});
await strictEmployeeMiddleware(request(), {
  setHeader() {},
  status(code) { strictMiddlewareStatus = code; return this; },
  json(payload) { strictMiddlewarePayload = payload; return this; },
}, () => { strictMiddlewareNext = true; });
assert.equal(strictMiddlewareNext, false, "identifier-only employee access must fail even while rollout policy observes");
assert.equal(strictMiddlewareStatus, 401);
assert.equal(strictMiddlewarePayload.code, "device_credential_required");
assert.equal(strictMiddlewarePayload.enrollment_required, true);

let strictCredentialedNext = false;
const strictCredentialedMiddleware = makeDeviceCredentialMiddleware({
  env,
  store: storeFor({ mode: "observe", credential }),
  runReadOnlySql: resolver,
  requireEnrolledCredential: true,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
await strictCredentialedMiddleware(request({ cookie }), {
  setHeader() {},
  status() { throw new Error("a valid enrolled credential must not be rejected"); },
  json() { throw new Error("a valid enrolled credential must not return an error body"); },
}, () => { strictCredentialedNext = true; });
assert.equal(strictCredentialedNext, true, "a valid enrolled credential must retain employee access in observe mode");

const strictIndexSource = read("src/index.js");
assert.match(
  strictIndexSource,
  /const requireEmployeeDeviceCredential = makeDeviceCredentialMiddleware\(\{[\s\S]*?requireEnrolledCredential:\s*true,[\s\S]*?\}\);/,
  "every operational employee route must share the strict enrolled-phone middleware",
);

let unconfirmedMiddlewareNext = false;
let unconfirmedMiddlewareStatus = 200;
let unconfirmedMiddlewarePayload = null;
const unconfirmedEmployeeMiddleware = makeDeviceCredentialMiddleware({
  env,
  store: storeFor({ mode: "enforce", credential: operationCredential }),
  runReadOnlySql: resolver,
});
await unconfirmedEmployeeMiddleware(request({ cookie }), {
  setHeader() {},
  status(code) { unconfirmedMiddlewareStatus = code; return this; },
  json(payload) { unconfirmedMiddlewarePayload = payload; return this; },
}, () => { unconfirmedMiddlewareNext = true; });
assert.equal(unconfirmedMiddlewareNext, false, "employee and push-registration routes must not run before explicit confirmation");
assert.equal(unconfirmedMiddlewareStatus, 409);
assert.equal(unconfirmedMiddlewarePayload.code, "device_enrollment_confirmation_required");

function fakeApp() {
  const routes = new Map();
  return {
    routes,
    use() {},
    get(pathname, ...handlers) { routes.set(`GET ${pathname}`, handlers); },
    post(pathname, ...handlers) { routes.set(`POST ${pathname}`, handlers); },
  };
}
function responseCapture() {
  const headers = {};
  return {
    code: 200, payload: null, headers,
    append(name, value) { headers[String(name).toLowerCase()] = value; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return headers[String(name).toLowerCase()]; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.code = code; return this; },
  };
}
const app = fakeApp();
const routeStore = storeFor({ mode: "enroll" });
installDeviceCredentialRoutes(app, {
  env,
  store: routeStore,
  supabase: {},
  runReadOnlySql: resolver,
  requireOpsAuth: (_req, _res, next) => next(),
  requireOpsWrite: (_req, _res, next) => next(),
});
assert.ok(app.routes.has("GET /device-auth/status"));
assert.ok(app.routes.has("POST /device-auth/enroll"));
assert.ok(app.routes.has("POST /device-auth/logout"));
assert.ok(app.routes.has("GET /admin-api/device-auth/summary"));

const statusHandler = app.routes.get("GET /device-auth/status").at(-1);
const statusRes = responseCapture();
await statusHandler(request({ deviceId: "KIOSK_06" }), statusRes);
assert.equal(statusRes.code, 200);
assert.equal(statusRes.payload.data.authenticated, false);
assert.equal(statusRes.payload.data.employee_name, null, "unenrolled status must not disclose employee identity");
assert.equal(statusRes.payload.data.employee_id, null, "unenrolled status must not disclose employee identifiers");
assert.equal(statusRes.payload.data.assignment_epoch, null, "unenrolled status must not disclose assignment generation");
assert.equal(statusRes.payload.data.employee_role, null, "unenrolled status must not disclose employee role");
assert.equal(statusRes.payload.data.device_name, null, "unenrolled status must not disclose device labels");

const authenticatedStatusRes = responseCapture();
routeStore.findCredential = async () => credential;
await statusHandler(request({ cookie }), authenticatedStatusRes);
assert.equal(authenticatedStatusRes.code, 200);
assert.equal(authenticatedStatusRes.payload.data.employee_name, "Kinnaye Peete");
assert.equal(authenticatedStatusRes.payload.data.employee_id, deviceA.assigned_employee_id, "authenticated status supplies its own assigned employee for identity-bound offline feedback");
assert.equal(authenticatedStatusRes.payload.data.employee_role, "staff");
assert.equal(authenticatedStatusRes.payload.data.assignment_epoch, 7, "native principal captures the authenticated assignment generation as an integer");
assert.equal(authenticatedStatusRes.payload.data.credential_id, credential.credential_id, "native principal must bind the actual credential, not caller data");

const logoutHandler = app.routes.get("POST /device-auth/logout").at(-1);
const logoutWithoutHeader = responseCapture();
await logoutHandler(request({ deviceId: "" }), logoutWithoutHeader);
assert.equal(logoutWithoutHeader.code, 400, "logout must require the preflight-protected X-Device-Id header");

routeStore.revokeByTokenHash = async () => { throw new Error("injected durable revocation failure"); };
const failedLogout = responseCapture();
await logoutHandler(request({ cookie }), failedLogout);
assert.equal(failedLogout.code, 503, "local credential removal must wait for durable server revocation");
assert.equal(failedLogout.payload.code, "device_logout_failed");

const enrollHandler = app.routes.get("POST /device-auth/enroll").at(-1);
const enrollRes = responseCapture();
await enrollHandler(request({ body: { enrollment_code: "12345678", device_id: "KIOSK_06" } }), enrollRes);
assert.equal(enrollRes.code, 200);
assert.equal(enrollRes.payload.ok, true);
assert.equal(Object.hasOwn(enrollRes.payload.data, "token"), false, "raw device credential must never enter JSON");
assert.match(String(enrollRes.headers["set-cookie"]), /HttpOnly/);
assert.match(String(enrollRes.headers["set-cookie"]), /Secure/);
assert.match(String(enrollRes.headers["set-cookie"]), /SameSite=None/);
assert.match(String(enrollRes.headers["set-cookie"]), /Partitioned/);
assert.match(String(enrollRes.headers["set-cookie"]), /Max-Age=315360000/);
assert.equal(routeStore.consumeCalls.at(-1)?.metadata?.credential_secret_key_id, currentSecretKeyId,
  "new credentials must record their exact secret generation");

const migration = read("supabase/migrations/20260715213000_device_credential_foundation.sql");
for (const table of ["device_auth_policy", "device_auth_credentials", "device_auth_enrollment_codes", "device_auth_events"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
}
assert.match(migration, /device_auth_issue_enrollment_code/);
assert.match(migration, /device_auth_consume_enrollment_code/);
assert.match(migration, /failed_attempts = v_failed_attempts/);
assert.match(migration, /return jsonb_build_object\('ok',false,'reason','invalid_or_expired'\)/);
assert.match(migration, /one_active_per_device/);
assert.match(migration, /confirmed_at timestamptz null/);
assert.match(migration, /metadata_json, confirmed_at, last_used_at, expires_at/);

const moduleSource = read("src/auth/device-credential-auth.js");
assert.match(moduleSource, /Array\.from\(\{ length: 9 \}/);
assert.match(moduleSource, /ready_to_enforce/);
assert.match(moduleSource, /Current eligible employees must each have a uniquely assigned, confirmed kiosk/);
assert.match(moduleSource, /app\.use\("\/admin-api\/device-auth", deviceRouteCors\)/);
assert.match(moduleSource, /An active canonical employee kiosk assignment is required/);
assert.match(moduleSource, /device_credential_confirmed/);
assert.match(moduleSource, /X-Device-Id is required/);
assert.doesNotMatch(moduleSource, /res\.status\(200\).*rawToken/s);
assert.doesNotMatch(moduleSource, /env\.OPS_MANAGER_SESSION_SECRET|env\.SUPABASE_SERVICE_ROLE_KEY/,
  "device credential HMAC authority must not fall back to another secret class");
assert.match(moduleSource, /device_credential_recovery_required/);
assert.match(moduleSource, /credential_secret_cutover_incomplete/);

const indexSource = read("src/index.js");
assert.match(indexSource, /installDeviceCredentialRoutes/);
assert.match(indexSource, /getDeviceCredentialSecretReadiness/);
assert.match(indexSource, /device_credential_secret:\s*deviceCredentialSecret/);
assert.match(indexSource, /parseScanAuthorityJsonBeforeAuthentication, requireDeviceOrOpsAccess, rejectInvalidAuthenticatedScanAuthorityJson, requireScanRpcAuthorization, scanRpcRateLimit/);
assert.match(indexSource, /deferJsonParserErrors/);
assert.match(indexSource, /X-Device-Credential/);
assert.match(indexSource, /X-Device-Label/);
assert.match(indexSource, /Access-Control-Expose-Headers", "X-Device-Enrollment-Required, Retry-After"/);
assert.match(indexSource, /sessionId is required/);
assert.match(indexSource, /Unknown or expired SSE session/);
assert.doesNotMatch(indexSource, /entries\[entries\.length - 1\]/);

const messaging = read("src/messaging-api.js");
assert.match(messaging, /requireDeviceAccess/);
assert.match(messaging, /requireWritableDeviceOrOpsAuth/);
assert.match(messaging, /router\.post\("\/thread\/direct", requireWritableDeviceOrOpsAuth/);
assert.match(messaging, /Read-only Ops Manager access cannot modify Messenger/);

const schedule = read("src/schedule-api.js");
assert.match(schedule, /requirePersonalScheduleAccess/);
assert.match(schedule, /router\.get\("\/my-day", requireEmployeeDevice/);
assert.match(schedule, /router\.get\("\/my-day-summary", requirePersonalScheduleAccess/);
assert.match(schedule, /router\.get\("\/my-schedule", requirePersonalScheduleAccess/);

const mcpAuth = read("src/auth/mcp-connector-auth.js");
assert.doesNotMatch(mcpAuth, /authenticateOpsAccessRequest|open_ops_manager/);

console.log("DEVICE_CREDENTIAL_FOUNDATION_TESTS_PASS");
