import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Actual shipping factories/registered callbacks. Recording app/request/response
// facilities do not bind a socket or replace auth, raw parsing or store guards.
// Signed sessions, authoritative rows and RPC responses are SYNTHETIC ONLY.
const joinedManagerSqlOnly = process.argv.includes('--joined-manager-sql-new');
if (!joinedManagerSqlOnly) {
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = process.argv[2];
assert.ok(backend && path.isAbsolute(backend), 'absolute source backend required');
const pins = {
  'src/auth/same-original-recovery-manager-auth.js': 'a547368fc59b8c55a01f8eb82693b4342a46cdf73a1ac32a3ea4a3b50c80c20d',
  'src/same-original-recovery-store.js': 'b7ebe12eea60f3d115da9ed9ee7fae8368671c8455b98be67d7aceb957b8e4d4',
  'src/same-original-recovery-routes.js': '2fa23d5c14200ddc66cab14c5ae34f6ad353bd03c54fb4ee8af248a3e0fe2ce2',
  'src/manager-original-recovery-approval.js': '622571d4ac00dc850b3aaac86d815fcaf00fbd2fe3967869a2cdeab1deec115d',
  'src/same-original-recovery-wire.js': 'dc79e4f3a7f137c5ea159b1f2b909e864378497c67259f862c27cc9e233335cb',
};
for (const [name, digest] of Object.entries(pins)) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(backend, name))).digest('hex'), digest, name);
}
const compositionUrl = pathToFileURL(root + '/src/same-original-recovery-manager-composition.js').href;
const hook = registerHooks({resolve(specifier, context, next) {
  if (context.parentURL === compositionUrl && specifier.startsWith('./'))
    return next(pathToFileURL(path.join(backend, 'src', specifier)).href, context);
  return next(specifier, context);
}});
const {installSameOriginalRecoveryManagerComposition: install} = await import(compositionUrl);
hook.deregister();
const wire = await import(pathToFileURL(backend + '/src/same-original-recovery-wire.js'));
const {createOpsManagerSession} = await import(pathToFileURL(backend + '/src/auth/shared-access-auth.js'));
const id = n => '95000000-0000-4000-8000-' + String(n).padStart(12, '0');
const base = '/admin-api/device-security/same-original-recovery';
const confirm = base + '/approvals', status = confirm + '/original-status', review = base + '/challenges/' + id(2);

