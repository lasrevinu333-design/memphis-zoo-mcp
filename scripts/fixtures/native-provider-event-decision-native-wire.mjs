import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {parseNativeProviderJson} from '../../src/native-provider-json.js';
import {validateNativeProviderEventDecisionQuery,validateNativeProviderEventDecisions} from '../../src/native-provider-event-decisions.js';

// Test-only transport bridge. This does not authorize a production principal,
// time profile, producer, delivery, or a native factory. No subprocess/SQL here.
export const NATIVE_DECISION_INPUT_SCHEMA='custodial.native-provider-event-decision-native-input.v1';
export const NATIVE_DECISION_WIRE_SCHEMA='custodial.native-provider-event-decision-wire-fixture.v1';
export const NATIVE_DECISION_PATH='/employee-notifications-api/native-provider/event-decisions';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=/^[0-9a-f]{64}$/,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keys=(x,want)=>{assert.ok(x&&typeof x==='object'&&!Array.isArray(x));assert.deepEqual(Object.keys(x).sort(),[...want].sort());};
function bytes(value,limit){
 assert.equal(typeof value,'string');assert.ok(value.length<=Math.ceil(limit/3)*4);
 const b=Buffer.from(value,'base64');assert.equal(b.toString('base64'),value);assert.ok(b.length>0&&b.length<=limit);return b;
}
function validateCase(input,missing=false){
 keys(input,['schema','synthetic','production','frontend','seed','query']);
 assert.equal(input.schema,NATIVE_DECISION_INPUT_SCHEMA);assert.equal(input.synthetic,true);assert.equal(input.production,false);
 const f=input.frontend;keys(f,['commit','tree','files','jars']);for(const id of [f.commit,f.tree])assert.match(id,/^[0-9a-f]{40}$/);
 assert.ok(Array.isArray(f.files)&&f.files.length>=4&&f.files.length<=250);
 assert.deepEqual(f.files.map(x=>x.path),[...new Set(f.files.map(x=>x.path))].sort());
 for(const row of f.files){keys(row,['path','sha256']);assert.match(row.path,/^(mobile\/scripts\/custodial-provider-storage-tests\.mjs|mobile\/plugins\/custodial-native-vault\/android\/src\/(?:main|test)\/java\/org\/memphiszoo\/custodial\/vault\/[A-Za-z0-9]+\.java)$/);assert.match(row.sha256,hex);}
 for(const name of ['NativeProviderEventDecisions.java','NativeProviderJournal.java','NativeProviderEventDecisionSqlWireTest.java'])assert.equal(f.files.filter(x=>x.path.endsWith('/'+name)).length,1);
 assert.deepEqual(f.jars.map(x=>x.name),['JUNIT_JAR','HAMCREST_JAR','JSON_JAR','ANDROID_API_JAR']);
 for(const row of f.jars){keys(row,['name','sha256']);assert.match(row.sha256,hex);}
 const {seed,query}=input;keys(seed,['principal','registration','registration_receipt','payload','journal_revision','records']);
 keys(query,['path','method','body_base64','body_sha256']);assert.equal(query.path,NATIVE_DECISION_PATH);assert.equal(query.method,'POST');assert.match(query.body_sha256,hex);
 const raw=bytes(query.body_base64,65536);assert.equal(sha(raw),query.body_sha256);const body=parseNativeProviderJson(raw);validateNativeProviderEventDecisionQuery(body);
 keys(body,['schema','requester','events']);assert.equal(body.schema,'custodial.native-provider-event-decision-query.v1');
 const r=seed.registration,p=seed.payload,requester=body.requester;
 assert.equal(r.schema,'custodial.native-provider-register.v1');assert.equal(r.native_app.version_name,'synthetic');assert.match(r.token,/^synthetic-/);assert.equal(sha(r.token),r.token_digest);
 assert.equal(r.device_id,'KIOSK_08');assert.ok(Number.isSafeInteger(r.assignment_epoch)&&r.assignment_epoch>0);
 for(const name of ['operation_id','generation_id','credential_id','employee_id'])assert.match(r[name],uuid);
 for(const name of ['principal_digest','token_digest'])assert.match(r[name],hex);
 keys(requester,['current_generation_id','principal_digest','token_digest','credential_id','employee_id','device_id','assignment_epoch']);
 assert.deepEqual(requester,Object.fromEntries(['current_generation_id','principal_digest','token_digest','credential_id','employee_id','device_id','assignment_epoch'].map(k=>[k,k==='current_generation_id'?r.generation_id:r[k]])));
 for(const k of ['credential_id','employee_id','device_id','assignment_epoch'])assert.equal(seed.principal[k],r[k]);
 assert.equal(seed.registration_receipt.generation_id,r.generation_id);assert.match(seed.registration_receipt.registration_id,uuid);
 assert.equal(p.kind,'employee_lunch_coverage');assert.equal(p.generation_id,r.generation_id);assert.equal(p.principal_digest,r.principal_digest);assert.equal(p.token_digest,r.token_digest);
 assert.equal(p.receipt_assignment_epoch,String(r.assignment_epoch));assert.equal(p.receipt_credential_id,r.credential_id);assert.equal(p.receipt_employee_id,r.employee_id);assert.equal(p.receipt_device_id,r.device_id);
 assert.equal(Object.keys(p).length,27);assert.ok(Object.values(p).every(x=>typeof x==='string'));
 const unsigned=Object.fromEntries(Object.entries(p).filter(([k])=>k!=='content_sha256').sort(([a],[b])=>a<b?-1:1));assert.equal(sha(JSON.stringify(unsigned)),p.content_sha256);
 assert.equal(body.events.length,missing?5:4);assert.deepEqual([...new Set(body.events.map(x=>x.action))].sort(),['acknowledged','displayed','opened','received']);assert.equal(body.events[0].action,'received');
 assert.equal(new Set(body.events.map(x=>x.event_id)).size,body.events.length);
 for(const e of body.events){
  assert.match(e.event_id,uuid);assert.equal(e.schema,'custodial.native-provider-event.v2');
  const unknown=missing&&e.receipt_job_id==='77000000-0000-4000-8000-000000000099';
  for(const k of ['generation_id','principal_digest','token_digest','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id'])if(!unknown||!['content_sha256','receipt_job_id'].includes(k))assert.equal(e[k],p[k]);
  if(unknown){assert.equal(e.action,'received');const other={...unsigned,receipt_job_id:e.receipt_job_id};assert.equal(sha(JSON.stringify(Object.fromEntries(Object.entries(other).sort(([a],[b])=>a<b?-1:1)))),e.content_sha256);}
  assert.equal(e.receipt_assignment_epoch,r.assignment_epoch);assert.equal(e.record_id,sha(r.generation_id+'\n'+e.receipt_job_id+'\n'+p.notification_key));
 }
 assert.ok(Number.isSafeInteger(seed.journal_revision)&&seed.journal_revision>0&&seed.journal_revision<=32);
 assert.ok(Array.isArray(seed.records)&&seed.records.length>4&&seed.records.length<=32);
 const names=new Set();for(const row of seed.records){keys(row,['domain','id','json']);assert.match(row.domain,/^(METADATA|TOKEN|GENERATION|INBOX|EVENT)$/);assert.match(row.id,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);assert.equal(typeof row.json,'string');assert.ok(row.json.length<=65536);JSON.parse(row.json);assert.ok(!names.has(row.domain+':'+row.id));names.add(row.domain+':'+row.id);}
 for(const e of body.events){const rows=seed.records.filter(x=>x.domain==='EVENT'&&x.id===e.event_id);assert.equal(rows.length,1);const stored=JSON.parse(rows[0].json);assert.equal(stored.state,'PENDING');for(const [k,v]of Object.entries(e))if(k!=='schema')assert.deepEqual(stored[k],k==='receipt_assignment_epoch'?String(v):v);}
 return {input,raw,body,request:{schema:'custodial.native-provider-events.v2',events:body.events}};
}
export function validateNativeDecisionInput(input){
 keys(input,['schema','synthetic','production','frontend','seed','query','unresolved']);
 const {unresolved,...base}=input;keys(unresolved,['seed','query']);
 const normal=validateCase(base),missing=validateCase({...base,...unresolved},true);
 assert.deepEqual(unresolved.seed.principal,base.seed.principal);assert.deepEqual(unresolved.seed.registration,base.seed.registration);
 assert.deepEqual(unresolved.seed.registration_receipt,base.seed.registration_receipt);assert.deepEqual(unresolved.seed.payload,base.seed.payload);
 for(const e of normal.body.events)assert.deepEqual(missing.body.events.find(x=>x.event_id===e.event_id),e,'all original native bytes retained');
 assert.equal(missing.body.events.filter(e=>!normal.body.events.some(x=>x.event_id===e.event_id)).length,1);
 for(const row of base.seed.records.filter(x=>x.domain==='EVENT'))assert.deepEqual(unresolved.seed.records.find(x=>x.domain==='EVENT'&&x.id===row.id),row);
 assert.ok(unresolved.seed.journal_revision>base.seed.journal_revision);
 return {...normal,input,missing};
}
export function readNativeDecisionInput(path,expectedHash){
 assert.ok(isAbsolute(path)&&realpathSync(path)===path);assert.match(expectedHash,hex,'explicit prepared input hash required');
 const st=lstatSync(path);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&st.size<=1048576);assert.equal(st.mode&0o077,0);
 const raw=readFileSync(path);assert.equal(sha(raw),expectedHash);return {...validateNativeDecisionInput(JSON.parse(raw)),input_sha256:expectedHash};
}
export function nativeDecisionSeed(prepared){
 const {registration:r,payload:p,registration_receipt:receipt}=prepared.input.seed;
 return {ids:{employee:r.employee_id,credential:r.credential_id,generation:r.generation_id,operation:r.operation_id,registration:receipt.registration_id,job:p.receipt_job_id,projection:p.projection_id},
  body:r,token:r.token,payload:p,request:prepared.request,
  times:{activated:receipt.activated_at,reserved:p.reservation_at,valid_until:p.valid_until,server:'2026-09-24T17:00:01.000000Z'}};
}
export function assertNativeDecisionHttpCapture(prepared,response,{missing=false}={}){
 keys(response,['status','content_type','body_base64','body_sha256','request_id','request_body_sha256']);
 assert.equal(response.status,200);assert.match(response.content_type,/^application\/json(?:;|$)/);assert.match(response.request_id,uuid);
 const raw=bytes(response.body_base64,262144);assert.equal(sha(raw),response.body_sha256);assert.equal(response.request_body_sha256,prepared.input.query.body_sha256);
 const value=JSON.parse(raw);assert.equal(value.ok,true);assert.equal(value.data.schema,'custodial.native-provider-event-decisions.v1');
 assert.equal(value.data.native_request_id,response.request_id);assert.equal(value.data.request_body_sha256,response.request_body_sha256);assert.deepEqual(value.data.requester,prepared.body.requester);
 validateNativeProviderEventDecisions(value,prepared.body,{credentialId:prepared.body.requester.credential_id,credentialHash:'b'.repeat(64),nativeRequestId:response.request_id,attestationDigest:'b'.repeat(64),rawBodySha256:response.request_body_sha256});
 assert.equal(value.data.results.length,missing?5:4);assert.deepEqual(value.data.results.map(x=>x.event_id).sort(),prepared.body.events.map(x=>x.event_id).sort());
 assert.equal(value.data.results.filter(x=>x.decision==='ORIGINAL_ACCEPTED'&&x.receipt.replayed===true).length,4);
 assert.equal(value.data.results.filter(x=>x.decision==='UNRESOLVED').length,missing?1:0);
 if(missing){const id=prepared.body.events.find(x=>x.receipt_job_id==='77000000-0000-4000-8000-000000000099').event_id;assert.deepEqual(value.data.results.find(x=>x.event_id===id),{event_id:id,decision:'UNRESOLVED'});}
 return value;
}
