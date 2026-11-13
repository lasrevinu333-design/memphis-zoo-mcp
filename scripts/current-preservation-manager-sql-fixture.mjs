import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
// New CURRENT candidate fixture. Original historical fixture/pins remain
// untouched; this constructor binds its own exact current nine source files.
// Real signed-session/security/SQL checks below are the original full body.
export async function createCurrentPreservationManagerSqlFixture(input) {
  assert.ok(process.argv.includes('--joined-manager-sql-current-preservation'),'Explicit current preservation fixture selector required');
  assert.ok(input && Object.getPrototypeOf(input) === Object.prototype);
  assert.deepEqual(Reflect.ownKeys(input).sort(), ['admin', 'backendRoot', 'challengeId', ...(Object.hasOwn(input,'inventoryManagerHttpJoin')?['inventoryManagerHttpJoin']:[])].sort());
  const inventoryManagerHttpJoin=input.inventoryManagerHttpJoin??false;assert.equal(typeof inventoryManagerHttpJoin,'boolean');
  for (const key of Reflect.ownKeys(input)) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'));
  const {admin, backendRoot, challengeId} = input;
  assert.equal(typeof admin?.query, 'function'); assert.ok(path.isAbsolute(backendRoot));
  assert.match(challengeId, /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const sourcePins = {
    "src/auth/shared-access-auth.js": "f867dd037c326d23b54a6f618317e63607d16b1cca72f7137ddec557d74a429c",
    "src/auth/manager-permissions.js": "bba5748f1bc7d55054759b06992926325af06f929b29b6ca7d5234bbe2a9ab23",
    "src/auth/device-credential-auth.js": "16ede66745fb3644de39024384e9e24bc510316e50aadff229868cc9e7f65375",
    "src/auth/same-original-recovery-manager-auth.js": "9792ad35218e33eb3276b4d758b61050020a18f8ec7da62df9f043696c186747",
    "src/same-original-recovery-manager-composition.js": "5a6a389e2746e0c979dd76d04067b2d262cf6690f5c658faa118a5d6b3a3f641",
    "src/same-original-recovery-store.js": "b7ebe12eea60f3d115da9ed9ee7fae8368671c8455b98be67d7aceb957b8e4d4",
    "src/same-original-recovery-routes.js": "2fa23d5c14200ddc66cab14c5ae34f6ad353bd03c54fb4ee8af248a3e0fe2ce2",
    "src/manager-original-recovery-approval.js": "622571d4ac00dc850b3aaac86d815fcaf00fbd2fe3967869a2cdeab1deec115d",
    "src/same-original-recovery-wire.js": "bc99757cce04e17ac0010169047498d35e71308dad2412aee2e885292bad62e7"
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
  // SAME existing local-database fixture recipe. Setup belongs to the owning fixture's
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
    // Borrowed admin remains this fixture-owned; auth/approval rows are retained for
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
    async function withCurrentOwner(action){
      assert.equal(typeof action,'function');const initial=await refreshOwner();
      const result=await action(initial);const terminal=await refreshOwner();
      assert.deepEqual(terminal,initial);return result;
    }
    return Object.freeze({request,currentOwner:()=>owner,challengeId,finish,close,withCurrentOwner,
      ...(inventoryManagerHttpJoin?{inventoryRequest,inventoryEvidence}:{})});
  } catch(error) { await close();throw error; }
}
