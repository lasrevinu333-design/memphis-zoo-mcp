import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Only NEW raw ingress/dependency/refusal caller checks. No listener, SQL or
// injected capture. The sealed Java SOURCE vector is deliberately UNTRUSTED;
// it is NOT an Engine-prepared challenge/HMAC/current-context positive fixture.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), backend = process.argv[2];
const nativeStatusOnly = process.argv[3] === 'NATIVE_CHALLENGE_STATUS_SOURCE_NEW';
const completionCompositionOnly = process.argv[3] === 'NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW';
assert.ok(backend && path.isAbsolute(backend), 'absolute backend source required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function pinned(file, digest) { const bytes = fs.readFileSync(file); assert.equal(sha(bytes), digest, file); return bytes.toString('utf8'); }
const pins = {
  'src/native-private-custody-exchange.js': 'ba138011ecadc2c0203ee755e2082810a42efc37913e2aa915ed17ff9f6d7106',
  'src/same-original-recovery-native-challenge-wire.js': 'f5ded6124a32644df4c839dfe01040918b5de1ce7f4d7d7f3e85fcd98a1a5e18',
  'src/same-original-recovery-wire.js': 'bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7',
  'src/native-private-custody-current-query-wire.js': '0e49384067113b3849a03bab8a075894c0782ce1ec8e13465f453c759d7123b9',
};
// Explicitly admitted combined status dependencies; historical/default pins
// remain unchanged. This mode still uses production decoder/capture imports.
const statusPins = {
  ...pins,
  'src/native-private-custody-exchange.js': 'f52b8a553911e0b11ec598550a5da272c811d013e7d6ed994a78a25d9c5802b7',
  'src/same-original-recovery-native-challenge-wire.js': '52fdfe487e98dadd83b1d9edc806a55cb9375faefad459e134963d79ecdd409c',
};
const completionPins = completionCompositionOnly ? {
  'src/same-original-completion-read-store.js': '4955f2380e5dbc83d81c6ee618722d409e324c39fd0234ac6208bc127317c863',
  'src/native-private-custody-exchange.js': 'd89306e6ff7ad6e9c9dbbb9c77087be097bc5138c3664e005852cdef4c8e1c6f',
  'src/same-original-recovery-native-challenge-route.js': '0ca83b15ba98824c581cf0bb13af91ad7a5852cd66ff908fbe23c896f478c8b4',
  'src/same-original-completion-read-wire.js': '9fcb090311e36ca179147ce8696cecc67ef3e7f7d6f37a932863ecaa0a151c05',
  'src/native-private-custody-current-query-wire.js': '0e49384067113b3849a03bab8a075894c0782ce1ec8e13465f453c759d7123b9',
} : null;
if (completionCompositionOnly) {
  // Main admitted the fixed store/capture source before this selector's first
  // invocation; no copied inspector or callback can replace those real imports.
  const fixedStoreFile = backend + '/src/same-original-completion-read-store.js';
  assert.ok(fs.existsSync(fixedStoreFile), 'same_original_completion_store_missing_Main_seal_required');
}
for (const [file, digest] of Object.entries(completionCompositionOnly ? completionPins : nativeStatusOnly ? statusPins : pins)) pinned(backend + '/' + file, digest);
const emittedSourceOnly = process.argv[3] === 'NATIVE_CHALLENGE_EMITTED_SOURCE_NEW';
const emittedFutureOnly = process.argv[3] === 'NATIVE_CHALLENGE_FUTURE_PACKET_SOURCE_NEW';
const emittedFaultsOnly = process.argv[3] === 'NATIVE_CHALLENGE_POST_WRITER_SOURCE_NEW';
const emittedCurrentOnly = process.argv[3] === 'NATIVE_CHALLENGE_CURRENT_CLOCK_SOURCE_NEW';
const emittedInputOnly = emittedSourceOnly || emittedFutureOnly || emittedFaultsOnly || emittedCurrentOnly;
const compositionOnly = process.argv[3] === 'NATIVE_CHALLENGE_COMPOSITION_NEW';
const compositionUrl = pathToFileURL((emittedFutureOnly || emittedCurrentOnly ? backend : root) + '/src/same-original-recovery-native-challenge-composition.js').href;
if (compositionOnly) {
  pinned(backend + '/src/same-original-recovery-native-challenge-store.js', 'e793144e046a047cf29318254ea966639e3fbd9e006ed378f37c2a10d7a1e919');
  pinned(backend + '/src/same-original-recovery-native-challenge-route.js', '085ef845aae36c20642b644b76c9e0db60f91a906a77903ba3d9f4e3b6dfe2d4');
}
if (emittedInputOnly) {
  pinned(backend + '/scripts/native-private-custody-http-piece-tests.mjs', '167626f8f68c6fb5c3a4f5e3b1c52c02c704199479749b8bc05508a7c817d618');
  pinned(backend + '/src/auth/device-credential-auth.js', 'ba20ff22b7ab815270311572838d7d9400b5cdc53f80500fe02b43555d6e5aa1');
  pinned(backend + '/src/same-original-recovery-native-challenge-store.js', '77784920f7bfebfe428658bb10c95718890d1cf08a285f1f32be50a6f14b9aee');
  pinned(backend + '/src/same-original-recovery-native-challenge-route.js', '085ef845aae36c20642b644b76c9e0db60f91a906a77903ba3d9f4e3b6dfe2d4');
  pinned(backend + '/src/same-original-recovery-native-challenge-composition.js', '6d20867aedbcbfef1dcdbbea5370f8bbbf27480fa2f73cad746afa708d711aad');
}
const routeUrl = pathToFileURL((completionCompositionOnly || compositionOnly || emittedInputOnly ? backend : root) + '/src/same-original-recovery-native-challenge-route.js').href;
const hook = registerHooks({resolve(specifier, context, next) {
  if ([routeUrl, compositionUrl].includes(context.parentURL) && specifier.startsWith('./'))
    return next(pathToFileURL(path.join(backend, 'src', specifier)).href, context);
  return next(specifier, context);
}});
const {installSameOriginalRecoveryNativeChallengeRoute: install,
  installSameOriginalRecoveryNativeStatusRoute: installStatus} = await import(routeUrl);
const installComposition = completionCompositionOnly || compositionOnly || emittedFutureOnly || emittedCurrentOnly
  ? (await import(compositionUrl)).installSameOriginalRecoveryNativeChallengeComposition : null;
const completionStoreFactory = completionCompositionOnly
  ? (await import(pathToFileURL(backend + '/src/same-original-completion-read-store.js'))).createSameOriginalCompletionReadStore : null;
hook.deregister();
const exchange = await import(pathToFileURL(backend + '/src/native-private-custody-exchange.js'));
const {decodeSameOriginalRecoveryNativeChallenge: decode,
  decodeSameOriginalRecoveryNativeStatus: decodeStatus} = await import(pathToFileURL(backend + '/src/same-original-recovery-native-challenge-wire.js'));
const wire = await import(pathToFileURL(backend + '/src/same-original-recovery-wire.js'));
const emittedStore = emittedInputOnly
  ? (await import(pathToFileURL(backend + '/src/same-original-recovery-native-challenge-store.js'))).createSameOriginalRecoveryNativeChallengeStore : null;
const sourceCredentials = emittedInputOnly
  ? (await import(pathToFileURL(backend + '/src/auth/device-credential-auth.js'))).deviceCredentialInternals : null;
const endpoint = '/device-auth/same-original-recovery/challenge';
assert.equal(exchange.sameOriginalRecoveryNativeChallengePath, endpoint);

// Exact fixture extraction already used in the existing decoder test. Reading
// these sealed source literals does NOT execute Java or invent a signed proof.
let body, vectorRaw;
if (!emittedInputOnly && !completionCompositionOnly) {
const packet = '/home/eric/Documents/Codex/2026-10-09/task-7/g08-native-challenge-envelope-20261014-v1';
pinned(packet + '/HANDOFF.json', 'eabbba8a663c1e3693c4d2521fe9becd7e8a408431b01569a36b89363515bd5a');
const javaRoot = packet + '/mobile/plugins/custodial-native-vault/android/src/';
pinned(javaRoot + 'main/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelope.java',
  '31743a79877a5c0bf2ae625826e5a0b6ec56d7ac772333497159a26b49a078b4');
const vectors = pinned(javaRoot + 'test/java/org/memphiszoo/custodial/vault/NativeSameOriginalRecoveryChallengeEnvelopeTest.java',
  '8cb99ed151ab75c85eecb28980d898cc34c694354af2ee1b176ca6e97e58aa9d');
const id = vectors.match(/String ID="([^"]+)"/)[1], other = vectors.match(/String OTHER="([^"]+)"/)[1];
const time = vectors.match(/String TIME="([^"]+)"/)[1];
assert.ok(vectors.includes('String SHA="a".repeat(64),OTHER_SHA="b".repeat(64)'));
function sourceObject(start, end) {
  const begin = vectors.indexOf(start); assert.ok(begin >= 0);
  const text = vectors.slice(begin, vectors.indexOf(end, begin)), result = {};
  for (const match of text.matchAll(/for\(String key:new String\[\]\{([^}]+)\}\)value\.put\(key,(ID|SHA)\)/g))
    for (const key of [...match[1].matchAll(/"([A-Za-z0-9_.-]+)"/g)].map(value => value[1]))
      result[key] = match[2] === 'ID' ? id : 'a'.repeat(64);
  for (const match of text.matchAll(/\.put\("([^"]+)","([^"]+)"\)/g)) result[match[1]] = match[2];
  return result;
}
const target = sourceObject('private static JSONObject targetJson()', 'private static NativeSameOriginalRecoveryPreparationWire.UntrustedTarget target()');
const query = sourceObject('private static JSONObject query()', 'private static JSONObject outer(');
const current = Buffer.from(JSON.stringify({schema: 'custodial.original-private-custody-current-query.v1',
  original_query_body_base64: Buffer.from(JSON.stringify(query)).toString('base64'), original_query_timestamp: time,
  original_query_http_attestation: 'a'.repeat(64), original_query_unknown_record_sha256: 'b'.repeat(64)}));
