import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import http from 'node:http';

if (process.argv.includes('--same-original-general-parser-mount-only')) {
  const {PassThrough}=await import('node:stream');
  const {createGeneralJsonMiddleware}=await import('../src/request-json-parser.js');
  const parser=createGeneralJsonMiddleware(),results=[];
  for(const path of ['/device-auth/same-original-recovery/target','/device-auth/same-original-recovery/challenge',
    '/admin-api/device-security/same-original-recovery/approvals','/admin-api/device-security/same-original-recovery/approvals/original-status']) {
    const req=new PassThrough();Object.assign(req,{method:'POST',path,url:path,originalUrl:path,headers:{'content-type':'application/json','content-length':'2'}});
    let handedOff=false;try{parser(req,{},error=>{assert.equal(error,undefined);handedOff=true;});
      assert.equal(handedOff,true,'exact owning route must receive the untouched readable stream: '+path);
      assert.equal(req.body,undefined);assert.equal(req.scanAuthorityRawBody,undefined);assert.equal(req.listenerCount('data'),0);
      results.push(path);
    }finally{req.destroy();}
  }
  console.log(JSON.stringify({scope:'NEW_SHIPPING_GENERAL_PARSER_EXACT_RAW_HANDOFF_ONLY',paths:results,
    native_auth:false,SQL:false,HTTP:false,manager_session:false,approval:false}));process.exit(0);
}

if (process.argv.includes('--current-original-query-buffer-shadow-only')) {
  const {decodeCurrentOriginalPrivateQueryRead, currentOriginalPrivateQueryReadWire} =
    await import('../src/native-private-custody-current-query-wire.js');
  const original=Buffer.from(JSON.stringify({schema:'custodial.original-native-private-custody-query.v1'}));
  const wire=Buffer.from(JSON.stringify({schema:currentOriginalPrivateQueryReadWire.schema,
    original_query_body_base64:original.toString('base64'),original_query_timestamp:'1970-01-01T00:00:00.000Z',
    original_query_http_attestation:'a'.repeat(64),original_query_unknown_record_sha256:'b'.repeat(64)}));
  const refused = value => assert.throws(()=>decodeCurrentOriginalPrivateQueryRead(value),
    error=>error?.code==='native_private_custody_current_query_wire_invalid');
  const results=[];
  const sharedStore=new SharedArrayBuffer(wire.length), shared=Buffer.from(sharedStore);
  shared.set(wire);Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(wire.length)});
  refused(shared);assert.deepEqual(Buffer.from(new Uint8Array(sharedStore)),wire);
  results.push('actual shared backing rejected despite nonshared .buffer shadow; caller bytes retained');

  const shadowed=Buffer.from(wire), realStore=shadowed.buffer, realOffset=shadowed.byteOffset;
  let propertyReads=0;
  for(const key of ['buffer','length','byteLength','byteOffset'])Object.defineProperty(shadowed,key,
    {get(){propertyReads++;throw new Error('caller property must not be read');}});
  Object.defineProperty(shadowed,'toString',{value(){propertyReads++;throw new Error('caller conversion must not run');}});
  const decoded=decodeCurrentOriginalPrivateQueryRead(shadowed);
  assert.equal(decoded.original_query_body_base64,original.toString('base64'));
  assert.equal(Object.isFrozen(decoded),true);assert.equal(propertyReads,0);
  assert.deepEqual(Buffer.from(new Uint8Array(realStore,realOffset,wire.length)),wire);
  results.push('nonshared actual bytes copied without caller backing/range/conversion getters or mutation');

  const surrounding=Buffer.concat([Buffer.from('foreign-prefix'),wire,Buffer.from('foreign-suffix')]);
  const slice=surrounding.subarray(14,14+wire.length);
  Object.defineProperties(slice,{buffer:{value:new ArrayBuffer(1)},length:{value:1},
    byteLength:{value:1},byteOffset:{value:0},toString:{value(){return 'foreign';}}});
  assert.equal(decodeCurrentOriginalPrivateQueryRead(slice).schema,currentOriginalPrivateQueryReadWire.schema);
  assert.deepEqual(surrounding,Buffer.concat([Buffer.from('foreign-prefix'),wire,Buffer.from('foreign-suffix')]));
  results.push('intrinsic nonzero offset and full range selected despite false caller bounds');

  const oversized=Buffer.alloc(currentOriginalPrivateQueryReadWire.maxRequestBytes+1,0x20);
  Object.defineProperty(oversized,'length',{value:wire.length});refused(oversized);
  assert.equal(Reflect.apply(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get,oversized,[]),526337);
  results.push('actual oversized range refused despite small shadowed length');
  const empty=Buffer.alloc(0);Object.defineProperty(empty,'length',{value:wire.length});refused(empty);
  results.push('actual empty range refused despite nonempty shadowed length');
  const falselyOversized=Buffer.from(wire);Object.defineProperty(falselyOversized,'length',{value:526337});
  assert.equal(decodeCurrentOriginalPrivateQueryRead(falselyOversized).schema,currentOriginalPrivateQueryReadWire.schema);
  results.push('valid actual range accepted despite oversized caller length');

  const invalidBytes=Buffer.from('invalid-original-bytes');
  Object.defineProperty(invalidBytes,'toString',{value(){return wire.toString();}});refused(invalidBytes);
  results.push('caller toString cannot substitute valid JSON for invalid actual bytes');
  const {runInNewContext}=await import('node:vm');
  const foreignSharedStore=runInNewContext('new SharedArrayBuffer('+wire.length+')');
  const foreignShared=Buffer.from(foreignSharedStore);foreignShared.set(wire);
  refused(foreignShared);assert.deepEqual(Buffer.from(new Uint8Array(foreignSharedStore)),wire);
  results.push('shared backing from another realm refused by ArrayBuffer intrinsic brand');
  console.log(JSON.stringify({status:'BUFFER_SHADOW_SOURCE_PASS',cases:results.length,results,
    authority:false,authentication:false,currentness:false,SQL:false}));
  process.exit(0);
}

