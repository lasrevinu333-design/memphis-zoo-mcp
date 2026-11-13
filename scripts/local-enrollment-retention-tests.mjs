import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {createHash,createHmac} from 'node:crypto';
import {inventoryRequestFixture} from './native-original-inventory-request-tests.mjs';
import {localEnrollmentRetentionWire as W,localEnrollmentRetentionFields as F,decodeLocalEnrollmentRetention,captureLocalEnrollmentRetention as capture,installLocalEnrollmentRetentionRoute} from '../src/native-local-enrollment-retention.js';
import {authenticateDeviceCredentialRequest,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
const sha=v=>createHash('sha256').update(v).digest('hex'),hmac=(s,v)=>createHmac('sha256',s).update(v).digest('hex');
const SECRET='SYNTHETIC_NATIVE_INVENTORY_TOKEN_ONLY_'.repeat(2);
function fixture(){const f=inventoryRequestFixture(),body=Object.fromEntries(F.map(k=>[k,'a'.repeat(64)]));
 Object.assign(body,{schema:W.schema,realm_id:'77777777-7777-4777-8777-777777777777',previous_realm:'legacy',inventory_native_request_id:'88888888-8888-4888-8888-888888888888',approval_id:'99999999-9999-4999-8999-999999999999',operation_id:f.target.operation_id,credential_id:f.target.credential_id});
 body.purpose_binding_sha256=sha(F.map(k=>body[k]).join('\n'));body.purpose_attestation=hmac(SECRET,[W.purpose,body.credential_id,body.purpose_binding_sha256].join('\n'));
 f.req.method='POST';f.req.path=f.req.url=f.req.originalUrl=W.path;f.req.scanAuthorityRawBody=Buffer.from(JSON.stringify(body));
 f.req.headers['x-memphis-native-request-id']=body.realm_id;f.req.headers['x-memphis-native-request-attestation']=hmac(SECRET,['custodial-native-request.v1',body.credential_id,'KIOSK_02','POST',W.path,sha(f.req.scanAuthorityRawBody),body.realm_id,f.req.headers['x-memphis-native-request-timestamp'],'custodial'].join('\n'));
 return {...f,body};}
const denied=fn=>assert.rejects(fn,e=>String(e.code).startsWith('local_enrollment_'));let groups=0;
{
 const f=fixture(),before=Buffer.from(f.req.scanAuthorityRawBody);f.row.expires_at='2026-10-15T09:00:00.000Z';
 const c=await capture(f.req,f.deps);assert.equal(c.parameters.p_original_utf8,before.toString());await c.revalidate();c.close();await denied(()=>c.revalidate());assert.deepEqual(f.req.scanAuthorityRawBody,before);groups++;
}
for(const mutate of [f=>f.row.revoked_at='2026-10-16T08:00:00Z',f=>f.row.confirmed_at='2026-10-17T00:00:00Z',f=>f.row.metadata_json.credential_secret_key_id='0'.repeat(64),f=>f.req.headers.origin='https://evil.example',f=>f.req.url+='?other=1',f=>f.req.body={},f=>f.row.device_id='99999999-9999-4999-8999-999999999999']){
 const f=fixture();mutate(f);await denied(()=>capture(f.req,f.deps));groups++;
}
{
 const f=fixture(),c=await capture(f.req,f.deps);f.req.scanAuthorityRawBody[0]=91;await denied(()=>c.revalidate());c.close();groups++;
}
{
 const f=fixture(),c=await capture(f.req,f.deps);f.row.metadata_json.retained_original_enrollment={realm_id:f.body.realm_id,operation_id:f.body.operation_id,report_sha256:sha(f.req.scanAuthorityRawBody),inventory_native_request_id:f.body.inventory_native_request_id};await c.revalidate();f.row.metadata_json.retained_original_enrollment.report_sha256='0'.repeat(64);await denied(()=>c.revalidate());c.close();groups++;
}
{
 const f=fixture(),raw=f.req.scanAuthorityRawBody;assert.deepEqual(decodeLocalEnrollmentRetention(raw),f.body);
 for(const b of [Buffer.from('{}'),Buffer.from(raw.toString()+' {}'),Buffer.from('{"schema":"x",'+raw.toString().slice(1)),Buffer.from(new SharedArrayBuffer(32)),new Proxy(raw,{})])assert.throws(()=>decodeLocalEnrollmentRetention(b));groups++;
}
{
 const f=fixture();f.row.metadata_json.retained_original_enrollment={realm_id:f.body.realm_id};f.row.expires_at='2036-10-15T09:00:00.000Z';
 f.deps.store.getPolicy=async()=>({mode:'observe'});
 const read=async()=>[{canonical_device_pk:f.target.canonical_device_pk,canonical_device_id:'KIOSK_02',device_id:'KIOSK_02',device_active:true,assigned_employee_id:'99999999-9999-4999-8999-999999999999',assignment_epoch:8,employee_active:true,employee_code:'EMP02',role:'staff'}];
 for(const readOnlyValidation of [false,true]){
  const result=await authenticateDeviceCredentialRequest(f.req,{...f.deps,runReadOnlySql:read,readOnlyValidation});assert.equal(result.ok,false);assert.equal(result.code,'device_original_enrollment_retained');
 }groups++;
}
{
 const routes=[],app={use(fn){routes.push(fn);},post(path,fn){assert.equal(path,W.path);routes.push(fn);}};
 const f=fixture();const installed=installLocalEnrollmentRetentionRoute(app,{...f.deps,now:()=>f.deps.now,db:{rpc(){throw Error('not invoked');}}});assert.equal(routes.length,2);assert.equal(installed.maxRequestBytes,16384);groups++;
}
{
 const id=n=>`a2000000-0000-4000-8000-${String(n).padStart(12,'0')}`,now=new Date('2026-11-01T00:00:00Z');
 const employee={id:id(1),employee_code:'EMP02',display_name:'Synthetic next employee',active:true,role:'staff'};
 const devices=Array.from({length:9},(_,i)=>({id:id(20+i),device_id:`KIOSK_${String(i+2).padStart(2,'0')}`,device_name:'Synthetic device',active:true,assigned_employee_id:i?null:employee.id,employees:i?null:employee}));
 const old={credential_id:id(50),device_id:devices[0].id,confirmed_at:'2026-10-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z',revoked_at:null,metadata_json:{retained_original_enrollment:{realm_id:id(90)}}};
 const fresh={...old,credential_id:id(51),metadata_json:{}};
 let credentials=[old,fresh];const calls=[];
 const client=createClient('https://synthetic-retained-coverage.invalid','synthetic-no-real-authority',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url??input.toString());assert.equal(url.origin,'https://synthetic-retained-coverage.invalid');assert.equal(init.method,'GET');
  const table=url.pathname.replace('/rest/v1/',''),rows={employees:[employee],devices,device_auth_credentials:credentials}[table];assert.ok(rows);calls.push({table,select:url.searchParams.get('select')});
  assert.equal(new Headers(init.headers).get('prefer'),'count=exact');return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json','Content-Range':`0-${rows.length-1}/${rows.length}`}});
 }}});
 let result=await deviceCredentialInternals.activeDeviceCoverage({supabase:client,now});assert.equal(result.ready_to_enforce,true);assert.equal(result.ready,1);assert.equal(result.devices[0].credential.credential_id,fresh.credential_id);assert.equal(result.coverage_issues.includes('active_device_credential_conflict'),false);
 credentials=[old];result=await deviceCredentialInternals.activeDeviceCoverage({supabase:client,now});assert.equal(result.ready_to_enforce,false);assert.equal(result.devices[0].enrolled,false);
 assert.ok(calls.filter(c=>c.table==='device_auth_credentials').every(c=>c.select.includes('metadata_json')));groups++;
}
{
 const f=fixture(),original=f.req.scanAuthorityRawBody.toString(),app=express();let rpcCalls=0,writes=0,saved=null,server;
 installLocalEnrollmentRetentionRoute(app,{...f.deps,now:()=>f.deps.now,db:{async rpc(name,parameters){
  assert.equal(name,W.rpc);assert.equal(parameters.p_original_utf8,original);rpcCalls++;
  if(!saved){writes++;saved={schema:'custodial.local-enrollment-retention-receipt.v1',realm_id:f.body.realm_id,operation_id:f.body.operation_id,
   inventory_native_request_id:f.body.inventory_native_request_id,credential_id:f.body.credential_id,employee_id:f.target.employee_id,canonical_device_id:'KIOSK_02',report_sha256:sha(original),recorded_at:'2026-10-16T09:00:00.000000Z',work_accepted:false,key_removal:false,phone_released:false};
   f.row.metadata_json.retained_original_enrollment={realm_id:f.body.realm_id,operation_id:f.body.operation_id,report_sha256:sha(original),inventory_native_request_id:f.body.inventory_native_request_id};
   throw Error('SYNTHETIC_REPLY_LOSS_AFTER_ONE_MOCK_FACT_WRITE');
  }
  return {data:saved,error:null};
 }}});
 app.use(express.json());server=http.createServer(app);server.requestTimeout=5000;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  async function request({method='POST',path=W.path,text=original,changedHeaders={}}={}){
   const headers={...f.req.headers,'content-type':'application/json; charset=utf-8','content-length':String(Buffer.byteLength(text)),...changedHeaders};
   return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers,agent:false},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});
   });req.setTimeout(5000,()=>req.destroy(Error('owned HTTP fixture timeout')));req.once('error',reject);req.end(text);});
  }
  const lost=await request();assert.equal(lost.status,503);assert.equal(lost.body.outcome,'UNKNOWN');assert.equal(writes,1);
  const recovered=await request();assert.equal(recovered.status,200);assert.deepEqual(recovered.body.data,saved);assert.equal(writes,1);assert.equal(rpcCalls,2);
  for(const [options,status] of [[{method:'GET'},405],[{path:W.path+'?caller=1'},400],[{changedHeaders:{'content-type':'text/plain'}},415],
   [{changedHeaders:{origin:'https://evil.invalid'}},403],[{text:'{}'},403],[{text:'x'.repeat(16385)},413]]){
   const refused=await request(options);assert.equal(refused.status,status,JSON.stringify(refused.body));assert.equal(refused.body.outcome,'UNKNOWN');
  }
  assert.equal(writes,1);assert.equal(rpcCalls,2);groups++;
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({pass:true,groups,scope:'ACTUAL_LOCAL_RAW_HTTP_AND_PINNED_SDK_WITH_SYNTHETIC_STORES; NO_SQL_OR_ANDROID_AUTHORITY',actual_SQL:false,Android:false,hardware:false}));
