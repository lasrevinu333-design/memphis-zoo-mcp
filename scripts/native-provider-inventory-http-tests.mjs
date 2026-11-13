import {readFileSync} from 'node:fs';
import {syntheticNativeAlertWire} from './fixtures/native-alert-wire-fixture.mjs';
import {canonicalNativeAlert} from '../src/native-alert-reservation.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
const id=n=>`55000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-provider-route-root-long-enough'};
const secret='syntheticProviderNativeSecret-abcdefghijklmnopqrstuvwxyz1234567890',cid=id(1),pk=id(3),employee=id(4);
const device={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:pk,device_id:'KIOSK_08',device_name:'Synthetic',
 device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP998',role:'staff',assignment_epoch:7,assigned_employee_id:employee,assigned_employee_name:'Synthetic'};
const base={credential_id:cid,device_id:pk,token_hash:deviceCredentialInternals.tokenHash(secret,env),created_at:'2026-01-01T00:00:00.000Z',
 confirmed_at:'2026-01-01T00:00:00.000Z',last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,
 metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
let row=structuredClone(base),calls=0,lastArgs,lastFunction,checks=0,dbError=null,dbValue=null,requestId=id(9);
const validResponse=args=>({data:{synthetic:true,server_now:'2026-10-02T01:02:03.123455Z'},clock:{native_request_id:args.p_native_request,
 server_now:'2026-10-02T01:02:03.123456Z',valid_until:'2026-10-02T01:17:03.123456Z'}});
const app=express();app.use(createGeneralJsonMiddleware());
installNativeProviderRoutes(app,{env,db:{rpc:async(fn,args)=>{calls++;lastArgs=args;lastFunction=fn;return dbError?{error:dbError}:{data:dbValue??validResponse(args)};}},
 requireCurrentCredential:makeDeviceCredentialMiddleware({env,store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async n=>n===cid?row:null,touchCredential:async()=>{},audit:async()=>{}},
  runReadOnlySql:async()=>[device],requireEnrolledCredential:true})});
app.use((err,_req,res,_next)=>res.status(err.status||500).json({code:'synthetic_error'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
console.log('OWNED_HTTP_SERVER',server.address().port,'cleanup=server.close in finally');
const origin='http://127.0.0.1:'+server.address().port,prefix='/employee-notifications-api/native-provider',path=prefix+'/register';
const token='synthetic-fcm-token-0000000000000';
const body={schema:'custodial.native-provider-register.v1',operation_id:id(5),generation_id:id(6),credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,
 principal_digest:'a'.repeat(64),token_digest:crypto.createHash('sha256').update(token).digest('hex'),token,
 native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
function headers(bytes,p=path,t=new Date().toISOString()){
 const proof=['custodial-native-request.v1',cid,'KIOSK_08','POST',p,crypto.createHash('sha256').update(bytes).digest('hex'),requestId,t,'custodial'].join('\n');
 return {'content-type':'application/json',authorization:`Device ${cid}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
  'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':t,
  'x-memphis-native-request-attestation':crypto.createHmac('sha256',secret).update(proof).digest('hex')};
}
async function send(value=body,p=path,edit=()=>{},method='POST'){
 const bytes=typeof value==='string'?value:JSON.stringify(value),h=headers(bytes,p);edit(h);
 return fetch(origin+p,{method,headers:h,...(!['GET','HEAD'].includes(method)?{body:bytes}:{}),signal:AbortSignal.timeout(5000)});
}
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
async function refused(name,value=body,p=path,edit=()=>{},method='POST'){
 const count=calls,r=await send(value,p,edit,method);await r.text();check(name,r.status>=400&&calls===count);
}