if (process.argv.includes('--current-original-query-wire-only')) {
  const { decodeCurrentOriginalPrivateQueryRead, currentOriginalPrivateQueryReadWire } =
    await import('../src/native-private-custody-current-query-wire.js');
  let negativeCases = 0;
  const assertInvalid = (bytes, label) => {
    assert.throws(
      () => decodeCurrentOriginalPrivateQueryRead(bytes),
      (error) => error?.code === 'native_private_custody_current_query_wire_invalid',
      label,
    );
    negativeCases++;
  };
  const make = (overrides = {}, originalBody = Buffer.from(
    JSON.stringify({ schema: 'custodial.original-native-private-custody-query.v1' }),
  )) => Buffer.from(JSON.stringify({
    schema: currentOriginalPrivateQueryReadWire.schema,
    original_query_body_base64: originalBody.toString('base64'),
    original_query_timestamp: '2026-10-13T12:34:56.789Z',
    original_query_http_attestation: 'a'.repeat(64),
    original_query_unknown_record_sha256: 'b'.repeat(64),
    ...overrides,
  }));

  assert.deepEqual(currentOriginalPrivateQueryReadWire, {
    schema: 'custodial.original-private-custody-current-query.v1',
    maxRequestBytes: 526336,
    maxOriginalQueryBytes: 393216,
  });
  assert.equal(Object.isFrozen(currentOriginalPrivateQueryReadWire), true);
  const validBytes = make();
  const decoded = decodeCurrentOriginalPrivateQueryRead(validBytes);
  assert.deepEqual(Object.keys(decoded), [
    'schema', 'original_query_body_base64', 'original_query_timestamp',
    'original_query_http_attestation', 'original_query_unknown_record_sha256',
  ]);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(decoded.original_query_body_base64, JSON.parse(validBytes.toString()).original_query_body_base64);
  assert.equal(decoded.original_query_timestamp, '2026-10-13T12:34:56.789Z');
  assert.equal(decodeCurrentOriginalPrivateQueryRead(make({
    original_query_timestamp: '1970-01-01T00:00:00.000Z',
  })).original_query_timestamp, '1970-01-01T00:00:00.000Z', 'timestamp is structural and is never judged for freshness here');

  const escapedDuplicate = make().toString().replace(
    '{"schema":',
    '{"\\u0073chema":"custodial.original-private-custody-current-query.v1","schema":',
  );
  assertInvalid(Buffer.from(escapedDuplicate), 'escaped duplicate field spelling rejects');
  const duplicateEnvelope = make().toString().replace(
    '{"schema":',
    '{"schema":"custodial.original-private-custody-current-query.v1","schema":',
  );
  assertInvalid(Buffer.from(duplicateEnvelope), 'duplicate envelope fields reject');
  assertInvalid(Buffer.from([0xef, 0xbb, 0xbf, ...make()]), 'BOM is rejected');
  assertInvalid(Buffer.from([0xc3, 0x28]), 'invalid UTF-8 rejects');
  assertInvalid(Buffer.concat([make(), Buffer.from('x')]), 'trailing non-JSON input rejects');
  assertInvalid(make({ extra: 'field' }), 'unknown envelope field rejects');
  assertInvalid(make({ original_query_unknown_record_sha256: undefined }), 'missing envelope field rejects');
  assertInvalid(make({ original_query_http_attestation: 7 }), 'non-string envelope value rejects');
  assertInvalid(make({ schema: 'custodial.original-native-private-custody-query.v1' }), 'wrong current envelope schema rejects');
  assertInvalid(make({ original_query_timestamp: '2026-10-13T12:34:56Z' }), 'timestamp without milliseconds rejects');
  assertInvalid(make({ original_query_timestamp: '2026-02-30T12:34:56.789Z' }), 'noncanonical calendar timestamp rejects');
  assertInvalid(make({ original_query_http_attestation: 'A'.repeat(64) }), 'uppercase attestation hash rejects');
  assertInvalid(make({ original_query_unknown_record_sha256: 'g'.repeat(64) }), 'invalid unknown-record hash rejects');
  assertInvalid(make({ original_query_body_base64: 'eyJzY2hlbWEiOiJ4In0=' }), 'noncanonical or wrong-schema query rejects');
  const canonicalBase64 = make().toString();
  const base64Value = JSON.parse(canonicalBase64).original_query_body_base64;
  const noncanonicalBase64 = base64Value.slice(0, -2) + 'AB';
  assertInvalid(make({ original_query_body_base64: noncanonicalBase64 }), 'noncanonical base64 pad bits reject');
  assertInvalid(make({ original_query_body_base64: 'eyJzY2hlbWEiOiJjdXN0b2RpYWwub3JpZ2luYWwtbmF0aXZlLXByaXZhdGUtY3VzdG9keS1xdWVyeS52MSJ9\n' }), 'base64 whitespace rejects');
  assertInvalid(make({}, Buffer.from([0xc3, 0x28])), 'invalid UTF-8 original query rejects');
  assertInvalid(make({}, Buffer.from('{"schema":"custodial.original-native-private-custody-query.v1","\\u0073chema":"custodial.original-native-private-custody-query.v1"}')),
    'duplicate original query schema rejects');
  const originalPrefix = '{"schema":"custodial.original-native-private-custody-query.v1","padding":"';
  const originalSuffix = '"}';
  const exactOriginal = Buffer.from(originalPrefix
    + 'x'.repeat(currentOriginalPrivateQueryReadWire.maxOriginalQueryBytes
      - Buffer.byteLength(originalPrefix) - Buffer.byteLength(originalSuffix))
    + originalSuffix);
  assert.equal(exactOriginal.length, currentOriginalPrivateQueryReadWire.maxOriginalQueryBytes);
  const maxOriginalDecoded = decodeCurrentOriginalPrivateQueryRead(make({}, exactOriginal));
  assert.equal(Buffer.from(maxOriginalDecoded.original_query_body_base64, 'base64').length,
    currentOriginalPrivateQueryReadWire.maxOriginalQueryBytes);
  const baseEnvelope = make();
  const maxEnvelope = Buffer.concat([baseEnvelope,
    Buffer.alloc(currentOriginalPrivateQueryReadWire.maxRequestBytes - baseEnvelope.length, 0x20)]);
  assert.equal(maxEnvelope.length, currentOriginalPrivateQueryReadWire.maxRequestBytes);
  assert.equal(decodeCurrentOriginalPrivateQueryRead(maxEnvelope).schema, currentOriginalPrivateQueryReadWire.schema);
  assertInvalid(Buffer.alloc(currentOriginalPrivateQueryReadWire.maxRequestBytes + 1), 'oversize current envelope rejects before decoding');
  assertInvalid(make({}, Buffer.alloc(currentOriginalPrivateQueryReadWire.maxOriginalQueryBytes + 1, 0x61)), 'oversize original query rejects');
  assertInvalid({ ...validBytes }, 'non-Buffer input rejects');
  console.log(JSON.stringify({ status: 'PASS', selector: '--current-original-query-wire-only',
    positive_cases: 5, negative_cases: negativeCases,
    authority: false, authentication: false, freshness: false, currentness: false, SQL: false }));
  process.exit(0);
}

