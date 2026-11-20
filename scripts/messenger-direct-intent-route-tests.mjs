import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {historicalMigrationNames} from './fixtures/reminder-timing-source-successor.mjs';
// Current Express router and real loopback HTTP, synthetic auth/DB dependencies.
import assert from 'node:assert/strict';
import express from 'express';
import {createMessagingRouter} from '../src/messaging-api.js';
const id=n=>`db000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cohort=id(1),claim=id(2),actor=id(3),peer=id(4),intent=id(5),thread=id(6),device='SYNTHETIC_BROWSER';
const calls=[];let revoked=false;
const boundary=(req,res,next)=>{
 if(revoked||req.get('X-Fixture-Access')!=='synthetic')return res.status(401).json({ok:false});
 if(req.get('X-CSRF-Token')!=='fixture-csrf')return res.status(403).json({ok:false});
 req.memphisAuth={manager_id:cohort,claimed_manager_id:claim,credential_id:id(7),device_id:device,auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',role:'ops_manager',read_only:req.get('X-Fixture-Readonly')==='yes'};
 if(req.get('X-Fixture-Frozen')==='yes')req.memphisDeviceAuth={offline_recovery_only:true};
 next();
};
const app=express();app.use(express.json());app.use('/messaging-api',createMessagingRouter({
 requireDeviceAccess:boundary,runReadOnlySql:async()=>[],buildHealthPayload:()=>({ok:true}),
 leadershipMessagingBridge:async({session,action,origin,csrfToken})=>{assert.equal(action,'identity');assert.equal(origin,'https://fixture.invalid');assert.equal(csrfToken,'fixture-csrf');return{schema:'custodial.cohort-messenger-identity.v1',msg_user_id:actor,role:'manager',custodial_cohort_manager_id:session.manager_id,custodial_claimed_account_id:session.claimed_manager_id,identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,ops_manager_id:null};},
 runRpc:async(name,args)=>{calls.push({name,args});if(name==='msg_issue_direct_open_intent')return{intent_id:intent,request_id:args.p_request_id,expires_at:'2026-11-19T18:15:00Z'};if(name==='msg_consume_direct_open_intent'||name==='msg_get_or_create_direct_thread')return{id:thread,thread_type:'direct',is_active:true};throw Error('Unexpected fixture writer '+name);},appVersion:'fixture',releaseId:'LOCAL_UNPUBLISHED',contractVersion:'messaging.v5'
}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
async function post(path,body={},headers={}){const res=await fetch(`http://127.0.0.1:${server.address().port}/messaging-api${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://fixture.invalid','X-Fixture-Access':'synthetic','X-CSRF-Token':'fixture-csrf',...headers},body:JSON.stringify({created_by_user_id:actor,other_user_id:peer,device_id:device,...body})});return{status:res.status,body:await res.json()};}
let passed=0;const failures=[];async function check(name,run){calls.length=0;try{await run();passed++;}catch(error){failures.push({name,error:error.message});}}
const issue={open_protocol:2,request_id:id(8),request_at:'2026-11-19T18:00:00.000Z'},consume={open_protocol:2,open_intent_id:intent};
try{
 await check('issuer binds the authenticated selected-name account',async()=>{const r=await post('/thread/direct-intent',issue);assert.equal(r.status,200);assert.equal(r.body.data.intent_id,intent);assert.equal(r.body.meta.open_protocol,2);assert.deepEqual(calls,[{name:'msg_issue_direct_open_intent',args:{p_user_a:actor,p_user_b:peer,p_request_id:issue.request_id,p_request_at:issue.request_at}}]);});
 await check('consumer binds same selected-name account and server intent',async()=>{const r=await post('/thread/direct',consume);assert.equal(r.status,200);assert.equal(r.body.data.id,thread);assert.deepEqual(calls,[{name:'msg_consume_direct_open_intent',args:{p_user_a:actor,p_user_b:peer,p_intent_id:intent}}]);});
 for(const path of ['/thread/direct-intent','/thread/direct']){
  const body=path.endsWith('direct-intent')?issue:consume;
  await check(path+' rejects another claimed actor without mutation',async()=>{assert.equal((await post(path,{...body,created_by_user_id:peer})).status,403);assert.equal(calls.length,0);});
  await check(path+' rejects read-only sessions without mutation',async()=>{assert.equal((await post(path,body,{'X-Fixture-Readonly':'yes'})).status,403);assert.equal(calls.length,0);});
  await check(path+' rejects frozen offline recovery authority without mutation',async()=>{const r=await post(path,body,{'X-Fixture-Frozen':'yes'});assert.equal(r.status,403);assert.equal(r.body.code,'messenger_offline_recovery_forbidden');assert.equal(calls.length,0);});
  await check(path+' retains denied credential and CSRF boundaries',async()=>{assert.equal((await post(path,body,{'X-Fixture-Access':'none'})).status,401);assert.equal((await post(path,body,{'X-CSRF-Token':'wrong'})).status,403);assert.equal(calls.length,0);});
 }
 await check('legacy unsupported IDs never invoke a writer',async()=>{for(const value of [intent,null,false,0,[]])assert.equal((await post('/thread/direct',{open_operation_id:value})).status,409);assert.equal(calls.length,0);});
 await check('malformed new protocol fields cannot fall back to canonical creation',async()=>{for(const value of [null,false,0,'',[],{},' '+intent])assert.equal((await post('/thread/direct',{open_protocol:2,open_intent_id:value})).status,422);assert.equal(calls.length,0);});
 await check('pre-protocol client retains non-reopening canonical route',async()=>{assert.equal((await post('/thread/direct',{})).status,200);assert.equal(calls[0].name,'msg_get_or_create_direct_thread');});
 await check('revoked fixture session cannot issue or consume',async()=>{revoked=true;assert.equal((await post('/thread/direct-intent',issue)).status,401);assert.equal((await post('/thread/direct',consume)).status,401);assert.equal(calls.length,0);});
 console.log(JSON.stringify({scope:'Current router, loopback HTTP; synthetic credential middleware, cohort bridge and DB; no production or live messages',passed,failed:failures.length,failures},null,2));if(failures.length)process.exitCode=1;
}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));console.log('OWNED_HTTP_SERVER_CLOSED');}

