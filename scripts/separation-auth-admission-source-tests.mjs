import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const here=path.dirname(new URL(import.meta.url).pathname),root=path.join(here,'..'),auth=fs.readFileSync(path.join(root,'src/auth/device-credential-auth.js'),'utf8'),identity=fs.readFileSync(path.join(root,'src/device-identity.js'),'utf8');
// Host source contract only: actual selected auth/HMAC helpers, synthetic SQL/store/secrets.
const take=(start,end)=>{assert.equal(auth.split(start).length,2);assert.equal(auth.split(end).length,2);const a=auth.indexOf(start),b=auth.indexOf(end,a);assert.ok(b>a);return auth.slice(a,b);};
// Execute the actual selected functions, not rewritten authorization logic.
// SQL/store outcomes are synthetic; no argon2, database, network or real keys.
const pieces=[take('const DEVICE_COOKIE_NAME','function truthy'),take('function safeEqual','function normalizePolicyMode'),take('function parseCookies','export function verifyNativeOfflineWorkAttestation'),take('function requestDeviceIdentifier','function requestIp'),take('function tokenHash','export function deviceCredentialSecretMetadata'),take('async function resolveDevice','function isEligibleEmployeeDevice'),take('// H04 status-only lane','// BEGIN native credential observation proof')];
const source=(identity+'\n'+pieces.join('\n')).replace(/^export /gm,'');
const context=vm.createContext({createHash:crypto.createHash,createHmac:crypto.createHmac,timingSafeEqual:crypto.timingSafeEqual,Buffer,URL,Date,structuredClone});
vm.runInContext(source+'\nglobalThis.testOwner=authenticateSeparationContextRequest;',context,{timeout:1000});
const C='11111111-1111-4111-8111-111111111111',D='22222222-2222-4222-8222-222222222222',E='33333333-3333-4333-8333-333333333333',S='44444444-4444-4444-8444-444444444444',R='55555555-5555-4555-8555-555555555555';
const now=new Date('2026-10-09T01:25:00.000Z'),secretA=crypto.randomBytes(32).toString('base64url'),secretB=crypto.randomBytes(32).toString('base64url'),env={DEVICE_CREDENTIAL_SECRET:crypto.randomBytes(32).toString('base64url')};
const tokenHash=crypto.createHmac('sha256',env.DEVICE_CREDENTIAL_SECRET).update('device-token:'+secretA).digest('hex');
const generation=crypto.createHmac('sha256',env.DEVICE_CREDENTIAL_SECRET).update('device-credential-secret-key-id:device-credential-hmac.v1').digest('hex');
const nativeContext={schema:'custodial.separation-context.v1',purpose:'SEPARATION_STATUS_ONLY',state:'PENDING_RECONCILIATION',new_work_allowed:false,phone_released:false,device_id:D,canonical_device_id:'KIOSK_08',employee_id:E,credential_id:C,assignment_epoch:1,separation_id:S,authority_revision:7,cutoff_at:'2026-10-08T12:00:00.000001Z',native_inventory_state:'UNKNOWN',server_known_open_sessions:[]};
const sign=(req,secret)=>{const message=['custodial-native-request.v1',C,'KIOSK_08',req.method,req.originalUrl,crypto.createHash('sha256').update(req.scanAuthorityRawBody||Buffer.alloc(0)).digest('hex'),R,now.toISOString(),'custodial'].join('\n');req.headers['x-memphis-native-request-attestation']=crypto.createHmac('sha256',secret).update(message).digest('hex');};
const results=[];
async function check(name,expected,configure=()=>{}){
  const req={method:'GET',originalUrl:'/device-auth/separation-context',headers:{authorization:'Device '+C+'.'+secretA,'x-device-id':'KIOSK_08','x-memphis-app-edition':'custodial','x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':R,'x-memphis-native-request-timestamp':now.toISOString()},scanAuthorityRawBody:Buffer.alloc(0)};sign(req,secretA);
  const row={credential_id:C,device_id:D,token_hash:tokenHash,revoked_at:null,confirmed_at:'2026-10-08T10:00:00.000Z',expires_at:'2026-10-08T22:00:00.000Z',metadata_json:{credential_secret_key_id:generation}};
  const device={device_active:true,employee_active:false,canonical_device_id:'KIOSK_08',canonical_device_pk:D,assigned_employee_id:E,assignment_epoch:1,employee_code:'EMP999'};
  const response=structuredClone(nativeContext),options={now:new Date(now.getTime()),mutation:()=>{}};let sqlCalls=0,storeCalls=0;
  configure(req,row,response,options);
  const runReadOnlySql=async query=>{sqlCalls++;if(query.includes('with requested')){options.mutation();return [device];}assert.ok(query.includes('custodial_v13_read_separation_context'));return response===null?[]:[{context:response}];};
  let accepted=false;
  try{const result=await context.testOwner(req,{env,store:{findCredential:async()=>{storeCalls++;return row;}},runReadOnlySql,now:options.now});accepted=result.ok===true;if(accepted)assert.equal(result.separation_recovery_only,true);}
  catch(error){assert.ok([403,503].includes(error.status)||error.code?.startsWith('native_'));}
  const good=accepted===expected;results.push({name,expected_accepted:expected,actual_accepted:accepted,pass:good,sql_calls:sqlCalls,store_calls:storeCalls});console.log((good?'PASS ':'MISMATCH ')+name);
}
await check('bound_native_status_only_original_cutoff_expiry',true);
await check('changed_secret_and_mac_cannot_replace_invalid_original_proof',false,(req,_row,_ctx,o)=>{req.headers['x-memphis-native-request-attestation']='0'.repeat(64);o.mutation=()=>{req.headers.authorization='Device '+C+'.'+secretB;sign(req,secretB);};});
await check('changed_method_path_cannot_replace_invalid_original_lane',false,(req,_row,_ctx,o)=>{req.headers['x-memphis-native-request-attestation']='0'.repeat(64);o.mutation=()=>{req.method='POST';req.originalUrl='/outside-the-separation-lane';sign(req,secretA);};});
await check('changed_raw_body_cannot_replace_invalid_original_transcript',false,(req,_row,_ctx,o)=>{req.scanAuthorityRawBody=Buffer.from('original-synthetic-body');o.mutation=()=>{req.scanAuthorityRawBody=Buffer.alloc(0);sign(req,secretA);};});
await check('invalid_admission_clock_stays_refused',false,(_req,_row,_ctx,o)=>{o.now=new Date(NaN);});
await check('invalid_native_mac_stays_refused',false,req=>{req.headers['x-memphis-native-request-attestation']='0'.repeat(64);});
await check('revoked_credential_stays_refused',false,(_req,row)=>{row.revoked_at='2026-10-08T11:00:00.000Z';});
await check('wrong_secret_generation_stays_refused',false,(_req,row)=>{row.metadata_json.credential_secret_key_id='0'.repeat(64);});
await check('wrong_token_hash_stays_refused',false,(_req,row)=>{row.token_hash='0'.repeat(64);});
await check('foreign_context_employee_stays_refused',false,(_req,_row,ctx)=>{ctx.employee_id='66666666-6666-4666-8666-666666666666';});
await check('new_work_context_stays_refused',false,(_req,_row,ctx)=>{ctx.new_work_allowed=true;});
await check('wrong_lane_at_entry_stays_refused',false,req=>{req.method='POST';sign(req,secretA);});
const mismatches=results.filter(x=>!x.pass).length;assert.equal(results.length,12);assert.equal(mismatches,0);
console.log(JSON.stringify({cases:12,pass:12,mismatches:0,actual_selected_auth_and_HMAC_source:true,synthetic_SQL_store_and_secrets:true,live_database_HTTP_or_key_access:false,independent_review:false}));