const routePath = fileURLToPath(new URL('../src/native-private-custody-http-route.js', import.meta.url));
let installNativePrivateCustodyExchangeRoute, installNativePrivateCustodyCurrentQueryRoute;
if (process.env.REAL_CORE === '1') {
  ({installNativePrivateCustodyExchangeRoute, installNativePrivateCustodyCurrentQueryRoute} = await import('../src/native-private-custody-http-route.js'));
} else {
  globalThis.__routeTestCore = {
    captures: 0, reads: 0, writes: 0, closes: 0, rawMatches: false,
    mode: 'QUERY',
  };
  const routeSource = readFileSync(routePath, 'utf8')
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+'[^']+';\n\n/, `
const privateCustodyExchangePath = '/device-auth/private-custody';
const privateCustodyCurrentQueryPath = '/device-auth/private-custody-current-read';
const captureAuthenticatedCurrentPrivateCustodyQuery = async (req, capabilities) => {
  const c = globalThis.__routeTestCore; c.currentCaptures++; c.rawMatches = Buffer.isBuffer(req.scanAuthorityRawBody);
  c.captureCapabilitiesSeen = capabilities; c.rawSeen = req.scanAuthorityRawBody; c.bodySeen = req.body;
  c.requestSeen = {method:req.method, originalUrl:req.originalUrl, headers:req.headers};
  if (c.captureWait) await c.captureWait;
  if (c.captureError) throw c.captureError;
  return {mode:c.currentMode ?? 'QUERY'};
};
const captureAuthenticatedPrivateCustodyExchange = async (req, capabilities) => {
  const c = globalThis.__routeTestCore; c.captures++; c.rawMatches = Buffer.isBuffer(req.scanAuthorityRawBody);
  c.captureCapabilitiesSeen = capabilities;
  c.rawSeen = req.scanAuthorityRawBody; c.bodySeen = req.body;
  c.requestSeen = {method:req.method, originalUrl:req.originalUrl, headers:req.headers};
  if (c.captureWait) await c.captureWait;
  if (c.captureError) throw c.captureError;
  return {mode: c.mode === 'AMBIGUOUS' ? 'WRITE' : c.mode};
};
const readAuthenticatedPrivateCustodyExchange = async (capture, capabilities) => {
  const c = globalThis.__routeTestCore; c.reads++;
  c.readCapabilitiesSeen = capabilities; c.readModeSeen = 'legacy';
  if (c.readWait) await c.readWait;
  if (c.readError) throw c.readError;
  return c.mode === 'UNRESOLVED' ? {state:'NO_MATCHING_ORIGINAL_WRITE_READBACK'} : {schema:'synthetic.read'};
};
const readAuthenticatedPrivateCustodyReturnedPiece = async (capture, capabilities) => {
  const result = await readAuthenticatedPrivateCustodyExchange(capture, capabilities);
  globalThis.__routeTestCore.readModeSeen = 'bounded'; return result;
};
const recordAuthenticatedPrivateCustodyExchange = async (capture, capabilities) => {
  const c = globalThis.__routeTestCore; c.writes++;
  c.writeCapabilitiesSeen = capabilities;
  if (c.writeWait) await c.writeWait;
  if (c.writeError) throw c.writeError;
  if (c.mode === 'AMBIGUOUS') throw Object.assign(new Error('synthetic ambiguous write'), {code:'native_private_custody_write_outcome_unresolved', status:503});
  return {schema:'synthetic.write'};
};
const closeAuthenticatedPrivateCustodyExchangeCapture = () => { globalThis.__routeTestCore.closes++; };
`)
  .replaceAll('export function ', 'function ');
  const routeExports = {};
  const timers = {
    set(fn,ms) { return globalThis.__routeTestCore.clock?.set(fn,ms) ?? setTimeout(fn,ms); },
    clear(handle) { if (globalThis.__routeTestCore.clock) globalThis.__routeTestCore.clock.clear(handle); else clearTimeout(handle); },
  };
  const observedBuffer = {isBuffer:Buffer.isBuffer,concat:Buffer.concat,
    from(...args) { const result=Buffer.from(...args);globalThis.__routeTestCore.partsSeen?.push(result);return result; }};
  new Function('routeExports','setTimeout','clearTimeout','Buffer', `${routeSource}\nrouteExports.installNativePrivateCustodyExchangeRoute = installNativePrivateCustodyExchangeRoute;\nrouteExports.installNativePrivateCustodyCurrentQueryRoute = installNativePrivateCustodyCurrentQueryRoute;`)(routeExports,
    timers.set,timers.clear,observedBuffer);
  ({installNativePrivateCustodyExchangeRoute, installNativePrivateCustodyCurrentQueryRoute} = routeExports);
}

class FakeResponse extends EventEmitter {
  constructor() { super();this.headersSent = false; this.writableEnded = false; this.statusCode = 200; this.body = null; this.headers={};this.endCalls=0; }
  setHeader(name,value) { this.headers[name]=value; }
  end() { this.endCalls++;this.writableEnded=true;this.emit('finish'); }
  status(code) { this.statusCode = code; return this; }
  json(body) { this.headersSent = true; this.writableEnded = true; this.body = body; return this; }
}

class FakeRequest extends EventEmitter {
  constructor({body, headers = {'content-type': 'application/json'}, method = 'POST', complete = true} = {}) {
    super(); this.method = method; this.originalUrl = '/device-auth/private-custody'; this.path = this.originalUrl;
    this.headers = headers; this.complete = complete; this.bodyBytes = Buffer.from(body ?? '{}');
  }
  send() { this.emit('data', this.bodyBytes); this.emit('end'); this.emit('close'); }
}

function routeHarness(capabilities = {}) {
  const registrations = [];
  const app = { post(path, ...handlers) { registrations.push({path, handlers}); } };
  const installedCapabilities = {
    env: {}, store: {}, db: {}, runReadOnlySql: async () => [], now: () => new Date(0), ...capabilities,
  };
  const result = installNativePrivateCustodyExchangeRoute(app, installedCapabilities);
  assert.equal(result.path, '/device-auth/private-custody');
  assert.equal(result.method, 'POST');
  assert.equal(registrations.length, 1);
  const handlers = registrations[0].handlers;
  handlers.installedCapabilities = installedCapabilities;
  return handlers;
}

function loopbackServer(handlers) {
  const server = http.createServer((req, res) => {
    req.originalUrl = req.url;
    req.path = req.url.split('?')[0];
    const response = {
      headersSent: false,
      writableEnded: false,
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.headersSent = true; this.writableEnded = true; res.statusCode = this.statusCode; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); },
    };
    handlers[0](req, response, () => handlers[1](req, response));
  });
  return server;
}

async function loopbackRequest(server, {body, headers = {'content-type': 'application/json'}} = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({hostname: '127.0.0.1', port: address.port, method: 'POST', path: '/device-auth/private-custody', headers}, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({statusCode: response.statusCode, body: text ? JSON.parse(text) : null}));
    });
    request.on('error', reject); request.end(body);
  });
}

async function invoke(handlers, request) {
  const res = new FakeResponse();
  await new Promise((resolve) => {
    handlers[0](request, res, () => { handlers[1](request, res); resolve(); });
    if (res.writableEnded) resolve();
    if (!res.writableEnded) request.send();
    if (res.writableEnded) resolve();
  });
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

if (process.argv.includes('--current-original-query-route-only')) {
  assert.notEqual(process.env.REAL_CORE, '1', 'current capture module is a Main-owned integration dependency');
  const core = globalThis.__routeTestCore;
  const clock = {now:0, active:new Map(), set(fn,ms) {
    const handle = {fn, at:this.now+ms, unref(){return this;}};
    this.active.set(handle,handle); return handle;
  }, clear(handle) {this.active.delete(handle);}, advance(ms) {
    this.now += ms;
    for (const [handle] of this.active) if (handle.at <= this.now) {this.active.delete(handle);handle.fn();}
  }};
  core.clock = clock;
  const results = [];
  const deferred = () => {let settle;const promise = new Promise(resolve => {settle=resolve;});return {promise,settle};};
  const raw = Buffer.from(' {"synthetic_current_query":"original-read","unicode":"é"} \n');
  const fixedPath = '/device-auth/private-custody-current-read';
  const capabilities = () => ({env:{synthetic:'original-env'}, store:{synthetic:'original-store'},
    runReadOnlySql:async()=>[], now:()=>new Date(1234)});
  const reset = () => {
    assert.equal(clock.active.size,0);
    Object.assign(core,{captures:0,currentCaptures:0,reads:0,writes:0,closes:0,mode:'QUERY',currentMode:'QUERY',
      captureWait:null,readWait:null,captureError:null,readError:null,rawSeen:undefined,partsSeen:[],
      captureCapabilitiesSeen:null,readCapabilitiesSeen:null,readModeSeen:null});
  };
  const start = (requestOptions={}) => {
    reset();const registrations=[], options=capabilities();
    const installation=installNativePrivateCustodyCurrentQueryRoute({post(path,...handlers){registrations.push({path,handlers});}},options);
    assert.deepEqual(installation,{path:fixedPath,method:'POST',maxRequestBytes:526336});
    assert.equal(Object.isFrozen(installation),true);assert.equal(registrations.length,1);
    const req=new FakeRequest(requestOptions),res=new FakeResponse();req.originalUrl=fixedPath;req.path=fixedPath;
    let work,next=0;
    registrations[0].handlers[0](req,res,()=>{next++;work=registrations[0].handlers[1](req,res);});
    return {req,res,options,registrations,get work(){return work;},get next(){return next;}};
  };
  const send = (s,bytes=raw) => {s.req.emit('data',bytes);s.req.emit('end');s.req.emit('close');};
  const cleaned = s => {
    assert.equal(clock.active.size,0);
    for(const event of ['data','end','aborted','close'])assert.equal(s.req.listenerCount(event),0,event);
    assert.equal(s.res.listenerCount('close'),0);assert.equal(s.req.scanAuthorityRawBody,undefined);
    assert.equal(s.req.body,undefined);assert.equal(s.req.nativePrivateCustodyRequestState,undefined);
    assert.ok(core.partsSeen.every(part=>part.every(byte=>byte===0)));
    if(core.rawSeen)assert.ok(core.rawSeen.every(byte=>byte===0));
    assert.equal(core.captures,0);assert.equal(core.writes,0);
  };
  const app={post(){assert.fail('invalid capabilities must not register');}};
  for(const key of ['env','store','runReadOnlySql']){const bad=capabilities();delete bad[key];assert.throws(()=>installNativePrivateCustodyCurrentQueryRoute(app,bad));}
  for(const additions of [{db:{}},{queryReader:async()=>{}},{now:7},{runReadOnlySql:{}}]){
    assert.throws(()=>installNativePrivateCustodyCurrentQueryRoute(app,{...capabilities(),...additions}));
  }
  results.push('explicit read capabilities required; writer/custom reader refused');

  let s=start();const paused=deferred();core.captureWait=paused.promise;send(s);
  assert.deepEqual(core.rawSeen,raw);assert.equal(s.next,1);assert.equal(clock.active.size,0);
  assert.equal(core.closes,0);assert.equal(s.res.writableEnded,false);
  const original={...s.options};Object.assign(s.options,{env:{foreign:true},store:{foreign:true},runReadOnlySql:async()=>['foreign'],now:()=>new Date(9)});
  clock.advance(60000);assert.equal(s.res.writableEnded,false);assert.equal(core.closes,0);
  paused.settle();await s.work;
  assert.equal(core.captureCapabilitiesSeen.env,original.env);assert.equal(core.captureCapabilitiesSeen.store,original.store);
  assert.equal(core.captureCapabilitiesSeen.runReadOnlySql,original.runReadOnlySql);
  assert.equal(core.captureCapabilitiesSeen.now.getTime(),1234);
  assert.deepEqual(Object.keys(core.captureCapabilitiesSeen).sort(),['env','now','runReadOnlySql','store']);
  assert.equal(core.readCapabilitiesSeen.runReadOnlySql,original.runReadOnlySql);assert.equal(core.readModeSeen,'bounded');
  assert.deepEqual(s.res.body,{ok:true,data:{schema:'synthetic.read'}});assert.equal(core.closes,1);cleaned(s);
  results.push('pinned capture/read/clock with exact raw bytes retained throughout awaited capture');

  s=start();core.currentMode='WRITE';send(s);await s.work;
  assert.equal(s.res.statusCode,403);assert.equal(s.res.body.error,'native_private_custody_current_query_capture_invalid');
  assert.equal(core.reads,0);assert.equal(core.closes,1);cleaned(s);results.push('non-QUERY capture refused without writer or reader');

  for(const phase of ['capture','read']){
    s=start();core[phase+'Error']=Object.assign(new Error('synthetic private failure details'),{code:'synthetic_current_query_refused',status:409});
    send(s);await s.work;assert.equal(s.res.statusCode,409);
    assert.deepEqual(s.res.body,{ok:false,error:'synthetic_current_query_refused',state:'PENDING_REVIEW'});
    assert.equal(core.closes,phase==='capture'?0:1);cleaned(s);
    results.push(`${phase} refusal returns bounded pending response and settles owned cleanup`);
  }

  for(const phase of ['capture','read']){
    s=start();const pending=deferred();core[phase+'Wait']=pending.promise;send(s);
    await new Promise(resolve=>setImmediate(resolve));
    s.res.destroyed=true;s.res.emit('close');clock.advance(60000);
    assert.equal(core.closes,0);assert.equal(s.res.endCalls,0);assert.deepEqual(s.req.scanAuthorityRawBody,raw);
    pending.settle();await s.work;assert.equal(s.res.body,null);assert.equal(s.res.endCalls,1);assert.equal(core.closes,1);cleaned(s);
    results.push(`${phase} disconnect keeps body/capture lease until owning await settles`);
  }

  const maxRaw=Buffer.from('{"padding":"'+'x'.repeat(526336-14)+'"}');
  assert.equal(maxRaw.length,526336);s=start();send(s,maxRaw);await s.work;
  assert.equal(s.res.statusCode,200);assert.equal(core.currentCaptures,1);cleaned(s);
  results.push('526336-byte inclusive receive limit accepts complete JSON above legacy limit');
  s=start();s.req.emit('data',Buffer.alloc(526337,0x20));
  assert.equal(s.res.statusCode,413);assert.equal(core.currentCaptures,0);cleaned(s);
  results.push('oversize body refused before capture');

  s=start();s.req.emit('data',Buffer.from('{'));clock.advance(10000);s.req.emit('data',Buffer.from(' '));
  clock.advance(10000);s.req.emit('data',Buffer.from(' '));clock.advance(10000);
  assert.equal(s.res.statusCode,408);assert.equal(core.currentCaptures,0);cleaned(s);
  results.push('absolute 30-second receive lifetime cannot be renewed by partial traffic');
  for(const event of ['aborted','close']){
    s=start();s.req.emit('data',Buffer.from('{'));s.req.emit(event);
    assert.equal(s.res.statusCode,499);assert.equal(core.currentCaptures,0);cleaned(s);
    results.push(`incomplete request ${event} clears owned bytes before capture`);
  }
  s=start();send(s,Buffer.from('{'));assert.equal(s.res.statusCode,400);assert.equal(core.currentCaptures,0);cleaned(s);
  results.push('malformed JSON refused before capture');
  for(const requestOptions of [{method:'GET'},{headers:{'content-type':'text/plain'}},
    {headers:{'content-type':'application/json','content-encoding':'gzip'}}]){
    s=start(requestOptions);assert.equal(s.res.statusCode,requestOptions.method?405:415);assert.equal(core.currentCaptures,0);cleaned(s);
  }
  // Route matching must include the exact URL, including absence of query strings.
  reset();const registrations=[];
  installNativePrivateCustodyCurrentQueryRoute({post(path,...handlers){registrations.push({path,handlers});}},capabilities());
  const wrong=new FakeRequest(),wrongRes=new FakeResponse();wrong.originalUrl=fixedPath+'?replacement=1';
  registrations[0].handlers[0](wrong,wrongRes,()=>assert.fail('foreign path dispatched'));
  assert.equal(wrongRes.statusCode,404);assert.equal(clock.active.size,0);assert.equal(core.currentCaptures,0);
  results.push('method, content type, encoding and exact URL constrained before capture');
  delete core.clock;delete core.partsSeen;
  console.log(JSON.stringify({status:'CURRENT_ORIGINAL_QUERY_ROUTE_SOURCE_PASS',cases:results.length,results,
    actualRouteSource:true,capture:'synthetic current capture in existing source fixture',
    HTTP:false,SQL:false,normalAuth:false,ownedTimers:0}));
  process.exit(0);
}

if (process.argv.some(flag=>['--affected-fixed-capabilities-only','--affected-fixed-capabilities-before-only'].includes(flag))) {
  assert.notEqual(process.env.REAL_CORE,'1','source route with synthetic exchange callbacks only');
  const core=globalThis.__routeTestCore, before=process.argv.includes('--affected-fixed-capabilities-before-only');
  const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
  const deferred=()=>{let settle;const promise=new Promise(resolve=>{settle=resolve;});return {promise,settle};};
  const raw=Buffer.from(' {"original_operation":"synthetic-original","encrypted_marker":"é"} \n');
  const fresh=()=>Object.assign(core,{captures:0,reads:0,writes:0,closes:0,mode:'QUERY',
    captureWait:null,readWait:null,writeWait:null,captureError:null,readError:null,writeError:null,
    captureCapabilitiesSeen:null,readCapabilitiesSeen:null,writeCapabilitiesSeen:null,readModeSeen:null});
  function start({mode='QUERY',queryMode,wait='capture'}={}){
    fresh();core.mode=mode;
    const original={env:{synthetic:'original-env'},store:{synthetic:'original-store'},db:{synthetic:'original-db'},
      runReadOnlySql:async()=>[],now:()=>new Date(1234)};
    const handlers=routeHarness({...original,originalQueryReply:queryMode});
    const pause=deferred();if(wait)core[`${wait}Wait`]=pause.promise;
    const req=new FakeRequest(),res=new FakeResponse();let work;
    handlers[0](req,res,()=>{work=handlers[1](req,res);});
    req.emit('data',raw);req.emit('end');req.emit('close');
    return {req,res,handlers,original,pause,get work(){return work;}};
  }
  const mutate=s=>Object.assign(s.handlers.installedCapabilities,{env:{synthetic:'foreign-env'},store:{synthetic:'foreign-store'},
    db:{synthetic:'foreign-db'},runReadOnlySql:async()=>['foreign'],now:()=>new Date(9999),
    originalQueryReply:s.handlers.installedCapabilities.originalQueryReply===undefined?'bounded-original-frame-piece.v1':undefined});
  const held=s=>{assert.equal(s.res.endCalls,0);assert.equal(s.res.writableEnded,false);assert.equal(core.closes,0);
    assert.deepEqual(s.req.scanAuthorityRawBody,raw);assert.equal(s.req.body.original_operation,'synthetic-original');};
  const cleaned=s=>{assert.equal(s.req.scanAuthorityRawBody,undefined);assert.equal(s.req.body,undefined);
    assert.equal(s.req.nativePrivateCustodyRequestState,undefined);assert.equal(s.res.listenerCount('close'),0);
    for(const event of ['data','end','aborted','close'])assert.equal(s.req.listenerCount(event),0);
    assert.ok(core.rawSeen.every(byte=>byte===0));};
  if(before){
    let s=start({mode:'WRITE'});mutate(s);held(s);s.pause.settle();await s.work;
    assert.equal(core.writeCapabilitiesSeen.db,s.handlers.installedCapabilities.db);
    assert.notEqual(core.writeCapabilitiesSeen.db,s.original.db);
    assert.equal(core.writeCapabilitiesSeen.runReadOnlySql,s.handlers.installedCapabilities.runReadOnlySql);
    cleaned(s);
    s=start({mode:'WRITE',wait:'write'});await nextTurn();s.res.destroyed=true;s.res.emit('close');held(s);
    core.writeError=Object.assign(new Error('synthetic failure details'),{code:'native_private_custody_write_outcome_unresolved',status:503});
    s.pause.settle();await s.work;assert.equal(s.res.body.ok,false);assert.equal(s.res.statusCode,503);
    cleaned(s);
    console.log(JSON.stringify({status:'REPRODUCED',cases:2,findings:['awaited capture switches writer/read dependency','catch attempts error reply after response close'],
      core:'synthetic deferred callbacks',HTTP:false,SQL:false,normalAuth:false,network:false}));process.exit(0);
  }
  const results=[];
  for(const [mode,queryMode] of [['WRITE','bounded-original-frame-piece.v1'],['QUERY','bounded-original-frame-piece.v1'],['QUERY',undefined]]){
    const s=start({mode,queryMode});mutate(s);held(s);s.pause.settle();await s.work;
    assert.equal(core.captureCapabilitiesSeen.env,s.original.env);assert.equal(core.captureCapabilitiesSeen.store,s.original.store);
    assert.equal(core.captureCapabilitiesSeen.runReadOnlySql,s.original.runReadOnlySql);
    assert.equal(core.captureCapabilitiesSeen.now.getTime(),1234);
    if(mode==='WRITE'){
      assert.equal(core.writeCapabilitiesSeen.db,s.original.db);assert.equal(core.writeCapabilitiesSeen.runReadOnlySql,s.original.runReadOnlySql);
      assert.equal(core.writes,1);assert.equal(core.reads,0);
    }else{
      assert.equal(core.readCapabilitiesSeen.runReadOnlySql,s.original.runReadOnlySql);
      assert.equal(core.readModeSeen,queryMode===undefined?'legacy':'bounded');assert.equal(core.reads,1);assert.equal(core.writes,0);
    }
    assert.equal(s.res.statusCode,200);assert.equal(core.closes,1);cleaned(s);
    // A later request registered through the SAME installer retains the
    // original env/store/clock refs as well; inner normal objects are not cloned.
    const req=new FakeRequest(),res=new FakeResponse();let work;core.captureWait=null;
    s.handlers[0](req,res,()=>{work=s.handlers[1](req,res);});req.send();await work;
    assert.equal(core.captureCapabilitiesSeen.env,s.original.env);assert.equal(core.captureCapabilitiesSeen.store,s.original.store);
    assert.equal(core.captureCapabilitiesSeen.now.getTime(),1234);assert.equal(core.closes,2);
    assert.equal(req.scanAuthorityRawBody,undefined);assert.equal(res.listenerCount('close'),0);
    results.push(`${mode}/${queryMode??'legacy'} retains registration refs across await and subsequent request`);
  }
  for(const [mode,wait] of [['QUERY','capture'],['QUERY','read'],['WRITE','write']]){
    const s=start({mode,wait});await nextTurn();s.res.destroyed=true;s.res.emit('close');held(s);
    core[`${wait}Error`]=Object.assign(new Error('synthetic private failure details'),{code:'native_private_custody_write_outcome_unresolved',status:503});
    s.pause.settle();await s.work;
    assert.equal(s.res.body,null);assert.equal(s.res.headersSent,false);assert.equal(s.res.endCalls,1);
    assert.equal(core.closes,wait==='capture'?0:1);cleaned(s);
    results.push(`close during ${wait} failure suppresses reply and retains body/capture until settled`);
  }
  for(const status of [403,409,503]){
    const s=start({mode:'WRITE',wait:'write'});await nextTurn();held(s);
    core.writeError=Object.assign(new Error('private details must not escape'),{code:'native_private_custody_write_outcome_unresolved',status});
    s.pause.settle();await s.work;assert.equal(s.res.statusCode,status);
    assert.deepEqual(s.res.body,{ok:false,error:'native_private_custody_write_outcome_unresolved',state:status>=500||status===409?'PENDING_REVIEW':'DENIED'});
    assert.equal(core.writes,1);assert.equal(core.closes,1);cleaned(s);
    results.push(`open response retains exact ${status} denial/unknown contract without retry`);
  }
  console.log(JSON.stringify({status:'PASS',cases:results.length,results,at_utc:new Date().toISOString(),
    actualRouteSource:true,core:'synthetic deferred callbacks with identity-reference recording',HTTP:false,SQL:false,normalAuth:false,network:false}));process.exit(0);
}

if (process.argv.includes('--affected-receive-lifetime-only')) {
  assert.notEqual(process.env.REAL_CORE,'1','this owning member is synthetic source/stream only');
  const clock={now:0,active:new Map(),all:[],set(fn,ms){const timer={fn,ms,at:this.now+ms,unref(){return this;}};this.active.set(timer,timer);this.all.push(timer);return timer;},
    clear(timer){this.active.delete(timer);},advance(ms){this.now+=ms;for(const [timer] of this.active)if(timer.at<=this.now){this.active.delete(timer);timer.fn();}}};
  const core=globalThis.__routeTestCore;core.clock=clock;let cases=0;
  const fresh=()=>{assert.equal(clock.active.size,0);Object.assign(core,{captures:0,reads:0,writes:0,closes:0,mode:'QUERY',partsSeen:[],rawSeen:undefined,captureWait:null,readWait:null,writeWait:null});};
  const start=()=>{fresh();const handlers=routeHarness({originalQueryReply:'bounded-original-frame-piece.v1'}),req=new FakeRequest({complete:false}),res=new FakeResponse();let next=0,work;
    handlers[0](req,res,()=>{next++;work=handlers[1](req,res);});return{req,res,get next(){return next;},get work(){return work;}};};
  const cleaned=s=>{assert.equal(clock.active.size,0);for(const event of ['data','end','aborted','close'])assert.equal(s.req.listenerCount(event),0,event);assert.equal(s.res.listenerCount('close'),0);assert.equal(s.req.scanAuthorityRawBody,undefined);assert.equal(s.req.body,undefined);assert.ok(core.partsSeen.every(p=>p.every(b=>b===0)));};
  const neverDispatched=s=>{assert.equal(s.next,0);assert.equal(core.captures+core.reads+core.writes+core.closes,0);};
  const partial=s=>{const borrowed=Buffer.from('{"incomplete":');s.req.emit('data',borrowed);assert.equal(borrowed.toString(),'{"incomplete":');return borrowed;};
  let s=start();partial(s);clock.advance(30000);
  console.log(JSON.stringify({case:'partial_body_without_end_or_abort',status:s.res.statusCode,data_listeners:s.req.listenerCount('data'),owned_partial_nonzero:core.partsSeen.some(p=>p.some(b=>b!==0)),handler_calls:s.next}));
  assert.equal(s.res.statusCode,408);assert.equal(s.res.body.error,'native_private_custody_body_receive_timeout');cleaned(s);neverDispatched(s);cases++;
  s=start();clock.advance(30000);assert.equal(s.res.statusCode,408);cleaned(s);neverDispatched(s);cases++;
  s=start();partial(s);clock.advance(10000);s.req.emit('data',Buffer.from(' '));clock.advance(10000);s.req.emit('data',Buffer.from(' '));clock.advance(10000);
  assert.equal(s.res.statusCode,408,'trickle must not renew the absolute receive deadline');cleaned(s);neverDispatched(s);cases++;
  s=start();partial(s);s.req.emit('data',Buffer.alloc(393216));assert.equal(s.res.statusCode,413);cleaned(s);neverDispatched(s);cases++;
  for(const event of ['aborted','close']){s=start();partial(s);s.req.emit(event);assert.equal(s.res.statusCode,499);cleaned(s);neverDispatched(s);cases++;}
  s=start();partial(s);s.req.complete=true;s.req.emit('close');assert.equal(s.res.statusCode,499,'close without observed end cannot certify a complete original');cleaned(s);neverDispatched(s);cases++;
  s=start();partial(s);s.res.destroyed=true;s.res.emit('close');assert.equal(s.res.body,null);assert.equal(s.res.endCalls,1);cleaned(s);neverDispatched(s);cases++;
  s=start();s.req.emit('data',Buffer.from('{'));s.req.emit('end');assert.equal(s.res.statusCode,400);cleaned(s);neverDispatched(s);cases++;
  // Complete exact bytes stop receive timing BEFORE any auth/core await. A
  // canceled callback cannot reply, close a capture, or release response work.
  const raw=Buffer.from(' { "operation_id":"synthetic-original", "text":"é☃", "padding": [1, 2] }\n');
  s=start();let resolveCapture;core.captureWait=new Promise(resolve=>{resolveCapture=resolve;});const timer=clock.all.at(-1),headers=s.req.headers;
  s.req.emit('data',raw.subarray(0,15));s.req.emit('data',raw.subarray(15));s.req.complete=true;s.req.emit('end');s.req.emit('close');
  assert.equal(s.next,1);assert.equal(clock.active.size,0);assert.deepEqual(core.rawSeen,raw);assert.deepEqual(core.bodySeen,JSON.parse(raw.toString()));
  assert.deepEqual(core.requestSeen,{method:'POST',originalUrl:'/device-auth/private-custody',headers});assert.equal(core.requestSeen.headers,headers);
  timer.fn();clock.advance(60000);assert.equal(s.res.writableEnded,false);assert.equal(core.closes,0);assert.deepEqual(s.req.scanAuthorityRawBody,raw);
  resolveCapture();await s.work;assert.equal(s.res.statusCode,200);assert.equal(core.closes,1);cleaned(s);cases++;
  for(const mode of ['QUERY','WRITE']){
    s=start();core.mode=mode;let resolveEffect;const pending=new Promise(resolve=>{resolveEffect=resolve;});core[mode==='QUERY'?'readWait':'writeWait']=pending;
    s.req.emit('data',raw);s.req.complete=true;s.req.emit('end');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(clock.active.size,0);assert.equal(core[mode==='QUERY'?'reads':'writes'],1);assert.equal(core.closes,0);
    if(mode==='QUERY'){s.res.destroyed=true;s.res.emit('close');}else{s.req.emit('aborted');}
    clock.advance(60000);assert.equal(s.res.writableEnded,false);assert.equal(s.res.endCalls,0);assert.equal(core.closes,0);assert.deepEqual(s.req.scanAuthorityRawBody,raw);
    resolveEffect();await s.work;assert.equal(s.res.body,null);assert.equal(s.res.endCalls,1);assert.equal(core.closes,1);cleaned(s);cases++;
  }
  assert.equal(clock.active.size,0);delete core.clock;delete core.partsSeen;
  console.log(JSON.stringify({status:'NATIVE_CUSTODY_RECEIVE_LIFETIME_SOURCE_PASS',cases,at_utc:new Date().toISOString(),actualRouteSource:true,
    core:'synthetic deferred auth/read/write',clock:'synthetic absolute receive timer',HTTP:false,SQL:false,normalAuth:false,network:false,owned_timers:0}));process.exit(0);
}

const calls = {store: 0, db: 0, sql: 0};
const handlers = routeHarness({
  store: {findCredential: async () => { calls.store++; return null; }},
  db: {rpc: async () => { calls.db++; return {data: null}; }},
  runReadOnlySql: async () => { calls.sql++; return []; },
});

const loopback = loopbackServer(handlers);
await new Promise((resolve) => loopback.listen(0, '127.0.0.1', resolve));

const wrongType = await invoke(handlers, new FakeRequest({headers: {'content-type': 'text/plain'}}));
assert.equal(wrongType.statusCode, 415);
assert.equal(calls.store + calls.db + calls.sql, 0, 'content-type rejection must precede dependencies');

const compressed = await invoke(handlers, new FakeRequest({headers: {'content-type': 'application/json', 'content-encoding': 'gzip'}}));
assert.equal(compressed.statusCode, 415);
assert.equal(calls.store + calls.db + calls.sql, 0, 'encoding rejection must precede dependencies');

const malformed = await invoke(handlers, new FakeRequest({body: '{', headers: {'content-type': 'application/json'}}));
assert.equal(malformed.statusCode, 400);
assert.equal(calls.store + calls.db + calls.sql, 0, 'malformed JSON must precede dependencies');

const oversized = await invoke(handlers, new FakeRequest({body: 'x'.repeat(393217), headers: {'content-type': 'application/json'}}));
assert.equal(oversized.statusCode, 413);
assert.equal(calls.store + calls.db + calls.sql, 0, 'oversize must precede dependencies');

const wrongMethod = new FakeRequest({method: 'GET'});
const wrongMethodHandlers = routeHarness();
const wrongMethodRes = await invoke(wrongMethodHandlers, wrongMethod);
assert.equal(wrongMethodRes.statusCode, 405);
assert.equal(calls.store + calls.db + calls.sql, 0, 'method rejection must precede dependencies');

const loopbackMalformed = await loopbackRequest(loopback, {body: '{'});
assert.equal(loopbackMalformed.statusCode, 400, 'real loopback malformed body rejected');
const loopbackOversize = await loopbackRequest(loopback, {body: 'x'.repeat(393217)});
assert.equal(loopbackOversize.statusCode, 413, 'real loopback oversize body rejected');

const abortReq = new FakeRequest({body: '{}'});
const abortRes = new FakeResponse();
await new Promise((resolve) => {
  handlers[0](abortReq, abortRes, () => { throw new Error('aborted request reached controller'); });
  abortReq.emit('aborted');
  setImmediate(resolve);
});
assert.equal(abortRes.statusCode, 499, 'aborted request must receive only bounded abort failure');
assert.equal(abortRes.body.ok, false, 'aborted request must not receive success');
assert.equal(calls.store + calls.db + calls.sql, 0, 'aborted request must not invoke dependencies');

console.log('PASS early parser ordering/content-type/encoding/malformed/oversize/abort cases');
if (process.env.REAL_CORE !== '1') {
  globalThis.__routeTestCore.mode = 'QUERY';
  const query = await invoke(handlers, new FakeRequest({body: '{"synthetic":"query"}'}));
  assert.equal(query.statusCode, 200);
  assert.deepEqual(query.body, {ok: true, data: {schema: 'synthetic.read'}});
  assert.equal(globalThis.__routeTestCore.reads, 1);
  assert.equal(globalThis.__routeTestCore.writes, 0);
  assert.equal(globalThis.__routeTestCore.closes, 1);
  assert.equal(globalThis.__routeTestCore.rawMatches, true);

  globalThis.__routeTestCore.mode = 'WRITE';
  const write = await invoke(handlers, new FakeRequest({body: '{"synthetic":"write"}'}));
  assert.equal(write.statusCode, 200);
  assert.deepEqual(write.body, {ok: true, data: {schema: 'synthetic.write'}});
  assert.equal(globalThis.__routeTestCore.writes, 1, 'write path calls core writer once');
  assert.equal(globalThis.__routeTestCore.closes, 2, 'write capture is closed exactly once');
  globalThis.__routeTestCore.mode = 'UNRESOLVED';
  const unresolved = await invoke(handlers, new FakeRequest({body: '{"synthetic":"unresolved"}'}));
  assert.equal(unresolved.statusCode, 200);
  assert.equal(unresolved.body.data.state, 'NO_MATCHING_ORIGINAL_WRITE_READBACK');
  globalThis.__routeTestCore.mode = 'AMBIGUOUS';
  const ambiguous = await invoke(handlers, new FakeRequest({body: '{"synthetic":"ambiguous"}'}));
  assert.equal(ambiguous.statusCode, 503);
  assert.equal(ambiguous.body.ok, false);
  assert.equal(globalThis.__routeTestCore.writes, 2, 'ambiguous path has one writer call and no retry');
  console.log('PASS synthetic query/write DTO flow, raw-body handoff and capture cleanup');
}
await new Promise((resolve) => loopback.close(resolve));
console.log(JSON.stringify({status: 'PRIVATE_CUSTODY_HTTP_ROUTE_NEW_SOURCE_TESTS_PASS', cases: process.env.REAL_CORE === '1' ? 8 : 12, dependencies: calls, realCore: process.env.REAL_CORE === '1'}));