body = {schema: 'custodial.same-original-recovery-native-challenge.v1', purpose: wire.recoveryPreparationPurpose,
  native_challenge_intent_id: other, native_challenge_intent_record_sha256: 'a'.repeat(64),
  current_original_query_envelope_base64: current.toString('base64'), original_target: target,
  original_target_sha256: wire.recoveryDocumentSha256('target', target)};
vectorRaw = Buffer.from('\n ' + JSON.stringify(body) + '\t');
assert.deepEqual(decode(vectorRaw), body); // Representation prerequisite ONLY.
}

class Response extends EventEmitter {
  constructor() { super(); this.statusCode = 200; this.headers = {}; this.body = null; this.endCalls = 0; }
  setHeader(key, value) { this.headers[key] = value; }
  status(value) { this.statusCode = value; return this; }
  json(value) { this.body = value; this.headersSent = true; this.writableEnded = true; return this; }
  end() { this.writableEnded = true; this.endCalls++; }
}
function fixture() {
  const calls = {credential: 0, SQL: 0, writer: 0}, registrations = [];
  const dependencies = {env: {NODE_ENV: 'test', DEVICE_CREDENTIAL_SECRET: 'SYNTHETIC_ONLY_NOT_AN_AUTH_PROOF'},
    store: {async findCredential() { calls.credential++; throw Error('NO_AUTHENTICATED_CHALLENGE_FIXTURE'); }},
    async runReadOnlySql() { calls.SQL++; throw Error('NO_AUTHENTICATED_CHALLENGE_FIXTURE'); },
    async registerOriginalChallengeOnce(capture) {
      calls.writer++; assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(capture), true);
      throw Error('UNEXPECTED_WRITER_WITHOUT_AUTHENTICATED_FIXTURE');
    }};
  const app = {use: callback => registrations.push({method: 'use', callback}),
    post: (path, callback) => registrations.push({method: 'post', path, callback})};
  function mount() { return install(app, dependencies); }
  function request({url = endpoint, method = 'POST', headers = {}, targetPath = endpoint} = {}) {
    const req = new EventEmitter(), res = new Response();
    Object.assign(req, {method, originalUrl: url, url, path: url.split('?')[0], headers: {
      'content-type': 'application/json', ...headers}, complete: true, aborted: false});
    let admitted = false;
    const post = registrations.findIndex(row => row.method === 'post' && row.path === targetPath);
    assert.ok(post > 0 && registrations[post - 1].method === 'use', 'actual_fixed_route_guard_required');
    registrations[post - 1].callback(req, res, () => { admitted = true; });
    if (admitted) registrations[post].callback(req, res);
    async function send(raw) { req.emit('data', raw); const end = req.listeners('end')[0]; if (end) await end.call(req); }
    function clean(expectedRaw = undefined, expectedBody = undefined) {
      assert.equal(req.scanAuthorityRawBody, expectedRaw); assert.equal(req.body, expectedBody);
      for (const event of ['data', 'end', 'aborted', 'close', 'error']) assert.equal(req.listenerCount(event), 0, event);
      assert.equal(res.listenerCount('close'), 0);
    }
    return {req, res, admitted, send, clean};
  }
  return {app, dependencies, registrations, calls, mount, request};
}
const cases = [];
async function test(name, callback) {
  const select = process.argv[3];
  if (completionCompositionOnly ? !name.startsWith('NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW ')
    : nativeStatusOnly ? !name.startsWith('NATIVE_CHALLENGE_STATUS_SOURCE_NEW ')
    : emittedCurrentOnly ? !name.startsWith('NATIVE_CHALLENGE_CURRENT_CLOCK_SOURCE_NEW ')
    : emittedFutureOnly ? !name.startsWith('NATIVE_CHALLENGE_FUTURE_PACKET_SOURCE_NEW ')
    : emittedFaultsOnly ? !name.startsWith('NATIVE_CHALLENGE_POST_WRITER_SOURCE_NEW ')
    : emittedSourceOnly ? !name.startsWith('NATIVE_CHALLENGE_EMITTED_SOURCE_NEW ')
    : compositionOnly ? !name.startsWith('NATIVE_CHALLENGE_COMPOSITION_NEW ') : select && select !== name) return;
  try { await callback(); cases.push({name, passed: true}); console.log('PASS ' + name); }
  catch (error) { cases.push({name, passed: false, error: error.code ?? error.name}); process.exitCode = 1;
    console.error('FAIL ' + name + ' ' + (error.code ?? error.name)); if (completionCompositionOnly) throw error; }
}
function noEffects(f) { assert.deepEqual(f.calls, {credential: 0, SQL: 0, writer: 0}); }
function unknown(res) { assert.equal(res.body.outcome, 'UNKNOWN'); assert.equal(res.body.retry_safe, false);
  assert.deepEqual(res.body.limits, wire.recoveryDeniedEffects); }

