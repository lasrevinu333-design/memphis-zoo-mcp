import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createOpsManagerSession,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';
import {createPlacesAdminRouter,placeHttpFailure} from '../src/places-api.js';
import {makeRestoreMutationGate} from '../src/restore-mutation-gate.js';
import {buildPlaceReconciliation,PLACE_LEGACY_PREVIEW_SQL} from '../src/place-reconciliation.js';

const env={NODE_ENV:'production',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:'place-http-synthetic-test-secret-only'};
const manager={manager_id:randomUUID(),display_name:'Synthetic Custodial Manager',roles:['CUSTODIAL_MANAGER','OPS_MANAGER'],active:true,revoked_at:null};
const credential=randomUUID(),device='PLACE_HTTP_SYNTHETIC';
const row={credential_id:credential,device_id:device,device_label:'Synthetic Device',token_hash:'test-hash',max_access_level:'full_access',manager_id:manager.manager_id,manager,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
const store={find:async id=>id===credential?structuredClone(row):null};
const token=(overrides={})=>createOpsManagerSession({credentialId:credential,deviceId:device,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env,...overrides}).token;
const calls=[];let sqlError=null,paused=false;
const client={rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='custodial_begin_application_mutation_lease')return paused?{error:{message:'Mutations are paused; recovery is in progress.'}}:{data:{mutations_paused:false,authority_generation:1}};
 if(name==='custodial_release_application_mutation_lease')return {data:true};
 if(sqlError)return {error:sqlError};
 if(name==='custodial_place_preview')return {data:{as_of:new Date().toISOString(),places:[],legacy_consumer_cutover:false}};
 return {data:{place_id:args.p_place,revision:args.p_expected_revision+1,actor_manager_id:args.p_manager}};
}};
const writeGuard=makeOpsAccessMiddleware({env,requireWrite:true,trustedDeviceStore:store});
const app=express();app.use(express.json({limit:'64kb'}));app.use(makeRestoreMutationGate({supabase:client,required:true,serviceName:'synthetic-place-http'}));
let catalogReads=0;
app.use('/admin-api/places',createPlacesAdminRouter({client,requireManagerWrite:writeGuard,runReadOnlySql:async query=>{check(query,PLACE_LEGACY_PREVIEW_SQL,'server-owned static query only');catalogReads++;return [{legacy_kind:'event_venue',legacy_id:randomUUID(),legacy_code:'EVENT_ONLY_TEST',display_name:'Legacy Test',active:true,source_flags:{eligible_event_venue:true},aliases:['Test'],source_relationships:{location_group_id:null}}];}}));
app.use('/unconfigured',createPlacesAdminRouter({client:null,requireManagerWrite:writeGuard}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const command={request_id:randomUUID(),place_id:randomUUID(),expected_revision:2,action:'rename',payload:{display_name:'New human name'},reason:'Synthetic confirmed preview'};
async function request(path='/admin-api/places/preview',{body,bearer=token()}={}){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
}
try{
 check((await request(undefined,{bearer:null})).status,401,'unauthenticated denied');
 check((await request(undefined,{bearer:token({authMode:'operations_first',credentialId:null})})).status,403,'unnamed/open session denied');
 check((await request(undefined,{bearer:token({accessLevel:'read_only'})})).status,403,'read-only management denied');
 let result=await request();check(result.status,200,'trusted named manager preview');check(result.cache,'no-store','private read no cache');check(calls.at(-1).args,{p_manager:manager.manager_id},'preview identity only from guard');
 result=await request('/admin-api/places/reconciliation');check(result.status,200,'manager read-only legacy preview');check(result.body.data.records[0].disposition,'UNMAPPED','no name-based canonical inference');check(result.body.data.import_available,false,'no silent import');check(result.body.data.consumer_cutover,false,'no operational adoption claim');
 check(result.body.data.complete_manifest,false,'bounded separate reads cannot authorize import');check(result.body.data.reader_limit_metadata_available,false,'reader cap metadata not silently claimed');
 check((await request('/admin-api/places/reconciliation?sql=delete')).status,422,'caller SQL denied');check(catalogReads,1,'caller SQL never reaches reader');
 const legacyId=randomUUID(),canonicalId=randomUUID();const linked=buildPlaceReconciliation([{legacy_kind:'physical_location',legacy_id:legacyId},{legacy_kind:'event_venue',legacy_id:legacyId}],{places:[{place_id:canonicalId,physical_location_id:legacyId}]});
 check(linked.records[0].disposition,'PHYSICAL_ID_LINK_PRESENT','exact FK relationship preserved');check(linked.records[0].needs_review,true,'FK alone is not imported/cut over');check(linked.records[1].disposition,'UNMAPPED','same UUID in another namespace never joins');
 check((await request('/admin-api/places/preview?manager_id=forged')).status,422,'forged query field rejected');
 result=await request('/admin-api/places/commands',{body:command});check(result.status,200,'authenticated actual HTTP command');check(result.body.request_id,command.request_id,'exact response request');check(result.body.data.actor_manager_id,manager.manager_id,'response manager binding');
 const rpc=calls.find(c=>c.name==='custodial_place_command');check(rpc.args.p_manager,manager.manager_id,'RPC server manager');check(rpc.args.p_expected_revision,2,'exact CAS');check(rpc.args.p_request,command.request_id,'exact stable request');
 const before=calls.filter(c=>c.name==='custodial_place_command').length;
 check((await request('/admin-api/places/commands',{body:{...command,manager_id:randomUUID()}})).status,422,'body actor spoof denied');check(calls.filter(c=>c.name==='custodial_place_command').length,before,'spoof never reaches RPC');
 sqlError={code:'40001',message:'Place revision changed; preview again'};result=await request('/admin-api/places/commands',{body:command});check(result.status,409,'CAS failure is review conflict not auto retry');check(result.body.command_rejected,true,'structured rejection');
 sqlError={code:'55000',message:'Physical-place merge needs a verified tag/schedule cutover preview'};check((await request('/admin-api/places/commands',{body:command})).status,409,'physical merge fail closed');
 sqlError={code:'42501',message:'Manager access'};result=await request('/admin-api/places/commands',{body:command});check(result.status,403,'database manager check retained');check(result.body.command_rejected,undefined,'auth failure cannot discard uncertain operation');
 sqlError={message:'transport unavailable'};result=await request('/admin-api/places/commands',{body:command});check(result.status,503,'unknown outcome honest');check(result.body.command_rejected,false,'unknown cannot discard saved request');sqlError=null;
 row.revoked_at=new Date().toISOString();check((await request()).status,401,'revoked credential denied');row.revoked_at=null;
 row.manager_id=randomUUID();row.manager={...manager,manager_id:row.manager_id};check((await request()).status,403,'manager reassignment denied');row.manager_id=manager.manager_id;row.manager=manager;
 check((await request('/unconfigured/preview')).status,503,'missing service client fail closed');
 paused=true;const count=calls.filter(c=>c.name==='custodial_place_command').length;check((await request('/admin-api/places/commands',{body:command})).status,503,'actual restore guard pause');check(calls.filter(c=>c.name==='custodial_place_command').length,count,'pause never changes place');
 check(placeHttpFailure({message:'unrecognized'}).body.command_rejected,false,'unexpected failure conservatively unconfirmed');
 const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(index,/app\.use\("\/admin-api\/places", createPlacesAdminRouter\(\{ client: supabaseAdmin, requireManagerWrite: requireOpsManagerWrite, runReadOnlySql \}\)\)/);checks++;
 console.log(JSON.stringify({status:'PLACE_HTTP_AUTH_GUARD_RPC_CONTRACT_PASS',checks,actualHttp:true,actualExistingAuth:true,database:'mock RPC; unchanged foundation has separate480-check DB proof',productionWritten:false}));
}finally{await new Promise(r=>server.close(r));}
