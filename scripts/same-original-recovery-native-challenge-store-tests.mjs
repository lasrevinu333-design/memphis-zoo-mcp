import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import http from 'node:http';
import {registerHooks} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Only NEW actual adapter source checks. The opaque inspector and recording
// RPC below are SYNTHETIC private test ports, NOT native authentication/SQL.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), backend = process.argv[2];
assert.ok(backend && path.isAbsolute(backend));
const positivePublicationOnly=process.argv[3]==='NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW';
const preparationOnly=positivePublicationOnly||['NATIVE_PREPARATION_CURRENT_AUTH_NEW','NATIVE_PREPARATION_ROUTE_JOIN_NEW'].includes(process.argv[3]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function pinned(file, digest) { const bytes = fs.readFileSync(file); assert.equal(sha(bytes), digest, file); return bytes.toString('utf8'); }
const exchangeSource = pinned(backend + '/src/native-private-custody-exchange.js',
  preparationOnly?'428afacafe7f3cde828694cdb35c1433a168f1f26eeb8a88414fd82115a21362':'f52b8a553911e0b11ec598550a5da272c811d013e7d6ed994a78a25d9c5802b7');
const pins = {
  'src/same-original-recovery-wire.js': 'bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7',
  'src/native-provider-json.js': '8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294',
  'src/same-original-recovery-native-challenge-wire.js': preparationOnly?'dcb2d4cb6b352549e1a1247a0165e8418bc2c6763c43746929f0e0a7a8404eb3':'07518e72aa5bca17b736dc510c0974a44b3ef88fe7261b4792a3dd0ae48ca33b',
};
for (const [file, digest] of Object.entries(pins)) pinned(backend + '/' + file, digest);
if(preparationOnly)for(const [file,digest] of Object.entries({
  'src/same-original-recovery-native-challenge-route.js':'7fb2e780563380cc8bd3cbdbda9e9d1573b88a0cfec7833b794ae261047116f6',
  'src/same-original-recovery-native-challenge-composition.js':'f3a0ff7e3f4f2f628e697e8d9df95f08f05cf482059c821a1ed9b2a32fb09f58',
  'src/request-json-parser.js':'7b58edda46ffe89495969d5d2c7dfb409c86f372e6a1b477ef2a0c7cf7d6973d',
  'src/same-original-recovery-native-preparation-store.js':'e83d2fac70ee92e3fde5d92daf8af4244bb25e2880e9762f2d350157a5aaebf2',
}))pinned(backend+'/'+file,digest);
const url = pathToFileURL((preparationOnly?backend:root) + '/src/same-original-recovery-native-challenge-store.js').href;
const hook = registerHooks({resolve(specifier, context, next) {
  if (context.parentURL === url && specifier.startsWith('./')) return next(pathToFileURL(path.join(backend, 'src', specifier)).href, context);
  return next(specifier, context);
}});
const {createSameOriginalRecoveryNativeChallengeStore: create,createSameOriginalRecoveryNativeStatusStore: createStatus} = await import(url); hook.deregister();
const wire = await import(pathToFileURL(backend + '/src/same-original-recovery-wire.js'));
const SQLproducer = pinned(backend + '/supabase/migrations/20261014024357_same_original_native_challenge_registration.sql',
  '20b181b6021fb73b4e72eaafbc4e2e2486c3e7c85aa2f898eb9700d85e6a66ae');
assert.ok(SQLproducer.includes("'custodial.same-original-native-challenge-binding.v1'||E'\\n'||p_native_request::text||E'\\n'"));
const exchange = await import(pathToFileURL(backend + '/src/native-private-custody-exchange.js'));
const inspectorSection = exchangeSource.slice(exchangeSource.indexOf('export function inspectAuthenticatedSameOriginalRecoveryNativeChallenge'),
  exchangeSource.indexOf('export function closeAuthenticatedPrivateCustodyExchangeCapture'));
const expectedNames = [...inspectorSection.matchAll(/\b(p_[a-z0-9_]+):/g)].map(match => match[1]);
assert.equal(expectedNames.length, 15); assert.equal(new Set(expectedNames).size, 15);

// Reuse the existing sealed Java SOURCE vector extraction, not a newly signed
// Engine request. This data is representation for the explicit synthetic port.
const packet = '/home/eric/Documents/Codex/2026-10-09/task-7/g08-native-challenge-envelope-20261014-v1';
pinned(packet + '/HANDOFF.json', 'eabbba8a663c1e3693c4d2521fe9becd7e8a408431b01569a36b89363515bd5a');
const javaRoot = packet + '/mobile/plugins/custodial-native-vault/android/src/';
pinned(javaRoot + 'main/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelope.java',
  '31743a79877a5c0bf2ae625826e5a0b6ec56d7ac772333497159a26b49a078b4');
const vectors = pinned(javaRoot + 'test/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelopeTest.java',
  '8cb99ed151ab75c85eecb28980d898cc34c694354af2ee1b176ca6e97e58aa9d');
const id = vectors.match(/String ID="([^"]+)"/)[1], other = vectors.match(/String OTHER="([^"]+)"/)[1], time = vectors.match(/String TIME="([^"]+)"/)[1];
function sourceObject(start, end) {
  const at = vectors.indexOf(start), text = vectors.slice(at, vectors.indexOf(end, at)), result = {};
  assert.ok(at >= 0);
  for (const match of text.matchAll(/for\(String key:new String\[\]\{([^}]+)\}\)value\.put\(key,(ID|SHA)\)/g))
    for (const key of [...match[1].matchAll(/"([A-Za-z0-9_.-]+)"/g)].map(value => value[1])) result[key] = match[2] === 'ID' ? id : 'a'.repeat(64);
  for (const match of text.matchAll(/\.put\("([^"]+)","([^"]+)"\)/g)) result[match[1]] = match[2];
  return result;
}
const target = Object.freeze(sourceObject('private static JSONObject targetJson()', 'private static NativeSameOriginalRecoveryPreparationWire.UntrustedTarget target()'));
const query = sourceObject('private static JSONObject query()', 'private static JSONObject outer(');
const current = {schema: 'custodial.original-private-custody-current-query.v1', original_query_body_base64: Buffer.from(JSON.stringify(query)).toString('base64'),
  original_query_timestamp: time, original_query_http_attestation: 'a'.repeat(64), original_query_unknown_record_sha256: 'b'.repeat(64)};
const original = {schema: 'custodial.same-original-recovery-native-challenge.v1', purpose: wire.recoveryPreparationPurpose,
  native_challenge_intent_id: other, native_challenge_intent_record_sha256: 'a'.repeat(64),
  current_original_query_envelope_base64: Buffer.from(JSON.stringify(current)).toString('base64'), original_target: target,
  original_target_sha256: wire.recoveryDocumentSha256('target', target)};

