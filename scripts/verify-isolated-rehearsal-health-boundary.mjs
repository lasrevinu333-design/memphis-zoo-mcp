// Read-only checks on the already-owned isolated API. No provider, DB write,
// credential issuance, server, browser, or production target is created here.
import assert from 'node:assert/strict';

const [endpoint, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.match(String(endpoint || ''), /^http:\/\/127\.0\.0\.1:[0-9]+\/health\/dependencies$/);
const detailed = new URL(endpoint);
assert.ok(Number(detailed.port) > 0 && Number(detailed.port) <= 65535);
const publicHealth = new URL('/health', detailed);
async function get(url, headers = {}) {
  const response = await fetch(url, { method: 'GET', headers, redirect: 'error',
    credentials: 'omit', signal: AbortSignal.timeout(5_000) });
  const body = await response.json().catch(() => { throw new Error('Isolated health response was not JSON.'); });
  return { status: response.status, body };
}
const publicResponse = await get(publicHealth);
assert.equal(publicResponse.status, 503, 'The isolated employee-credential revocation state must remain unready.');
assert.deepEqual(Object.keys(publicResponse.body).sort(), ['ok', 'process_alive']);
assert.equal(publicResponse.body.ok === false && publicResponse.body.process_alive === true, true, 'Public health must expose only the exact readiness booleans.');
for (const [name, headers] of [
  ['missing_session', {}],
  ['invalid_session', { Authorization: 'Bearer invalid.invalid' }],
]) {
  const result = await get(detailed, headers);
  assert.equal(result.status, 401, `${name} must be denied before dependency probes.`);
  for (const field of ['database_reachable', 'read_authority_ready', 'required_schema_present',
    'release_canary', 'device_credential_secret', 'worker', 'schema_fingerprint']) {
    assert.equal(Object.hasOwn(result.body, field), false, `${name} must not expose dependency details.`);
  }
}
console.log(JSON.stringify({ scope: 'ISOLATED_EXISTING_API_AUTH_BOUNDARY_ONLY',
  publicHealthExactMinimal503: true, missingSessionDenied401: true, invalidSessionDenied401: true,
  noUnauthorizedDependencyDetails: true, providerCallsRequested: 0, databaseWritesRequested: 0,
  productionAcceptance: false }));