await test('NATIVE_ROUTE_NEW missing and alternate dependencies refuse before route registration', async () => {
  for (const change of [
    value => { delete value.registerOriginalChallengeOnce; }, value => { value.registerOriginalChallengeOnce = null; },
    value => { delete value.runReadOnlySql; }, value => { value.runReadOnlySql = null; },
    value => { delete value.store.findCredential; }, value => { delete value.env; },
    value => { value.now = new Date(); }, value => { value.capture = async () => ({}); },
    value => { value.auth = {}; }, value => { value.db = {}; }, value => { value.role = 'service_role'; },
    value => { Object.defineProperty(value, 'env', {enumerable: true, get() { throw Error('GETTER_MUST_NOT_RUN'); }}); },
  ]) {
    const f = fixture(); change(f.dependencies);
    assert.throws(() => f.mount(), {code: 'same_original_recovery_native_dependencies_required', status: 503});
    assert.equal(f.registrations.length, 0); noEffects(f);
  }
});
await test('NATIVE_ROUTE_NEW fixed route and immutable non-authority metadata', async () => {
  const f = fixture(), installed = f.mount();
  assert.deepEqual(installed, {path: endpoint, maxRequestBytes: 786432, receiveDeadlineMs: 30000});
  assert.ok(Object.isFrozen(installed)); assert.deepEqual(f.registrations.map(row => row.method), ['use', 'post']);
  assert.equal(f.registrations[1].path, endpoint); noEffects(f);
});
await test('NATIVE_ROUTE_NEW exact URL method content type compression reject before capture', async () => {
  const f = fixture(); f.mount();
  for (const url of [endpoint + '?x=1', endpoint + '/', endpoint + '/foreign', endpoint.toUpperCase(), endpoint.replace('device-auth', '%64evice-auth')]) {
    const r = f.request({url}); assert.equal(r.res.statusCode, 400); assert.equal(r.admitted, false); unknown(r.res); r.clean();
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT']) {
    const r = f.request({method}); assert.equal(r.res.statusCode, 405); unknown(r.res); r.clean();
  }
  for (const headers of [{'content-type': 'text/plain'}, {'content-encoding': 'gzip'}, {'content-encoding': ''}]) {
    const r = f.request({headers}); assert.equal(r.res.statusCode, 415); unknown(r.res); r.clean();
  }
  noEffects(f);
});
await test('NATIVE_ROUTE_NEW actual duplicate-free fatal UTF8 ingress refuses malformed before capture', async () => {
  const f = fixture(); f.mount();
  for (const raw of [Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(0), Buffer.from('\ufeff' + JSON.stringify(body)),
    Buffer.from('{"schema":"' + body.schema + '",' + JSON.stringify(body).slice(1)),
    Buffer.from(JSON.stringify({...body, authority: 'invented'}))]) {
    const r = f.request(); await r.send(raw); assert.equal(r.res.statusCode, 400); unknown(r.res); r.clean();
  }
  noEffects(f);
});
await test('NATIVE_ROUTE_NEW declared and streaming raw ceilings preserve borrowed input', async () => {
  const f = fixture(); f.mount();
  const declared = f.request({headers: {'content-length': '786433'}});
  assert.equal(declared.res.statusCode, 413); declared.clean();
  const r = f.request(), chunk = Buffer.alloc(786433, 120), before = Buffer.from(chunk);
  await r.send(chunk); assert.equal(r.res.statusCode, 413); assert.deepEqual(chunk, before); unknown(r.res); r.clean();
  const shared = f.request(), bytes = Buffer.from(new SharedArrayBuffer(5)); bytes.fill(99);
  await shared.send(bytes); assert.equal(shared.res.statusCode, 400); assert.ok(bytes.every(value => value === 99)); shared.clean();
  noEffects(f);
});
await test('NATIVE_ROUTE_NEW aborted and closed receive release listeners with no auth or writer', async () => {
  for (const event of ['aborted', 'close', 'error', 'response-close']) {
    const f = fixture(); f.mount(); const r = f.request(), borrowed = Buffer.from('{');
    r.req.emit('data', borrowed);
    if (event === 'response-close') r.res.emit('close'); else r.req.emit(event);
    assert.deepEqual(borrowed, Buffer.from('{')); r.clean(); noEffects(f);
    if (event === 'response-close') assert.equal(r.res.endCalls, 1); else unknown(r.res);
  }
});
await test('NATIVE_ROUTE_NEW valid untrusted source representation cannot enter actual branded writer', async () => {
  const f = fixture(); f.mount(); const r = f.request();
  const before = Buffer.from(vectorRaw);
  await r.send(vectorRaw); assert.equal(r.res.statusCode, 403); unknown(r.res); r.clean(); noEffects(f);
  assert.deepEqual(vectorRaw, before);
});
await test('NATIVE_ROUTE_NEW rejected capture wipes original allocation not foreign substituted pointer', async () => {
  const f = fixture(); f.mount(); const r = f.request();
  r.req.emit('data', vectorRaw); const pending = r.req.listeners('end')[0].call(r.req);
  const ownedRaw = r.req.scanAuthorityRawBody; assert.ok(Buffer.isBuffer(ownedRaw));
  const foreign = Buffer.from('FOREIGN_BORROWED_FIXTURE'), before = Buffer.from(foreign);
  r.req.scanAuthorityRawBody = foreign;
  await pending; assert.equal(r.res.statusCode, 403); assert.ok(ownedRaw.every(value => value === 0));
  assert.deepEqual(foreign, before); r.clean(foreign); noEffects(f);
});
await test('NATIVE_ROUTE_CLEANUP_NEW malformed error response hook preserves never-owned foreign fields', async () => {
  const f = fixture(); f.mount(); const r = f.request();
  const malformed = Buffer.from('{"schema":'), borrowedBefore = Buffer.from(malformed);
  const foreignRaw = Buffer.from('FOREIGN_ERROR_RESPONSE_RAW'), foreignBefore = Buffer.from(foreignRaw);
  const foreignBody = Object.freeze({schema: 'FOREIGN_ERROR_RESPONSE_OBJECT'});
  const json = r.res.json;
  r.res.json = function (value) {
    r.req.scanAuthorityRawBody = foreignRaw;
    r.req.body = foreignBody;
    return json.call(this, value);
  };
  // Observe the actual lexical allocation; forward the original native concat
  // unchanged. No alternate bytes, parser, capture, auth or writer is injected.
  const concat = Buffer.concat, allocations = [];
  Buffer.concat = function (...args) {
    const result = Reflect.apply(concat, this, args); allocations.push(result); return result;
  };
  try {
    await r.send(malformed);
    assert.equal(r.res.statusCode, 400); unknown(r.res); noEffects(f);
    assert.equal(allocations.length, 1); assert.equal(allocations[0].length, malformed.length);
    assert.ok(allocations[0].every(value => value === 0));
    r.clean(foreignRaw, foreignBody);
    assert.deepEqual(foreignRaw, foreignBefore); assert.deepEqual(malformed, borrowedBefore);
  } finally { Buffer.concat = concat; }
});
if (compositionOnly) {
  // Reuse the actual existing recording app/ingress/response fixture. Only
  // current registry/read-only/RPC dependencies are supplied; no fake inspector
  // or registration callback enters the composition being qualified here.
  function composedFixture() {
    const f = fixture();
    const dependencies = {env: f.dependencies.env, store: f.dependencies.store,
      runReadOnlySql: f.dependencies.runReadOnlySql, db: {async rpc() {
        f.calls.writer++; throw Error('NO_AUTHENTICATED_CHALLENGE_FIXTURE');
      }}};
    return {...f, compositionDependencies: dependencies, compose() { return installComposition(f.app, dependencies); }};
  }
  await test('NATIVE_CHALLENGE_COMPOSITION_NEW closed missing extra and accessor dependencies deny before registration', async () => {
    for (const change of [
      ...['env', 'store', 'runReadOnlySql', 'db'].map(key => value => { delete value[key]; }),
      ...['auth', 'inspectAuthenticatedNativeChallenge', 'registerOriginalChallengeOnce', 'rpcName', 'path', 'role', 'now', 'client']
        .map(key => value => { value[key] = 'NOT_ADMITTED'; }),
      value => { Object.defineProperty(value, 'env', {enumerable: true, get() { throw Error('GETTER_MUST_NOT_RUN'); }}); },
      value => { value[Symbol('foreign')] = true; },
    ]) {
      const f = composedFixture(); change(f.compositionDependencies);
      assert.throws(() => f.compose(), {code: 'same_original_recovery_native_composition_unavailable', status: 503, retry_safe: false});
      assert.equal(f.registrations.length, 0); noEffects(f);
    }
  });
  await test('NATIVE_CHALLENGE_COMPOSITION_NEW proxy dependencies never invoke caller traps', async () => {
    let traps = 0;
    const handler = {get() { traps++; throw Error('TRAP_MUST_NOT_RUN'); }, ownKeys() { traps++; throw Error('TRAP_MUST_NOT_RUN'); },
      getPrototypeOf() { traps++; throw Error('TRAP_MUST_NOT_RUN'); }};
    for (const key of ['whole', 'env', 'store', 'runReadOnlySql', 'db']) {
      const f = composedFixture();
      if (key === 'whole') {
        assert.throws(() => installComposition(f.app, new Proxy(f.compositionDependencies, handler)), {status: 503});
      } else {
        f.compositionDependencies[key] = new Proxy(f.compositionDependencies[key], handler);
        assert.throws(() => f.compose(), {status: 503});
      }
      assert.equal(f.registrations.length, 0); noEffects(f);
    }
    assert.equal(traps, 0);
  });
  await test('NATIVE_CHALLENGE_COMPOSITION_NEW explicit authoritative callable methods required without getter fallback', async () => {
    for (const change of [
      value => { value.env = undefined; }, value => { value.env = []; }, value => { value.runReadOnlySql = {}; },
      value => { delete value.store.findCredential; }, value => { value.db.rpc = null; },
      value => { Object.defineProperty(value.store, 'findCredential', {get() { throw Error('METHOD_GETTER_MUST_NOT_RUN'); }}); },
      value => { Object.defineProperty(value.db, 'rpc', {get() { throw Error('METHOD_GETTER_MUST_NOT_RUN'); }}); },
    ]) {
      const f = composedFixture(); change(f.compositionDependencies);
      assert.throws(() => f.compose(), {code: 'same_original_recovery_native_composition_unavailable', status: 503});
      assert.equal(f.registrations.length, 0); noEffects(f);
    }
  });
  await test('NATIVE_CHALLENGE_COMPOSITION_NEW direct actual factories wire fixed route and expose safe metadata only', async () => {
    const f = composedFixture(), installed = f.compose();
    assert.deepEqual(installed, {path: endpoint, maxRequestBytes: 786432, receiveDeadlineMs: 30000});
    assert.ok(Object.isFrozen(installed));
    assert.deepEqual(f.registrations.map(row => row.method), ['use', 'post']); assert.equal(f.registrations[1].path, endpoint);
    assert.equal(Object.values(installed).some(value => typeof value === 'function'), false); noEffects(f);
  });
  await test('NATIVE_CHALLENGE_COMPOSITION_NEW actual installed ingress and untrusted capture refusal reach no RPC', async () => {
    const f = composedFixture(); f.compose();
    const malformed = f.request(); await malformed.send(Buffer.from('{')); assert.equal(malformed.res.statusCode, 400);
    unknown(malformed.res); malformed.clean();
    const untrusted = f.request(); await untrusted.send(vectorRaw); assert.equal(untrusted.res.statusCode, 403);
    unknown(untrusted.res); untrusted.clean(); noEffects(f);
  });
}

