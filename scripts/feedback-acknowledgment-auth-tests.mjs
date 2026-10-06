// STUDY-AUTH-001: real loopback HTTP, exact acknowledgment registration and current auth.
// Only the credential store, persisted feedback, and signed-link verifier are fixtures.
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createOpsManagerSession, authenticateOpsAccessRequest, makeOpsAccessMiddleware } from '../src/auth/shared-access-auth.js';

const started = performance.now();
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../src/auth/shared-access-auth.js', import.meta.url));
const mapSource = readFileSync(new URL('../src/auth/map-manager-identity.js', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
function section(start, end) {
  const a = source.indexOf(start), z = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && z > a && source.indexOf(start, a + 1) < 0, `Missing/ambiguous source section: ${start}`);
  return source.slice(a, z);
}
const binding = source.match(/const requireOpsManagerWrite\s*=\s*makeOpsAccessMiddleware\([\s\S]*?\);/);
assert.ok(binding, 'The actual manager-write middleware binding is required.');
const gate = section('function requireFeedbackSignedLinkOrOps(', '\nfunction requireFeedbackReminderSecret(');
const helper = section('async function acknowledgeSystemFeedbackItem(', '\nasync function listSystemFeedbackReminderDueItems(');
const route = section('app.post("/feedback-api/acknowledge/:feedbackId",', '\napp.post("/feedback-api/reminders/run",');
const env = { NODE_ENV: 'production', OPS_MANAGER_AUTH_REQUIRED: 'true', OPS_MANAGER_SESSION_SECRET: 'ack-authority-fixture-only-not-production-20261005' };
const managerId = '91000000-0000-4000-8000-000000000001';
const credentialId = '91000000-0000-4000-8000-000000000002';
const feedbackId = '91000000-0000-4000-8000-000000000003';
const otherId = '91000000-0000-4000-8000-000000000004';
const deviceId = 'SYNTHETIC_ACK_MANAGER';
const manager = { manager_id: managerId, display_name: 'Synthetic Custodial Manager', system_key: 'eric_custodial_manager', is_system_principal: false, roles: ['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN'], active: true, revoked_at: null };
let state = 'active', writes = 0, reads = 0;
const currentManager = () => ({ ...manager, manager_id: state === 'reassigned' ? otherId : managerId, active: state !== 'inactive', revoked_at: state === 'manager_revoked' ? new Date().toISOString() : null });
const store = {
  async find(id) {
    reads++;
    if (id !== credentialId || state === 'missing') return null;
    const current = currentManager();
    return { credential_id: credentialId, device_id: deviceId, manager_id: current.manager_id,
      manager: state === 'missing_manager' ? null : current, max_access_level: state === 'downgraded' ? 'read_only' : 'full_access',
      revoked_at: state === 'revoked' ? new Date().toISOString() : null,
      created_at: new Date(Date.now()-60000).toISOString(), expires_at: new Date(Date.now()+(state === 'expired_credential' ? -60000 : 3600000)).toISOString() };
  },
  async getManagerBySystemKey(key) {
    reads++;
    return ['eric_custodial_manager','jennifer_sheffield_director_operations'].includes(key) ? { ...currentManager(), system_key: key } : null;
  },
};
function token({ access = 'full_access', expired = false, mapKey = '', unbound = false } = {}) {
  return createOpsManagerSession({ env, manager, deviceId,
    credentialId: mapKey || unbound ? undefined : credentialId,
    authMode: mapKey ? `map_identity:${mapKey}` : unbound ? 'operations_first' : 'trusted_device',
    accessLevel: access, maximumAccessLevel: mapKey ? 'read_only' : 'full_access',
    now: new Date(Date.now()-(expired ? 20*60000 : 0)),
  }).token;
}
const full = token(), readonly = token({ access: 'read_only' });
const app = express();
app.use(express.json());
const context = {
  app, opsTrustedDeviceStore: store,
  makeOpsAccessMiddleware(options) {
    assert.equal(options.requireWrite, true);
    assert.equal(options.trustedDeviceStore, store);
    return makeOpsAccessMiddleware({ ...options, env });
  },
  authenticateOpsAccessRequest: req => authenticateOpsAccessRequest(req, { env }),
  verifyFeedbackLinkToken: (value, id, purpose) => value === 'synthetic-valid-ack' && id === feedbackId && purpose === 'ack',
  ensureSystemFeedbackSchema: async () => {},
  runOperationalCommand: async (command, payload) => {
    assert.equal(command, 'feedback_status'); assert.equal(payload.status, 'acknowledged'); writes++;
  },
  getSystemFeedbackItemById: async id => ({ id, summary: 'Synthetic acknowledgment test' }),
  isUuid: value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)),
  APP_VERSION: 'test', RELEASE_ID: 'test', FEEDBACK_CONTRACT_VERSION: 'test', escapeHtml: value => String(value), console,
};
vm.runInNewContext([binding[0], gate, helper, route].join('\n'), context, { timeout: 1000 });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;
const cases = [];
async function check(name, { bearer = full, mode = 'active', capability = '', id = feedbackId, status = 403, mutation = 0, headers = {} } = {}) {
  state = mode;
  const beforeWrites = writes, beforeReads = reads;
  const remaining = Math.floor(10000 - (performance.now()-started));
  assert.ok(remaining > 0, 'Absolute local regression deadline exceeded.');
  const response = await fetch(`${base}/feedback-api/acknowledge/${id}${capability ? '?token='+encodeURIComponent(capability) : ''}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(remaining),
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers }, body: '{}',
  });
  const result = await response.json();
  assert.equal(response.status, status, `${name}: ${JSON.stringify(result)}`);
  assert.equal(writes-beforeWrites, mutation, `${name}: mutation count`);
  if (['revoked','reassigned'].includes(mode)) assert.ok(reads > beforeReads, `${name}: current store was not checked`);
  cases.push({ name, status: response.status, synthetic_mutations: writes-beforeWrites, current_store_reads: reads-beforeReads });
}
try {
  await check('anonymous denied', { bearer: '', status: 401 });
  await check('read-only denied', { bearer: readonly });
  await check('revoked credential denied', { mode: 'revoked', status: 401 });
  await check('reassigned credential denied', { mode: 'reassigned' });
  await check('active full access preserved', { status: 200, mutation: 1 });
  await check('expired session denied', { bearer: token({ expired: true }), status: 401 });
  await check('malformed session denied', { bearer: 'malformed', status: 401 });
  await check('missing current credential denied', { mode: 'missing', status: 401 });
  await check('expired current credential denied', { mode: 'expired_credential', status: 401 });
  await check('inactive manager denied', { mode: 'inactive' });
  await check('revoked manager denied', { mode: 'manager_revoked' });
  await check('missing manager denied', { mode: 'missing_manager' });
  await check('current access downgrade denied', { mode: 'downgraded' });
  await check('unbound manager denied', { bearer: token({ unbound: true }) });
  for (const mapKey of ['eric_custodial_manager','jennifer_sheffield_director_operations']) {
    await check(`read-only Map identity cannot write: ${mapKey}`, { bearer: token({ access: 'read_only', mapKey }) });
  }
  await check('valid scoped acknowledgment link preserved', { bearer: '', capability: 'synthetic-valid-ack', status: 200, mutation: 1 });
  await check('invalid signed link denied', { bearer: '', capability: 'invalid', status: 401 });
  await check('signed link cannot change feedback target', { bearer: '', capability: 'synthetic-valid-ack', id: otherId, status: 401 });
  await check('invalid link may use valid independent manager authority', { capability: 'invalid', status: 200, mutation: 1 });
  await check('invalid link does not upgrade read-only manager', { bearer: readonly, capability: 'invalid' });
  await check('alternate read-only header denied', { bearer: '', headers: { 'x-memphis-auth': readonly } });
  await check('alternate malformed header denied', { bearer: '', headers: { 'x-memphis-auth': 'invalid' }, status: 401 });
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
assert.equal(server.listening, false);
assert.ok(performance.now()-started < 12000, 'Local deadline includes cleanup.');
console.log(JSON.stringify({ status: 'FEEDBACK_ACKNOWLEDGMENT_AUTH_ROUTE_PASS', cases: cases.length, results: cases,
  source: { index: sha(source), shared_auth: sha(authSource), map_identity: sha(mapSource) },
  elapsed_ms: performance.now()-started, server_closed: !server.listening,
  scope: 'Actual loopback HTTP, exact source route/manager-write binding, actual signed manager and current-store checks. Synthetic persistence and link verifier; no SQL/provider/deployment acceptance.' }));