function fixture() {
  const capture = Object.freeze({schema: 'SYNTHETIC_OPAQUE_INSPECTOR_TEST_HANDLE_ONLY'}), calls = [];
  const raw = '\n ' + JSON.stringify(original, null, 2) + '\t';
  const params = Object.freeze({p_operation: target.operation_id, p_device: target.canonical_device_pk, p_credential: target.credential_id,
    p_credential_hash: 'c'.repeat(64), p_credential_key_id: target.original_credential_secret_key_id, p_generation: target.original_generation_id,
    p_chunk_index: 0, p_original_write_request: id, p_original_write_body_sha256: 'd'.repeat(64), p_original_write_attestation_digest: 'e'.repeat(64),
    p_native_request: original.native_challenge_intent_id, p_native_request_timestamp: time, p_native_request_body_sha256: sha(Buffer.from(raw)),
    p_native_attestation_digest: 'f'.repeat(64), p_original_utf8: raw});
  assert.deepEqual(Object.keys(params).sort(), expectedNames.slice().sort());
  const binding = Object.freeze({capture, observation_only: true, transaction_authority: false, original_request_utf8: raw,
    original_target: target, native_challenge_intent_id: original.native_challenge_intent_id,
    native_challenge_intent_record_sha256: original.native_challenge_intent_record_sha256, rpc_parameters: params});
  const bindings = new WeakMap([[capture, binding]]);
  const receipt = {schema: 'custodial.same-original-recovery-native-challenge-receipt.v1', state: 'ORIGINAL_CHALLENGE_RECORDED_PREPARATION_ONLY',
    challenge_id: original.native_challenge_intent_id, challenge_sha256: 'a'.repeat(64), original_target_sha256: original.original_target_sha256,
    native_challenge_intent_id: original.native_challenge_intent_id, native_challenge_intent_record_sha256: original.native_challenge_intent_record_sha256,
    registered_at: '2000-02-29T12:34:56.007000Z', expires_at: '2000-02-29T12:39:56.007000Z', retry_safe: false, limits: {...wire.recoveryDeniedEffects}};
  // Actual SQL273 formula, from frozen ORIGINAL params. Representation only,
  // not a native signature, SQL execution or authentication fixture.
  receipt.challenge_sha256 = challengeDigest(params, receipt);
  let inspections = 0;
  const dependencies = {db: {async rpc(name, args) { calls.push({name, args}); return {data: JSON.stringify(receipt), error: null}; }},
    inspectAuthenticatedNativeChallenge(handle) { inspections++; if (!bindings.has(handle)) throw Error('SYNTHETIC_UNBOUND'); return bindings.get(handle); }};
  return {capture, binding, bindings, raw, params, receipt, calls, dependencies, create() { return create(dependencies); }, inspections() { return inspections; }};
}
const cases = [];
async function test(name, callback) {
  if(preparationOnly&&process.exitCode)return; // Preserve the first owning failure; no later probe/retry.
  const selector = process.argv[3];
  if (['NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW','NATIVE_PREPARATION_CURRENT_AUTH_NEW','NATIVE_PREPARATION_ROUTE_JOIN_NEW','NATIVE_REGISTRATION_LOST_REPLY_NEW', 'NATIVE_REGISTRATION_RECEIPT_BINDING_NEW', 'NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW', 'NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW', 'NATIVE_REGISTRATION_STATUS_ROUTE_JOIN_NEW'].includes(selector) ? !name.startsWith(selector + ' ')
    : selector && name !== selector) return;
  try { await callback(); cases.push({name, passed: true}); console.log('PASS ' + name); }
  catch (error) { cases.push({name, passed: false, error: error.code ?? error.name}); console.error('FAIL ' + name + ' ' + (error.code ?? error.name)); process.exitCode = 1; }
}
function unknown(error) { assert.equal(error.outcome, 'UNKNOWN'); assert.equal(error.retry_safe, false);
  assert.deepEqual(error.limits, wire.recoveryDeniedEffects); return true; }
function challengeDigest(params, receipt, suffix = '') {
  return sha(Buffer.from(['custodial.same-original-native-challenge-binding.v1', params.p_native_request,
    params.p_native_request_body_sha256, params.p_native_attestation_digest, receipt.native_challenge_intent_record_sha256,
    receipt.original_target_sha256, receipt.registered_at, receipt.expires_at].join('\n') + suffix, 'utf8'));
}