if (completionCompositionOnly) {
  const completionPath = '/device-auth/private-custody-original-completion-read';
  function completionFixture() {
    const f = fixture(), rpcCalls = [];
    const db = {async rpc(name, parameters) {
      rpcCalls.push({name, parameters});
      throw Error('NO_AUTHENTICATED_ORIGINAL_COMPLETION_FIXTURE');
    }};
    const dependencies = {env: f.dependencies.env, store: f.dependencies.store,
      runReadOnlySql: f.dependencies.runReadOnlySql, db};
    return {...f, rpcCalls, db, dependencies,
      compose() { return installComposition(f.app, dependencies); },
      completionRequest(options = {}) { return f.request({url: completionPath, ...options, targetPath: completionPath}); }};
  }
  function noCompletionEffects(f) { noEffects(f); assert.equal(f.rpcCalls.length, 0); }
  function completionBody() {
    // Deliberately UNAUTHENTICATED representation. No original proof/nonce/ID
    // or Source brand is manufactured to enter the real private reader.
    const original = Buffer.from(' {"schema":"custodial.original-native-private-custody-query.v1"} ');
    const query = Buffer.from(JSON.stringify({schema: 'custodial.original-private-custody-current-query.v1',
      original_query_body_base64: original.toString('base64'), original_query_timestamp: '2000-02-29T12:34:56.007Z',
      original_query_http_attestation: 'a'.repeat(64), original_query_unknown_record_sha256: 'b'.repeat(64)}));
    return {schema: 'custodial.same-original-completion-read.v1', current_original_query_envelope_base64: query.toString('base64'),
      original_completion_arguments_base64: Buffer.from(' {"opaque":"UNAUTHENTICATED_SOURCE_ONLY"} ').toString('base64')};
  }
  await test('NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW fixed actual store route registration and unchanged metadata', async () => {
    const f = completionFixture(), result = f.compose();
    assert.deepEqual(result, {path: endpoint, maxRequestBytes: 786432, receiveDeadlineMs: 30000});
    assert.ok(Object.isFrozen(result)); assert.equal(Object.values(result).some(value => typeof value === 'function'), false);
    assert.deepEqual(f.registrations.filter(row => row.method === 'post').map(row => row.path), [
      endpoint, '/device-auth/same-original-recovery/challenge-status',
      '/device-auth/same-original-recovery/manager-preparation', completionPath]);
    assert.deepEqual(f.registrations.map(row => row.method), ['use', 'post', 'use', 'post', 'use', 'post', 'use', 'post']);
    noCompletionEffects(f);
  });
  await test('NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW no caller reader inspector role path or dependency fallback', async () => {
    for (const change of [
      ...['env', 'store', 'runReadOnlySql', 'db'].map(key => value => { delete value[key]; }),
      ...['readOriginalCompletionOnce', 'inspect', 'authenticate', 'role', 'path', 'now', 'client']
        .map(key => value => { value[key] = () => assert.fail('CALLER_PORT_MUST_NOT_RUN'); }),
      value => { Object.defineProperty(value, 'db', {enumerable: true, get() { assert.fail('GETTER_MUST_NOT_RUN'); }}); },
    ]) {
      const f = completionFixture(); change(f.dependencies);
      assert.throws(() => f.compose(), {code: 'same_original_recovery_native_composition_unavailable', status: 503});
      assert.equal(f.registrations.length, 0); noCompletionEffects(f);
    }
  });
  await test('NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW exact parser method path content and receive bound deny before auth', async () => {
    const f = completionFixture(); f.compose();
    for (const url of [completionPath + '?x=1', completionPath + '/', completionPath + '/foreign',
      completionPath.toUpperCase(), completionPath.replace('device-auth', '%64evice-auth')]) {
      const r = f.completionRequest({url}); assert.equal(r.admitted, false); assert.equal(r.res.statusCode, 400);
      unknown(r.res); r.clean();
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT']) {
      const r = f.completionRequest({method}); assert.equal(r.res.statusCode, 405); unknown(r.res); r.clean();
    }
    for (const headers of [{'content-type': 'text/plain'}, {'content-encoding': 'gzip'}, {'content-encoding': ''}]) {
      const r = f.completionRequest({headers}); assert.equal(r.res.statusCode, 415); unknown(r.res); r.clean();
    }
    const large = f.completionRequest({headers: {'content-length': '8388609'}});
    assert.equal(large.res.statusCode, 413); unknown(large.res); large.clean();
    const json = JSON.stringify(completionBody());
    for (const raw of [Buffer.from('{'), Buffer.from([255]), Buffer.from('\ufeff' + json),
      Buffer.from('{"schema":"custodial.same-original-completion-read.v1",' + json.slice(1)),
      Buffer.from(JSON.stringify({...completionBody(), authority: 'false'}))]) {
      const r = f.completionRequest(), before = Buffer.from(raw); await r.send(raw);
      assert.equal(r.res.statusCode, 400); unknown(r.res); assert.deepEqual(raw, before); r.clean();
    }
    noCompletionEffects(f);
  });
  await test('NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW actual unauthenticated capture and copied JSON never reach RPC', async () => {
    const f = completionFixture(); f.compose();
    const raw = Buffer.from(' \n' + JSON.stringify(completionBody()) + '\t '), before = Buffer.from(raw);
    const r = f.completionRequest(); await r.send(raw);
    assert.equal(r.res.statusCode, 403); unknown(r.res); r.clean(); assert.deepEqual(raw, before); noCompletionEffects(f);
    const read = completionStoreFactory({db: f.db}).readOriginalCompletionOnce;
    for (const copied of [{}, Object.freeze({...completionBody()}), Object.freeze({observation_only: true, transaction_authority: false})]) {
      assert.equal(exchange.isAuthenticatedSameOriginalCompletionReadCapture(copied), false);
      await assert.rejects(() => read(copied)); noCompletionEffects(f);
    }
  });
  await test('NATIVE_ORIGINAL_COMPLETION_COMPOSITION_NEW aborted and foreign replacement cleanup preserve borrowed bytes', async () => {
    for (const event of ['aborted', 'close', 'error', 'response-close']) {
      const f = completionFixture(); f.compose(); const r = f.completionRequest(), borrowed = Buffer.from('{');
      r.req.emit('data', borrowed);
      if (event === 'response-close') r.res.emit('close'); else r.req.emit(event);
      assert.deepEqual(borrowed, Buffer.from('{')); r.clean(); noCompletionEffects(f);
    }
    const f = completionFixture(); f.compose(); const r = f.completionRequest();
    const raw = Buffer.from(JSON.stringify(completionBody())), foreign = Buffer.from('FOREIGN_ORIGINAL_COMPLETION_RAW'), before = Buffer.from(foreign);
    const pending = r.send(raw), ownedRaw = r.req.scanAuthorityRawBody;
    assert.ok(Buffer.isBuffer(ownedRaw)); r.req.scanAuthorityRawBody = foreign;
    await pending; assert.equal(r.res.statusCode, 403); unknown(r.res);
    assert.ok(ownedRaw.every(byte => byte === 0)); assert.deepEqual(foreign, before); r.clean(foreign); noCompletionEffects(f);
  });
  for (const [file, digest] of Object.entries(completionPins)) pinned(backend + '/' + file, digest);
}

