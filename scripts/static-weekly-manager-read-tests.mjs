import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
const env={NODE_ENV:'test',SUPABASE_URL:'https://scheduler-read-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-reader-service',OPS_MANAGER_SESSION_SECRET:'synthetic-manager-read-secret-0123456789012345'};
const manager={manager_id:'10000000-0000-4000-8000-000000000052',display_name:'Synthetic Read-only Manager',roles:['OPS_MANAGER'],active:true,is_system_principal:false,system_key:'jennifer_sheffield_director_operations'};
const credentialId='synthetic-reader-credential',deviceId='synthetic-reader-device';
const session=createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:'read_only',maximumAccessLevel:'read_only',env});
const calls=[],results=[],leases=new Set();let revoked=false,reassigned=false;
const mapKey='jennifer_sheffield_director_operations';
const mapSession=createOpsManagerSession({credentialId:'map-fixture',deviceId,manager,authMode:'map_identity:'+mapKey,accessLevel:'read_only',maximumAccessLevel:'read_only',env});
const snapshot={schema:'memphis-zoo.static-weekly-manager-snapshot.v1',week_start:'2026-10-05',authority_revision:42,projection_status:'current'};
const database={async connect(){const client=new EventEmitter();client.query=async(sql,args)=>{const text=typeof sql==='string'?sql:sql.text;calls.push(text);return {rows:[{result:snapshot,data:snapshot}],rowCount:1};};client.release=()=>{};return client;},async end(){}};
const controlPlane=createStaticWeeklyControlPlane({database,compiler:()=>{throw Error('Read invoked compiler');},initializeSolver:()=>{throw Error('Read invoked solver');}});
const store={async find(){return {credential_id:credentialId,device_id:deviceId,max_access_level:'read_only',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:revoked?new Date().toISOString():null,manager_id:reassigned?'10000000-0000-4000-8000-000000000099':manager.manager_id,manager:{...manager}};}};
store.getManagerBySystemKey=async key=>key===mapKey?{...manager,system_key:mapKey,active:!revoked}:null;
const supabase={async rpc(name,args){if(name==='custodial_begin_application_mutation_lease'){leases.add(args.p_request_id);return {data:{mutations_paused:false,authority_generation:1},error:null};}if(name==='custodial_release_application_mutation_lease'){leases.delete(args.p_request_id);return {data:true,error:null};}if(name==='custodial_heartbeat_application_mutation_lease')return {data:true,error:null};throw Error('Unexpected RPC');}};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database,controlPlane,datedTransitionController:null,supabase,trustedDeviceStore:store});
const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
const get=async token=>{const r=await fetch(base+'/static-weekly/manager-snapshot?week_start=2026-10-05',{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(3000)});return {status:r.status,body:await r.json()};};
try{
 await test('read-only named manager can view unchanged stored schedule',async()=>{const r=await get(session.token);assert.equal(r.status,200);assert.deepEqual(r.body.data,snapshot);assert.ok(calls.some(x=>x.includes('static_weekly_v3_read_manager_snapshot')));});
 await test('verified existing Map session can read the same schedule',async()=>{const r=await get(mapSession.token);assert.equal(r.status,200);assert.deepEqual(r.body.data,snapshot);});
 await test('revoked Map registry access is rejected',async()=>{revoked=true;try{const n=calls.length;assert.equal((await get(mapSession.token)).status,403);assert.equal(calls.length,n);}finally{revoked=false;}});
 await test('Map read session cannot publish',async()=>{const n=calls.length,r=await fetch(base+'/static-weekly/approved-initial/confirm',{method:'POST',headers:{Authorization:'Bearer '+mapSession.token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});assert.equal(r.status,403);await r.text();assert.equal(calls.length,n);});
 await test('read path does not invoke a schedule writer or compiler',()=>{for(const sql of calls)assert.doesNotMatch(sql,/static_weekly_(materialize|register|publish|apply)|insert into|update public|delete from/i);});
 await test('anonymous cannot view schedule',async()=>{const n=calls.length;assert.equal((await get(null)).status,401);assert.equal(calls.length,n);});
 await test('revoked read credential is rejected',async()=>{revoked=true;try{const n=calls.length;assert.equal((await get(session.token)).status,401);assert.equal(calls.length,n);}finally{revoked=false;}});
 await test('reassigned read credential is rejected',async()=>{reassigned=true;try{const n=calls.length;assert.equal((await get(session.token)).status,403);assert.equal(calls.length,n);}finally{reassigned=false;}});
 for(const path of['/drafts/initial','/approved-initial/confirm','/recurring-adaptation/confirm','/roster/vacant-slots'])await test('read access does not grant write '+path,async()=>{const n=calls.length,r=await fetch(base+'/static-weekly'+path,{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});assert.equal(r.status,403);await r.text();assert.equal(calls.length,n);});
 await test('direct mutation helper still rejects read-only manager',async()=>{const n=calls.length;await assert.rejects(controlPlane.createInitialDraft({manager:{...session,manager_display_name:manager.display_name,read_only:true},sourceId:'50000000-0000-4000-8000-000000000052',effectiveStart:'2026-10-05',expectedRevision:42,idempotencyKey:'must-not-write'}),/named manager|write-enabled/i);assert.equal(calls.length,n);});
 await test('no response leaves lease pending',async()=>{await new Promise(r=>setTimeout(r,10));assert.equal(leases.size,0);});
}finally{server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));await controlPlane.close();}
console.log(JSON.stringify({status:results.every(x=>x.pass)?'PASS':'FAIL',checks:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass),scope:'Actual runtime and control-plane code with signed synthetic sessions and synthetic SQL transport; no production or delegated-write activation.'},null,2));if(results.some(x=>!x.pass))process.exitCode=1;