await test('FIXED_STORE_NEW fixed fifteen source parameters preserve raw and return metadata only', async () => {
  const f = fixture(), store = f.create(); assert.ok(Object.isFrozen(store)); assert.deepEqual(Object.keys(store), ['registerOriginalChallengeOnce', 'readOriginalChallengeStatusOnce']);
  const receipt = await store.registerOriginalChallengeOnce(f.capture);
  assert.deepEqual(receipt, f.receipt); assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.limits));
  assert.equal(f.inspections(), 2); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'custodial_same_original_preparation_register_v1');
  assert.deepEqual(f.calls[0].args, f.params); assert.equal(f.calls[0].args.p_original_utf8, f.raw); assert.ok(Object.isFrozen(f.calls[0].args));
  assert.ok(!Object.hasOwn(receipt, 'rpc_parameters') && !Object.hasOwn(receipt, 'capture'));
  await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
});
await test('FIXED_STORE_NEW lost reply and SDK errors consume attempt and never retry', async () => {
  for (const response of ['throw', '42501', '40001']) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); if (response === 'throw') throw Error('SYNTHETIC_COMMIT_LOST_REPLY');
      return {data: JSON.stringify(f.receipt), error: {code: response}}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    // A single bounded original-status read is now allowed for uncertainty,
    // never for definite42501 and never a second writer. Prior proof retained.
    assert.equal(f.inspections(), response === '42501' ? 2 : 4);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    assert.equal(f.calls.length, response === '42501' ? 1 : 2);
  }
});
await test('FIXED_STORE_NEW concurrent second call cannot dispatch while original awaits', async () => {
  const f = fixture(), store = f.create(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); await gate; return {data: JSON.stringify(f.receipt)}; };
  const first = store.registerOriginalChallengeOnce(f.capture);
  try { await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1); }
  finally { release(); }
  assert.deepEqual(await first, f.receipt); assert.equal(f.calls.length, 1);
});
await test('FIXED_STORE_NEW copied closed or actual-Main-unbound captures never reach RPC', async () => {
  const f = fixture(), store = f.create();
  await assert.rejects(() => store.registerOriginalChallengeOnce(Object.freeze({...f.capture})), unknown);
  f.bindings.delete(f.capture); await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 0);
  const actual = create({db: f.dependencies.db, inspectAuthenticatedNativeChallenge: exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge});
  await assert.rejects(() => actual.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 0);
});
await test('FIXED_STORE_NEW postawait closure raw parameter target or handle drift stays UNKNOWN', async () => {
  for (const change of [
    f => f.bindings.delete(f.capture),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, original_request_utf8: f.raw + ' ', rpc_parameters: Object.freeze({...f.params, p_original_utf8: f.raw + ' '})})),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, rpc_parameters: Object.freeze({...f.params, p_credential_hash: '0'.repeat(64)})})),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, original_target: Object.freeze({...target, engine_revision: '1'})})),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, capture: Object.freeze({...f.capture})})),
  ]) {
    const f = fixture(), store = f.create(); f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); change(f); return {data: JSON.stringify(f.receipt)}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  }
});
await test('FIXED_STORE_NEW wrong index flags missing or extra parameters refuse before writer', async () => {
  for (const change of [
    b => ({...b, transaction_authority: true}), b => ({...b, observation_only: false}),
    b => ({...b, rpc_parameters: Object.freeze({...b.rpc_parameters, p_chunk_index: 1})}),
    b => ({...b, rpc_parameters: Object.freeze({...b.rpc_parameters, p_original_utf8: 'foreign'})}),
    b => ({...b, rpc_parameters: Object.freeze({...b.rpc_parameters, p_extra: 'foreign'})}),
    b => { const params = {...b.rpc_parameters}; delete params.p_device; return {...b, rpc_parameters: Object.freeze(params)}; },
  ]) {
    const f = fixture(); f.bindings.set(f.capture, Object.freeze(change(f.binding)));
    await assert.rejects(() => f.create().registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 0);
  }
});
await test('FIXED_STORE_NEW object NULL duplicate oversized or contradictory receipt remains unknown', async () => {
  const f = fixture();
  const mismatches = ['native_challenge_intent_id', 'native_challenge_intent_record_sha256', 'original_target_sha256'];
  const data = [null, f.receipt, '', ' '.repeat(24577), '{"schema":"duplicate",' + JSON.stringify(f.receipt).slice(1),
    ...mismatches.map(key => JSON.stringify({...f.receipt, [key]: key.endsWith('_id') ? id : '0'.repeat(64)})),
    JSON.stringify({...f.receipt, limits: {...f.receipt.limits, finalizer_allowed: true}}), JSON.stringify({...f.receipt, retry_safe: true})];
  for (const value of data) {
    const g = fixture(), store = g.create(); g.dependencies.db.rpc = async (name, args) => { g.calls.push({name, args}); return {data: value}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(g.capture), unknown);
    await assert.rejects(() => store.registerOriginalChallengeOnce(g.capture), unknown); assert.equal(g.calls.length, 2);
  }
});
await test('FIXED_STORE_NEW missing or fallback factory dependencies cannot supply authority', async () => {
  for (const dependencies of [undefined, {}, {db: {}}, {db: {rpc() {}}, inspectAuthenticatedNativeChallenge: null},
    {...fixture().dependencies, role: 'service_role'}, {...fixture().dependencies, rpcName: 'foreign'},
    {...fixture().dependencies, issuer: {}}, {...fixture().dependencies, fallbackDb: {}}]) assert.throws(() => create(dependencies), unknown);
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW lost registration reply reads exact original once without writer retry', async () => {
  const f = fixture(), store = f.create(); let originalArgs;
  f.dependencies.db.rpc = async (name, args) => {
    f.calls.push({name, args});
    if (name === 'custodial_same_original_preparation_register_v1') { originalArgs = args; throw Error('SYNTHETIC_COMMIT_LOST_REPLY'); }
    assert.equal(name, 'custodial_same_original_preparation_registration_status_v1');
    assert.equal(args, originalArgs); assert.equal(args.p_original_utf8, f.raw);
    return {data: JSON.stringify(f.receipt), error: null};
  };
  assert.deepEqual(await store.registerOriginalChallengeOnce(f.capture), f.receipt);
  assert.deepEqual(f.calls.map(row => row.name), ['custodial_same_original_preparation_register_v1',
    'custodial_same_original_preparation_registration_status_v1']);
  await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2);
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW uncertain results get one bounded status then remain unknown', async () => {
  for (const response of [null, {}, {data: null}, {data: fixture().receipt}, {data: '{'}, {error: {code: '40001'}}]) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
      return name.endsWith('register_v1') ? response : {data: null}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].name, 'custodial_same_original_preparation_registration_status_v1');
    assert.equal(f.calls[0].args, f.calls[1].args);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2);
  }
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW definite 42501 rejects403 without read around denial', async () => {
  for (const thrown of [false, true]) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
      if (thrown) throw Object.assign(Error('SYNTHETIC_CURRENT_DENIAL'), {code: '42501'});
      return {data: JSON.stringify(f.receipt), error: {code: '42501'}}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), error => { unknown(error); return error.status === 403; });
    assert.equal(f.calls.length, 1); await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  }
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW closed or drifted original after uncertain write cannot read status', async () => {
  for (const change of [
    f => f.bindings.delete(f.capture),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, rpc_parameters: Object.freeze({...f.params, p_credential_hash: '0'.repeat(64)})})),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, capture: Object.freeze({...f.capture})})),
  ]) {
    const f = fixture(), store = f.create(); f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); change(f); throw Error('SYNTHETIC_LOST'); };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  }
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW null errors malformed foreign or postread drift cannot promote', async () => {
  for (const type of ['null', 'error', 'throw', 'malformed', 'object', 'foreign', 'closed', 'drift']) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => {
      f.calls.push({name, args}); if (name.endsWith('register_v1')) throw Error('SYNTHETIC_LOST');
      if (type === 'null') return {data: null}; if (type === 'error') return {error: {code: 'SYNTHETIC_READ_UNAVAILABLE'}};
      if (type === 'throw') throw Error('SYNTHETIC_READ_LOST');
      if (type === 'malformed') return {data: '{'}; if (type === 'object') return {data: f.receipt};
      if (type === 'foreign') return {data: JSON.stringify({...f.receipt, original_target_sha256: '0'.repeat(64)})};
      if (type === 'closed') f.bindings.delete(f.capture);
      if (type === 'drift') f.bindings.set(f.capture, Object.freeze({...f.binding, original_request_utf8: f.raw + ' ',
        rpc_parameters: Object.freeze({...f.params, p_original_utf8: f.raw + ' '})}));
      return {data: JSON.stringify(f.receipt)};
    };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    assert.equal(f.calls.length, 2); await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2);
  }
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW pending original status retains latch and exact frozen parameters', async () => {
  const f = fixture(), store = f.create(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  f.dependencies.db.rpc = async (name, args) => {
    f.calls.push({name, args}); if (name.endsWith('register_v1')) throw Error('SYNTHETIC_LOST');
    entered(); await gate; return {data: JSON.stringify(f.receipt)};
  };
  const first = store.registerOriginalChallengeOnce(f.capture);
  try {
    await Promise.race([ready, first.then(() => { throw Error('REQUIRED_STATUS_NOT_REACHED'); })]);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].args, f.calls[1].args); assert.ok(Object.isFrozen(f.calls[1].args));
  } finally { release(); }
  assert.deepEqual(await first, f.receipt); assert.equal(f.calls.length, 2);
});
await test('NATIVE_REGISTRATION_LOST_REPLY_NEW definite successful writer still performs no status RPC', async () => {
  const f = fixture(), store = f.create();
  assert.deepEqual(await store.registerOriginalChallengeOnce(f.capture), f.receipt);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'custodial_same_original_preparation_register_v1');
  assert.equal(f.inspections(), 2); assert.equal(Object.isFrozen(f.receipt), false);
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW foreign challenge ID with unchanged three original pins is refused', async () => {
  const f = fixture(), store = f.create(); f.receipt.challenge_id = id;
  assert.notEqual(f.receipt.challenge_id, original.native_challenge_intent_id);
  assert.equal(f.receipt.native_challenge_intent_id, original.native_challenge_intent_id);
  assert.equal(f.receipt.native_challenge_intent_record_sha256, original.native_challenge_intent_record_sha256);
  assert.equal(f.receipt.original_target_sha256, original.original_target_sha256);
  await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].args, f.calls[1].args);
  await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2);
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW SQL formula golden receipt is unchanged metadata and no status read', async () => {
  const f = fixture(), store = f.create(), before = structuredClone(f.receipt);
  assert.equal(f.receipt.challenge_id, f.params.p_native_request);
  assert.equal(f.receipt.challenge_sha256, challengeDigest(f.params, f.receipt));
  const result = await store.registerOriginalChallengeOnce(f.capture);
  assert.deepEqual(result, before); assert.ok(Object.isFrozen(result)); assert.deepEqual(f.receipt, before);
  assert.equal(f.calls.length, 1); assert.equal(f.inspections(), 2);
  assert.equal(f.calls[0].args.p_native_request_timestamp, time);
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW transcript binds frozen body and attestation with no trailing newline', async () => {
  for (const makeDigest of [
    f => 'a'.repeat(64),
    f => challengeDigest({...f.params, p_native_request_body_sha256: '0'.repeat(64)}, f.receipt),
    f => challengeDigest({...f.params, p_native_attestation_digest: '0'.repeat(64)}, f.receipt),
    f => challengeDigest(f.params, f.receipt, '\n'),
  ]) {
    const f = fixture(), store = f.create(); f.receipt.challenge_sha256 = makeDigest(f);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].args, f.calls[1].args);
  }
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW original relative civil time limits are inclusive and microsecond exact', async () => {
  const checks = [
    ['2000-02-29T12:34:26.007000Z', '2000-02-29T12:39:26.007000Z', true], // original-30s
    ['2000-02-29T12:36:56.007000Z', '2000-02-29T12:39:56.007000Z', true], // original+120s
    ['2000-02-29T12:34:26.006999Z', '2000-02-29T12:39:26.006999Z', false],
    ['2000-02-29T12:36:56.007001Z', '2000-02-29T12:39:56.007000Z', false],
    ['2000-02-29T12:36:56.007000Z', '2000-02-29T12:39:56.007001Z', false], // original+300s exceeded
    ['2000-02-29T12:34:26.007000Z', '2000-02-29T12:39:26.007001Z', false], // registration+300s exceeded
    ['2000-02-29T12:34:56.007000Z', '2000-02-29T12:34:56.007000Z', false],
    ['2026-10-14T00:00:00.000000Z', '2026-10-14T00:05:00.000000Z', false], // valid civil but foreign original clock
  ];
  for (const [registered, expires, accepted] of checks) {
    const f = fixture(), store = f.create(); f.receipt.registered_at = registered; f.receipt.expires_at = expires;
    f.receipt.challenge_sha256 = challengeDigest(f.params, f.receipt);
    if (accepted) { assert.deepEqual(await store.registerOriginalChallengeOnce(f.capture), f.receipt); assert.equal(f.calls.length, 1); }
    else { await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2); }
  }
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW original native timestamp requires canonical milliseconds and real civil date', async () => {
  for (const timestamp of ['2000-02-29T12:34:56.007000Z', '2000-02-29T12:34:56.07Z', '2000-02-29T12:34:56.007+00:00',
    '2000-02-30T12:34:56.007Z', '2000-02-29T24:00:00.007Z', '2000-02-29T12:60:00.007Z',
    '2000-02-29T12:34:60.007Z', '0000-02-29T12:34:56.007Z']) {
    const f = fixture(), store = f.create();
    f.bindings.set(f.capture, Object.freeze({...f.binding, rpc_parameters: Object.freeze({...f.params, p_native_request_timestamp: timestamp})}));
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 0);
  }
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW foreign writer can only recover exact original bound status once', async () => {
  const f = fixture(), store = f.create();
  f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
    return {data: JSON.stringify(name.endsWith('register_v1') ? {...f.receipt, challenge_id: id} : f.receipt)}; };
  assert.deepEqual(await store.registerOriginalChallengeOnce(f.capture), f.receipt);
  assert.deepEqual(f.calls.map(row => row.name), ['custodial_same_original_preparation_register_v1', 'custodial_same_original_preparation_registration_status_v1']);
  assert.equal(f.calls[0].args, f.calls[1].args); assert.equal(f.calls[1].args.p_original_utf8, f.raw);
  await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2);
});
await test('NATIVE_REGISTRATION_RECEIPT_BINDING_NEW status enforces identical ID transcript and original time bounds', async () => {
  for (const change of [
    f => { f.receipt.challenge_id = id; },
    f => { f.receipt.challenge_sha256 = '0'.repeat(64); },
    f => { f.receipt.registered_at = '2026-10-14T00:00:00.000000Z'; f.receipt.expires_at = '2026-10-14T00:05:00.000000Z';
      f.receipt.challenge_sha256 = challengeDigest(f.params, f.receipt); },
  ]) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
      if (name.endsWith('register_v1')) throw Error('SYNTHETIC_LOST_WRITER_REPLY');
      change(f); return {data: JSON.stringify(f.receipt)}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].args, f.calls[1].args);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 2);
  }
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW reads original fixed parameters once without a writer or renewal', async () => {
  const f = fixture(), store = f.create(), before = structuredClone(f.receipt);
  const result = await store.readOriginalChallengeStatusOnce(f.capture);
  assert.deepEqual(result, before); assert.ok(Object.isFrozen(result) && Object.isFrozen(result.limits));
  assert.equal(f.calls.length, 1); assert.equal(f.inspections(), 2);
  assert.equal(f.calls[0].name, 'custodial_same_original_preparation_registration_status_v1');
  assert.deepEqual(f.calls[0].args, f.params); assert.ok(Object.isFrozen(f.calls[0].args));
  assert.equal(f.calls[0].args.p_original_utf8, f.raw); assert.equal(f.calls[0].args.p_native_request_timestamp, time);
  assert.deepEqual(result.limits, wire.recoveryDeniedEffects); assert.equal(result.retry_safe, false);
  await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown);
  await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
  assert.equal(f.calls.length, 1);
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW a reconstructed private capture only performs fixed read', async () => {
  const f = fixture(), first = f.create();
  f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); throw Error('SYNTHETIC_LOST_RESULT'); };
  await assert.rejects(() => first.registerOriginalChallengeOnce(f.capture), unknown);
  const next = Object.freeze({schema: 'SYNTHETIC_RECONSTRUCTED_CURRENT_PRIVATE_CAPTURE'});
  f.bindings.set(next, Object.freeze({...f.binding, capture: next}));
  f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); return {data: JSON.stringify(f.receipt)}; };
  const restart = f.create(), count = f.calls.length;
  assert.deepEqual(await restart.readOriginalChallengeStatusOnce(next), f.receipt);
  assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).name, 'custodial_same_original_preparation_registration_status_v1');
  assert.deepEqual(f.calls.at(-1).args, f.params);
  await assert.rejects(() => restart.registerOriginalChallengeOnce(next), unknown); assert.equal(f.calls.length, count + 1);
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW definite denial never calls writer or alternative reader', async () => {
  for (const thrown of [false, true]) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
      if (thrown) throw Object.assign(Error('SYNTHETIC_DENIED'), {code: '42501'});
      return {data: JSON.stringify(f.receipt), error: {code: '42501'}}; };
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), error => { unknown(error); return error.status === 403; });
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  }
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW prior definite writer denial cannot be bypassed with explicit read', async () => {
  for (const thrown of [false, true]) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
      if (thrown) throw Object.assign(Error('SYNTHETIC_DENIED'), {code: '42501'});
      return {error: {code: '42501'}}; };
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), error => { unknown(error); return error.status === 403; });
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), error => { unknown(error); return error.status === 403; });
    assert.equal(f.calls.length, 1);
  }
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW missing malformed or foreign read remains unknown and consumed', async () => {
  for (const type of ['null', 'error', 'throw', 'malformed', 'object', 'foreign', 'authority', 'expiry']) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args});
      if (type === 'null') return {data: null}; if (type === 'error') return {error: {code: '40001'}};
      if (type === 'throw') throw Error('SYNTHETIC_LOST_READ'); if (type === 'malformed') return {data: '{'};
      if (type === 'object') return {data: f.receipt};
      const receipt = structuredClone(f.receipt);
      if (type === 'foreign') receipt.challenge_id = id;
      if (type === 'authority') receipt.limits.key_removal = true;
      if (type === 'expiry') receipt.expires_at = '2026-10-14T11:00:00.000000Z';
      return {data: JSON.stringify(receipt)};
    };
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown);
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  }
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW private capture closure or drift across awaited read refuses receipt', async () => {
  for (const change of [
    f => f.bindings.delete(f.capture),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, original_request_utf8: f.raw + ' ', rpc_parameters: Object.freeze({...f.params, p_original_utf8: f.raw + ' '})})),
    f => f.bindings.set(f.capture, Object.freeze({...f.binding, rpc_parameters: Object.freeze({...f.params, p_credential_hash: '0'.repeat(64)})})),
  ]) {
    const f = fixture(), store = f.create();
    f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); change(f); return {data: JSON.stringify(f.receipt)}; };
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  }
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW unbound copied proxy or closed capture never reads', async () => {
  const f = fixture(), store = f.create();
  for (const capture of [null, Object.freeze({...f.capture}), new Proxy(f.capture, {})])
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(capture), unknown);
  f.bindings.delete(f.capture); await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown);
  assert.equal(f.calls.length, 0);
  const actual = create({db: f.dependencies.db, inspectAuthenticatedNativeChallenge: exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge});
  await assert.rejects(() => actual.readOriginalChallengeStatusOnce(f.capture), unknown); assert.equal(f.calls.length, 0);
});
await test('NATIVE_REGISTRATION_EXPLICIT_STATUS_NEW concurrent calls cannot read twice or write while read is pending', async () => {
  const f = fixture(), store = f.create(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.dependencies.db.rpc = async (name, args) => { f.calls.push({name, args}); await gate; return {data: JSON.stringify(f.receipt)}; };
  const first = store.readOriginalChallengeStatusOnce(f.capture);
  try {
    await assert.rejects(() => store.readOriginalChallengeStatusOnce(f.capture), unknown);
    await assert.rejects(() => store.registerOriginalChallengeOnce(f.capture), unknown); assert.equal(f.calls.length, 1);
  } finally { release(); }
  assert.deepEqual(await first, f.receipt); assert.equal(f.calls.length, 1);
});
function currentStatusSourceFixture(preparation=false,positivePublication=false) {
  // Retained ORIGINAL native source request is deliberately archived/expired.
  // Only a NEW read-only outer Source-fixture HMAC is produced here, using the
  // existing public synthetic issuer recipe. No live credential or clock edit.
  assert.ok(!positivePublication||preparation);
  const sourceRoot='/home/eric/Documents/Codex/2026-10-09/task-7/g08-original-write-sql-join-capture-20261014-v1/'+(positivePublication?'main-sql-packet-KmVe5w':preparation?'main-sql-packet-dw6N3L':'main-sql-packet-amMZvi')+'/emitted';
  const originalSha=positivePublication?'49612b447f67da5233d8c8435ce257840dc94c463dfecefb6bcbac14d64a6c12':preparation?'2c75599b701e3924e493d403b29d5f441bdf6d5149ea2458d07265fc73786d95':'c4869ac07c218ece3dfd844cced9f89888e478375e4291fe4a2ccbefb2b17579';
  const raw=Buffer.from(pinned(sourceRoot+'/request.bin',originalSha),'utf8');assert.equal(sha(raw),originalSha);
  const nativeHeaders=JSON.parse(pinned(sourceRoot+'/native-headers.json',positivePublication?'f2394102abeacfdb61eb7f1c56972a07b42e28023efdee367f318e03372b8583':preparation?'40c2c5108345667f6f7edc46afc3bb6c7aa169365840652a4cab49d1f9181c76':'3944ad86d29b7e9a702b5fa89466be0e60be1fe125cc873ee0172131593784a2'));
  const facts=JSON.parse(pinned(sourceRoot+'/sql-source-facts.json',positivePublication?'253a3d10e073ae7b6f01282d44c82175ad1abc14aa840144845efcd2d23a4969':preparation?'28fba7726dfd2de98c35b1c76b6454f8847e21d3da7ada01d055c9be35a57db2':'dfbf433a31f9e92fba51e137cf348ce0936c31b973427977d589bc05d23e4f7a'));
  let capturedFacts;
  if(preparation){const metadata=JSON.parse(pinned(sourceRoot+'/fixture-metadata.json',positivePublication?'9f1a959a7e299fa207f714e73e9ae86f1baabe2f698f4f6dd3232bddc7b40511':'693e2ec6d55b5ded42de61793e6348efe786dd4ef54493dd8b01e7845a9d5eb9'));
    assert.equal(raw.length,15091);assert.deepEqual(metadata.separationContext,facts.separationContext);assert.deepEqual(metadata.originalGeneration,facts.originalGeneration);
    capturedFacts=structuredClone(facts);const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(capturedFacts);
    Object.freeze(nativeHeaders);}
  const c=facts.separationContext,secret='SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08';
  const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'};
  const token=c.credential_id+'.'+secret;
  assert.equal(sha(Buffer.from(token)),facts.native_credential_sha256);
  const status={schema:preparation?'custodial.same-original-manager-preparation-native-read.v1':'custodial.same-original-recovery-native-status.v1',purpose:preparation?'READ_CURRENT_ORIGINAL_MANAGER_PREPARATION_ONLY':'OBSERVE_ORIGINAL_REGISTRATION_ONLY',
    original_challenge_body_base64:raw.toString('base64'),original_challenge_timestamp:nativeHeaders['x-memphis-native-request-timestamp'],
    original_challenge_http_attestation:nativeHeaders['x-memphis-native-request-attestation']};
  assert.ok(Date.now()-Date.parse(status.original_challenge_timestamp)>120000,'original must actually be archived beyond live freshness');
  const device={canonical_device_pk:c.device_id,canonical_device_id:c.canonical_device_id,device_active:true,employee_active:false,
    employee_code:'EMP001',assigned_employee_id:c.employee_id,assignment_epoch:String(c.assignment_epoch)};
  const credential={credential_id:c.credential_id,device_id:c.device_id,token_hash:'595479772eca56d2f19282dc14d00961fdb7e849ace539879bf45000b7e2b7b0',
    revoked_at:null,confirmed_at:'2026-01-01T00:00:00Z',metadata_json:{credential_secret_key_id:'86dbf23b4ae9a54d3d032f7b4b2cceb98395add7dc811476257b6bba1ce27778'}};
  const counts={credential:0,SQL:0,RPC:0},calls=[];
  const deps={env,store:{async findCredential(id){counts.credential++;assert.equal(id,c.credential_id);return structuredClone(credential);}},
    async runReadOnlySql(sql){counts.SQL++;calls.push(sql);
      if(sql.includes('with requested as'))return [structuredClone(device)];
      if(sql.includes('custodial_v13_read_separation_context'))return [{context:structuredClone(c)}];
      if(sql.includes('custodial_v14_read_separation_generation'))return [{original_generation:structuredClone(facts.originalGeneration)}];
      throw Error('UNEXPECTED_STATUS_SOURCE_SQL');}};
  const receipt=preparation?null:JSON.parse(fs.readFileSync(sourceRoot+'/actual-http-response.bin','utf8')).data;
  const readPath=preparation?exchange.sameOriginalRecoveryNativePreparationPath:exchange.sameOriginalRecoveryNativeStatusPath;
  function request(change=()=>{},timestamp=new Date().toISOString()) {
    const body=structuredClone(status);change(body);const bytes=Buffer.from(JSON.stringify(body));
    const headers={...nativeHeaders,authorization:'Device '+token,'x-memphis-native-request-timestamp':timestamp};
    headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',c.credential_id,
      c.canonical_device_id,'POST',readPath,sha(bytes),headers['x-memphis-native-request-id'],timestamp,'custodial'].join('\n')).digest('hex');
    return {method:'POST',originalUrl:readPath,headers,scanAuthorityRawBody:bytes,body};
  }
  let capturedRepresentation,representationUtf8;
  const sourceFilePins=positivePublication?{
    'request.bin':originalSha,
    'native-headers.json':'f2394102abeacfdb61eb7f1c56972a07b42e28023efdee367f318e03372b8583',
    'sql-source-facts.json':'253a3d10e073ae7b6f01282d44c82175ad1abc14aa840144845efcd2d23a4969',
    'fixture-metadata.json':'9f1a959a7e299fa207f714e73e9ae86f1baabe2f698f4f6dd3232bddc7b40511',
    'manager-preparation-http-response.bin':'ab895bc9f722841bf4c35962e1bd3cdac419963526bd1196aa0da35c6f83972a',
  }:{};
  const assertSourceUnchanged=()=>{for(const [file,digest] of Object.entries(sourceFilePins))pinned(sourceRoot+'/'+file,digest);};
  if(positivePublication){
    // EXPIRED immutable SQL-flow output: representation/parser data ONLY.
    // Preserve its exact data text and BOTH original receipt strings, not a
    // fabricated approval or renewed current-manager observation.
    const responseUtf8=pinned(sourceRoot+'/manager-preparation-http-response.bin','ab895bc9f722841bf4c35962e1bd3cdac419963526bd1196aa0da35c6f83972a');
    assert.equal(Buffer.byteLength(responseUtf8),4991);
    const prefix='{"ok":true,"data":';assert.ok(responseUtf8.startsWith(prefix)&&responseUtf8.endsWith('}'));
    representationUtf8=responseUtf8.slice(prefix.length,-1);capturedRepresentation=JSON.parse(representationUtf8);
    assert.equal(Object.keys(capturedRepresentation).length,9);
    assert.ok(Date.parse(capturedRepresentation.current_until)<Date.now(),'captured observation is expired, never live authority');
    assert.equal(capturedRepresentation.transaction_authority,false);assert.deepEqual(capturedRepresentation.limits,wire.recoveryDeniedEffects);
    Object.freeze(capturedRepresentation.limits);Object.freeze(capturedRepresentation);
  }
  return {raw,nativeHeaders,status,credential,facts,capturedFacts,originalSha,counts,calls,deps,receipt,request,capturedRepresentation,representationUtf8,assertSourceUnchanged};
}
await test('NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW normal current auth observes archived original with separate readonly brand and fixed reader',async()=>{
  const f=currentStatusSourceFixture(),req=f.request();let capture;
  try {
    capture=await exchange.captureAuthenticatedSameOriginalRecoveryNativeStatus(req,f.deps);
    assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeStatusCapture(capture),true);
    assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(capture),false);
    assert.throws(()=>exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge(capture));
    const binding=exchange.inspectAuthenticatedSameOriginalRecoveryNativeStatus(capture);
    assert.equal(binding.original_request_utf8,f.raw.toString('utf8'));
    assert.equal(binding.rpc_parameters.p_native_request_timestamp,f.status.original_challenge_timestamp);
    assert.equal(binding.rpc_parameters.p_native_request_body_sha256,sha(f.raw));
    const store=createStatus({inspectAuthenticatedNativeStatus:exchange.inspectAuthenticatedSameOriginalRecoveryNativeStatus,
      db:{async rpc(name,args){f.counts.RPC++;assert.equal(name,'custodial_same_original_preparation_registration_status_v1');
        assert.deepEqual(args,binding.rpc_parameters);return {data:JSON.stringify(f.receipt)};}}});
    assert.deepEqual(Object.keys(store),['readOriginalChallengeStatusOnce']);
    const result=await store.readOriginalChallengeStatusOnce(capture);
    assert.deepEqual(result,f.receipt);assert.deepEqual(result.limits,wire.recoveryDeniedEffects);
    assert.deepEqual(f.counts,{credential:1,SQL:3,RPC:1});
    await assert.rejects(()=>store.readOriginalChallengeStatusOnce(capture),unknown);assert.equal(f.counts.RPC,1);
    assert.equal(sha(f.raw),'c4869ac07c218ece3dfd844cced9f89888e478375e4291fe4a2ccbefb2b17579');
  } finally {exchange.closeAuthenticatedPrivateCustodyExchangeCapture(capture);req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
});
await test('NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW expired or tampered outer live read cannot use historical auth as fallback',async()=>{
  for(const mode of ['expired','signature']){
    const f=currentStatusSourceFixture(),req=f.request(()=>{},mode==='expired'?f.status.original_challenge_timestamp:new Date().toISOString());
    if(mode==='signature')req.headers['x-memphis-native-request-attestation']='0'.repeat(64);
    try{await assert.rejects(()=>exchange.captureAuthenticatedSameOriginalRecoveryNativeStatus(req,f.deps));
      assert.deepEqual(f.counts,{credential:1,SQL:1,RPC:0});}
    finally{req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
  }
});
await test('NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW current signed envelope cannot replace original challenge timestamp or signature',async()=>{
  for(const field of ['original_challenge_timestamp','original_challenge_http_attestation']){
    const f=currentStatusSourceFixture(),req=f.request(body=>{body[field]=field.endsWith('timestamp')?'2026-10-14T00:00:00.000Z':'0'.repeat(64);});
    try{await assert.rejects(()=>exchange.captureAuthenticatedSameOriginalRecoveryNativeStatus(req,f.deps));
      assert.deepEqual(f.counts,{credential:1,SQL:1,RPC:0});}
    finally{req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
  }
});
await test('NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW revoked or successor original generation refuses before fixed status reader',async()=>{
  for(const mode of ['revoked','generation']){
    const f=currentStatusSourceFixture(),req=f.request();
    if(mode==='revoked')f.credential.revoked_at='2026-10-14T12:00:00Z';
    else f.facts.originalGeneration.principal_digest='0'.repeat(64);
    try{await assert.rejects(()=>exchange.captureAuthenticatedSameOriginalRecoveryNativeStatus(req,f.deps));assert.equal(f.counts.RPC,0);}
    finally{req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
  }
});
async function statusRouteSourceCase(outcome,preparation=false,positivePublication=false) {
  const f=currentStatusSourceFixture(preparation,positivePublication),sourceRequest=f.request();
  const {default:express}=await import(preparation?pathToFileURL(backend+'/node_modules/express/index.js').href:'express');
  const {createGeneralJsonMiddleware}=await import(preparation?pathToFileURL(backend+'/src/request-json-parser.js').href:'../src/request-json-parser.js');
  const {installSameOriginalRecoveryNativeChallengeComposition:mount}=await import(preparation?pathToFileURL(backend+'/src/same-original-recovery-native-challenge-composition.js').href:'../src/same-original-recovery-native-challenge-composition.js');
  const app=express();let actualRequest,ownedRaw;
  app.use((req,res,next)=>{actualRequest=req;next();});app.use(createGeneralJsonMiddleware());
  const installed=mount(app,{...f.deps,db:{async rpc(name,args){
    if(preparation){
      f.counts.RPC++;assert.equal(name,'custodial_same_original_current_manager_preparation_v1');assert.ok(Object.isFrozen(args));
      assert.deepEqual(Object.keys(args).sort(),expectedNames.slice().sort());
      assert.equal(args.p_original_utf8,f.raw.toString('utf8'));assert.equal(args.p_native_request_timestamp,f.status.original_challenge_timestamp);
      assert.equal(args.p_native_request,f.nativeHeaders['x-memphis-native-request-id']);assert.equal(args.p_native_request_body_sha256,sha(f.raw));
      ownedRaw=actualRequest.scanAuthorityRawBody;await Promise.resolve();
      if(outcome==='revoked_after_read')f.credential.revoked_at=new Date().toISOString();
      if(outcome==='generation_after_read')f.facts.originalGeneration.principal_digest='0'.repeat(64);
      if(outcome==='lost_preparation')throw Error('SYNTHETIC_PREPARATION_READ_REPLY_LOST');
      if(positivePublication){
        let text=f.representationUtf8;
        if(outcome==='broken_receipt'){
          const copy=structuredClone(f.capturedRepresentation);copy.original_approval_receipt_utf8='{';text=JSON.stringify(copy);
        }
        if(outcome==='cross_original_receipt'){
          const copy=structuredClone(f.capturedRepresentation),registered=JSON.parse(copy.original_registration_utf8);
          registered.challenge_id='00000000-0000-4000-8000-000000000001';
          copy.original_registration_utf8=JSON.stringify(registered);text=JSON.stringify(copy);
        }
        return {data:text,error:null}; // Original SDK TEXT framing, recorded row port; NOT actual SQL authority.
      }
      // NO original manager approval source receipt is supplied. NULL remains
      // UNKNOWN; it is never replaced with fabricated manager metadata/HTTP200.
      return {data:null,error:null};
    }
    f.counts.RPC++;assert.equal(name,'custodial_same_original_preparation_registration_status_v1');
    assert.equal(args.p_original_utf8,f.raw.toString('utf8'));
    assert.equal(args.p_native_request_timestamp,f.status.original_challenge_timestamp);
    assert.equal(args.p_native_request_body_sha256,sha(f.raw));
    ownedRaw=actualRequest.scanAuthorityRawBody;
    if(outcome==='revoked_after_read')f.credential.revoked_at='2026-10-14T12:00:00Z';
    if(outcome==='lost_status')throw Error('SYNTHETIC_STATUS_REPLY_LOST');
    return {data:JSON.stringify(f.receipt)};
  }}});
  assert.deepEqual(installed,{path:'/device-auth/same-original-recovery/challenge',maxRequestBytes:786432,receiveDeadlineMs:30000});
  const server=http.createServer(app);const sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    const port=server.address().port;
    const result=await new Promise((resolve,reject)=>{
      const request=http.request({host:'127.0.0.1',port,path:sourceRequest.originalUrl,method:'POST',agent:false,
        headers:{...sourceRequest.headers,'content-type':'application/json','content-length':sourceRequest.scanAuthorityRawBody.length}},response=>{
          let received=0;const parts=[];response.on('data',chunk=>{received+=chunk.length;if(received>(preparation?131072:32768)){response.destroy(Error('STATUS_REPLY_CAP'));return;}parts.push(chunk);});
          response.on('error',reject);response.on('end',()=>{const bytes=Buffer.concat(parts);try{resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(bytes.toString('utf8'))});}catch(error){reject(error);}finally{bytes.fill(0);for(const p of parts)p.fill(0);}});
        });
      request.setTimeout(10000,()=>request.destroy(Error('STATUS_SOURCE_HTTP_TIMEOUT')));request.on('error',reject);request.end(sourceRequest.scanAuthorityRawBody);
    });
    assert.equal(f.counts.RPC,1,'exactly one status read and no writer/retry');
    assert.equal(result.headers['cache-control'],'private, no-store');
    if(positivePublication&&outcome==='captured_positive'){
      assert.equal(result.status,200);assert.deepEqual(result.body,{ok:true,data:f.capturedRepresentation});
      assert.equal(result.body.data.original_registration_utf8,f.capturedRepresentation.original_registration_utf8);
      assert.equal(result.body.data.original_approval_receipt_utf8,f.capturedRepresentation.original_approval_receipt_utf8);
      assert.equal(result.body.data.transaction_authority,false);assert.deepEqual(result.body.data.limits,wire.recoveryDeniedEffects);
    }
    else if(outcome==='original'&&!preparation) {assert.equal(result.status,200);assert.deepEqual(result.body,{ok:true,data:f.receipt});}
    else {assert.equal(result.status,503);assert.equal(result.body.outcome,'UNKNOWN');assert.equal(result.body.retry_safe,false);assert.deepEqual(result.body.limits,wire.recoveryDeniedEffects);}
    assert.equal(actualRequest.scanAuthorityRawBody,undefined);assert.equal(actualRequest.body,undefined);
    assert.ok(ownedRaw.every(value=>value===0));
    assert.equal(sha(f.raw),f.originalSha);
    if(preparation){assert.equal(f.counts.credential,2);assert.equal(f.counts.SQL,outcome==='revoked_after_read'?4:6);
      assert.ok(Object.isFrozen(f.capturedFacts.originalGeneration));}
  } finally {
    sourceRequest.scanAuthorityRawBody.fill(0);f.raw.fill(0);server.closeAllConnections();
    for(const socket of sockets)socket.destroy();
    if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(positivePublication){f.assertSourceUnchanged();assert.equal(server.listening,false);
      assert.ok([...sockets].every(socket=>socket.destroyed));
      if(actualRequest)for(const event of ['data','end','aborted','error'])assert.equal(actualRequest.listenerCount(event),0);}
  }
}
await test('NATIVE_REGISTRATION_STATUS_ROUTE_JOIN_NEW real local HTTP general parser and closed normal auth factory read original once',()=>statusRouteSourceCase('original'));
await test('NATIVE_REGISTRATION_STATUS_ROUTE_JOIN_NEW current credential withdrawal after read cannot publish retained receipt',()=>statusRouteSourceCase('revoked_after_read'));
await test('NATIVE_REGISTRATION_STATUS_ROUTE_JOIN_NEW lost readonly reply stays unknown without writer or retry',()=>statusRouteSourceCase('lost_status'));
await test('NATIVE_PREPARATION_CURRENT_AUTH_NEW actual preparation capture and inspector reject writer status brands',async()=>{
  const f=currentStatusSourceFixture(true),req=f.request();let capture;
  try{
    capture=await exchange.captureAuthenticatedSameOriginalRecoveryNativePreparation(req,f.deps);
    assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativePreparationCapture(capture),true);
    assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(capture),false);
    assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeStatusCapture(capture),false);
    assert.throws(()=>exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge(capture));
    assert.throws(()=>exchange.inspectAuthenticatedSameOriginalRecoveryNativeStatus(capture));
    const binding=exchange.inspectAuthenticatedSameOriginalRecoveryNativePreparation(capture);assert.equal(Object.keys(binding).length,8);
    assert.equal(binding.original_request_utf8,f.raw.toString('utf8'));assert.equal(binding.rpc_parameters.p_native_request_timestamp,f.status.original_challenge_timestamp);
    assert.equal(binding.rpc_parameters.p_native_request_body_sha256,sha(f.raw));
    const {createSameOriginalRecoveryNativePreparationStore:factory}=await import(pathToFileURL(backend+'/src/same-original-recovery-native-preparation-store.js'));
    const reader=factory({inspectAuthenticatedNativePreparationRead:exchange.inspectAuthenticatedSameOriginalRecoveryNativePreparation,
      db:{async rpc(name,args){f.counts.RPC++;assert.equal(name,'custodial_same_original_current_manager_preparation_v1');assert.deepEqual(args,binding.rpc_parameters);assert.ok(Object.isFrozen(args));return {data:null,error:null};}}});
    await assert.rejects(()=>reader.readCurrentManagerPreparationOnce(capture),unknown);
    await assert.rejects(()=>reader.readCurrentManagerPreparationOnce(capture),unknown);assert.equal(f.counts.RPC,1);
    assert.deepEqual(f.counts,{credential:1,SQL:3,RPC:1});assert.equal(sha(f.raw),f.originalSha);
  }finally{exchange.closeAuthenticatedPrivateCustodyExchangeCapture(capture);if(capture)assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativePreparationCapture(capture),false);req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
});
await test('NATIVE_PREPARATION_CURRENT_AUTH_NEW expired bad live READ and altered archive cannot authenticate',async()=>{
  for(const mode of ['expired','signature','original_time','original_signature','original_body']){
    const f=currentStatusSourceFixture(true),req=f.request(body=>{
      if(mode==='original_time')body.original_challenge_timestamp='2000-02-29T12:34:56.007Z';
      if(mode==='original_signature')body.original_challenge_http_attestation='0'.repeat(64);
      if(mode==='original_body'){const changed=Buffer.from(f.raw);changed[0]=0xff;body.original_challenge_body_base64=changed.toString('base64');changed.fill(0);}
    },mode==='expired'?f.status.original_challenge_timestamp:new Date().toISOString());
    if(mode==='signature')req.headers['x-memphis-native-request-attestation']='0'.repeat(64);
    try{await assert.rejects(()=>exchange.captureAuthenticatedSameOriginalRecoveryNativePreparation(req,f.deps));assert.equal(f.counts.RPC,0);assert.equal(sha(f.raw),f.originalSha);}
    finally{req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
  }
});
await test('NATIVE_PREPARATION_CURRENT_AUTH_NEW current credential and original generation withdrawal refuse',async()=>{
  for(const mode of ['credential','generation']){const f=currentStatusSourceFixture(true),req=f.request();
    if(mode==='credential')f.credential.revoked_at=new Date().toISOString();else f.facts.originalGeneration.principal_digest='0'.repeat(64);
    try{await assert.rejects(()=>exchange.captureAuthenticatedSameOriginalRecoveryNativePreparation(req,f.deps));assert.equal(f.counts.RPC,0);assert.equal(sha(f.raw),f.originalSha);}
    finally{req.scanAuthorityRawBody.fill(0);f.raw.fill(0);}
  }
});
await test('NATIVE_PREPARATION_ROUTE_JOIN_NEW actual parser private composition NULL stays UNKNOWN and cleaned',()=>statusRouteSourceCase('absent_preparation',true));
await test('NATIVE_PREPARATION_ROUTE_JOIN_NEW credential revoked AFTER reader is reauthenticated and refused',()=>statusRouteSourceCase('revoked_after_read',true));
await test('NATIVE_PREPARATION_ROUTE_JOIN_NEW generation withdrawn AFTER reader is reauthenticated and refused',()=>statusRouteSourceCase('generation_after_read',true));
await test('NATIVE_PREPARATION_ROUTE_JOIN_NEW lost readonly result cannot retry or fall back',()=>statusRouteSourceCase('lost_preparation',true));
// NEW ONLY: Main executes these through its normal permitted bounded runner.
// The loan is expired representation, not present SQL/manager/native authority.
if(positivePublicationOnly){
await test('NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW exact captured nine-field representation and raw receipts publish metadata only',()=>statusRouteSourceCase('captured_positive',true,true));
await test('NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW valid captured positive result cannot publish after credential withdrawal',()=>statusRouteSourceCase('revoked_after_read',true,true));
await test('NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW valid captured positive result cannot publish after original generation withdrawal',()=>statusRouteSourceCase('generation_after_read',true,true));
await test('NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW lost captured-result read stays unknown without fallback or retry',()=>statusRouteSourceCase('lost_preparation',true,true));
await test('NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW broken copied approval receipt refuses without replacement',()=>statusRouteSourceCase('broken_receipt',true,true));
await test('NATIVE_PREPARATION_POSITIVE_PUBLICATION_NEW cross-original copied registration receipt refuses without adoption',()=>statusRouteSourceCase('cross_original_receipt',true,true));
}
console.log(JSON.stringify({cases, scope: preparationOnly
  ? positivePublicationOnly?'EXPIRED_CAPTURED_REPRESENTATION_SOURCE_PUBLICATION_WITH_RECORDING_ROWS_NOT_CURRENT_MANAGER_SQL':process.argv[3]==='NATIVE_PREPARATION_ROUTE_JOIN_NEW'
    ? 'ACTUAL_PREPARATION_ROUTE_AUTH_PARSER_SOURCE_NULL_OR_LOST_READ_WITH_RECORDING_ROWS_NOT_MANAGER_SQL'
    : 'ACTUAL_PREPARATION_AUTH_CAPTURE_PRIVATE_BRAND_WITH_RECORDING_ROWS_NOT_MANAGER_SQL'
  : process.argv[3]==='NATIVE_REGISTRATION_STATUS_ROUTE_JOIN_NEW'
  ? 'ACTUAL_LOOPBACK_HTTP_PARSER_AUTH_STATUS_ROUTE_COMPOSITION_SYNTHETIC_ROWS_RECORDING_SQL_RPC'
  : process.argv[3]==='NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW'
  ? 'ACTUAL_CURRENT_AUTH_AND_STATUS_ADAPTER_SOURCE_SYNTHETIC_ROWS_RECORDING_SQL_RPC_ARCHIVED_NATIVE_SOURCE_BYTES'
  : 'ACTUAL_ADAPTER_SOURCE_SYNTHETIC_OPAQUE_INSPECTOR_AND_RECORDING_RPC',
  inspector_source_sha256: preparationOnly?'428afacafe7f3cde828694cdb35c1433a168f1f26eeb8a88414fd82115a21362':'f52b8a553911e0b11ec598550a5da272c811d013e7d6ed994a78a25d9c5802b7', parameter_names: expectedNames,
  ...(preparationOnly?{original_packet:positivePublicationOnly?'KmVe5w':'dw6N3L',positive_manager_preparation_publication:positivePublicationOnly?'EXPIRED_REPRESENTATION_ONLY_NO_CURRENT_MANAGER_AUTHORITY':'NOT_RUN_ORIGINAL_MANAGER_RECEIPT_SOURCE_MISSING'}:{}),
  actual_branded_positive_capture: preparationOnly
    ? cases[0]?.passed?'ACTUAL_PREPARATION_CAPTURE_REACHED_SOURCE_READER_NO_MANAGER_OR_SQL_AUTHORITY':'NOT_COMPLETED'
    : ['NATIVE_REGISTRATION_CURRENT_STATUS_AUTH_NEW','NATIVE_REGISTRATION_STATUS_ROUTE_JOIN_NEW'].includes(process.argv[3])
    ? 'PASS_ACTUAL_SOURCE_PRIVATE_BRAND_SYNTHETIC_ROWS_NOT_LIVE_AUTH' : 'NOT_RUN_BY_THIS_ADAPTER_SELECTOR',
  actual_SQL_registration: 'NOT_RUN_BY_THIS_SOURCE_SELECTOR',
  listener: false, real_auth: false, native: false, effects: false, resources: {sockets: 0, DB_connections: 0, JVMs: 0}}));
