import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeRestoreMutationGate} from '../src/restore-mutation-gate.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const calls=[...source.matchAll(/installNativeProviderRoutes\(app,\s*\{[\s\S]*?\}\);/g)];
assert.equal(calls.length,1,'exactly one production installation');
const binding=calls[0][0];
assert.match(binding,/db:\s*supabaseAdmin/);assert.match(binding,/requireCurrentCredential:\s*requireEmployeeDeviceCredential/);
assert.match(source,/import \{ installNativeProviderRoutes \} from "\.\/native-provider-api\.js"/);
assert.ok(source.indexOf('app.use(makeRestoreMutationGate(')<calls[0].index,'global restore gate must precede native routes');
assert.ok(source.indexOf('installEmployeeNotificationRoutes(app,')<calls[0].index,'existing notification CORS boundary retained');
assert.match(source,/const requireEmployeeDeviceCredential = makeDeviceCredentialMiddleware\(\{\s*supabase: supabaseAdmin,\s*runReadOnlySql,\s*requireEnrolledCredential: true,/);
const id=n=>`79000000-0000-4000-8000-${String(n).padStart(12,'0')}`,credential=id(1),device=id(2),employee=id(3);
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-current-native-binding-secret-abcdefghijklmnopqrstuvwxyz'};
const secret='synthetic-native-credential-not-production-abcdefghijklmnopqrstuvwxyz';
let revoked=false,paused=false,nativeCalls=0,authCalls=0;const leases=new Set(),seen=[];
const authDevice={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:device,device_id:'KIOSK_08',device_name:'Fixture',device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP999',role:'staff',assignment_epoch:7,assigned_employee_id:employee,assigned_employee_name:'Fixture'};
const requireEmployeeDeviceCredential=makeDeviceCredentialMiddleware({env,requireEnrolledCredential:true,
 store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async value=>{authCalls++;return value===credential?{credential_id:credential,device_id:device,token_hash:deviceCredentialInternals.tokenHash(secret,env),created_at:'2026-01-01T00:00:00Z',confirmed_at:'2026-01-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',revoked_at:revoked?new Date().toISOString():null,metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)}:null;},touchCredential:async()=>{},audit:async()=>{}},runReadOnlySql:async()=>[authDevice]});
const db={async rpc(name,args){
 if(name==='custodial_begin_application_mutation_lease'){if(paused)return{error:{message:'mutations are paused'}};leases.add(args.p_request_id);return{data:{mutations_paused:false,authority_generation:1}};}
 if(name==='custodial_release_application_mutation_lease'){leases.delete(args.p_request_id);return{data:true};}
 if(name==='custodial_heartbeat_application_mutation_lease')return{data:true};
 nativeCalls++;seen.push({name,args});assert.equal(leases.size,1,'native SQL stays inside the established request lease');
 const clock={native_request_id:args.p_native_request,server_now:'2026-10-07T00:00:00.123456Z',valid_until:'2026-10-07T00:15:00.123456Z'};
 return{data:{data:{server_now:'2026-10-07T00:00:00.123455Z'},clock}};
}};
const app=express();app.use(createGeneralJsonMiddleware());app.use(makeRestoreMutationGate({supabase:db,required:true,serviceName:'synthetic-native-binding'}));
runInNewContext(binding,{app,supabaseAdmin:db,requireEmployeeDeviceCredential,installNativeProviderRoutes:(target,options)=>{assert.equal(target,app);assert.equal(options.db,db);assert.equal(options.requireCurrentCredential,requireEmployeeDeviceCredential);installNativeProviderRoutes(target,{...options,env});}});
app.use((error,_req,res,_next)=>res.status(error.status||500).json({ok:false,error:'fixture_parser_rejection'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port,prefix='/employee-notifications-api/native-provider';
const token='synthetic-device-push-token-not-a-provider';const body={schema:'custodial.native-provider-register.v1',operation_id:id(4),generation_id:id(5),credential_id:credential,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,principal_digest:'a'.repeat(64),token_digest:createHash('sha256').update(token).digest('hex'),token,native_app:{package_name:'org.memphiszoo.custodial',version_name:'fixture',version_code:56,build_id:'fixture.custodial.123456789abc'}};
async function send({path=prefix+'/register',input=body,method='POST',change=()=>{}}={}){
 const raw=' \n'+JSON.stringify(input,null,2)+'\n',nonce=randomUUID(),timestamp=new Date().toISOString();
 const message=['custodial-native-request.v1',credential,'KIOSK_08',method,path,createHash('sha256').update(raw).digest('hex'),nonce,timestamp,'custodial'].join('\n');
 const headers={'content-type':'application/json',authorization:`Device ${credential}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial','x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':nonce,'x-memphis-native-request-timestamp':timestamp,'x-memphis-native-request-attestation':createHmac('sha256',secret).update(message).digest('hex')};change(headers);
 const response=await fetch(base+path,{method,headers,...(method==='GET'?{}:{body:raw}),signal:AbortSignal.timeout(5000)});const data=await response.json();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(leases.size,0,'every completed request lease settled');return{status:response.status,data};
}
let checks=6;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
try{
 const response=await send();check('actual bootstrap installation reaches current authenticated native RPC',()=>{assert.equal(response.status,200);assert.equal(seen.at(-1).name,'custodial_native_provider_registration_clock');assert.equal(response.data.ok,true);});
 check('credential secret not forwarded or returned',()=>{assert.equal(JSON.stringify(seen).includes(secret),false);assert.equal(JSON.stringify(response.data).includes(secret),false);});
 const status={...body,schema:'custodial.native-provider-status.v1'};delete status.token;assert.equal((await send({path:prefix+'/status',input:status})).status,200);checks++;
 for(const[name,opts,expected]of[
  ['anonymous',{change:h=>delete h.authorization},401],['manager token',{change:h=>h.authorization='Bearer synthetic-manager'},401],
  ['missing native proof',{change:h=>delete h['x-memphis-native-request-attestation']},403],['foreign employee',{input:{...body,employee_id:id(77)}},403],
  ['wrong epoch',{input:{...body,assignment_epoch:8}},403],['external origin',{change:h=>h.origin='https://example.invalid'},403],
  ['manager edition',{change:h=>h['x-memphis-app-edition']='manager'},403],['read method',{method:'GET'},405],
  ['query alias',{path:prefix+'/register?extra=1'},400],['unknown route',{path:prefix+'/unreviewed'},400]]){
  const before=nativeCalls;const r=await send(opts);check(name+' cannot reach native SQL',()=>{assert.equal(r.status,expected);assert.equal(nativeCalls,before);});
 }
 revoked=true;let before=nativeCalls;const denied=await send();check('revoked credential cannot register even with valid original HMAC',()=>{assert.ok([401,403].includes(denied.status));assert.equal(nativeCalls,before);});revoked=false;
 paused=true;before=nativeCalls;const beforeAuth=authCalls;const recovery=await send();check('actual global restore gate refuses before native credential or RPC',()=>{assert.equal(recovery.status,503);assert.equal(nativeCalls,before);assert.equal(authCalls,beforeAuth);});paused=false;
 console.log(JSON.stringify({status:'PASS',checks,source_binding:'Exact actual src/index.js installation statement with existing parser/restore/device-auth/native-router owners',synthetic_rpc:true,real_loopback_http:true,server_startup_side_effects_executed:false,production:false,provider_delivery:false}));
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));assert.equal(leases.size,0);}