// Same synthetic signed session/registry fixture fields as the existing
// manager-auth test and exact wire DTO shapes from the existing store test.
function fixture() {
  const env = {NODE_ENV: 'production', OPS_MANAGER_AUTH_REQUIRED: 'true',
    OPS_MANAGER_SESSION_SECRET: 'synthetic-new-recovery-manager-session-secret-01',
    DEVICE_CREDENTIAL_SECRET: 'synthetic-new-recovery-security-cookie-secret-02'};
  const now = Date.now(), secret = 'synthetic-cookie-secret-32-characters-long', csrf = 'synthetic-csrf-secret-32-characters-long';
  const hash = (purpose, value) => createHmac('sha256', env.DEVICE_CREDENTIAL_SECRET).update(purpose + ':' + value).digest('hex');
  const manager = {manager_id: id(40), display_name: 'Synthetic Owner', system_key: 'eric_custodial_manager',
    is_system_principal: false, roles: ['CUSTODIAL_MANAGER', 'SECURITY_ADMIN'], active: true, revoked_at: null};
  const credential = {credential_id: id(41), device_id: 'manager-fixture', manager_id: manager.manager_id, manager,
    max_access_level: 'full_access', created_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 86400000).toISOString(), revoked_at: null};
  const config = {password_hash: 'x'.repeat(64), password_version: 1, sessions_revoked_at: null};
  const securitySession = {session_id: id(42), manager_id: manager.manager_id, credential_id: credential.credential_id,
    password_version: 1, token_hash: hash('device-security-session', secret), csrf_hash: hash('device-security-csrf', csrf),
    created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 900000).toISOString(), revoked_at: null};
  const signed = createOpsManagerSession({credentialId: credential.credential_id, deviceId: credential.device_id,
    manager, authMode: 'trusted_device', accessLevel: 'full_access', maximumAccessLevel: 'full_access', env});
  const headers = {authorization: 'Bearer ' + signed.token,
    cookie: 'memphis_device_security_session=' + securitySession.session_id + '.' + secret, 'x-device-security-csrf': csrf};
  const issuer = {manager_id: manager.manager_id, manager_credential_id: credential.credential_id, manager_device_id: credential.device_id};
  const target = Object.fromEntries(wire.recoveryTargetFields.map(key => [key,
    ['operation_id', 'separation_id', 'canonical_device_pk', 'employee_id', 'credential_id', 'original_generation_id'].includes(key) ? id(1) :
    ['assignment_epoch', 'separation_authority_revision'].includes(key) ? '7' : key === 'engine_revision' ? '0' :
    key === 'canonical_device_id' ? 'KIOSK_08' : 'a'.repeat(64)]));
  const preview = {schema: 'custodial.same-original-recovery-review.v1', state: 'ORIGINAL_BINDING_REVIEW_ONLY',
    purpose: wire.recoveryPreparationPurpose, challenge_id: id(2), challenge_sha256: 'b'.repeat(64),
    preview_sha256: 'a'.repeat(64), original_target: target, expires_at: '2026-10-14T00:05:00.000000Z',
    limits: {...wire.recoveryDeniedEffects}};
  preview.preview_sha256 = wire.recoveryDocumentSha256('preview', preview);
  const original = {schema: 'custodial.same-original-recovery-approval-request.v1', request_id: id(3), challenge_id: id(2),
    expected_challenge_sha256: preview.challenge_sha256, expected_preview_sha256: preview.preview_sha256,
    expected_manager_id: issuer.manager_id, expected_manager_credential_id: issuer.manager_credential_id,
    expected_manager_device_id: issuer.manager_device_id, decision: wire.recoveryPreparationPurpose,
    manager_confirmation: 'CONFIRM_THIS_SAME_ORIGINAL_ONLY'};
  const receipt = {schema: 'custodial.same-original-recovery-approval-receipt.v1', state: 'APPROVAL_RECORDED_ONLY',
    approval_id: id(4), original_request: original, original_request_sha256: wire.recoveryDocumentSha256('request', original),
    issuer, challenge_sha256: preview.challenge_sha256, preview_sha256: preview.preview_sha256, original_target: target,
    purpose_admission_id: wire.recoveryPreparationAdmission, issued_at: '2026-10-14T00:00:00.000000Z',
    expires_at: preview.expires_at, receipt_sha256: 'a'.repeat(64), retry_safe: false, limits: {...wire.recoveryDeniedEffects}};
  receipt.receipt_sha256 = wire.recoveryDocumentSha256('receipt', receipt);
  const calls = [], registrations = [], rows = [];
  const trustedDeviceStore = {async find() { return structuredClone(credential); }};
  const securityStore = {async getManager() { return structuredClone(manager); },
    async getDeviceSecurityConfig() { return structuredClone(config); },
    async findDeviceSecuritySession() { return structuredClone(securitySession); }};
  const db = {async rpc(name, args) {
    calls.push({name, args});
    return {data: JSON.stringify(name.endsWith('preview_v1') ? preview : receipt), error: null};
  }};
  const app = Object.fromEntries(['use', 'get', 'post'].map(method => [method, (...args) => registrations.push({method, args})]));
  const dependencies = {env, trustedDeviceStore, securityStore, db};
  let installed;
  function mount() { return installed = install(app, dependencies); }
  async function invoke(kind, raw = Buffer.from('\n ' + JSON.stringify(original, null, 2) + '\t'), changedHeaders = {}) {
    const req = new EventEmitter(), res = new EventEmitter();
    const url = kind === 'preview' ? review : kind === 'confirm' ? confirm : status;
    Object.assign(req, {method: kind === 'preview' ? 'GET' : 'POST', originalUrl: url, url, path: url,
      params: {challengeId: id(2)}, headers: {...headers,
        ...(kind === 'preview' ? {} : {'content-type': 'application/json', 'content-length': String(raw.length)}), ...changedHeaders}});
    Object.assign(res, {statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; this.writableEnded = true; return this; }, end() { this.writableEnded = true; }});
    const row = {req, res}; rows.push(row);
    let next = false;
    registrations.find(entry => entry.method === 'use').args[0](req, res, () => { next = true; });
    if (next) {
      const method = kind === 'preview' ? 'get' : 'post', registeredPath = kind === 'preview' ? installed.paths.preview : url;
      const callback = registrations.find(entry => entry.method === method && entry.args[0] === registeredPath).args[1];
      if (kind === 'preview') await callback(req, res);
      else {
        callback(req, res);
        if (!res.writableEnded) {
          req.emit('data', raw);
          const onEnd = req.listeners('end')[0];
          if (onEnd) await onEnd.call(req);
        }
      }
    }
    assert.equal(req.scanAuthorityRawBody, undefined); assert.equal(req.body, undefined);
    assert.equal(req.listenerCount('data'), 0); assert.equal(req.listenerCount('aborted'), 0);
    assert.equal(req.listenerCount('end'), 0); assert.equal(res.listenerCount('close'), 0);
    return res;
  }
  return {env, manager, credential, config, securitySession, headers, issuer, preview, original, receipt,
    dependencies, calls, registrations, rows, db, mount, invoke};
}

const cases = [];
async function test(name, body) {
  const only = process.argv.find(value => value.startsWith('--only='))?.slice(7);
  if (only && name !== only) return;
  try { await body(); cases.push({name, passed: true}); console.log('PASS ' + name); }
  catch (error) { cases.push({name, passed: false, error: error.code ?? error.name});
    console.error('FAIL ' + name + ' ' + (error.code ?? error.name));
    if (typeof error.actual === 'number' && typeof error.expected === 'number')
      console.error(JSON.stringify({actual_status: error.actual, expected_status: error.expected}));
    process.exitCode = 1; }
}
const unknown = res => { assert.equal(res.body.outcome, 'UNKNOWN'); assert.equal(res.body.retry_safe, false);
  assert.deepEqual(res.body.limits, wire.recoveryDeniedEffects); };