try{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url),'utf8'));
 const anchor=fixture.payload,from=anchor.reservation_at,until=anchor.valid_until,date=anchor.service_date;
 const rehash=p=>({...p,content_sha256:crypto.createHash('sha256').update(canonicalNativeAlert(p,{excludeHash:true})).digest('hex')});
 const adapt=(p,n)=>{
  const value={...p,generation_id:body.generation_id,principal_digest:body.principal_digest,receipt_credential_id:cid,
   receipt_employee_id:employee,receipt_device_id:'KIOSK_08',receipt_assignment_epoch:'7',token_digest:body.token_digest,
   receipt_job_id:id(n),reservation_at:from,valid_until:until,service_date:date};
  if(value.kind==='employee_schedule_ownership')value.notification_key='schedule-ownership:'+date+':'+employee+':09:45';
  if(value.kind==='employee_event')value.notification_key='event:'+value.event_id+':'+value.event_revision+':'+date+':'+employee+':'+value.recipient_device_uuid+':7:'+value.notification_kind;
  return rehash(value);
 };
 const payloads=[adapt(syntheticNativeAlertWire.event,60),adapt(syntheticNativeAlertWire.message,61),adapt(anchor,62)];
 const request={schema:'custodial.native-provider-inventory-request.v1',scan_id:id(44),principal_digest:body.principal_digest,
  device_id:'KIOSK_08',credential_id:cid,employee_id:employee,assignment_epoch:7,generation_ids:[body.generation_id],limit:32,cursor:null,ceiling:null,server_now:null};
 const response=(items)=>{
  const last=items.at(-1),cursor={reservation_at:last.reservation_at,job_id:last.receipt_job_id};
  const data={...request,schema:'custodial.native-provider-inventory.v1',server_now:from,has_more:false,cursor,ceiling:cursor,
   rows:items.map(payload=>({payload,provider_outcome:'prepared'}))};delete data.limit;
  return{ok:true,data,clock:{native_request_id:requestId,server_now:from,valid_until:until}};
 };
 // Frozen ce3f7884 response validator, imports only rebased to unchanged
 // current helper files. Baseline read/compare is local source proof only.
 const oldBytes=readFileSync(new URL('./fixtures/native-location-lifecycle-before-inventory.js',import.meta.url));
 assert.equal(crypto.createHash('sha256').update(oldBytes).digest('hex'),'75db8e179f5d8de18f56352815d143383bd2c0ec0e331322198df6df992cff3e');
 const original=oldBytes.toString().replace(/from '\.\/([^']+)'/g,(_m,p)=>"from '"+new URL('../src/'+p,import.meta.url).href+"'");
 const old=await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'));
 for(const payload of payloads){
  const value=response([payload]);assert.throws(()=>old.validateNativeLocationInventoryResponse({ok:true,data:value.data},request));
  check('frozen baseline rejects supported typed inventory '+payload.kind,true);
  dbValue=value;const r=await send(request,prefix+'/inventory'),got=await r.json();
  check('current actual HMAC HTTP accepts typed inventory '+payload.kind,r.status===200&&lastFunction==='custodial_native_provider_inventory_clock');
  check('current HTTP echoes exact typed wire '+payload.kind,JSON.stringify(got)===JSON.stringify(value));
 }
 dbValue=response(payloads);let r=await send(request,prefix+'/inventory'),got=await r.json();
 check('mixed Event Message Schedule HTTP page passes',r.status===200&&JSON.stringify(got)===JSON.stringify(dbValue));
 for(const k of ['x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation'])
  await refused('mixed inventory proof remains required '+k,request,prefix+'/inventory',h=>delete h[k]);
 await refused('wrong recipient denied before SQL',{...request,employee_id:id(99)},prefix+'/inventory');
 await refused('wrong edition denied before SQL',request,prefix+'/inventory',h=>h['x-memphis-app-edition']='manager');
 await refused('wrong origin denied before SQL',request,prefix+'/inventory',h=>h.origin='https://example.invalid');
 for(const p of [prefix+'/inventory/',prefix+'/INVENTORY',prefix+'/%69nventory',prefix+'/inventory?x=1'])await refused('inventory alias denied '+p,request,p);
 for(const mutate of [
  x=>x.data.rows[0].payload.content_sha256='f'.repeat(64),
  x=>x.data.rows[1].payload.route='events.html?hub=employee',
  x=>x.data.rows[2].payload.extra='unbound',
  x=>x.data.rows[2].payload.receipt_employee_id=id(99),
  x=>x.data.rows[2].payload.boundary_local='09:44',
  x=>x.data.rows[2].provider_outcome='known_nonacceptance',
  x=>x.data.rows.push(x.data.rows[0]),
  x=>x.clock.native_request_id=id(99),
  x=>x.clock.valid_until=x.clock.server_now,
  x=>x.data.employee_id=id(99),
 ]){
  dbValue=response(payloads.map(p=>({...p})));mutate(dbValue);r=await send(request,prefix+'/inventory');await r.text();check('malformed mixed SQL response remains fail-closed',r.status===503);
 }
 dbValue=response(payloads);row={...base,revoked_at:new Date().toISOString()};await refused('revoked credential cannot read mixed inventory',request,prefix+'/inventory');row=structuredClone(base);
 const text=' \n'+JSON.stringify(request,null,2)+'\n';r=await send(text,prefix+'/inventory');await r.text();check('original whitespace bytes authenticate',r.status===200);
 await refused('reserialized signature cannot replace original bytes',text,prefix+'/inventory',h=>Object.assign(h,headers(JSON.stringify(request),prefix+'/inventory')));
 assert.equal(checks,34);
 console.log(JSON.stringify({status:'PASS',checks,baseline_source_sha256:crypto.createHash('sha256').update(oldBytes).digest('hex'),
  baseline_reproduced_kinds:3,actual_local_HTTP:true,actual_credential_middleware:true,actual_HMAC:true,
  synthetic_actor_RPC_and_payload_rebinding:true,actual_SQL_in_this_test:false,production:false,phone:false,native_qualified:false,provider_dispatch:false}));
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_HTTP_SERVER_CLOSED');}