// DATA ONLY: Main must first pin the actual NEW emission/source/class/facts
// files and their pre-target provenance. This does not authenticate sourceFacts
// or load a parcel. The explicit fields below match T7's authored capture roles;
// they are not reconstructed from challenge.original_target or today's actor.
function closedSourceData(value, keys) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).slice().sort(), keys.slice().sort());
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
export function bindTrustedNativeSourceFacts(input) {
  assert.equal(emittedInputOnly, true, 'native emission source selector required');
  closedSourceData(input, ['sourceFacts', 'nativeSourcePins']);
  // Main supplies these only after checking the actual source/class manifest
  // and emission-file hashes. Format checks are not provenance authentication.
  closedSourceData(input.nativeSourcePins, ['test_source_sha256', 'test_class_sha256']);
  for (const digest of Object.values(input.nativeSourcePins)) assert.match(digest, /^[a-f0-9]{64}$/);
  const sourceFacts = input.sourceFacts;
  closedSourceData(sourceFacts, ['separationContext', 'original_WRITE0', 'native_principal',
    'originalGeneration', 'source_recipe', 'native_credential_sha256']);
  const context = structuredClone(sourceFacts.separationContext), write0 = structuredClone(sourceFacts.original_WRITE0),
    principal = structuredClone(sourceFacts.native_principal), generation = structuredClone(sourceFacts.originalGeneration),
    recipe = structuredClone(sourceFacts.source_recipe);
  closedSourceData(write0, ['operation_id', 'original_generation_id', 'principal_digest']);
  closedSourceData(generation, ['generation_id', 'device_id', 'device_identifier', 'credential_id',
    'employee_id', 'assignment_epoch', 'principal_digest', 'activated_at']);
  closedSourceData(recipe, ['path', 'sha256', 'lines', 'auth_helper_sha256', 'key_id', 'classification']);
  assert.equal(recipe.path, '/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/lean-held-correction-integration-20261011/backend/scripts/native-private-custody-http-piece-tests.mjs');
  assert.equal(recipe.sha256, '167626f8f68c6fb5c3a4f5e3b1c52c02c704199479749b8bc05508a7c817d618');
  assert.equal(recipe.auth_helper_sha256, 'ba20ff22b7ab815270311572838d7d9400b5cdc53f80500fe02b43555d6e5aa1');
  assert.equal(recipe.lines, '19-24');
  assert.equal(recipe.classification, 'EXISTING_MAIN_ADMITTED_SYNTHETIC_ROWS_NOT_LIVE_DB_OR_PERMISSION');
  closedSourceData(context, ['schema', 'separation_id', 'authority_revision', 'employee_id', 'device_id',
    'canonical_device_id', 'credential_id', 'assignment_epoch', 'cutoff_at', 'state',
    'native_inventory_state', 'server_known_open_sessions', 'new_work_allowed', 'phone_released', 'purpose']);
  for (const id of [context.separation_id, context.employee_id, context.device_id, context.credential_id,
    write0.operation_id, write0.original_generation_id]) assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(write0.principal_digest, /^[a-f0-9]{64}$/);
  assert.equal(context.schema, 'custodial.separation-context.v1');
  assert.equal(context.state, 'PENDING_RECONCILIATION');
  assert.equal(context.purpose, 'SEPARATION_STATUS_ONLY');
  assert.equal(context.new_work_allowed, false); assert.equal(context.phone_released, false);
  assert.equal(context.canonical_device_id, 'KIOSK_08');
  assert.equal(context.assignment_epoch, 7);
  assert.equal(generation.activated_at, '2026-09-24T08:00:00.123456Z');
  assert.equal(principal.device_id, context.canonical_device_id);
  assert.equal(generation.device_id, context.device_id);
  assert.equal(generation.device_identifier, context.canonical_device_id);
  for (const key of ['employee_id', 'credential_id', 'assignment_epoch']) {
    assert.equal(String(principal[key]), String(context[key]));
    assert.equal(generation[key], context[key]);
  }
  assert.equal(generation.generation_id, write0.original_generation_id);
  assert.equal(generation.principal_digest, write0.principal_digest);
  // Literal EXISTING FakeTransport SOURCE issuer and existing backend recipe;
  // no enrollment, signing, process.env, credential store or alternate key.
  const secret = 'SYNTHETIC_LONG_DEVICE_SECRET_SOURCE_OWNER_KIOSK_08',
    env = Object.freeze({NODE_ENV: 'test', DEVICE_CREDENTIAL_SECRET: 'SYNTHETIC_ONLY_HTTP_PIECE_LOCAL_SOURCE_KEY'}),
    metadata = Object.freeze(sourceCredentials.deviceCredentialSecretMetadata(env)),
    tokenHash = sourceCredentials.tokenHash(secret, env), credentialToken = context.credential_id + '.' + secret;
  assert.equal(metadata.credential_secret_key_id, '86dbf23b4ae9a54d3d032f7b4b2cceb98395add7dc811476257b6bba1ce27778');
  assert.equal(recipe.key_id, metadata.credential_secret_key_id);
  assert.equal(tokenHash, '595479772eca56d2f19282dc14d00961fdb7e849ace539879bf45000b7e2b7b0');
  assert.equal(sha(credentialToken), sourceFacts.native_credential_sha256);
  return Object.freeze({env,
    deviceRow: Object.freeze({canonical_device_pk: context.device_id, canonical_device_id: context.canonical_device_id,
      device_active: true, employee_active: false, employee_code: 'EMP001', assigned_employee_id: context.employee_id,
      assignment_epoch: String(context.assignment_epoch)}),
    credentialRow: Object.freeze({credential_id: context.credential_id, device_id: context.device_id,
      token_hash: tokenHash, revoked_at: null, confirmed_at: '2026-01-01T00:00:00Z', metadata_json: metadata}),
    separationContext: Object.freeze(context), originalGeneration: Object.freeze(generation),
    authorization: 'Device ' + credentialToken});
}
// Explicit data bridge into the unchanged 50ef nine-role callable. The source
// owner supplies the six pre-target roles above, not an invented file ABI.
export function bindEmittedNativeChallengeSourceInput(input) {
  closedSourceData(input, ['raw', 'headers', 'fixtureNow', 'receiptUtf8', 'sourceFacts', 'nativeSourcePins']);
  const rows = bindTrustedNativeSourceFacts({sourceFacts: input.sourceFacts, nativeSourcePins: input.nativeSourcePins}), challenge = decode(input.raw),
    target = challenge.original_target, headers = {...input.headers};
  assert.equal(Object.hasOwn(headers, 'authorization'), false, 'exported headers must not contain credential strings');
  assert.equal(headers.origin, 'https://localhost');
  assert.equal(headers['x-device-id'], rows.deviceRow.canonical_device_id);
  assert.equal(headers['x-memphis-app-edition'], 'custodial');
  for (const key of ['x-memphis-native-attestation-version', 'x-memphis-native-request-id',
    'x-memphis-native-request-timestamp', 'x-memphis-native-request-attestation']) assert.equal(typeof headers[key], 'string');
  assert.equal(headers['x-memphis-native-request-id'], challenge.native_challenge_intent_id);
  assert.equal(target.operation_id, input.sourceFacts.original_WRITE0.operation_id);
  assert.equal(target.original_generation_id, rows.originalGeneration.generation_id);
  assert.equal(target.principal_digest, rows.originalGeneration.principal_digest);
  assert.equal(target.canonical_device_pk, rows.deviceRow.canonical_device_pk);
  assert.equal(target.canonical_device_id, rows.deviceRow.canonical_device_id);
  assert.equal(target.employee_id, rows.deviceRow.assigned_employee_id);
  assert.equal(target.credential_id, rows.credentialRow.credential_id);
  assert.equal(target.assignment_epoch, rows.deviceRow.assignment_epoch);
  assert.equal(target.original_credential_secret_key_id, rows.credentialRow.metadata_json.credential_secret_key_id);
  // Content-Type is only the HTTP framing declaration; the seven actual saved
  // header values and borrowed raw bytes are neither normalized nor re-signed.
  if (Object.hasOwn(headers, 'content-type')) assert.equal(headers['content-type'], 'application/json');
  headers['content-type'] = 'application/json'; headers.authorization = rows.authorization;
  return Object.freeze({raw: input.raw, headers: Object.freeze(headers), env: rows.env,
    deviceRow: rows.deviceRow, credentialRow: rows.credentialRow, separationContext: rows.separationContext,
    originalGeneration: rows.originalGeneration, fixtureNow: input.fixtureNow, receiptUtf8: input.receiptUtf8});
}
// Main may call this existing-test member ONLY after binding an actual NEW
// native emission loan and its matching synthetic row/time/receipt recipe.
// No file-envelope ABI, issuer, native signature or row mapping is fabricated
// here. Data-only input: no auth/capture/inspector/registration callback allowed.
async function runFuturePacketNormalCompositionCase(input) {
  closedSourceData(input, ['raw', 'headers', 'env', 'deviceRow', 'credentialRow', 'separationContext',
    'originalGeneration', 'fixtureNow', 'receiptUtf8']);
  assert.ok(Buffer.isBuffer(input.raw) && input.raw.length > 0 && input.raw.length <= 786432);
  const originalTimestamp = input.headers['x-memphis-native-request-timestamp'], timestamp = Date.parse(originalTimestamp),
    observedNow = new Date(); // Observe the actual clock; NEVER replace Date or inject route now.
  assert.equal(new Date(timestamp).toISOString(), originalTimestamp);
  assert.ok(timestamp > observedNow.getTime() + 15000, 'original packet must actually be beyond normal future tolerance');
  assert.equal(typeof input.receiptUtf8, 'string');
  await test('NATIVE_CHALLENGE_FUTURE_PACKET_SOURCE_NEW actual closed four-port normal-clock composition refuses original future packet before writer', async () => {
    const before = Buffer.from(input.raw), headersBefore = {...input.headers}, receiptBefore = input.receiptUtf8,
      expected = decode(input.raw), f = fixture(), rows = {device: structuredClone(input.deviceRow),
        credential: structuredClone(input.credentialRow)};
    let r, ownedRaw, ownedBody;
    // EXACT four admitted capabilities. No now, auth, inspector, registration,
    // role or default-client port. Actual composition binds the real private
    // inspector/store/route and its own NORMAL Date clock, unchanged.
    const capabilities = {env: input.env,
      store: {async findCredential(credentialId) {
        f.calls.credential++; assert.equal(credentialId, rows.credential.credential_id);
        ownedRaw = r.req.scanAuthorityRawBody; ownedBody = r.req.body;
        assert.deepEqual(ownedRaw, before); assert.deepEqual(ownedBody, expected);
        return structuredClone(rows.credential);
      }},
      async runReadOnlySql(sql) {
        f.calls.SQL++;
        if (sql.includes('with requested as')) return [structuredClone(rows.device)];
        throw Error('FUTURE_PACKET_REACHED_SEPARATION_READER');
      },
      db: {async rpc() { f.calls.writer++; throw Error('FUTURE_PACKET_REACHED_REGISTRATION_RPC'); }}};
    assert.deepEqual(Object.keys(capabilities).sort(), ['env', 'store', 'runReadOnlySql', 'db'].sort());
    const installed = installComposition(f.app, capabilities);
    assert.deepEqual(installed, {path: endpoint, maxRequestBytes: 786432, receiveDeadlineMs: 30000});
    assert.ok(Object.isFrozen(installed));
    r = f.request({headers: {...input.headers}});
    try {
      await r.send(input.raw);
      // Actual attestation source rejects future >now+15000 BEFORE context,
      // generation or writer; the route deliberately masks the causal auth
      // code as fixed unconfirmed/UNKNOWN, not an approval or no-write retry.
      assert.deepEqual(f.calls, {credential: 1, SQL: 1, writer: 0});
      assert.equal(r.res.statusCode, 403); assert.equal(r.res.body.ok, false);
      assert.equal(r.res.body.code, 'same_original_recovery_native_unconfirmed'); unknown(r.res);
      assert.equal(Object.hasOwn(r.res.body, 'data'), false);
      assert.ok(timestamp > new Date().getTime() + 15000);
      assert.deepEqual(input.raw, before); assert.deepEqual(input.headers, headersBefore);
      assert.equal(input.receiptUtf8, receiptBefore); assert.deepEqual(ownedBody, expected);
      assert.ok(ownedRaw.every(value => value === 0)); r.clean();
    } finally { before.fill(0); }
  });
  return Object.freeze({result: cases.find(value => value.name.startsWith('NATIVE_CHALLENGE_FUTURE_PACKET_SOURCE_NEW ')),
    original_native_timestamp: originalTimestamp, observed_normal_currentDate: observedNow.toISOString(),
    scope: 'NORMAL_CLOCK_CLOSED_FOUR_PORT_COMPOSITION_SOURCE_FUTURE_PACKET_REFUSAL_SYNTHETIC_ROWS_NO_RPC',
    SQL: false, Android: false, real_manager: false});
}
async function runEmittedPostWriterSourceCases(input) {
  // SAME sealed nine data roles, approved original packet and source recipe.
  // No auth/capture/inspector injection, new file ABI or production adapter.
  closedSourceData(input, ['raw', 'headers', 'env', 'deviceRow', 'credentialRow', 'separationContext',
    'originalGeneration', 'fixtureNow', 'receiptUtf8']);
  assert.ok(Buffer.isBuffer(input.raw) && input.raw.length > 0 && input.raw.length <= 786432);
  assert.equal(new Date(input.fixtureNow).toISOString(), input.fixtureNow);
  assert.equal(typeof input.receiptUtf8, 'string');
  const outcomes = [
    {name: 'NATIVE_CHALLENGE_POST_WRITER_SOURCE_NEW lost recording writer reply preserves original UNKNOWN after one fixed NULL status', lost: true},
    {name: 'NATIVE_CHALLENGE_POST_WRITER_SOURCE_NEW current credential revoked only after writer refuses metadata publication', lost: false},
  ];
  for (const scenario of outcomes) await test(scenario.name, async () => {
    const before = Buffer.from(input.raw), originalHeaders = {...input.headers}, expected = decode(input.raw),
      f = fixture(), rows = {device: structuredClone(input.deviceRow), credential: structuredClone(input.credentialRow),
        context: structuredClone(input.separationContext), generation: structuredClone(input.originalGeneration)};
    let revoked = false, originalParameters, ownedRaw, ownedBody, r, statusReads = 0;
    const capabilities = {env: input.env,
      store: {async findCredential(credentialId) {
        f.calls.credential++; assert.equal(credentialId, rows.credential.credential_id);
        // Change only the existing SOURCE row's revocation after exact writer
        // entry; request/body/time/target/principal are never rewritten.
        return {...structuredClone(rows.credential), revoked_at: revoked ? input.fixtureNow : rows.credential.revoked_at};
      }},
      async runReadOnlySql(sql) {
        f.calls.SQL++;
        if (sql.includes('with requested as')) return [structuredClone(rows.device)];
        if (sql.includes('custodial_v13_read_separation_context')) return [{context: structuredClone(rows.context)}];
        if (sql.includes('custodial_v14_read_separation_generation')) return [{original_generation: structuredClone(rows.generation)}];
        throw Error('EMITTED_SOURCE_REQUIRED_ROW_READER_MISSING');
      }};
    const registration = emittedStore({inspectAuthenticatedNativeChallenge: exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge,
      db: {async rpc(name, args) {
        if (name === 'custodial_same_original_preparation_register_v1') {
          f.calls.writer++; assert.equal(f.calls.writer, 1);
          assert.equal(revoked, false); assert.ok(Object.isFrozen(args));
          originalParameters = args; ownedRaw = r.req.scanAuthorityRawBody; ownedBody = r.req.body;
          assert.equal(args.p_original_utf8, before.toString('utf8')); assert.equal(args.p_chunk_index, 0);
          assert.equal(args.p_native_request, expected.native_challenge_intent_id);
          assert.equal(args.p_native_request, originalHeaders['x-memphis-native-request-id']);
          assert.equal(args.p_native_request_timestamp, originalHeaders['x-memphis-native-request-timestamp']);
          assert.equal(args.p_native_request_body_sha256, sha(before));
          assert.equal(args.p_operation, expected.original_target.operation_id);
          assert.equal(args.p_generation, expected.original_target.original_generation_id);
          assert.equal(args.p_credential, rows.credential.credential_id);
          assert.deepEqual(ownedRaw, before); assert.deepEqual(ownedBody, expected);
          assert.deepEqual(r.req.headers, originalHeaders);
          if (scenario.lost) {
            // Recording happened: a thrown reply does NOT establish rollback
            // or no-write, and cannot justify another writer/ID/signature.
            throw Error('SYNTHETIC_RECORDING_COMMIT_REPLY_LOST');
          }
          revoked = true; return {data: input.receiptUtf8, error: null};
        }
        assert.equal(name, 'custodial_same_original_preparation_registration_status_v1');
        assert.equal(scenario.lost, true); statusReads++; assert.equal(statusReads, 1);
        assert.equal(args, originalParameters); // Same original frozen object.
        assert.deepEqual(ownedRaw, before); assert.deepEqual(r.req.headers, originalHeaders);
        return {data: null, error: null}; // Unknown is not no-write or permission.
      }}});
    install(f.app, {...capabilities, registerOriginalChallengeOnce: registration.registerOriginalChallengeOnce,
      now: () => new Date(input.fixtureNow)});
    r = f.request({headers: {...input.headers}});
    try {
      await r.send(input.raw);
      assert.equal(f.calls.writer, 1); assert.equal(statusReads, scenario.lost ? 1 : 0);
      assert.equal(r.res.statusCode, 503); assert.equal(r.res.body.ok, false);
      assert.equal(r.res.body.code, 'same_original_recovery_native_outcome_unknown'); unknown(r.res);
      assert.equal(Object.hasOwn(r.res.body, 'data'), false);
      assert.equal(f.calls.credential, 2); assert.equal(f.calls.SQL, scenario.lost ? 6 : 4);
      // Lost reply reaches SAME original post-writer auth; revoked row reaches
      // that real check and refuses before further context/generation reads.
      assert.ok(originalParameters && Object.isFrozen(originalParameters));
      assert.equal(originalParameters.p_original_utf8, before.toString('utf8'));
      assert.equal(originalParameters.p_native_request_timestamp, originalHeaders['x-memphis-native-request-timestamp']);
      assert.deepEqual(ownedBody, expected); assert.deepEqual(input.raw, before);
      assert.deepEqual(input.headers, originalHeaders);
      assert.ok(ownedRaw.every(value => value === 0)); r.clean();
    } finally { before.fill(0); }
  });
  return Object.freeze({cases: cases.filter(value => value.name.startsWith('NATIVE_CHALLENGE_POST_WRITER_SOURCE_NEW ')),
    scope: 'ACTUAL_NATIVE_PACKET_SOURCE_TIME_POST_WRITER_REFUSALS_SYNTHETIC_ROWS_RECORDING_RPC',
    closed_four_port_composition_currentDate: 'NOT_RUN', SQL: false, Android: false, real_manager: false});
}
async function runCurrentClockNormalCompositionCase(input) {
  closedSourceData(input, ['raw', 'headers', 'env', 'deviceRow', 'credentialRow', 'separationContext',
    'originalGeneration', 'fixtureNow', 'receiptUtf8']);
  assert.ok(Buffer.isBuffer(input.raw) && input.raw.length > 0 && input.raw.length <= 786432);
  const timestamp = input.headers['x-memphis-native-request-timestamp'], originalMs = Date.parse(timestamp),
    observedNow = new Date();
  assert.equal(new Date(originalMs).toISOString(), timestamp); assert.equal(input.fixtureNow, timestamp);
  assert.ok(originalMs <= observedNow.getTime() + 15000 && observedNow.getTime() - originalMs <= 120000,
    'NEW host-clock-before-originals packet in unchanged normal window required');
  assert.equal(typeof input.receiptUtf8, 'string');
  await test('NATIVE_CHALLENGE_CURRENT_CLOCK_SOURCE_NEW actual closed four-port default-currentDate composition accepts fresh original metadata with one writer', async () => {
    const before = Buffer.from(input.raw), headersBefore = {...input.headers}, receiptBefore = input.receiptUtf8,
      expected = decode(input.raw), expectedReceipt = wire.validateRecoveryNativeChallengeReceipt(JSON.parse(receiptBefore)),
      f = fixture(), rows = {device: structuredClone(input.deviceRow), credential: structuredClone(input.credentialRow),
        context: structuredClone(input.separationContext), generation: structuredClone(input.originalGeneration)};
    let r, ownedRaw, ownedBody, originalParameters;
    const rpcNames = [];
    // EXACT closed four ports: actual composition directly supplies its private
    // WeakMap inspector, fixed store and normal-clock route. No .now, auth,
    // inspector, capture, role, registration or alternative client injection.
    const capabilities = {env: input.env,
      store: {async findCredential(credentialId) {
        f.calls.credential++; assert.equal(credentialId, rows.credential.credential_id);
        ownedRaw = r.req.scanAuthorityRawBody; ownedBody = r.req.body;
        assert.deepEqual(ownedRaw, before); assert.deepEqual(ownedBody, expected);
        return structuredClone(rows.credential);
      }},
      async runReadOnlySql(sql) {
        f.calls.SQL++;
        if (sql.includes('with requested as')) return [structuredClone(rows.device)];
        if (sql.includes('custodial_v13_read_separation_context')) return [{context: structuredClone(rows.context)}];
        if (sql.includes('custodial_v14_read_separation_generation')) return [{original_generation: structuredClone(rows.generation)}];
        throw Error('CURRENT_PACKET_REQUIRED_SOURCE_ROW_READER_MISSING');
      },
      db: {async rpc(name, args) {
        rpcNames.push(name); assert.equal(name, 'custodial_same_original_preparation_register_v1');
        f.calls.writer++; assert.equal(f.calls.writer, 1); assert.ok(Object.isFrozen(args));
        assert.equal(Object.keys(args).length, 15); originalParameters = args;
        assert.equal(args.p_original_utf8, before.toString('utf8')); assert.equal(args.p_chunk_index, 0);
        assert.equal(args.p_operation, expected.original_target.operation_id);
        assert.equal(args.p_generation, expected.original_target.original_generation_id);
        assert.equal(args.p_device, rows.device.canonical_device_pk);
        assert.equal(args.p_credential, rows.credential.credential_id);
        assert.equal(args.p_credential_hash, rows.credential.token_hash);
        assert.equal(args.p_credential_key_id, rows.credential.metadata_json.credential_secret_key_id);
        assert.equal(args.p_native_request, expected.native_challenge_intent_id);
        assert.equal(args.p_native_request, headersBefore['x-memphis-native-request-id']);
        assert.equal(args.p_native_request_timestamp, timestamp); assert.equal(args.p_native_request_body_sha256, sha(before));
        assert.equal(args.p_native_attestation_digest, sha(JSON.stringify([
          headersBefore['x-memphis-native-attestation-version'], rows.credential.credential_id,
          rows.device.canonical_device_id, 'POST', endpoint, sha(before),
          headersBefore['x-memphis-native-request-id'], timestamp, headersBefore['x-memphis-native-request-attestation']])));
        assert.deepEqual(ownedRaw, before); assert.deepEqual(r.req.headers, headersBefore);
        return {data: receiptBefore, error: null}; // Exact saved bare11 text, recording RPC only.
      }}};
    assert.deepEqual(Object.keys(capabilities).sort(), ['env', 'store', 'runReadOnlySql', 'db'].sort());
    const installed = installComposition(f.app, capabilities);
    assert.deepEqual(installed, {path: endpoint, maxRequestBytes: 786432, receiveDeadlineMs: 30000});
    assert.ok(Object.isFrozen(installed)); r = f.request({headers: {...input.headers}});
    try {
      await r.send(input.raw);
      assert.equal(r.res.statusCode, 200); assert.equal(r.res.body.ok, true);
      assert.deepEqual(r.res.body.data, expectedReceipt);
      assert.equal(r.res.body.data.retry_safe, false); assert.deepEqual(r.res.body.data.limits, wire.recoveryDeniedEffects);
      assert.equal(r.res.body.data.native_challenge_intent_id, expected.native_challenge_intent_id);
      assert.deepEqual(f.calls, {credential: 2, SQL: 6, writer: 1});
      assert.deepEqual(rpcNames, ['custodial_same_original_preparation_register_v1']);
      assert.ok(originalParameters && Object.isFrozen(originalParameters));
      assert.equal(originalParameters.p_original_utf8, before.toString('utf8'));
      assert.equal(originalParameters.p_native_request_timestamp, timestamp);
      const afterNow = new Date();
      assert.ok(originalMs <= afterNow.getTime() + 15000 && afterNow.getTime() - originalMs <= 120000);
      assert.deepEqual(input.raw, before); assert.deepEqual(input.headers, headersBefore);
      assert.equal(input.receiptUtf8, receiptBefore); assert.deepEqual(ownedBody, expected);
      assert.ok(ownedRaw.every(value => value === 0)); r.clean();
    } finally { before.fill(0); }
  });
  return Object.freeze({result: cases.find(value => value.name.startsWith('NATIVE_CHALLENGE_CURRENT_CLOCK_SOURCE_NEW ')),
    original_native_timestamp: timestamp, observed_normal_currentDate: observedNow.toISOString(),
    scope: 'ACTUAL_CLOSED_FOUR_PORT_NORMAL_CURRENTDATE_SOURCE_METADATA_SYNTHETIC_ROWS_RECORDING_RPC',
    SQL: false, Android: false, real_manager: false});
}
export async function runEmittedNativeChallengeSourceCase(input) {
  if (emittedCurrentOnly) return runCurrentClockNormalCompositionCase(input);
  if (emittedFutureOnly) return runFuturePacketNormalCompositionCase(input);
  if (emittedFaultsOnly) {
    // Source-case prerequisite only, never native/auth permission. Main must
    // first qualify the NEW host-clock-before-originals packet through normal
    // currentDate composition. Do not execute these cases with old2027 bytes.
    const timestamp = input?.headers?.['x-memphis-native-request-timestamp'], originalMs = Date.parse(timestamp), nowMs = Date.now();
    assert.equal(new Date(originalMs).toISOString(), timestamp);
    assert.equal(input.fixtureNow, timestamp);
    assert.ok(originalMs <= nowMs + 15000 && nowMs - originalMs <= 120000,
      'fresh original native packet in the unchanged normal time window required');
    return runEmittedPostWriterSourceCases(input);
  }
  assert.equal(emittedSourceOnly, true, 'NATIVE_CHALLENGE_EMITTED_SOURCE_NEW required');
  const required = ['raw', 'headers', 'env', 'deviceRow', 'credentialRow', 'separationContext',
    'originalGeneration', 'fixtureNow', 'receiptUtf8'];
  assert.ok(input && Object.getPrototypeOf(input) === Object.prototype);
  assert.deepEqual(Reflect.ownKeys(input).slice().sort(), required.slice().sort());
  for (const key of required) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'));
  assert.ok(Buffer.isBuffer(input.raw) && input.raw.length > 0 && input.raw.length <= 786432);
  assert.equal(typeof input.fixtureNow, 'string');
  const clock = new Date(input.fixtureNow);
  assert.equal(clock.toISOString(), input.fixtureNow); // Fixture representation, not a new timestamp.
  assert.equal(typeof input.receiptUtf8, 'string');
  for (const header of ['authorization', 'origin', 'x-device-id', 'x-memphis-app-edition',
    'x-memphis-native-attestation-version', 'x-memphis-native-request-id',
    'x-memphis-native-request-timestamp', 'x-memphis-native-request-attestation'])
    assert.equal(typeof input.headers[header], 'string');
  await test('NATIVE_CHALLENGE_EMITTED_SOURCE_NEW actual request auth private brand fixed store and source-time route', async () => {
    const before = Buffer.from(input.raw), expected = decode(input.raw);
    const f = fixture(), rows = {device: structuredClone(input.deviceRow), credential: structuredClone(input.credentialRow),
      context: structuredClone(input.separationContext), generation: structuredClone(input.originalGeneration)};
    const privateCapabilities = {env: input.env,
      store: {async findCredential(credentialId) {
        f.calls.credential++; assert.equal(credentialId, rows.credential.credential_id); return structuredClone(rows.credential);
      }},
      async runReadOnlySql(sql) {
        f.calls.SQL++;
        if (sql.includes('with requested as')) return [structuredClone(rows.device)];
        if (sql.includes('custodial_v13_read_separation_context')) return [{context: structuredClone(rows.context)}];
        if (sql.includes('custodial_v14_read_separation_generation')) return [{original_generation: structuredClone(rows.generation)}];
        throw Error('EMITTED_SOURCE_REQUIRED_ROW_READER_MISSING');
      }};
    // First prove the brand comes from the actual capture and WeakMap inspector,
    // never a JSON flag or copied observer. This is SOURCE fixture time only.
    const probeRaw = Buffer.from(input.raw);
    const probeRequest = {method: 'POST', originalUrl: endpoint, headers: {...input.headers},
      scanAuthorityRawBody: probeRaw, body: decode(probeRaw)};
    let capture;
    try {
      capture = await exchange.captureAuthenticatedSameOriginalRecoveryNativeChallenge(probeRequest,
        {...privateCapabilities, now: new Date(input.fixtureNow)});
      assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(capture), true);
      const binding = exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge(capture);
      assert.equal(binding.capture, capture); assert.equal(binding.observation_only, true); assert.equal(binding.transaction_authority, false);
      assert.equal(binding.original_request_utf8, input.raw.toString('utf8'));
      assert.equal(binding.rpc_parameters.p_native_request, input.headers['x-memphis-native-request-id']);
      assert.equal(binding.rpc_parameters.p_native_request_timestamp, input.headers['x-memphis-native-request-timestamp']);
    } finally { exchange.closeAuthenticatedPrivateCustodyExchangeCapture(capture); probeRaw.fill(0); }
    assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(capture), false);
    const registration = emittedStore({inspectAuthenticatedNativeChallenge: exchange.inspectAuthenticatedSameOriginalRecoveryNativeChallenge,
      db: {async rpc(name, args) {
        f.calls.writer++;
        assert.equal(name, 'custodial_same_original_preparation_register_v1'); assert.ok(Object.isFrozen(args));
        assert.equal(args.p_original_utf8, input.raw.toString('utf8')); assert.equal(args.p_chunk_index, 0);
        assert.equal(args.p_native_request, expected.native_challenge_intent_id);
        assert.equal(args.p_native_request_body_sha256, sha(input.raw));
        // Exact synthetic source-receipt text supplied by the approved recipe;
        // neither request signing nor an actual SQL transaction is performed.
        return {data: input.receiptUtf8, error: null};
      }}});
    install(f.app, {...privateCapabilities, registerOriginalChallengeOnce: registration.registerOriginalChallengeOnce,
      now: () => new Date(input.fixtureNow)});
    const r = f.request({headers: {...input.headers}});
    await r.send(input.raw); r.clean(); assert.deepEqual(input.raw, before);
    assert.equal(r.res.statusCode, 200); assert.equal(r.res.body.ok, true);
    assert.equal(r.res.body.data.native_challenge_intent_id, expected.native_challenge_intent_id);
    assert.deepEqual(r.res.body.data.limits, wire.recoveryDeniedEffects);
    assert.equal(f.calls.writer, 1); assert.equal(f.calls.credential, 3); assert.equal(f.calls.SQL, 9);
  });
  const result = cases.find(value => value.name.startsWith('NATIVE_CHALLENGE_EMITTED_SOURCE_NEW '));
  return Object.freeze({result, scope: 'ACTUAL_MODULE_NATIVE_EMISSION_SOURCE_TIME_SYNTHETIC_ROWS_RECORDING_RPC',
    closed_four_port_composition_currentDate: 'NOT_RUN', SQL: false, Android: false, real_manager: false});
}
if (emittedInputOnly && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No guessed exporter/recipe format or JS loader. Main must supply the exact
  // new emitted packet and approved data binding to the callable above first.
  console.error('NOT_RUN native emission source selector requires Main verified data binding and invocation');
  process.exitCode = 2;
}