// Source/recovery dependency proof only. Full original-owner SQL remains mandatory.
{
 const sha=b=>createHash('sha256').update(b).digest('hex'),root=new URL('../',import.meta.url);
 const migration=readFileSync(new URL('supabase/migrations/20261120002521_messenger_direct_reopen_intents_v2.sql',root));
 const tail=readFileSync(new URL('proposals/messenger-direct-open-recovery.sql',root));
 assert.equal(sha(tail),'48a7c9a2e807654a514134b1e469210d12e5cb0a075d86cf021c8207035a00c1');
 assert.ok(migration.subarray(-tail.length-1).equals(Buffer.concat([Buffer.from('\n'),tail])));
 const previous=migration.subarray(0,-tail.length-1);assert.equal(sha(previous),'62b5102a0f0b5fe601d9d67509c199919808001f00f4d88d0faca5f7dac96fe6');
 const profile=JSON.parse(readFileSync(new URL('scripts/fixtures/accepted-seven-current-week-forward.json',root)));
 assert.equal(profile.deferred[0].sha256,sha(migration));assert.equal(profile.deferred[0].bytes,migration.length);
 profile.deferred[0].sha256=sha(previous);profile.deferred[0].bytes=previous.length;
 assert.equal(sha(JSON.stringify(profile,null,2)+'\n'),'46077a4a1905a8249de45d3440011d0b16f294ead973ece82dfdc14ddcd4b37e');
 const {readdirSync}=await import('node:fs');const names=readdirSync(new URL('supabase/migrations/',root)).filter(n=>n.endsWith('.sql')).sort();
 assert.equal(names.length,322);assert.equal(historicalMigrationNames(root.pathname,names).length,315);
 assert.doesNotMatch(tail.toString(),/\b(?:insert into|update|delete from|truncate) public\.msg_/i);
 console.log(JSON.stringify({status:'PASS_EXACT_MESSENGER_RECOVERY_SOURCE_DEPENDENCY',originalMigrationPreserved:true,historicalForwardFixturePreserved:true,actualSQL:false,production:false}));
}
