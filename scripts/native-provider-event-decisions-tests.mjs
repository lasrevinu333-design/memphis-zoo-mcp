import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';

const id=n=>`56000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha=x=>createHash('sha256').update(x).digest('hex');
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-event-decision-root-long-enough'};
const secret='syntheticEventDecisionSecret-abcdefghijklmnopqrstuvwxyz1234567890',cid=id(1),employee=id(2),devicePk=id(3);
const device={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:devicePk,device_id:'KIOSK_08',device_name:'Synthetic',
 device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP998',role:'staff',assignment_epoch:7,assigned_employee_id:employee,assigned_employee_name:'Synthetic'};
const credential={credential_id:cid,device_id:devicePk,token_hash:deviceCredentialInternals.tokenHash(secret,env),created_at:'2026-01-01T00:00:00.000Z',
 confirmed_at:'2026-01-01T00:00:00.000Z',last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,
 metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
const observation={earliest_at:'2026-10-02T15:00:02.123456Z',latest_at:'2026-10-02T15:00:02.123458Z',clock_profile_id:'SYNTHETIC_ONLY_PC01',elapsed_realtime_ms:150,boot_count:1};
const event={schema:'custodial.native-provider-event.v2',event_id:id(10),generation_id:id(11),receipt_job_id:id(12),notification_key:'synthetic-original-location',
 action:'received',receipt_credential_id:cid,receipt_employee_id:employee,receipt_device_id:'KIOSK_08',receipt_assignment_epoch:7,
 principal_digest:'a'.repeat(64),token_digest:'b'.repeat(64),content_sha256:'c'.repeat(64),admission_bounds:observation,
 original_observation:{earliest_at:null,latest_at:null,clock_profile_id:null,elapsed_realtime_ms:null,boot_count:null}};
event.record_id=sha(event.generation_id+'\n'+event.receipt_job_id+'\n'+event.notification_key);
const requester={current_generation_id:id(20),credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,principal_digest:'a'.repeat(64),token_digest:'d'.repeat(64)};
const body={schema:'custodial.native-provider-event-decision-query.v1',requester,events:[event]};
const receipt=e=>({...e,schema:'custodial.native-provider-event-receipt.v2',admitted_state:'ACCEPTED',server_received_at:'2026-10-02T15:00:04.123456Z',replayed:true});
const response=(args,results=[{event_id:event.event_id,decision:'ORIGINAL_ACCEPTED',receipt:receipt(event)}])=>({ok:true,data:{
 schema:'custodial.native-provider-event-decisions.v1',native_request_id:args.p_native_request,request_body_sha256:args.p_raw_body_sha256,
 requester:structuredClone(args.p_body.requester),results}});
let checks=0,calls=0,lastArgs,lastFunction,row=structuredClone(credential),requestId=id(30),dbValue=null,dbError=null,dbThrow=false;
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
const app=express();app.use(createGeneralJsonMiddleware());
installNativeProviderRoutes(app,{env,db:{rpc:async(fn,args)=>{calls++;lastArgs=args;lastFunction=fn;
 if(dbThrow)throw new Error('SYNTHETIC_PRIVATE_LOST_RESPONSE');return dbError?{error:dbError}:{data:dbValue??response(args)};}},
 requireCurrentCredential:makeDeviceCredentialMiddleware({env,store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async n=>n===cid?row:null,touchCredential:async()=>{},audit:async()=>{}},
 runReadOnlySql:async()=>[device],requireEnrolledCredential:true})});
app.use((error,_req,res,_next)=>res.status(error.status||500).json({ok:false,code:'synthetic_error'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const origin='http://127.0.0.1:'+server.address().port,path='/employee-notifications-api/native-provider/event-decisions';
console.log('OWNED_HTTP_SERVER',server.address().port,'cleanup=finally; synthetic only');
function headers(bytes,p=path,t=new Date().toISOString()){
 const proof=['custodial-native-request.v1',cid,'KIOSK_08','POST',p,sha(bytes),requestId,t,'custodial'].join('\n');
 return {'content-type':'application/json',authorization:`Device ${cid}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
 'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':t,
 'x-memphis-native-request-attestation':createHmac('sha256',secret).update(proof).digest('hex')};
}
async function send(value=body,p=path,edit=()=>{},method='POST'){
 const bytes=typeof value==='string'?value:JSON.stringify(value),h=headers(bytes,p);edit(h);
 const r=await fetch(origin+p,{method,headers:h,...(!['GET','HEAD'].includes(method)?{body:bytes}:{}),signal:AbortSignal.timeout(5000)});
 const text=await r.text();return {status:r.status,text,data:JSON.parse(text),headers:r.headers};
}
async function refuse(name,value=body,p=path,edit=()=>{},method='POST'){
 const count=calls,r=await send(value,p,edit,method);check(name,r.status>=400&&calls===count&&!r.text.includes(secret));
}
try{
 // This same first assertion is the actual route fail-before on the predecessor.
 let r=await send();check('actual current credential/raw HMAC reaches read-only decision RPC',r.status===200&&lastFunction==='custodial_native_provider_event_decisions');
 check('exact original accepted receipt preserved',JSON.stringify(r.data.data.results[0].receipt)===JSON.stringify(receipt(event)));
 check('distinct current and retired original generations are not rebound',lastArgs.p_body.requester.current_generation_id!==lastArgs.p_body.events[0].generation_id&&lastArgs.p_body.events[0].token_digest==='b'.repeat(64));
 check('native request/raw bytes bound and no-store',lastArgs.p_native_request===requestId&&lastArgs.p_raw_body_sha256===sha(JSON.stringify(body))&&r.headers.get('cache-control')==='no-store');
 check('SQL sees credential hash not secret',lastArgs.p_credential_hash===credential.token_hash&&!JSON.stringify(lastArgs).includes(secret));
 const {validateNativeProviderEventDecisionQuery:query,validateNativeProviderEventDecisions:validate,lookupNativeProviderEventDecisions:lookup}=await import('../src/native-provider-event-decisions.js');
 const context={credentialId:cid,credentialHash:credential.token_hash,nativeRequestId:requestId,attestationDigest:'e'.repeat(64),rawBodySha256:sha(JSON.stringify(body))};
 const accepted=response(lastArgs),original=JSON.stringify(body);
 for(const bad of [null,[],{...context,extra:true},...Object.keys(context).map(k=>({...context,[k]:null})),
  {...context,nativeRequestId:[requestId]},{...context,credentialId:[cid]},
  {...context,credentialHash:['a'.repeat(64)]},{...context,rawBodySha256:'A'.repeat(64)}]){
  assert.throws(()=>validate(accepted,body,bad));checks++;
 }
 const frozen=query(structuredClone(body));check('whole query copies/freezes nested original observations',Object.isFrozen(frozen)&&Object.isFrozen(frozen.requester)&&Object.isFrozen(frozen.events[0].admission_bounds));
 assert.throws(()=>{frozen.events[0].admission_bounds.latest_at='changed';});checks++;
 for(const field of Object.keys(requester)){
  const bad=structuredClone(body);bad.requester[field]=null;assert.throws(()=>query(bad));checks++;
 }
 for(const change of [{extra:true},{schema:'custodial.native-provider-events.v2'},{events:[]},{events:Array(17).fill(event)},
 {events:[event,event]},{events:[event,{...event,event_id:id(99)}]},{requester:{...requester,extra:true}},
 {requester:{...requester,assignment_epoch:'7'}},{requester:{...requester,employee_id:id(99)}},{requester:{...requester,credential_id:id(99)}},
 {requester:{...requester,device_id:'KIOSK_09'}},{requester:{...requester,principal_digest:'f'.repeat(64)}}]){
  assert.throws(()=>query({...body,...change}));checks++;
 }
 for(const field of Object.keys(event)){const e={...event,[field]:null};assert.throws(()=>query({...body,events:[e]}));checks++;}
 check('missing result stays absent/pending',validate({...accepted,data:{...accepted.data,results:[]}},body,context).data.results.length===0);
 const unresolved={event_id:event.event_id,decision:'UNRESOLVED'};
 check('explicit unresolved supplies no terminal evidence',validate({...accepted,data:{...accepted.data,results:[unresolved]}},body,context).data.results[0].decision==='UNRESOLVED');
 for(const mutate of [
  x=>x.data.native_request_id=id(99),x=>x.data.request_body_sha256='f'.repeat(64),x=>x.data.requester.current_generation_id=id(99),
  x=>x.data.requester.token_digest='f'.repeat(64),x=>x.data.requester.employee_id=id(99),x=>x.data.requester.assignment_epoch=8,
  x=>x.data.results.push(structuredClone(x.data.results[0])),x=>x.data.results[0].event_id=id(99),x=>x.data.results[0].decision='PERMANENT_DENIED',
  x=>x.data.results[0].receipt.original_observation.boot_count=1,x=>x.data.results[0].receipt.generation_id=requester.current_generation_id,
  x=>x.data.results[0].receipt.replayed=false,x=>x.data.results[0].receipt.receipt_credential_id=id(99),
  x=>x.data.results[0].receipt.server_received_at='2026-10-02T15:00:01.000000Z',x=>x.data.results[0].extra=true,x=>x.data.extra=true,
  x=>x.data.results[0]={...unresolved,receipt:receipt(event)},x=>x.ok=false,
 ]){const value=structuredClone(accepted);mutate(value);assert.throws(()=>validate(value,body,context));checks++;}
 let release;const mutable=structuredClone(body),mutableContext={...context};
 const delayed=lookup({db:{rpc:async(_fn,args)=>{await new Promise(resolve=>release=resolve);return{data:response(args)};}},body:mutable,context:mutableContext});
 mutable.requester.current_generation_id=id(77);mutable.events[0].admission_bounds.latest_at='changed';mutableContext.nativeRequestId=id(88);release();
 const saved=await delayed;check('await cannot replace captured request/context',saved.data.native_request_id===context.nativeRequestId&&saved.data.requester.current_generation_id===requester.current_generation_id&&saved.data.results[0].receipt.admission_bounds.latest_at===observation.latest_at);
 await assert.rejects(lookup({db:{rpc:async()=>{throw new Error('SYNTHETIC_PRIVATE_RPC_LOSS');}},body,context}),
  e=>e.status===503&&e.code==='native_provider_service_unavailable'&&!e.message.includes('PRIVATE'));checks++;
 await assert.rejects(lookup({db:null,body,context}),e=>e.status===503&&e.code==='native_provider_service_unavailable');checks++;
 for(const key of ['x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation'])await refuse('missing proof '+key,body,path,h=>delete h[key]);
 for(const field of ['credential_id','employee_id','device_id','assignment_epoch','principal_digest']){
  const bad=structuredClone(body);bad.requester[field]=field==='assignment_epoch'?8:field==='device_id'?'KIOSK_09':field==='principal_digest'?'f'.repeat(64):id(99);
  await refuse('crossed requester '+field,bad);
 }
 for(const state of ['expired','revoked','unknown','unconfirmed','wrong_device','wrong_secret']){
  row=structuredClone(credential);if(state==='expired')row.expires_at='2020-01-01T00:00:00.000Z';if(state==='revoked')row.revoked_at=new Date().toISOString();
  if(state==='unknown')row=null;if(state==='unconfirmed'){row.confirmed_at=null;row.metadata_json.enrollment_operation_id=id(90);row.metadata_json.enrollment_flow='recovery';}
  if(state==='wrong_device')row.device_id=id(99);if(state==='wrong_secret')row.token_hash='f'.repeat(64);
  await refuse('current denial never reaches outcome lookup '+state);
 }row=structuredClone(credential);
 await refuse('wrong signed body',body,path,h=>Object.assign(h,headers(JSON.stringify({...body,extra:true}))));
 await refuse('wrong signed path',body,path,h=>Object.assign(h,headers(JSON.stringify(body),'/employee-notifications-api/native-provider/events')));
 await refuse('web origin denied',body,path,h=>h.origin='https://example.invalid');
 await refuse('wrong edition denied',body,path,h=>h['x-memphis-app-edition']='manager');
 for(const delta of [-300000,60000])await refuse('old/future request proof '+delta,body,path,h=>Object.assign(h,headers(JSON.stringify(body),path,new Date(Date.now()+delta).toISOString())));
 for(const p of [path+'/',path+'?x=1',path.toUpperCase(),path.replace('event-decisions','%65vent-decisions'),path+'/extra',path.replace('/native-provider/','/native-provider//')])await refuse('noncanonical path '+p,body,p);
 for(const method of ['GET','PUT','PATCH','DELETE'])await refuse('method '+method,body,path,()=>{},method);
 await refuse('duplicate raw key denied','{"schema":"wrong",'+JSON.stringify(body).slice(1));
 await refuse('signed decimal epoch denied',JSON.stringify(body).replace('"assignment_epoch":7','"assignment_epoch":7.0'));
 const raw=' \n'+JSON.stringify(body,null,2)+'\n';r=await send(raw);check('original raw whitespace digest preserved',r.status===200&&r.data.data.request_body_sha256===sha(raw));
 await refuse('parsed/reserialized HMAC cannot stand in for raw',raw,path,h=>Object.assign(h,headers(JSON.stringify(body))));
 dbValue=response(lastArgs);requestId=id(31);r=await send(raw);check('cached prior response cannot answer fresh nonce',r.status===503);dbValue=null;
 dbThrow=true;r=await send();check('ambiguous lost response never synthesizes accepted item',r.status===503&&!r.text.includes('ORIGINAL_ACCEPTED')&&!r.text.includes('PRIVATE'));dbThrow=false;
 r=await send();check('fresh lookup reuses immutable original after response loss',r.status===200&&r.data.data.results[0].receipt.event_id===event.event_id&&r.data.data.results[0].receipt.original_observation.earliest_at===null);
 for(const code of ['42501','23505','22023','XX000']){dbError={code,message:'SYNTHETIC_PRIVATE',details:secret};r=await send();check('SQL failure not a terminal decision '+code,r.status>=400&&!r.text.includes('ORIGINAL_ACCEPTED')&&!r.text.includes('PERMANENT')&&!r.text.includes('PRIVATE')&&!r.text.includes(secret));}dbError=null;
 const mixedEvent={...event,event_id:id(80),action:'opened'};const mixed={...body,events:[event,mixedEvent]};
 dbValue=response({...lastArgs,p_body:mixed,p_raw_body_sha256:sha(JSON.stringify(mixed))},[{event_id:event.event_id,decision:'ORIGINAL_ACCEPTED',receipt:receipt(event)},{event_id:mixedEvent.event_id,decision:'UNRESOLVED'}]);
 r=await send(mixed);check('mixed response settles only existing exact accepted original',r.status===200&&r.data.data.results[1].decision==='UNRESOLVED'&&!Object.hasOwn(r.data.data.results[1],'receipt'));dbValue=null;
 check('original input bytes never changed',JSON.stringify(body)===original);
 // Source capability guards, not SQL execution or health evidence.
 const migration='20261004000000_native_provider_event_decision_lookup.sql';
 const source=readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8');
 const fn=source.split('as $fn$\n')[1]?.split('end $fn$;')[0];assert.ok(fn);checks++;
 const code=fn.replace(/--[^\n]*/g,'');
 assert.doesNotMatch(code,/\b(insert|update|delete|truncate|execute)\b/i);checks++;
 assert.doesNotMatch(code,/custodial_begin_application_mutation|custodial_native_provider_events\(|custodial_native_location_project_ack|custodial_native_location_live|custodial_native_lunch_live/);checks++;
 assert.match(code,/prior\.original_event=e/);checks++;
 assert.match(code,/current_ok is true/);checks++;
 assert.match(code,/g\.revoked_at is null/);checks++;
 assert.match(code,/g\.dispatch_retired_at is null or r\.prepared_at<=g\.dispatch_retired_at/);checks++;
 assert.doesNotMatch(code,/native_valid_until|valid_until|PERMANENT|TERMINAL/);checks++;
 assert.match(source,/grant execute on function public\.custodial_native_provider_event_decisions\(uuid,text,uuid,text,text,jsonb\) to service_role;/);checks++;
 assert.match(source,/661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471/);checks++;
 assert.match(source,/next_definition is distinct from replace\(prior_definition/);checks++;
 assert.match(source,/Native decision surface recovery predecessor changed/);checks++;
 assert.match(source,/Native decision recovery identity already exists/);checks++;
 assert.equal(readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort().at(-1),migration);checks++;
 const fixture=await import('./fixtures/native-provider-event-decisions-database-cases.mjs');
 assert.equal(typeof fixture.nativeProviderEventDecisionDatabaseCases,'function');checks++;
 assert.equal(fixture.NATIVE_EVENT_DECISION_MIGRATION,migration);checks++;
 console.log(JSON.stringify({status:'PASS',checks,actualHTTP:true,actualCredentialMiddleware:true,actualHmac:true,syntheticRpc:true,
  actualSQL:false,terminalDisposition:false,productionMounted:false,independentAudit:false,providerClock:false,delivery:false}));
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_HTTP_SERVER_CLOSED');}