/* STATUS-only new ingress cases. The sealed source vector is UNTRUSTED.
 * No capture brand, authenticated response, transaction or row is fabricated.
 * Positive/post-reader qualification requires Main's actual authenticated ports.
 */
if (nativeStatusOnly) {
  const statusEndpoint = '/device-auth/same-original-recovery/challenge-status';
  const statusBody = {
    schema: 'custodial.same-original-recovery-native-status.v1',
    purpose: 'OBSERVE_ORIGINAL_REGISTRATION_ONLY',
    original_challenge_body_base64: vectorRaw.toString('base64'),
    original_challenge_timestamp: '2027-01-15T08:00:00.000Z',
    original_challenge_http_attestation: 'a'.repeat(64),
  };
  const statusRaw = Buffer.from(JSON.stringify(statusBody));
  function statusFixture() {
    const f = fixture();
    delete f.dependencies.registerOriginalChallengeOnce;
    f.calls.reader = 0;
    f.dependencies.readOriginalChallengeStatusOnce = async capture => {
      f.calls.reader++;
      assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeStatusCapture(capture), true);
      assert.equal(exchange.isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(capture), false);
      throw Error('UNEXPECTED_STATUS_READ_WITHOUT_AUTHENTICATED_FIXTURE');
    };
    return {...f, mount: () => installStatus(f.app, f.dependencies),
      request: options => f.request({url: statusEndpoint, ...options})};
  }
  function noStatusEffects(f) {
    assert.deepEqual(f.calls, {credential: 0, SQL: 0, writer: 0, reader: 0});
  }
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW closed private read-only dependencies', async () => {
    for (const change of [
      value => { delete value.readOriginalChallengeStatusOnce; },
      value => { value.readOriginalChallengeStatusOnce = null; },
      value => { value.registerOriginalChallengeOnce = async () => {}; },
      value => { value.capture = async () => ({}); },
      value => { value.role = 'service_role'; },
      value => { delete value.runReadOnlySql; },
      value => { value.now = new Date(); },
      value => { Object.defineProperty(value, 'env', {enumerable: true,
        get() { throw Error('GETTER_MUST_NOT_RUN'); }}); },
    ]) {
      const f = statusFixture(); change(f.dependencies);
      assert.throws(() => f.mount(), {code: 'same_original_recovery_native_dependencies_required', status: 503});
      assert.equal(f.registrations.length, 0); noStatusEffects(f);
    }
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW fixed status path cap and no writer registration', async () => {
    const f = statusFixture(), installed = f.mount();
    assert.equal(exchange.sameOriginalRecoveryNativeStatusPath, statusEndpoint);
    assert.deepEqual(installed, {path: statusEndpoint, maxRequestBytes: 1050624, receiveDeadlineMs: 30000});
    assert.ok(Object.isFrozen(installed));
    assert.deepEqual(f.registrations.map(row => row.method), ['use', 'post']);
    assert.equal(f.registrations[1].path, statusEndpoint); noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW exact transport refuses aliases methods and encodings', async () => {
    const f = statusFixture(); f.mount();
    for (const url of [statusEndpoint + '?x=1', statusEndpoint + '/', statusEndpoint + '/foreign',
      statusEndpoint.toUpperCase(), statusEndpoint.replace('device-auth', '%64evice-auth')]) {
      const r = f.request({url}); assert.equal(r.res.statusCode, 400); assert.equal(r.admitted, false);
      unknown(r.res); r.clean();
    }
    for (const method of ['GET', 'HEAD', 'PUT']) {
      const r = f.request({method}); assert.equal(r.res.statusCode, 405); unknown(r.res); r.clean();
    }
    for (const headers of [{'content-type': 'text/plain'}, {'content-encoding': 'gzip'}]) {
      const r = f.request({headers}); assert.equal(r.res.statusCode, 415); unknown(r.res); r.clean();
    }
    noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW strict original envelope and borrowed bytes', async () => {
    const f = statusFixture(); f.mount();
    for (const raw of [vectorRaw, Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(0),
      Buffer.from('\ufeff' + JSON.stringify(statusBody)),
      Buffer.from('{"schema":"' + statusBody.schema + '",' + JSON.stringify(statusBody).slice(1)),
      Buffer.from(JSON.stringify({...statusBody, retry_safe: true})),
      Buffer.from(JSON.stringify({...statusBody, original_challenge_timestamp: '2026-02-30T00:00:00.000Z'})),
      Buffer.from(JSON.stringify({...statusBody, original_challenge_body_base64: statusBody.original_challenge_body_base64 + '='}))]) {
      const before = Buffer.from(raw), r = f.request(); await r.send(raw);
      assert.equal(r.res.statusCode, 400); assert.deepEqual(raw, before); unknown(r.res); r.clean();
    }
    noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW status ceilings and shared backing retain caller input', async () => {
    const f = statusFixture(); f.mount();
    const declared = f.request({headers: {'content-length': '1050625'}});
    assert.equal(declared.res.statusCode, 413); declared.clean();
    const chunk = Buffer.alloc(1050625, 120), before = Buffer.from(chunk), r = f.request();
    await r.send(chunk); assert.equal(r.res.statusCode, 413); assert.deepEqual(chunk, before); r.clean();
    const shared = Buffer.from(new SharedArrayBuffer(4)); shared.fill(99);
    const s = f.request(); await s.send(shared); assert.equal(s.res.statusCode, 400);
    assert.ok(shared.every(value => value === 99)); s.clean(); noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW receive retirement releases listeners without read', async () => {
    for (const event of ['aborted', 'close', 'error', 'response-close']) {
      const f = statusFixture(); f.mount(); const r = f.request(), borrowed = Buffer.from('{');
      r.req.emit('data', borrowed);
      if (event === 'response-close') r.res.emit('close'); else r.req.emit(event);
      assert.equal(borrowed.toString(), '{'); r.clean(); noStatusEffects(f);
    }
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW parser ordering and foreign pointers preserved', async () => {
    const f = statusFixture(); f.mount();
    const req = new EventEmitter(), res = new Response(), foreign = Buffer.from('foreign');
    const foreignBody = Object.freeze({foreign: true});
    Object.assign(req, {method: 'POST', originalUrl: statusEndpoint, url: statusEndpoint, path: statusEndpoint,
      headers: {'content-type': 'application/json'}, body: foreignBody, scanAuthorityRawBody: foreign});
    f.registrations.find(row => row.method === 'post').callback(req, res);
    assert.equal(res.statusCode, 400); unknown(res);
    assert.equal(req.body, foreignBody); assert.equal(req.scanAuthorityRawBody, foreign);
    assert.equal(foreign.toString(), 'foreign'); assert.equal(req.listenerCount('data'), 0); noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW untrusted original cannot enter authenticated status read', async () => {
    assert.deepEqual(decodeStatus(statusRaw), statusBody); // Representation ONLY.
    const f = statusFixture(); f.mount(); const r = f.request(), before = Buffer.from(statusRaw);
    let ownedRaw;
    const originalStatus = r.res.status;
    r.res.status = function (code) { ownedRaw = r.req.scanAuthorityRawBody; return originalStatus.call(this, code); };
    await r.send(statusRaw);
    assert.notEqual(r.res.statusCode, 200); unknown(r.res);
    assert.deepEqual(statusRaw, before); assert.ok(ownedRaw?.every(byte => byte === 0));
    r.clean(); noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW rejected capture preserves substituted raw and body', async () => {
    const f = statusFixture(); f.mount(); const r = f.request();
    r.req.emit('data', statusRaw); const pending = r.req.listeners('end')[0].call(r.req);
    const ownedRaw = r.req.scanAuthorityRawBody; assert.ok(Buffer.isBuffer(ownedRaw));
    const foreignRaw = Buffer.from('FOREIGN_STATUS_ORIGINAL'), before = Buffer.from(foreignRaw);
    const foreignBody = Object.freeze({foreign: true});
    r.req.scanAuthorityRawBody = foreignRaw; r.req.body = foreignBody;
    await pending;
    assert.notEqual(r.res.statusCode, 200); unknown(r.res);
    assert.ok(ownedRaw.every(byte => byte === 0)); assert.deepEqual(foreignRaw, before);
    r.clean(foreignRaw, foreignBody); noStatusEffects(f);
  });
  await test('NATIVE_CHALLENGE_STATUS_SOURCE_NEW malformed response hook cannot retire foreign fields', async () => {
    const f = statusFixture(); f.mount(); const r = f.request();
    const foreignRaw = Buffer.from('FOREIGN_STATUS_ERROR'), before = Buffer.from(foreignRaw);
    const foreignBody = Object.freeze({foreign: true}), json = r.res.json;
    r.res.json = function (value) {
      r.req.scanAuthorityRawBody = foreignRaw; r.req.body = foreignBody;
      return json.call(this, value);
    };
    await r.send(Buffer.from('{'));
    assert.equal(r.res.statusCode, 400); unknown(r.res);
    assert.deepEqual(foreignRaw, before); r.clean(foreignRaw, foreignBody); noStatusEffects(f);
  });
}
console.log(JSON.stringify({cases, pins: completionCompositionOnly ? completionPins : nativeStatusOnly ? statusPins : pins, scope: completionCompositionOnly
  ? 'ACTUAL_ORIGINAL_COMPLETION_COMPOSITION_REFUSALS_SOURCE_RECORDING_PORTS_ONLY_NO_POSITIVE_AUTH'
  : nativeStatusOnly
  ? 'PREPARED_STATUS_INGRESS_REFUSALS_SOURCE_ONLY_NO_AUTHENTICATED_STATUS_FIXTURE'
  : emittedCurrentOnly
  ? 'PREPARED_NORMAL_CURRENTDATE_COMPOSITION_POSITIVE_NOT_RUN_PENDING_MAIN_VERIFIED_FRESH_PACKET'
  : emittedFutureOnly
  ? 'PREPARED_NORMAL_CLOCK_FUTURE_PACKET_REFUSAL_NOT_RUN_PENDING_MAIN_REVIEW'
  : emittedFaultsOnly
  ? 'PREPARED_POST_WRITER_NATIVE_SOURCE_CASES_NOT_RUN_PENDING_MAIN_REVIEW_AND_FRESH_PACKET'
  : emittedSourceOnly
  ? 'PREPARED_NATIVE_EMISSION_SOURCE_CASE_NOT_RUN_NO_PACKET_OR_RECIPE'
  : compositionOnly
  ? 'ACTUAL_NATIVE_COMPOSITION_FACTORY_ROUTE_SOURCE_RECORDING_DEPENDENCIES_NO_POSITIVE_AUTH'
  : 'ACTUAL_ROUTE_DECODER_CAPTURE_REFUSAL_SOURCE_WITH_UNTRUSTED_SEALED_SOURCE_VECTORS',
  positive_authenticated_capture_and_registration: completionCompositionOnly
    ? 'NOT_RUN_MISSING_ACTUAL_SAME_ORIGINAL_COMPLETION_ARGUMENTS_CAPTURE_FIXTURE'
    : 'NOT_RUN_MISSING_ACTUAL_ENGINE_NEW_PURPOSE_RAW_HMAC_CONTEXT_FIXTURE',
  lost_writer_reply_or_revocation_after_writer: emittedFaultsOnly ? 'NOT_RUN_PENDING_MAIN_REVIEW_AND_FRESH_CURRENT_CLOCK_PACKET' : 'NOT_RUN_SAME_MISSING_FIXTURE',
  receive_deadline_elapsed_case: 'NOT_RUN',
  actual_registration_port: completionCompositionOnly ? 'UNRELATED_REGISTRATION_NOT_EXERCISED' : 'MISSING_MAIN_TRANSACTION', listener_HTTP: false, SQL: false, real_auth: false, native: false,
  resources: {listeners: 0, sockets: 0, DB_connections: 0, JVMs: 0}}));