await test('COMPOSITION_NEW preview uses actual signed auth private issuer store and read route', async () => {
  const f = fixture(), installed = f.mount();
  assert.deepEqual(Object.keys(installed).sort(), ['maxRequestBytes', 'paths', 'receiveDeadlineMs']);
  assert.ok(Object.isFrozen(installed)); assert.ok(Object.isFrozen(installed.paths));
  assert.equal(installed.maxRequestBytes, 8192); assert.equal(installed.receiveDeadlineMs, 30000);
  const res = await f.invoke('preview'); assert.equal(res.statusCode, 200); assert.deepEqual(res.body.data, f.preview);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'custodial_same_original_preparation_preview_v1');
  assert.equal(f.calls[0].args.p_manager, f.manager.manager_id); assert.equal(f.calls[0].args.p_security_session, f.securitySession.session_id);
});
await test('COMPOSITION_NEW exact confirm preserves raw bytes and original private auth binding', async () => {
  const f = fixture(); f.mount();
  const raw = Buffer.from('\n ' + JSON.stringify(Object.fromEntries(Object.entries(f.original).reverse()), null, 2) + '\t');
  const res = await f.invoke('confirm', raw); assert.equal(res.statusCode, 200); assert.deepEqual(res.body.data, f.receipt);
  assert.deepEqual(f.calls.map(row => row.name), ['custodial_same_original_preparation_preview_v1', 'custodial_same_original_preparation_issue_v1']);
  const args = f.calls[1].args; assert.equal(args.p_original_utf8, raw.toString('utf8'));
  assert.equal(args.p_credential, f.credential.credential_id); assert.equal(args.p_device, f.credential.device_id);
  assert.match(args.p_signed_sha, /^[a-f0-9]{64}$/); assert.ok(Object.isFrozen(args));
});
await test('COMPOSITION_NEW lost issue reply exact status reads only no writer retry', async () => {
  const f = fixture(); f.mount(); let saved = null;
  f.db.rpc = async (name, args) => {
    f.calls.push({name, args});
    if (name.endsWith('preview_v1')) return {data: JSON.stringify(f.preview)};
    if (name.endsWith('issue_v1')) { saved = args.p_original_utf8; throw Error('SYNTHETIC_COMMIT_LOST_REPLY'); }
    return {data: args.p_original_utf8 === saved ? JSON.stringify(f.receipt) : null};
  };
  const raw = Buffer.from('\n ' + JSON.stringify(f.original, null, 2) + '\t');
  const lost = await f.invoke('confirm', raw); assert.equal(lost.statusCode, 503); unknown(lost);
  const statusReply = await f.invoke('status', raw); assert.equal(statusReply.statusCode, 200); assert.deepEqual(statusReply.body.data, f.receipt);
  const changedRaw = await f.invoke('status', Buffer.from(JSON.stringify(f.original))); assert.equal(changedRaw.statusCode, 503); unknown(changedRaw);
  assert.equal(f.calls.filter(row => row.name.endsWith('issue_v1')).length, 1);
  assert.equal(f.calls.filter(row => row.name.endsWith('status_v1')).length, 2);
  assert.equal(f.calls[2].args.p_original_utf8, saved);
});
await test('COMPOSITION_NEW revoked credential after preview await cannot issue', async () => {
  const f = fixture(); f.mount();
  f.db.rpc = async (name, args) => { f.calls.push({name, args}); f.credential.revoked_at = new Date().toISOString(); return {data: JSON.stringify(f.preview)}; };
  const res = await f.invoke('confirm'); assert.equal(res.statusCode, 401); unknown(res);
  assert.deepEqual(f.calls.map(row => row.name), ['custodial_same_original_preparation_preview_v1']);
});
await test('COMPOSITION_NEW owner changes after issue await remain unknown never accepted', async () => {
  const f = fixture(); f.mount();
  f.db.rpc = async (name, args) => {
    f.calls.push({name, args});
    if (name.endsWith('issue_v1')) { f.credential.manager_id = id(90); f.manager.manager_id = id(90); }
    return {data: JSON.stringify(name.endsWith('preview_v1') ? f.preview : f.receipt)};
  };
  const res = await f.invoke('confirm'); assert.equal(res.statusCode, 503); unknown(res);
  assert.equal(f.calls.filter(row => row.name.endsWith('issue_v1')).length, 1);
});
await test('COMPOSITION_NEW CSRF and password mismatch refuse before any writer or preview RPC', async () => {
  for (const type of ['csrf', 'password']) {
    const f = fixture(); f.mount(); if (type === 'password') f.config.password_version = 2;
    const res = await f.invoke('confirm', undefined, type === 'csrf' ? {'x-device-security-csrf': 'SYNTHETIC_WRONG'} : {});
    assert.equal(res.statusCode, type === 'csrf' ? 403 : 401); unknown(res); assert.equal(f.calls.length, 0);
  }
});
await test('COMPOSITION_NEW current readonly or non Security Admin rows cannot issue', async () => {
  for (const type of ['readonly', 'role']) {
    const f = fixture(); f.mount();
    if (type === 'readonly') f.credential.max_access_level = 'read_only'; else f.manager.roles = ['CUSTODIAL_MANAGER'];
    const res = await f.invoke('confirm'); assert.equal(res.statusCode, 403); unknown(res); assert.equal(f.calls.length, 0);
  }
});
await test('COMPOSITION_NEW missing exact dependency methods fail before route mutation', async () => {
  for (const [dependency, method] of [['trustedDeviceStore', 'find'], ['securityStore', 'getManager'],
    ['securityStore', 'getDeviceSecurityConfig'], ['securityStore', 'findDeviceSecuritySession'], ['db', 'rpc']]) {
    const f = fixture(); delete f.dependencies[dependency][method];
    assert.throws(() => f.mount(), error => error.status === 503 && error.retry_safe === false
      && error.message === 'same_original_recovery_dependency_missing:' + dependency + '.' + method);
    assert.equal(f.registrations.length, 0); assert.equal(f.calls.length, 0);
  }
});
await test('COMPOSITION_NEW missing alternate or accessor dependencies cannot supply authority', async () => {
  for (const change of [
    deps => { delete deps.env; }, deps => { deps.env = undefined; }, deps => { deps.db = null; },
    deps => { deps.authenticateCurrentManager = async () => ({}); }, deps => { deps.issuer = {}; },
    deps => { deps.role = 'SECURITY_ADMIN'; }, deps => { deps.rpcName = 'arbitrary'; },
    deps => { Object.defineProperty(deps, 'env', {enumerable: true, get() { throw Error('GETTER_MUST_NOT_RUN'); }}); },
  ]) {
    const f = fixture(); change(f.dependencies);
    assert.throws(() => f.mount(), {code: 'same_original_recovery_composition_unavailable', status: 503});
    assert.equal(f.registrations.length, 0); assert.equal(f.calls.length, 0);
  }
});
await test('COMPOSITION_NEW conflicting original issuer and target never reach issue', async () => {
  for (const type of ['issuer', 'target']) {
    const f = fixture(); f.mount();
    if (type === 'issuer') f.original.expected_manager_credential_id = id(91);
    else f.preview.original_target.engine_revision = '1';
    const res = await f.invoke('confirm'); assert.ok([403, 409, 503].includes(res.statusCode)); unknown(res);
    assert.equal(f.calls.filter(row => row.name.endsWith('issue_v1')).length, 0);
  }
});
console.log(JSON.stringify({cases, source_pins: pins,
  scope: 'ACTUAL_REGISTERED_SOURCE_CALLBACK_COMPOSITION_SYNTHETIC_SIGNED_ROWS_RECORDING_RPC',
  listener: false, SQL: false, real_manager: false, native_authority: false, effects: false,
  resources: {listeners: 0, sockets: 0, JVMs: 0, DB_connections: 0}}));
}

