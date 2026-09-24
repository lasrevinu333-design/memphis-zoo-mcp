import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installAssignedActivationTransportRoutes} from '../src/assigned-activation-transport.js';
const id=n=>`44000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-legacy-route-credential-root-long-enough'};
const secret='syntheticLegacyNativeSecret-abcdefghijklmnopqrstuvwxyz1234567890',cid=id(1),op=id(2),pk=id(3);
const device={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:pk,device_id:'KIOSK_08',
 device_name:'Synthetic',device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP998',role:'staff',
 assignment_epoch:7,assigned_employee_id:id(4),assigned_employee_name:'Synthetic'};
const base={credential_id:cid,device_id:pk,token_hash:deviceCredentialInternals.tokenHash(secret,env),
 created_at:'2026-01-01T00:00:00.000Z',confirmed_at:'2026-01-01T00:00:00.000Z',last_used_at:new Date().toISOString(),
 expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
let row=structuredClone(base),calls=0,lastArgs,lastFunction,checks=0;
const store={getPolicy:async()=>({mode:'enforce'}),findCredential:async n=>n===cid?row:null,touchCredential:async()=>{},audit:async()=>{}};
const app=express();app.use(createGeneralJsonMiddleware());
app.use(express.urlencoded({extended:false,limit:'32kb'}));
installAssignedActivationTransportRoutes(app,{env,db:{rpc:async(fn,args)=>{calls++;lastFunction=fn;lastArgs=args;return{data:{synthetic:true}};}},
 configured:(_q,_s,n)=>n(),requireManager:(_q,_s,n)=>n(),
 requireCurrentCredential:makeDeviceCredentialMiddleware({env,store,runReadOnlySql:async()=>[device],requireEnrolledCredential:true}),
 isNativeCustodialRequest:r=>r.headers.origin==='https://localhost'&&r.headers['x-memphis-app-edition']==='custodial',
 nativeCredentialParts:r=>{const m=/^Device ([0-9a-f-]+)\.(.+)$/.exec(r.headers.authorization||'');return m?{credentialId:m[1],secret:m[2]}:null;},
 tokenHash:(_e,s)=>deviceCredentialInternals.tokenHash(s,env)});
// Observe the shared parser's scope without supplying any raw bytes ourselves.
for(const probe of ['/scan-api/rpc','/oauth/register','/unrelated-json'])app.post(probe,(req,res)=>res.json({
 parsed:req.body!==undefined,raw:Buffer.isBuffer(req.scanAuthorityRawBody)}));
app.use((err,_req,res,_next)=>res.status(err.status||500).json({code:err.type||'test_server_error'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
console.log('OWNED_HTTP_SERVER',server.address().port,'cleanup: server close in finally');
const origin='http://127.0.0.1:'+server.address().port;
const path='/custodial-device-auth/assigned-activation-operations/'+op+'/legacy-lineage-binding';
const binding={schema_version:'custodial-legacy-lineage-binding-request.v1',operation_id:op,device_id:'KIOSK_08',
 credential_id:cid,installation_binding_sha256:'a'.repeat(64),migrated_from_credential_only_state:true};
function headers(body,p=path,t=new Date().toISOString(),request=id(5)){
 const hash=crypto.createHash('sha256').update(body).digest('hex');
 const proof=['custodial-native-request.v1',cid,'KIOSK_08','POST',p,hash,request,t,'custodial'].join('\n');
 return {'content-type':'application/json','authorization':`Device ${cid}.${secret}`,'x-device-id':'KIOSK_08',
 origin:'https://localhost','x-memphis-app-edition':'custodial','x-memphis-native-attestation-version':'custodial-native-request.v1',
 'x-memphis-native-request-id':request,'x-memphis-native-request-timestamp':t,
 'x-memphis-native-request-attestation':crypto.createHmac('sha256',secret).update(proof).digest('hex')};
}
async function send(body=binding,edit=()=>{},url=path){const encoded=typeof body==='string'?body:JSON.stringify(body),h=headers(encoded,url);edit(h);
 return fetch(origin+url,{method:'POST',headers:h,body:encoded,signal:AbortSignal.timeout(10000)});}
function check(name,value){assert.ok(value,name);checks++;console.log('PASS',name);}
async function refused(name,body=binding,edit=()=>{},url=path){const before=calls,r=await send(body,edit,url);check(name,r.status>=400&&calls===before);await r.text();}
try{
 const mount=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 check('production imports the same middleware used by socket harness',mount.includes('import { createGeneralJsonMiddleware } from "./request-json-parser.js";'));
 const generalAt=mount.indexOf('app.use(createGeneralJsonMiddleware());');
 check('production shared JSON mount precedes form parsing and credential routes',generalAt>0
  &&generalAt<mount.indexOf('app.use(express.urlencoded(')&&generalAt<mount.indexOf('installDeviceCredentialRoutes(app'));
 check('no earlier production JSON parser silently consumes the signed bytes',!mount.slice(0,generalAt).includes('express.json('));
 let r=await send();check('real HTTP middleware authenticates native bind',r.status===200);await r.text();
 check('binding reaches only the intended SQL RPC',lastFunction==='custodial_legacy_activation_bind');
 check('only authenticated canonical device/credential forwarded',lastArgs.p_device===pk&&lastArgs.p_credential===cid);
 check('current token hash only, no raw secret forwarded',lastArgs.p_token_hash===base.token_hash&&!JSON.stringify(lastArgs).includes(secret));
 check('full verified attestation identity retained',lastArgs.p_native_request===id(5)&&/^[a-f0-9]{64}$/.test(lastArgs.p_attestation_digest));
 for(const key of ['x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation'])
  await refused('missing '+key,binding,h=>delete h[key]);
 await refused('origin-only is not native proof',binding,h=>h['x-memphis-native-request-attestation']='0'.repeat(64));
 await refused('signature for different path refused',binding,h=>Object.assign(h,headers(JSON.stringify(binding),path+'-wrong')));
 await refused('signature for different body refused',binding,h=>Object.assign(h,headers(JSON.stringify({...binding,installation_binding_sha256:'b'.repeat(64)}))));
 await refused('stale proof refused',binding,h=>Object.assign(h,headers(JSON.stringify(binding),path,new Date(Date.now()-300000).toISOString())));
 await refused('future proof refused',binding,h=>Object.assign(h,headers(JSON.stringify(binding),path,new Date(Date.now()+60000).toISOString())));
 for(const change of [{extra:true},{device_id:'KIOSK_09'},{credential_id:id(7)},{operation_id:id(8)},{migrated_from_credential_only_state:false},{installation_binding_sha256:'bad'},{schema_version:'bad'}])
  await refused('strict exact binding '+Object.keys(change)[0],{...binding,...change});
 await refused('oversize binding denied',{...binding,installation_binding_sha256:'a'.repeat(2200)});
 for(const kind of ['revoked','expired','wrong_device','unknown','unconfirmed','wrong_secret']){
  row=structuredClone(base);
  if(kind==='revoked')row.revoked_at=new Date().toISOString();
  if(kind==='expired')row.expires_at='2020-01-01T00:00:00.000Z';
  if(kind==='wrong_device')row.device_id=id(9);
  if(kind==='unknown')row=null;
  if(kind==='unconfirmed'){row.confirmed_at=null;row.metadata_json.enrollment_operation_id=id(10);row.metadata_json.enrollment_flow='recovery';}
  await refused('non-current credential '+kind,binding,h=>{if(kind==='wrong_secret')h.authorization+='wrong';});
 }
 row=structuredClone(base);
 const receipt={operation_id:op,device_id:'KIOSK_08',credential_id:cid,outcome:'not_required',changed:false,transition:'healthy_no_change',
 journal_schema:'native-assigned-activation-legacy.v1',journal_binding_sha256:'b'.repeat(64),legacy_binding_id:id(12),
 legacy_binding_kind:'authenticated_legacy_installation_observation',installation_binding_sha256:'a'.repeat(64)};
 const resultPath=path.replace('legacy-lineage-binding','native-legacy-result');r=await send(receipt,()=>{},resultPath);
 check('legacy terminal uses same actual authenticated HTTP boundary',r.status===200);await r.text();
 await refused('legacy terminal requires HMAC',receipt,h=>delete h['x-memphis-native-request-attestation'],resultPath);
 check('exact receipt goes to strict database function',JSON.stringify(lastArgs.p_receipt)===JSON.stringify(receipt));
 check('terminal reaches only the intended SQL RPC',lastFunction==='custodial_legacy_activation_result');
 for(const [name,body,url] of [['binding',binding,path],['terminal',receipt,resultPath]]){
  const formatted='\n '+JSON.stringify(body,null,2)+' \n';
  r=await send(formatted,()=>{},url);check(name+' exact original whitespace bytes authenticate',r.status===200);await r.text();
  await refused(name+' reserialized signature cannot substitute for original bytes',formatted,h=>Object.assign(h,headers(JSON.stringify(body),url)),url);
  await refused(name+' other route signature denied',body,h=>Object.assign(h,headers(JSON.stringify(body),url+'-other')),url);
  await refused(name+' wrong body signature denied',body,h=>Object.assign(h,headers(JSON.stringify({...body,device_id:'KIOSK_09'}),url)),url);
  for(const offset of [-300000,60000])await refused(name+' stale/future '+offset,body,h=>Object.assign(h,headers(JSON.stringify(body),url,new Date(Date.now()+offset).toISOString())),url);
  for(const change of [{extra:true},{device_id:'KIOSK_09'},{credential_id:id(7)},{operation_id:id(8)}])await refused(name+' exact identity/key '+Object.keys(change)[0],{...body,...change},()=>{},url);
  await refused(name+' authenticated credential mismatch denied',body,h=>h.authorization=`Device ${id(7)}.${secret}`,url);
  await refused(name+' missing HMAC denied',body,h=>delete h['x-memphis-native-request-attestation'],url);
  const oversized=JSON.stringify(body)+' '.repeat(2049);const before=calls;
  r=await send(oversized,()=>{},url);check(name+' parser caps original bytes before route/RPC',r.status===413&&calls===before);await r.text();
  await refused(name+' malformed JSON does not reach RPC','{"broken":',()=>{},url);
  await refused(name+' form content cannot masquerade as signed JSON',body,h=>h['content-type']='application/x-www-form-urlencoded',url);
  r=await send(body,()=>{},url+'/');check(name+' Express trailing-slash route retains signed bytes',r.status===200);await r.text();
 }
 for(const probe of ['/scan-api/rpc','/oauth/register','/unrelated-json']){
  const response=await send({},()=>{},probe),seen=await response.json();
  check(probe+' retains its existing parser ownership',seen.parsed===(probe==='/unrelated-json')&&seen.raw===false);
 }
 console.log(JSON.stringify({status:'PASS',checks,actualHttp:true,sharedProductionParser:true,actualCredentialMiddleware:true,actualHmac:true,syntheticStore:true,production:false}));
}finally{await new Promise(resolve=>server.close(resolve));check('owned HTTP server closed',!server.listening);}
