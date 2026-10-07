import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile,readdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readMessagePreparePredecessor} from './fixtures/employee-message-prepare-predecessor.mjs';
import {runMessagePreparePredecessorTests} from './employee-message-prepare-predecessor-tests.mjs';

// Execute the actual owning dispatcher, with only external imports/scheduler
// stubbed. This is a no-network source proof, not a SQL or provider receipt.
export async function loadMessageDispatcher(sourcePath=new URL('../src/employee-notifications.js',import.meta.url)) {
 const source=await readFile(sourcePath,'utf8');
 const imports=[
  "import crypto from 'node:crypto';",
  "import { createClient } from '@supabase/supabase-js';",
  "import { makeDeviceCredentialMiddleware } from './auth/device-credential-auth.js';",
  "import { deliverNativeLocationJob } from './native-location-dispatch.js';",
  "import { deliverNativeLunchJob } from './native-lunch-dispatch.js';",
 ];
 let body=source;
 for(const line of imports){assert.equal(body.split(line).length,2);body=body.replace(line,'');}
 body=body.replace("import { isDeepStrictEqual } from 'node:util';",'');
 assert.doesNotMatch(body,/^import /m);
 body=body.replace(/^export /gm,'');
 return runInNewContext(body+'\ninstallEmployeeNotificationRoutes;',{
  crypto,isDeepStrictEqual,process:{pid:1,env:{}},console,structuredClone,
  createClient(){throw Error('No environment client allowed');},
  makeDeviceCredentialMiddleware(){return ()=>{};},
  deliverNativeLocationJob(){throw Error('Not MESSAGE');},
  deliverNativeLunchJob(){throw Error('Not MESSAGE');},
  setInterval(){return {unref(){}};},
 });
}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const copy=v=>JSON.parse(JSON.stringify(v));
export function messageAdmissionFixture(){
 const job={job_id:id(1),job_key:`employee-message-push:${id(2)}:${id(3)}`,job_type:'employee_native_push',
  source_id:id(2),lease_token:id(4),payload_json:{credential_id:id(3),employee_id:id(5),device_id:id(6),
   device_identifier:'KIOSK_08',assignment_epoch:4,channel_id:'employee-messages',title:'Synthetic sender',
   body:'Original synthetic message.',data_json:{kind:'employee_message',notification_type:'message',
    notification_key:`message:${id(2)}`,thread_id:id(7),message_id:id(2),
    route:`messages.html?hub=employee&thread_id=${id(7)}`,sender_name:'Synthetic sender',thread_title:'Synthetic conversation'}}};
 const registration={registration_id:id(8),credential_id:id(3),employee_id:id(5),device_id:id(6),
  assignment_epoch:4,fcm_token:'synthetic-message-token-not-provider',active:true};
 registration.token_hash=crypto.createHash('sha256').update(registration.fcm_token).digest('hex');
 const projection={schema:'custodial.employee-message-admission.v1',job_id:job.job_id,job_key:job.job_key,
  lease_token:job.lease_token,source_id:job.source_id,message_id:id(2),thread_id:id(7),recipient_user_id:id(9),
  employee_id:id(5),device_id:id(6),device_identifier:'KIOSK_08',credential_id:id(3),assignment_epoch:4,
  registration_id:id(8),token_hash:registration.token_hash,logical_key:`message:${id(2)}:recipient:${id(9)}`,
  source_revision:'a'.repeat(64),payload:copy(job.payload_json)};
 return {job,registration,projection};
}
export async function runEmployeeMessageSourceAdmissionTests({sourcePath}={}){
 const install=await loadMessageDispatcher(sourcePath);let checks=0;
 const check=(value,message)=>{assert.ok(value,message);checks++;};
 async function scenario({change,mode='new',hook,marker,expectReject=false}={}){
  const f=messageAdmissionFixture();if(marker!==undefined)f.job.payload_json.data_json.test_delivery=marker;
  f.projection.payload=copy(f.job.payload_json);const before=JSON.stringify(f.job);let sent=0,prepared=0,recorded=0;
  let pushed=null;const calls=[];
  const db={async rpc(name,args){calls.push({name,args:copy(args)});
   if(name==='mz_get_employee_native_push_delivery_receipt')return {data:mode==='delivered'
    ?{current:true,already_recorded:true,provider_message_id:'original-provider-id'}
    :mode==='unknown'?{current:true,delivery_outcome_unknown:true,reason:'native_push_delivery_outcome_unknown'}
     :{current:true,already_recorded:false}};
   if(name==='mz_resolve_employee_push_delivery')return {data:{ok:true,registration:copy(f.registration)}};
   if(name==='mz_prepare_employee_native_push_delivery'){
    prepared++;const result={current:true,dispatch_authorized:true,already_prepared:false,message_projection:copy(f.projection)};
    if(change)change(result,f);return {data:result};
   }
   if(name==='mz_record_employee_native_push_delivery'){recorded++;return {data:{current:true,recorded:true}};}
   if(name==='mz_record_employee_push_delivery')return {data:{current:true}};
   throw Error('Unexpected RPC: '+name);
  }};
  const app={use(){},get(){},post(){},delete(){}};
  const runtime=install(app,{supabase:db,pushRuntime:{configured:true,async send(push){sent++;pushed=copy(push);return 'new-provider-id';}},
   beforeFinalDeliveryCheck:hook?()=>hook(f):null});
  let outcome,error;
  try{outcome=await runtime.deliverClaimedJob(f.job);}catch(e){error=e;}
  if(expectReject){check(Boolean(error),'invalid or absent MESSAGE authority must reject');check(sent===0,'refused source cannot send');check(recorded===0,'refused source cannot record delivery');
   if(error?.code==='employee_message_projection_unresolved'){
    check(error.deferFinish===true,'uncertain original preparation must remain pending');
    check(error.terminal!==true&&error.permanent!==true,'missing projection does not mint permanent disposition');
    check(!calls.some(c=>c.name==='mz_release_employee_native_push_delivery'),'uncertain original is not released for resend');
   }}
  else check(!error,'valid source must retain delivery: '+error?.message);
  if(!hook)check(JSON.stringify(f.job)===before,'original queued bytes preserved');
  return {f,prepared,sent,recorded,pushed,calls,outcome,error};
 }
 await scenario({change:r=>delete r.message_projection,expectReject:true});
 const valid=await scenario();check(valid.sent===1&&valid.recorded===1,'one valid original attempt');
 assert.deepEqual(valid.pushed,{title:valid.f.job.payload_json.title,body:valid.f.job.payload_json.body,data_json:valid.f.job.payload_json.data_json});checks++;
 for(const field of ['job_id','job_key','lease_token','source_id','message_id','thread_id','employee_id','device_id','device_identifier',
  'credential_id','assignment_epoch','registration_id','token_hash','logical_key','schema']){
  await scenario({change:r=>{r.message_projection[field]=field==='assignment_epoch'?5:'crossed';},expectReject:true});
 }
 for(const change of [p=>{p.extra=true;},p=>{p.source_revision='bad';},p=>{p.recipient_user_id='bad';},p=>{p.payload.body='Newer message';},
  p=>{p.payload.data_json.route='https://external.invalid';},p=>{delete p.payload;},p=>{p.payload.data_json.message_id=id(10);}]){
  await scenario({change:r=>change(r.message_projection),expectReject:true});
 }
 for(const reason of ['message_source_stale','message_membership_stale','message_hidden','message_acknowledged','message_content_changed']){
  await scenario({change:r=>{r.current=false;r.dispatch_authorized=false;r.reason=reason;delete r.message_projection;},expectReject:true});
 }
 const delivered=await scenario({mode:'delivered'});check(delivered.sent===0&&delivered.prepared===0,'original delivered receipt precedes new projection');
 check(delivered.outcome.provider_message_id==='original-provider-id','original result retained');
 const unknown=await scenario({mode:'unknown',expectReject:true});check(unknown.prepared===0,'ambiguous original is not reprepared');
 const explicit=await scenario({marker:true,change:r=>delete r.message_projection});check(explicit.sent===1,'explicit boolean manager test unchanged');
 for(const marker of [false,'true','false',1,0,null,{},[]])await scenario({marker,change:r=>delete r.message_projection,expectReject:true});
 const race=await scenario({hook:f=>{f.job.payload_json.body='late caller mutation';f.job.payload_json.data_json.route='changed';}});
 check(race.pushed.body==='Original synthetic message.','caller mutation cannot alter authorized speech');
 check(race.pushed.data_json.route===messageAdmissionFixture().job.payload_json.data_json.route,'caller mutation cannot alter route');
 return {status:'PASS',checks,scope:'actual dispatcher with synthetic RPC/plugin edges; no SQL/provider/network'};
}
const migrationName='20261003121757_employee_message_source_admission.sql';
const laterPins=Object.freeze({
 '20261003140000_static_weekly_nonemployee_contractor_capacity.sql':'8ae8467900940a76b296030f630fbc610b7d21d619661a13d8caee32c4d8ddca',
 '20261003143000_issue_constraint_index_recovery.sql':'651d9c0562fc6fce55d1a76553e3f1016ef2bf52d879773101e551923b757276',
 '20261003150000_native_provider_interval_protocol.sql':'cb94f7cd6dd949407a936a2c6915bd0ef0972fb79a1cf89b2e480d628c50b194',
 '20261003160000_static_weekly_contractor_capacity_extension.sql':'3c6ec864d7b2bdd6264e44225a9c3e25c98a6fe522645bfdc5fad020e5877ac7',
 '20261003170000_native_target_source_projection.sql':'e9d998154190b1156009311c9c241b418b15c4d9c029c22186c49df5cf691b5c',
 '20261003190000_static_weekly_capacity_current_source_bridge.sql':'4454a7048e7845f39bb372397dd52bcb247de5fa68ec81f3fad01cc6186aa716',
 '20261003193000_coverall_event_brief_private_reader.sql':'c4b3ef269efad069b684ccfb2ebaf72923f87200d0093a3e5c46daba930ea318',
 '20261003194000_native_lunch_delivery.sql':'22ef0f716accbd8c2222a117ba876a04631163399ec5619418ddc2e0835f156b',
 '20261003210000_static_weekly_splash_season_gate.sql':'2f17a1d235f7da72cd0db6372a76793b6860490bf5fb2688240dc883102a78bd',
 '20261003211000_static_weekly_splash_source_retention.sql':'c03305a1da6f03db6e5a737e9605cb28b594703c5a3f14778b2575fdeb124eba',
 '20261003220000_current_release_authority_completion.sql':'8d8d60f1b10427f5c184488a9faa5e4f4bbb9ac2f11526ff921bb8c2eac70898',
 '20261003230000_static_weekly_named_handoff_derivation.sql':'ef4c6fc1183002af23797b5ac226660a3b1c2b85f3a543df75c1afa61d8fd500',
 '20261004000000_native_provider_event_decision_lookup.sql':'ab4e6eb848bd214f8616fb52f094829786df9a9a81d2eb8d00d247b1f28e52fd',
 '20261004140657_approved_static_template_authority.sql':'23f311b1d506c0d5ad3c0f04554a2388956f4fd8539af42e96107b1c07afa5b4',
 '20261006031304_custodial_owner_delegated_actions.sql':'4da5a15f22065b9467136eb4a622fa58a9559758c16edd844228f33a84223cf1',
 '20261006113610_custodial_shared_events_outlook.sql':'9172c433894853a0ccc378036f9d2d633422991d3ee30dca6007b1b81eeac001',
 '20261006162427_custodial_shared_events_recovery_binding.sql':'c889928458f5b8e70b860c41f707e8c1438d88270dc60b68cea32c6f06bc2537',
 '20261006172928_custodial_manager_scheduler_permissions.sql':'f4cf312cd905e82181e4b376948c0fb309fd70c575a066934f843e41a17c8d12',
 '20261006190426_manager_scheduler_recovery_binding.sql':'7a57b1b3607d27bd298646f72bc65917cb522e26a2c6169bb610ec79500c6209',
 '20261006203931_custodial_delegated_coverall.sql':'2f84424673d75eb2986a2c5d4b51c51baf4cbcb869def741aa5f5c84b5b3e475',
 '20261006211215_preserved_coverall_validator_recovery.sql':'2a47538c6c202482711e0ff80516c8a62a7acdf993302b3b3ef3dc0d3a237399',
});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
// This pins source ordering/finite textual delta, not PostgreSQL execution or
// complete replay. No host clock manipulation or invented future filename.
export async function runEmployeeMessageMigrationSourceTests(){
 let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const dir=new URL('../supabase/migrations/',import.meta.url);
 const inventory=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
 check(inventory.filter(f=>f>migrationName),Object.keys(laterPins),'all exact later migrations');
 for(const [file,hash] of Object.entries(laterPins)){
  const bytes=await readFile(new URL(file,dir));check(sha(bytes),hash,'unchanged later source '+file);
  check(bytes.includes('mz_prepare_employee_native_push_delivery'),false,'no later prepare writer '+file);
 }
 const predecessorChecks=runMessagePreparePredecessorTests();
 check(predecessorChecks.status,'PASS','owning historical predecessor hostile suite invoked');
 const predecessor=readMessagePreparePredecessor();
 const prior=predecessor.prior;
 check(sha(prior),'33d72de69db3e6735bec2827642bea966b89920d4c7b7bf338d73b7aca907ff2','exact last rendered prepare predecessor');
 const sql=await readFile(new URL(migrationName,dir),'utf8');
 function sourceContract(text){
  const literal=name=>{const m=text.match(new RegExp(' '+name+" text:='([^']*)';"));assert.ok(m,name);return m[1];};
  const oldDecl=literal('old_decl'),oldInsert=literal('old_insert');
  const oldReturn=text.match(/ old_return text:=\$old\$([\s\S]*?)\$old\$;/)?.[1];
  const addition=text.match(/ addition text:=\$message\$([\s\S]*?)\$message\$;/)?.[1];
  const result=text.match(/\$new\$([\s\S]*?)\$new\$\);/)?.[1];
  assert.ok(oldReturn&&addition&&result);
  for(const seam of [oldDecl,oldInsert,oldReturn])assert.equal(prior.split(seam).length,2,'one exact predecessor seam');
  assert.doesNotMatch(text,/create (?:or replace )?function|\bgrant execute\b|\brevoke\b|custodial_employee_message_source_projection|custodial_release_canary_authority_surface|insert into public\.custodial_release_authority_restore_inventory/i);
  for(const exact of [
   "v_job.job_key like 'employee-message-push:%'",
   "(v_job.payload_json#>'{data_json,test_delivery}') is distinct from 'true'::jsonb",
   'for share of d,c,r,e;',
   'select * into v_thread from public.msg_threads where id=v_thread_id for update;',
   'select * into v_message from public.msg_messages where id=v_job.source_id for share;',
   'where thread_id=v_thread.id and user_id=v_user.id and left_at is null for share;',
   'v_message_receipt.acknowledged_at is not null',
   'public.msg_message_deletions','public.msg_thread_visibility',
   "v_data->>'message_id' is distinct from v_job.source_id::text",
   "v_payload->>'body' is distinct from left(coalesce(nullif(regexp_replace(v_message.body,'[[:space:]]+',' ','g'),''),'New message'),1000)",
   'if v_job.leased_until<=v_now or v_target.credential_expires_at<=v_now then',
   "'source_revision',public.static_weekly_digest_jsonb(","'payload',v_payload)",
   "public.static_weekly_digest_text(prior) is distinct from '33d72de69db3e6735bec2827642bea966b89920d4c7b7bf338d73b7aca907ff2'",
   "row.definition_sql is distinct from public.custodial_release_authority_current_grant_definition(row.object_identity)",
   'if pg_get_functiondef(sig::regprocedure) is distinct from next_definition',
   "i.definition_sql=prior and i.definition_sha256=public.static_weekly_digest_text(prior)",
   "get diagnostics n=row_count;if n<>1 then raise exception 'MESSAGE prepare recovery update count changed';end if;",
  ])assert.ok(text.includes(exact),'required finite boundary '+exact);
  assert.equal((text.match(/\bupdate public\.custodial_release_authority_restore_inventory/g)||[]).length,1);
  assert.equal((text.match(/\bexecute next_definition;/g)||[]).length,1);
  assert.ok(prior.indexOf('if v_receipt.job_id is not null then')<prior.indexOf(oldInsert));
  assert.doesNotMatch(addition,/\bread_at\b|\bupdate\b(?!;)|\binsert into\b|\bdelete from\b|interval '/);
  const next=prior.replace(oldDecl,oldDecl+' v_message_projection jsonb;').replace(oldInsert,addition+oldInsert).replace(oldReturn,result);
  assert.equal(next.replace(oldDecl+' v_message_projection jsonb;',oldDecl).replace(addition,'').replace(result,oldReturn),prior);
  return next;
 }
 const next=sourceContract(sql);checks++;
 check(next,predecessor.current,'existing finite source reconstruction matches independently pinned current body');
 for(const [before,after] of [
  ['v_message_receipt.acknowledged_at is not null','false'],
  ['and left_at is null for share;','for share;'],
  ['if v_job.leased_until<=v_now or v_target.credential_expires_at<=v_now then','if false then'],
  ['v_data->>\'message_id\' is distinct from v_job.source_id::text','false'],
  ['i.definition_sql=prior and i.definition_sha256=public.static_weekly_digest_text(prior)','true'],
  ["get diagnostics n=row_count;if n<>1 then raise exception 'MESSAGE prepare recovery update count changed';end if;",'null;'],
 ]){assert.notEqual(sql.replaceAll(before,after),sql);assert.throws(()=>sourceContract(sql.replaceAll(before,after)));checks++;}
 assert.throws(()=>sourceContract(sql+'\ngrant execute on function public.fake() to public;'));checks++;
 return {status:'PASS',checks,scope:'portable finite source delta and 21 later-migration hashes only; SQL not executed',
  migration:migrationName,sha256:sha(sql),predecessor_sha256:sha(prior),expected_definition_sha256:sha(next),predecessor_checks:predecessorChecks};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 console.log(JSON.stringify(await runEmployeeMessageSourceAdmissionTests()));
 console.log(JSON.stringify(await runEmployeeMessageMigrationSourceTests()));
}