// Import-safe NEW joined member. Main owns the actual isolated schema/roles,
// original registered native challenge, borrowed admin client and execution.
// A supplied admin/query method is NOT manager authorization: normal signed
// headers + current registry/password/CSRF rows and fixed SQL revalidation are.
export async function createSameOriginalRecoveryManagerSqlFixture(input) {
  assert.equal(joinedManagerSqlOnly, true, '--joined-manager-sql-new required');
  assert.ok(input && Object.getPrototypeOf(input) === Object.prototype);
  assert.deepEqual(Reflect.ownKeys(input).sort(), ['admin', 'backendRoot', 'challengeId', ...(Object.hasOwn(input,'inventoryManagerHttpJoin')?['inventoryManagerHttpJoin']:[])].sort());
  const inventoryManagerHttpJoin=input.inventoryManagerHttpJoin??false;assert.equal(typeof inventoryManagerHttpJoin,'boolean');
  for (const key of Reflect.ownKeys(input)) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'));
  const {admin, backendRoot, challengeId} = input;
  assert.equal(typeof admin?.query, 'function'); assert.ok(path.isAbsolute(backendRoot));
  assert.match(challengeId, /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const sourcePins = {
    'src/auth/shared-access-auth.js': '17bd837f46d5692a042ec280331c0f15c9ee3fd9b7a43ed0458dc1c1f7741c8b',
    'src/auth/manager-permissions.js': '9d18a8dc2b8f435eeb8d8613588bab1ea4bdbc9f217dd17910fd09ef307dadc2',
    'src/auth/device-credential-auth.js': 'ba20ff22b7ab815270311572838d7d9400b5cdc53f80500fe02b43555d6e5aa1',
    'src/auth/same-original-recovery-manager-auth.js': 'a547368fc59b8c55a01f8eb82693b4342a46cdf73a1ac32a3ea4a3b50c80c20d',
    'src/same-original-recovery-manager-composition.js': '5a6a389e2746e0c979dd76d04067b2d262cf6690f5c658faa118a5d6b3a3f641',
    'src/same-original-recovery-store.js': 'b7ebe12eea60f3d115da9ed9ee7fae8368671c8455b98be67d7aceb957b8e4d4',
    'src/same-original-recovery-routes.js': '2fa23d5c14200ddc66cab14c5ae34f6ad353bd03c54fb4ee8af248a3e0fe2ce2',
    'src/manager-original-recovery-approval.js': '622571d4ac00dc850b3aaac86d815fcaf00fbd2fe3967869a2cdeab1deec115d',
    'src/same-original-recovery-wire.js': 'bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7',
  };
  const sha = value => createHash('sha256').update(value).digest('hex');
  for (const [file, digest] of Object.entries(sourcePins)) assert.equal(sha(fs.readFileSync(path.join(backendRoot, file))), digest, file);
  const load = file => import(pathToFileURL(path.join(backendRoot, file)));
  const http = await import('node:http'), {default: express} = await load('node_modules/express/index.js'),
    {createOpsManagerSession: signSession} = await load('src/auth/shared-access-auth.js'),
    {isCustodialOwner} = await load('src/auth/manager-permissions.js'),
    {createSameOriginalRecoveryManagerAuthenticator} = await load('src/auth/same-original-recovery-manager-auth.js'),
    {installSameOriginalRecoveryManagerComposition: compose} = await load('src/same-original-recovery-manager-composition.js'),
    protocol = await load('src/same-original-recovery-wire.js');
  const env = Object.freeze({NODE_ENV: 'production', OPS_MANAGER_AUTH_REQUIRED: 'true',
    OPS_MANAGER_SESSION_SECRET: 'synthetic-new-recovery-manager-session-secret-01',
    DEVICE_CREDENTIAL_SECRET: 'synthetic-new-recovery-security-cookie-secret-02'});
  const secret = 'synthetic-cookie-secret-32-characters-long', csrf = 'synthetic-csrf-secret-32-characters-long',
    hash = (purpose, value) => createHmac('sha256', env.DEVICE_CREDENTIAL_SECRET).update(purpose + ':' + value).digest('hex');
  const connections = new Set(), clients = new Set(), pending = new Set(), calls = [];
  let server, closing = false, tail = Promise.resolve(), firstSqlFailure, owner = null, pageGeneration = 1,
    originalUtf8 = null, originalRequest = null, issueAttempted = false, issueCommitted = false, receiptSeen = null, issuedReceipt = null;
  let inventoryIssueAttempted=false,inventoryIssueCommitted=false;const inventoryCalls=[];
  // One borrowed PG connection, serialized transactions. No owner/service
  // fallback or permission widening. Normal RPCs use their existing service
  // role and transaction form (current-manager SQL takes FOR SHARE locks).
  function sql(text, values = [], readOnly = true) {
    const work = tail.then(async () => {
      await admin.query(readOnly ? 'begin read only' : 'begin');
      try { await admin.query('set local role service_role'); const r = await admin.query(text, values);
        await admin.query('commit'); return r.rows; }
      catch (error) { await admin.query('rollback'); firstSqlFailure ??= {code: error.code || 'SQL_ERROR'}; throw error; }
    }); tail = work.catch(() => {}); return work;
  }
  const jsonRow = row => row ? JSON.parse(JSON.stringify(row)) : null;
  const managerRows = await sql("select * from public.ops_manager_managers where system_key='eric_custodial_manager' and active and revoked_at is null and not is_system_principal");
  assert.equal(managerRows.length, 1, 'existing isolated authoritative owner row required');
  const manager = jsonRow(managerRows[0]); assert.ok(isCustodialOwner(manager)); assert.ok(manager.roles.includes('SECURITY_ADMIN'));
  const credentialId = randomUUID(), securityId = randomUUID(), deviceId = 'synthetic-g08-local-' + randomUUID();
  // SAME existing local-database fixture recipe. Setup belongs to Main's
  // isolated admin/schema, not a production enrollment or new permission.
  await admin.query(`insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,created_at,expires_at)
    values($1,$2,'SYNTHETIC G08 JOINED FIXTURE',$3,'full_access',$4,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day')`,
    [credentialId, deviceId, 'a'.repeat(64), manager.manager_id]);
  await admin.query(`insert into public.ops_manager_device_security_config(singleton,password_hash,password_version) values(true,$1,1) on conflict(singleton) do nothing`,
    ['SYNTHETIC local unrecoverable password hash ' + 'a'.repeat(64)]);
  const config = (await sql('select password_hash,password_version,sessions_revoked_at from public.ops_manager_device_security_config where singleton'))[0];
  assert.ok(config?.password_hash); assert.ok(Number.isSafeInteger(config.password_version));
  await admin.query(`insert into public.ops_manager_device_security_sessions(session_id,manager_id,credential_id,token_hash,csrf_hash,password_version,created_at,expires_at)
    values($1,$2,$3,$4,$5,$6,clock_timestamp()-interval '1 second',clock_timestamp()+interval '10 minutes')`,
    [securityId, manager.manager_id, credentialId, hash('device-security-session', secret), hash('device-security-csrf', csrf), config.password_version]);
  const signed = signSession({credentialId, deviceId, manager, authMode: 'trusted_device', accessLevel: 'full_access', maximumAccessLevel: 'full_access', env});
  const headers = Object.freeze({authorization: 'Bearer ' + signed.token,
    cookie: 'memphis_device_security_session=' + securityId + '.' + secret, 'x-device-security-csrf': csrf});
  const trustedDeviceStore = {async find(id) {
    const row = (await sql('select * from public.ops_manager_trusted_devices where credential_id=$1::uuid', [id]))[0];
    if (!row) return null;
    const currentManager = (await sql('select * from public.ops_manager_managers where manager_id=$1::uuid', [row.manager_id]))[0];
    return {...jsonRow(row), manager: jsonRow(currentManager)};
  }};
  const securityStore = {
    async getManager(id) { return jsonRow((await sql('select * from public.ops_manager_managers where manager_id=$1::uuid', [id]))[0]); },
    async getDeviceSecurityConfig() { return jsonRow((await sql('select password_hash,password_version,sessions_revoked_at from public.ops_manager_device_security_config where singleton'))[0]); },
    async findDeviceSecuritySession(id) { return jsonRow((await sql('select * from public.ops_manager_device_security_sessions where session_id=$1::uuid', [id]))[0]); },
  }; // Read-only session inspection, no touch/expiry renewal method.
  const currentAuth = createSameOriginalRecoveryManagerAuthenticator({env, trustedDeviceStore, securityStore});
  const prefix = '/admin-api/device-security/same-original-recovery', previewPath = prefix + '/challenges/' + challengeId,
    issuePath = prefix + '/approvals', statusPath = issuePath + '/original-status';
  function invalidateOwner() { owner = null; pageGeneration++; }
  async function refreshOwner() {
    try {
      assert.equal(closing, false, 'joined owner is closed');
      const issuer = await currentAuth.authenticateCurrentManager({method: 'GET', originalUrl: previewPath, headers: {...headers}}, {requireCsrf: true});
      assert.equal(closing, false, 'joined owner closed during authentication');
      if (owner && (owner.manager_id !== issuer.manager_id || owner.manager_credential_id !== issuer.manager_credential_id
        || owner.manager_device_id !== issuer.manager_device_id)) throw Error('JOINED_ORIGINAL_OWNER_CHANGED');
      owner = Object.freeze({manager_id: issuer.manager_id, manager_credential_id: issuer.manager_credential_id,
        manager_device_id: issuer.manager_device_id, page_generation: pageGeneration}); return owner;
    } catch (error) { invalidateOwner(); throw error; }
  }
  const common = ['p_manager','p_credential','p_device','p_signed_expires','p_security_session','p_password_version','p_security_hash','p_csrf_hash'];
  const commonTypes = '$1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::uuid,$6::integer,$7::text,$8::text';
  const db = {async rpc(name, args) {
    const preview = name === 'custodial_same_original_preparation_preview_v1', issue = name === 'custodial_same_original_preparation_issue_v1',
      status = name === 'custodial_same_original_preparation_status_v1';
    assert.ok(preview || issue || status); assert.ok(Object.isFrozen(args));
    // Actual SQL issue signature places signed_sha BEFORE signed_expires;
    // object property order from the private store is not SQL argument order.
    const fields = issue ? ['p_manager','p_credential','p_device','p_signed_sha','p_signed_expires',
      'p_security_session','p_password_version','p_security_hash','p_csrf_hash','p_original_utf8']
      : [...common, preview ? 'p_challenge' : 'p_original_utf8'];
    assert.deepEqual(Object.keys(args).sort(), fields.slice().sort());
    assert.equal(args.p_manager, manager.manager_id); assert.equal(args.p_credential, credentialId);
    assert.equal(args.p_device, deviceId); assert.equal(args.p_security_session, securityId);
    calls.push({name, raw_sha256: args.p_original_utf8 ? sha(args.p_original_utf8) : null});
    if (issue) assert.equal(calls.filter(x => x.name === name).length, 1);
    const types = issue ? '$1::uuid,$2::uuid,$3::text,$4::text,$5::timestamptz,$6::uuid,$7::integer,$8::text,$9::text,$10::text'
      : commonTypes + (preview ? ',$9::uuid' : ',$9::text');
    const rows = await sql('select public.' + name + '(' + types + ') data', fields.map(k => args[k]), false);
    const data = rows[0]?.data; assert.ok(data === null || typeof data === 'string');
    if (issue) {
      assert.equal(typeof data,'string');protocol.validateRecoveryApprovalReceipt(JSON.parse(data));
      issueCommitted = true;
      // Ordinary reply from actual SQL, not a constructed fixture receipt.
      // A real error/lost transport still retains original attempt and only
      // allows status; no automatic resend or no-write inference.
    }
    return {data, error: null};
  }};
  async function close() {
    if (closing) return; closing = true; invalidateOwner();
    for (const client of clients) client.destroy();
    for (const connection of connections) connection.destroy();
    await Promise.allSettled([...pending]); await tail;
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    // Borrowed admin remains Main-owned; auth/approval rows are retained for
    // parent fixture cleanup, NEVER deleted as a consequence of uncertainty.
  }
  try {
    await refreshOwner();
    const app = express(); compose(app, {env, trustedDeviceStore, securityStore, db});
    if(inventoryManagerHttpJoin){
      const {installOriginalInventorySeparationManagerComposition}=await load('src/original-inventory-separation-manager-composition.js');
      installOriginalInventorySeparationManagerComposition(app,{env,trustedDeviceStore,securityStore,db:{async rpc(name,args){
        const issue=name==='custodial_original_inventory_separation_issue_v1';
        const source=name==='custodial_original_inventory_separation_manifest_v1'||name==='custodial_original_inventory_separation_review_v1';
        assert.ok(issue||source||name==='custodial_original_inventory_separation_status_v1');
        const fields=[...common,...(issue?['p_signed_sha']:[]),source?'p_inventory_request':'p_original_utf8'];
        const types=commonTypes+(issue?',$9::text,$10::text':source?',$9::uuid':',$9::text');
        assert.deepEqual(Object.keys(args).sort(),fields.slice().sort());
        assert.equal(args.p_manager,manager.manager_id);assert.equal(args.p_credential,credentialId);
        assert.equal(args.p_device,deviceId);assert.equal(args.p_security_session,securityId);
        inventoryCalls.push({name,raw_sha256:args.p_original_utf8?sha(args.p_original_utf8):null});
        if(issue){assert.equal(inventoryIssueAttempted,false,'No inventory writer retry after ANY first attempt');inventoryIssueAttempted=true;}
        const rows=await sql('select public.'+name+'('+types+') data',fields.map(k=>args[k]),!issue);
        if(issue){
          assert.equal(typeof rows[0].data,'string');inventoryIssueCommitted=true;
          // Actual committed SQL reply is deliberately lost. Only subsequent
          // original-status READ is permitted; never infer no-write or resend.
          throw Error('SYNTHETIC_LOST_SHIPPING_INVENTORY_MANAGER_REPLY_AFTER_COMMIT');
        }
        return {data:rows[0].data,error:null};
      }}});
    }
    app.use((req, res) => res.status(404).end());
    server = http.createServer(app); server.on('connection', connection => {
      connections.add(connection); connection.on('close', () => connections.delete(connection));
    });
    await new Promise((resolve, reject) => { server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    async function request(call) {
      assert.equal(closing, false); assert.ok(call && typeof call === 'object' && Object.isFrozen(call));
      const keys = Reflect.ownKeys(call); assert.ok(keys.every(k => ['method','path','body'].includes(k)));
      for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(call,key), 'value'));
      const isPreview = call.method === 'GET' && call.path === previewPath,
        isIssue = call.method === 'POST' && call.path === issuePath, isStatus = call.method === 'POST' && call.path === statusPath;
      assert.ok(isPreview || isIssue || isStatus); assert.equal(Object.hasOwn(call, 'body'), !isPreview);
      assert.deepEqual(keys.slice().sort(), (isPreview?['method','path']:['method','path','body']).sort());
      await refreshOwner(); let raw;
      if (!isPreview) {
        raw = Buffer.from(JSON.stringify(call.body), 'utf8'); assert.ok(raw.length > 0 && raw.length <= 8192);
        const parsed = protocol.decodeRecoveryApprovalRequest(raw);
        if (isIssue) {
          assert.equal(issueAttempted, false, 'original confirmation is dispatch-once, status-only after attempt');
          issueAttempted = true; originalUtf8 = raw.toString('utf8'); originalRequest = parsed;
        } else if (originalUtf8 !== null) {
          assert.equal(protocol.recoveryDocumentSha256('request',parsed),protocol.recoveryDocumentSha256('request',originalRequest));
          raw.fill(0); raw = Buffer.from(originalUtf8, 'utf8'); // EXACT first HTTP bytes, not regenerated status bytes.
        }
      }
      const work = new Promise((resolve, reject) => {
        const chunks = []; let bytes = 0, timer;
        function fail(error) { for(const chunk of chunks)chunk.fill(0);chunks.length=0;reject(error); }
        const client = http.request({hostname:'127.0.0.1',port:server.address().port,path:call.path,method:call.method,agent:false,
          headers:{...headers,...(raw ? {'content-type':'application/json','content-length':String(raw.length)} : {})}}, response => {
          response.on('data', chunk => { bytes += chunk.length;if(bytes>32768){client.destroy(Error('JOINED_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk); });
          response.on('error', fail);response.on('aborted',()=>fail(Error('JOINED_RESPONSE_ABORTED')));
          response.on('end', () => { clearTimeout(timer);
            const body = Buffer.concat(chunks); for(const c of chunks)c.fill(0);
            try { const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
              if(response.statusCode!==200||value.ok!==true) reject(Object.assign(Error('JOINED_ORIGINAL_OUTCOME_UNKNOWN'),{
                status:response.statusCode,outcome:'UNKNOWN',retry_safe:false,limits:protocol.recoveryDeniedEffects}));
              else resolve(value.data);
            } catch(error){reject(error);}finally{body.fill(0);}
          });
        });
        clients.add(client);client.on('close',()=>{clearTimeout(timer);clients.delete(client);});client.on('error',fail);
        timer=setTimeout(()=>client.destroy(Error('JOINED_REQUEST_TIMEOUT')),15000);timer.unref();client.end(raw);
      }); pending.add(work);
      let value, error; try { value=await work; } catch(cause){error=cause;}
      finally { pending.delete(work);raw?.fill(0); }
      await refreshOwner(); if(error)throw error;
      value=isPreview?protocol.validateRecoveryPreview(value):protocol.validateRecoveryApprovalReceipt(value);
      assert.deepEqual(value.limits,protocol.recoveryDeniedEffects);
      if(isIssue)issuedReceipt=value;
      if(isStatus){receiptSeen=value;if(issuedReceipt)assert.deepEqual(receiptSeen,issuedReceipt);}
      return value; // Bare validated product DTO, as actual page/controller expects.
    }
    async function finish() {
      if(firstSqlFailure)throw Object.assign(Error('JOINED_FIRST_SQL_FAILURE'),firstSqlFailure);
      await refreshOwner();
      assert.equal(issueAttempted,true);assert.equal(issueCommitted,true);assert.ok(receiptSeen);
      assert.equal(calls.filter(x=>x.name==='custodial_same_original_preparation_issue_v1').length,1);
      assert.ok(calls.some(x=>x.name==='custodial_same_original_preparation_status_v1'));
      await tail;
      // Main-admin fixture diagnostic ONLY. These owner-private tables revoke
      // service direct SELECT; never substitute this for the runtime status
      // RPC or use it as manager authority/read fallback.
      const rows=(await admin.query('select original_request_utf8,receipt_utf8,expires_at from public.custodial_same_original_recovery_approvals where request_id=$1::uuid and challenge_id=$2::uuid',
        [originalRequest.request_id,challengeId])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].original_request_utf8,originalUtf8);
      assert.deepEqual(protocol.validateRecoveryApprovalReceipt(JSON.parse(rows[0].receipt_utf8)),receiptSeen);assert.equal(receiptSeen.retry_safe,false);
      return Object.freeze({approvals:1,issue_calls:1,original_status_calls:calls.filter(x=>x.name.endsWith('status_v1')).length,
        original_request_sha256:sha(originalUtf8),limits:protocol.recoveryDeniedEffects,
        scope:'ISOLATED_SQL_NORMAL_SIGNED_SOURCE_MANAGER_HTTP_ORIGINAL_PREPARATION_ONLY',real_manager:false,Android:false});
    }
    async function inventoryRequest(call){
      assert.equal(inventoryManagerHttpJoin,true);assert.equal(closing,false);
      assert.ok(call&&Object.getPrototypeOf(call)===Object.prototype&&Object.isFrozen(call));
      const base='/admin-api/device-security/original-inventory-separation';
      const preview=call.method==='GET'&&new RegExp('^'+base+'/reviews/[a-f0-9-]{36}$').test(call.path);
      const issue=call.method==='POST'&&call.path===base+'/approvals';
      const status=call.method==='POST'&&call.path===base+'/approvals/original-status';
      assert.ok(preview||issue||status);
      assert.deepEqual(Object.keys(call).sort(),(preview?['method','path']:['method','path','originalUtf8']).sort());
      let raw=null;
      if(!preview){assert.equal(typeof call.originalUtf8,'string');raw=Buffer.from(call.originalUtf8);assert.ok(raw.length>0&&raw.length<=8192);}
      const work=new Promise((resolve,reject)=>{
        const client=http.request({hostname:'127.0.0.1',port:server.address().port,path:call.path,method:call.method,agent:false,
          headers:{...headers,...(raw?{'content-type':'application/json; charset=utf-8','content-length':String(raw.length)}:{})}},response=>{
          const parts=[];let bytes=0;
          response.on('data',part=>{bytes+=part.length;if(bytes>65536)client.destroy(Error('INVENTORY_MANAGER_RESPONSE_TOO_LARGE'));else parts.push(part);});
          response.once('error',reject);response.once('aborted',()=>reject(Error('INVENTORY_MANAGER_RESPONSE_ABORTED')));
          response.once('end',()=>{const bytes=Buffer.concat(parts);for(const p of parts)p.fill(0);
            try{resolve({status:response.statusCode,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),
              cacheControl:response.headers['cache-control']});}catch(e){reject(e);}finally{bytes.fill(0);}});
        });
        clients.add(client);client.once('close',()=>clients.delete(client));client.once('error',reject);
        client.setTimeout(15000,()=>client.destroy(Error('INVENTORY_MANAGER_HTTP_TIMEOUT')));client.end(raw);
      });
      pending.add(work);try{return await work;}finally{pending.delete(work);raw?.fill(0);}
    }
    function inventoryEvidence(){
      assert.equal(inventoryManagerHttpJoin,true);assert.equal(inventoryIssueAttempted,true);assert.equal(inventoryIssueCommitted,true);
      return Object.freeze({issue_attempts:inventoryCalls.filter(x=>x.name==='custodial_original_inventory_separation_issue_v1').length,
        calls:inventoryCalls.map(x=>({...x})),auth:'SHIPPING_SIGNED_SESSION_AND_SQL_CURRENT_SECURITY_STORES',real_manager:false});
    }
    return Object.freeze({request,currentOwner:()=>owner,challengeId,finish,close,
      ...(inventoryManagerHttpJoin?{inventoryRequest,inventoryEvidence}:{})});
  } catch(error) { await close();throw error; }
}
