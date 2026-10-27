// New route seam only. Real source auth/HTTP/SQL adapter; injected synthetic
// store and SQL pool. No live mailbox, hosted database, map survey or phone.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import express from 'express';
import {createOpsManagerSession,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';
import {runReadOnlySql} from '../src/supabase/read.js';
import {HISTORY_SQL} from '../src/gps-map-history.js';
import {completeGpsHistoryRows,makeGpsMapContextHandler,installGpsMapContextRoute,GPS_MAP_CONTEXT_ROUTE} from '../src/gps-map-context-route.js';
const id=n=>`94000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const principal={role:'ops_manager',manager_id:id(1),credential_id:id(2),device_id:'SYNTHETIC_GPS_MANAGER',
  read_only:true,permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false}};
const instant=Date.parse('2026-10-09T16:10:00Z');
const row={open_work_id:id(3),source_kind:'native_offline_context',work_session_id:null,work_context_id:id(3),work_session_uuid:'synthetic-native',client_session_id:'synthetic-native',employee_id:id(4),work_device_id:id(5),work_location_id:id(6),location_code:'SYNTHETIC_LOCATION',device_identifier:'SYNTHETIC_DEVICE',work_status:'active',started_at:'2026-10-09T16:00:00Z',ended_at:null,event_id:id(7),event_session_id:null,event_device_id:id(5),event_location_id:id(6),event_device_identifier:'SYNTHETIC_DEVICE',event_location_code:'SYNTHETIC_LOCATION',event_result:'location_uncalibrated',received_at:'2026-10-09T16:01:01Z',association_count:1,payload_json:{session_uuid:'synthetic-native',client_session_id:'synthetic-native',observed_at:'2026-10-09T16:01:00Z',client_latitude:35,client_longitude:-90,accuracy_m:5}};
const complete=(rows=[row])=>({ok:true,row_limit_truncated:false,response_truncated:false,omitted_oversized_rows:0,rowCount:rows.length,originalRowCount:rows.length,rows});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
const invoke=async({session=structuredClone(principal),query={},body={},result=complete(),read=null,now=()=>instant}={})=>{let calls=0;const req={memphisAuth:session,query,body},res=response();await makeGpsMapContextHandler({runReadOnlyQuery:async sql=>{calls++;assert.equal(sql,HISTORY_SQL);return read?read(req):result;},now})(req,res);return{req,res,calls};};

test('named read-only manager consumes original native context and missing controls stay unverified',async()=>{const {res,calls}=await invoke();assert.equal(calls,1);assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.body.meta.contract,'gps-map-context.v1');assert.equal(res.body.meta.manager_id,principal.manager_id);assert.equal(res.body.data.work[0].session.employeeId,id(4));assert.equal(res.body.data.work[0].session.sessionId,null);assert.equal(res.body.data.controls,null);assert.equal(res.body.data.geographic_registration,'unverified_controls_missing');});
test('absent or malformed named manager and missing read permission refuse before SQL',async()=>{for(const delta of [null,{role:'employee'},{manager_id:'fake'},{credential_id:null},{permissions:{read:true}},{permissions:{schema:'custodial.manager-permissions.v1',read:false}}]){const session=delta===null?null:{...principal,...delta};const r=await invoke({session});assert.equal(r.res.code,403);assert.equal(r.calls,0);}});
test('caller identities, coordinates, controls, limits and body input cannot select history',async()=>{for(const key of ['manager_id','employee_id','session_uuid','device_id','latitude','controls','limit']){const r=await invoke({query:{[key]:'untrusted'}});assert.equal(r.res.code,422);assert.equal(r.calls,0);}const r=await invoke({body:{controls:{fake:true}}});assert.equal(r.res.code,422);assert.equal(r.calls,0);});
test('partial/missing adapter completeness flags never produce successful path data',async()=>{for(const delta of [{row_limit_truncated:true},{response_truncated:true},{omitted_oversized_rows:1},{rowCount:0},{originalRowCount:2},{ok:false},{rows:null},{row_limit_truncated:undefined},{response_truncated:undefined}]){const r=await invoke({result:{...complete(),...delta}});assert.equal(r.res.code,503);assert.equal(r.res.body.data,undefined);}assert.throws(()=>completeGpsHistoryRows([row]));});
test('principal or read authority change during SQL withholds response',async()=>{for(const delta of [{manager_id:id(20)},{credential_id:id(21)},{device_id:'OTHER'},{permissions:{schema:'custodial.manager-permissions.v1',read:false}}]){const r=await invoke({read:async req=>{req.memphisAuth={...req.memphisAuth,...delta};return complete();}});assert.equal(r.res.code,403);assert.equal(r.res.body.data,undefined);}});
test('SQL errors and malformed authority fail without exposing raw private details',async()=>{const r=await invoke({read:async()=>{throw new Error('PRIVATE DATABASE CONNECTION SECRET');}});assert.equal(r.res.code,503);assert.doesNotMatch(JSON.stringify(r.res.body),/PRIVATE|SECRET/);const invalid=await invoke({result:complete([{...row,employee_id:null}])});assert.equal(invalid.res.code,503);});
test('unknown server time refuses before history read',async()=>{const r=await invoke({now:()=>NaN});assert.equal(r.res.code,503);assert.equal(r.calls,0);});
test('per-work incomplete and truncated state survive API without claiming geometry',async()=>{for(const rows of [[{...row,association_count:2}],Array.from({length:1201},(_,n)=>({...row,event_id:id(n+100)}))]){const r=await invoke({result:complete(rows)});assert.equal(r.res.code,200);const work=r.res.body.data.work[0];assert.equal(work.incomplete||work.truncated,true);assert.equal(r.res.body.data.controls,null);}});
test('dedicated SQL adapter enforces read-only transaction and exposes global truncation',async()=>{
 const commands=[];let releaseReason;
 const authority={same_session_identity:true,transaction_read_only:true,dedicated_reader_member:true,exclusive_reader_membership:true,direct_object_grants_absent:true,owned_objects_absent:true,reader_role_restricted:true};
 const pool={async connect(){return{async query(sql){commands.push(sql);if(sql.includes('with login_role as'))return{rows:[authority]};if(sql.startsWith('select * from ('))return{rows:[row,{...row,event_id:id(8)}]};return{rows:[]};},release(reason){releaseReason=reason;}};}};
 const result=await runReadOnlySql({pool,sql:HISTORY_SQL,maxRows:1,maxResponseBytes:10000});assert.equal(result.row_limit_truncated,true);assert.equal(result.rows.length,1);assert.throws(()=>completeGpsHistoryRows(result));assert.equal(commands[0],'begin isolation level repeatable read read only');assert.equal(commands.at(-1),'commit');assert.equal(releaseReason,undefined);assert.ok(commands.some(x=>x==='set local row_security = on'));
 const r=await invoke({read:async()=>result});assert.equal(r.res.code,503);
});
test('byte-compacted actual source adapter response also refuses',async()=>{
 const authority={same_session_identity:true,transaction_read_only:true,dedicated_reader_member:true,exclusive_reader_membership:true,direct_object_grants_absent:true,owned_objects_absent:true,reader_role_restricted:true};
 const pool={async connect(){return{async query(sql){if(sql.includes('with login_role as'))return{rows:[authority]};if(sql.startsWith('select * from ('))return{rows:[{...row,oversized_fixture:'x'.repeat(2000)}]};return{rows:[]};},release(){}};}};
 const result=await runReadOnlySql({pool,sql:HISTORY_SQL,maxResponseBytes:1000});assert.equal(result.response_truncated,true);const r=await invoke({result});assert.equal(r.res.code,503);
});
test('installer requires existing auth and mounts only fixed GET',()=>{const mounts=[];const auth=()=>{};installGpsMapContextRoute({get(...args){mounts.push(args);}},{requireOpsManagerAuth:auth,runReadOnlyQuery:async()=>complete()});assert.equal(mounts.length,1);assert.equal(mounts[0][0],GPS_MAP_CONTEXT_ROUTE);assert.equal(mounts[0][1],auth);assert.throws(()=>installGpsMapContextRoute({get(){}},{runReadOnlyQuery:()=>{}}));});

await test('exact main mount, real signed/current-manager auth, loopback HTTP and frontend consumer',async t=>{
 const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const mount="installGpsMapContextRoute(app, {\n  requireOpsManagerAuth,\n  runReadOnlyQuery: async sql => runSupabaseReadOnlySql({ sql }),\n});";
 assert.equal(source.split(mount).length,2);assert.ok(source.includes('import { installGpsMapContextRoute } from "./gps-map-context-route.js";'));
 const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'synthetic-route-only-not-production-secret'};
 const manager={manager_id:principal.manager_id,display_name:'Synthetic delegated manager',roles:['OPS_MANAGER'],active:true,revoked_at:null,is_system_principal:false,system_key:null};
 const trusted={credential_id:principal.credential_id,device_id:principal.device_id,manager_id:manager.manager_id,manager,token_hash:'synthetic-test-only',max_access_level:'full_access',revoked_at:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};
 const token=createOpsManagerSession({credentialId:trusted.credential_id,deviceId:trusted.device_id,manager,accessLevel:'read_only',env}).token;
 const wrongIssuedDeviceToken=createOpsManagerSession({credentialId:trusted.credential_id,deviceId:'OTHER_ISSUED_DEVICE',manager,accessLevel:'read_only',env}).token;
 const app=express();let reads=0,fixtureResult=complete(),fixtureError=null;
 vm.runInNewContext(mount,{app,installGpsMapContextRoute,requireOpsManagerAuth:makeOpsAccessMiddleware({env,trustedDeviceStore:{find:async credential=>credential===trusted.credential_id?trusted:null}}),runSupabaseReadOnlySql:async({sql})=>{reads++;assert.equal(sql,HISTORY_SQL);if(fixtureError)throw fixtureError;return fixtureResult;}},{timeout:1000});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,url=origin+GPS_MAP_CONTEXT_ROUTE,headers={authorization:'Bearer '+token,'X-Device-Id':trusted.device_id};
 try{
  await t.test('anonymous, invalid bearer and wrong issued-device token cannot read',async()=>{for(const h of [{},{authorization:'Bearer invalid'}, {...headers,authorization:'Bearer '+wrongIssuedDeviceToken}])assert.ok([401,403].includes((await fetch(url,{headers:h})).status));assert.equal(reads,0);});
  await t.test('untrusted device header cannot change authenticated canonical context',async()=>{const r=await fetch(url,{headers:{...headers,'X-Device-Id':'untrusted-header'}});assert.equal(r.status,200);const p=await r.json();assert.equal(p.meta.manager_id,principal.manager_id);assert.equal(p.meta.credential_id,principal.credential_id);assert.equal(p.data.work[0].session.deviceIdentifier,'SYNTHETIC_DEVICE');});
  if(!process.argv.includes('--auth-fixture-only')){
  await t.test('delegated readonly manager gets exact contract, not geographic admission',async()=>{const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const p=await response.json();assert.equal(p.meta.contract,'gps-map-context.v1');assert.equal(p.meta.manager_id,principal.manager_id);assert.equal(p.data.controls,null);assert.equal(p.data.work[0].session.employeeId,id(4));});
  await t.test('exact existing frontend path source consumes loopback-backed contract',async()=>{const require=createRequire(import.meta.url);const pathSource=require('../../../gps-native-history-repair-20261009-v1/frontend/custodial-gps-path-source.js');let outgoing;const data=await pathSource.read({headers,fetchImpl:async(u,o)=>{outgoing=u;assert.equal(o.method,'GET');assert.equal(o.cache,'no-store');return fetch(url,o);}});assert.equal(outgoing,'https://memphis-zoo-mcp.onrender.com/dashboard-api/gps-map-context');assert.equal(data.controls,null);assert.equal(data.geographic_registration,'unverified_controls_missing');assert.equal(data.work.length,1);});
  await t.test('forged query and POST do not reach reader',async()=>{const before=reads;assert.equal((await fetch(url+'?controls=forged',{headers})).status,422);assert.equal((await fetch(url,{headers,method:'POST'})).status,404);assert.equal(reads,before);});
  await t.test('partial rows cannot become HTTP success or frontend data',async()=>{fixtureResult={...complete(),row_limit_truncated:true};const r=await fetch(url,{headers});assert.equal(r.status,503);assert.equal((await r.json()).data,undefined);fixtureResult=complete();});
  await t.test('private SQL error is redacted',async()=>{fixtureError=new Error('PRIVATE SQL DETAIL');const r=await fetch(url,{headers});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/PRIVATE SQL DETAIL/);fixtureError=null;});
  await t.test('current credential revocation and manager reassignment refuse before SQL',async()=>{const before=reads;trusted.revoked_at=new Date().toISOString();assert.equal((await fetch(url,{headers})).status,401);trusted.revoked_at=null;trusted.manager_id=id(90);assert.equal((await fetch(url,{headers})).status,403);assert.equal(reads,before);});
  }
 }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
