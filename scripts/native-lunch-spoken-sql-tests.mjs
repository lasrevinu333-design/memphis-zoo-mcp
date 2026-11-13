// Actual disposable PostgreSQL and canonical accepted lunch document; no real
// provider, handset, mailbox, production endpoint or device/profile activation.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import pg from 'pg';
import {migrationReplayNames} from './migration-replay-order.mjs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
import {validateNativeLunchDispatch,prepareNativeLunchDataSender} from '../src/native-lunch-dispatch.js';
const [socket,out,container,mode='full']=process.argv.slice(2);
assert.ok(['full','dispatch-only'].includes(mode));
assert.match(socket,/^\/tmp\/mz-msg-[A-Za-z0-9_-]+\/socket$/);
assert.match(container,/^mz_schema_rebuild_lunch_[a-z0-9]+$/);
const sha=x=>createHash('sha256').update(x).digest('hex');
const q=x=>`'${String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")}'`;
const j=x=>q(x)+'::jsonb';
const put=(name,x)=>writeFileSync(out+'/'+name,JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});
let c,checks=0,current='startup';
const step=(name,detail={})=>{const row={at:new Date().toISOString(),name,...detail};appendFileSync(out+'/PROGRESS.jsonl',JSON.stringify(row)+'\n',{mode:0o600});console.log(JSON.stringify(row));};
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;step('CHECK',{test:name,checks});};
const sql=async text=>{const r=await c.query(text);return Array.isArray(r)?r.at(-1):r;};
const one=async text=>(await sql(text)).rows[0]?.v;
async function call(name,args,role='service_role'){
 assert.match(name,/^[a-z][a-z0-9_]+$/);assert.ok(['service_role','static_weekly_control_plane','anon','authenticated','custodial_application_reader','static_weekly_release_operator','supabase_admin'].includes(role));
 await sql('reset role');await sql('set role '+role);
 try{return await one(`select public.${name}(${Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z_]+$/);return k+'=>'+(v===null?'null':q(v));}).join(',')}) as v`);}
 finally{await sql('reset role');}
}
const absent=`select count(*)::int as v from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)`;
const remove=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].flatMap(scope=>['tables','sequences'].map(kind=>`alter default privileges for role ${owner}${scope} revoke all on ${kind} from public,anon,authenticated,service_role;`))).join('\n');
const exceptions=new Set(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql']);
const manifest=migrationReplayNames().map(file=>({file,sha256:sha(readFileSync('supabase/migrations/'+file))}));
put('MIGRATIONS.json',manifest);
const final='20261008032718_native_lunch_spoken_accepted_duties.sql';assert.equal(manifest.at(-1).file,final);assert.equal(manifest.length,235);
try{
 let ready=0;
 for(let n=0;n<40;n++){
  const next=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:30000});next.on('error',()=>{});
  try{await next.connect();assert.equal((await next.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')")).rows[0].n,4);ready++;if(ready===4){c=next;break;}await next.end();}
  catch{ready=0;await next.end().catch(()=>{});}await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(c,'isolated database startup');step('READY');await sql(remove);
 for(const [i,row] of manifest.entries()){
  current=row.file;assert.equal(await one(absent),0,'before '+current);
  const bytes=readFileSync('supabase/migrations/'+current);assert.equal(sha(bytes),row.sha256);await sql(bytes.toString());
  if(await one(absent)){assert.ok(exceptions.has(current));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);await sql(remove);}
  assert.equal(await one(absent),0,'after '+current);
  if(i%25===24||i===manifest.length-1)step('REPLAY',{completed:i+1,file:current});
 }
 current='accepted-lunch-fixture';
 // Future fixture day permits the existing private deterministic-time test
 // entrypoint without changing a production clock or generation timestamp.
 const dates=await one("select jsonb_build_object('date',public.sch_service_date(now())+1,'week',date_trunc('week',(public.sch_service_date(now())+1)::timestamp)::date) as v");
 const day=new Date(dates.date+'T12:00:00Z').getUTCDay(),manager=randomUUID();
 const slots=['Synthetic Tammy','Synthetic Karen','Synthetic Gregory','Synthetic Kaili'].map(name=>({id:randomUUID(),person:randomUUID(),name}));
 const codes=['West Admin','East Admin','Northwest Passage','Northwest Passage Restroom','Event Center','Event Center Left Restroom','China','China Restroom'];
 const locations=codes.map((name,i)=>({id:randomUUID(),name,code:'CUE_'+i,group:randomUUID()}));
 const lunches=[['12:00','13:00'],['12:30','13:30'],['10:00','11:00'],['14:00','15:00']];
 await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic cue manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
  insert into public.employees(id,employee_code,display_name,role,active) values ${slots.map((s,i)=>`(${q(s.person)},'EMP${980+i}',${q(s.name)},'staff',true)`).join(',')};`);
 for(const l of locations)await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(l.id)},${q(l.code)},${q(l.name)},'restroom','restroom',true);
  insert into public.location_groups(id,group_code,group_name,active) values(${q(l.group)},${q(l.code)},${q(l.name)},true);
  insert into public.location_group_memberships(location_id,location_group_id,active) values(${q(l.id)},${q(l.group)},true);`);
 const source={serviceDate:dates.week,timezone:'America/Chicago',exceptions:[],
  slots:slots.map(s=>({id:s.id,label:s.name,incumbencies:[{personId:s.person,displayName:s.name,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
  proximity:locations.flatMap(from=>locations.filter(to=>to!==from).map(to=>({from:from.id,to:to.id,minutes:1,verified:true,provenance:'synthetic-only cue fixture proximity, not geographic calibration'}))),
  versions:[{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:dates.week,effectiveEnd:null,objective:{requireVerifiedProximity:true},
   slotAvailability:slots.map((s,i)=>({slotId:s.id,dayOfWeek:day,status:'working',shift:{start:'07:00',end:'17:00'},lunch:{start:lunches[i][0],end:lunches[i][1]},
    productiveCapacityProvenance:'synthetic fixture shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'synthetic fixture capacity',qualifications:['general'],qualificationProvenance:'fixture',restrictions:[],restrictionProvenance:'fixture',acceptedRouteAnchorLocationId:locations[i*2].id,acceptedRouteProvenance:'fixture'})),
   assignments:slots.flatMap((s,i)=>locations.slice(i*2,i*2+2).map((l,n)=>({workId:l.code,dayOfWeek:day,ownerSlotId:s.id,locationId:l.id,locationCodeSnapshot:l.code,locationNameSnapshot:l.name,
    includedLocations:[{locationId:l.id,locationNameSnapshot:l.name}],schedulingMode:'flexible_coverage_ownership',window:{start:i===0&&n===1?'12:15':'09:45',end:'16:00'},serviceEffortMinutes:20,serviceEffortProvenance:'synthetic-only effort',priority:2,priorityProvenance:'fixture',requiredQualifications:['general'],qualificationProvenance:'fixture',restrictions:[],restrictionProvenance:'fixture'})))}]};
 const scalarSql=async statement=>{await sql('reset role');const r=await sql(statement);const v=r.rows[0]&&Object.values(r.rows[0])[0];return v==null?'':typeof v==='object'?JSON.stringify(v):String(v);};
 step('OFFICIAL_FIXTURE_BEGIN');
 const authority=await seedCompiledEventAuthority({sql:scalarSql,container,managerId:manager,dates:[dates.date],source,label:'lunch-spoken-cue',mode:'official'});
 await sql('reset role');const projection=authority.projectionIds[dates.week];
 const document=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[dates.week],publicationId:authority.publicationId,expectedRevision:0,actor:{managerId:manager,managerName:'Synthetic cue manager',idempotencyKey:'cue-lunch-document'}}).lunchDocument;
 await call('static_weekly_v8_materialize_lunch_document',{p_projection_id:projection,p_document:document,p_manager_id:manager},'static_weekly_control_plane');
 step('ACCEPTED_LUNCH',{projection,document_identity:document.document_identity,loans:document.loans.length,responsibilities:document.responsibilities.length});
 const loan=document.loans.find(l=>l.normal_owner_person_id===slots[0].person);
 const responsibility=document.responsibilities.find(r=>r.loan_id===loan.loan_id&&r.segments.some(s=>s.window.start==='12:15'));
 assert.ok(responsibility,'fixture retains a partial-window component');
 const coverer=slots.find(s=>s.person===responsibility.coverer_person_id);
 const args={p_projection:projection,p_document_identity:document.document_identity,p_loan_id:loan.loan_id,p_coverer:coverer.person,p_event:'start'};
 const body=await call('custodial_native_lunch_spoken_body',args,'supabase_admin');
 const ended=await call('custodial_native_lunch_spoken_body',{...args,p_event:'end'},'supabase_admin');
 const old=readFileSync('supabase/migrations/20261003194000_native_lunch_delivery.sql','utf8');
 const acceptedBefore=await one(`select document_json as v from public.weekly_schedule_lunch_documents where projection_id=${q(projection)}`);
 if(mode==='full'){
 check('start speaks only lunch owner actual end/duration and schedule direction',body,'You are on lunch coverage now for Synthetic Tammy until 1:00 PM Memphis time. Scheduled duration: 60 minutes. Please see your schedule page for your updated assignments.');
 check('no coverage area is spoken at start or end',locations.every(l=>!body.includes(l.name)&&!ended.includes(l.name)),true);
 check('partial borrowed-area window stays on accepted schedule',responsibility.segments.some(s=>s.window.start==='12:15'&&s.includedLocations.some(l=>l.locationNameSnapshot==='East Admin')),true);
 check('no coverer greeting or cleaning/on-call commands added to speech',!body.includes(coverer.name)&&!body.includes('cleaning')&&!body.includes('radio calls'),true);
 check('end keeps same no-areas rule and updated schedule direction',ended,'Your scheduled lunch coverage for Synthetic Tammy ended at 1:00 PM Memphis time. Scheduled duration: 60 minutes. Please see your schedule page for your updated assignments.');
 check('SQL duration arithmetic is not a hardcoded hour; no schedule policy changed',await one("select jsonb_build_array(extract(epoch from (time '12:45'-time '12:00'))/60,extract(epoch from (time '13:30'-time '12:00'))/60) as v"),[45,90]);
 const spokenDefinition=await one("select pg_get_functiondef('public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'::regprocedure) as v");
 check('formatter uses accepted loan window not fixed60 text',spokenDefinition.includes("duration_minutes:=extract(epoch from ((loan->>'coverage_end')::time-(loan->>'coverage_start')::time))/60;")&&!spokenDefinition.includes("'60 minutes'")&&!spokenDefinition.includes("'1 hour'"),true);
 for(const [label,change] of [['crossed document',{p_document_identity:'f'.repeat(64)}],['crossed recipient',{p_coverer:randomUUID()}],['unknown loan',{p_loan_id:'f'.repeat(64)}],['unsupported event',{p_event:'clean'}],['null event',{p_event:null}]]){
  await assert.rejects(()=>call('custodial_native_lunch_spoken_body',{...args,...change},'supabase_admin'));checks++;step('CHECK',{test:label+' fails closed',checks});
 }
 for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','custodial_application_reader','static_weekly_release_operator']){
  await assert.rejects(()=>call('custodial_native_lunch_spoken_body',args,role),e=>e.code==='42501');checks++;step('CHECK',{test:role+' cannot call private formatter',checks});
 }
 const definition=await one("select pg_get_functiondef('public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure) as v");
 const prior=old.slice(old.indexOf(' select * into prior'),old.indexOf(' data:=jsonb_build_object'));
 check('original receipt replay/conflict block remains byte exact',definition.includes(prior),true);
 const helperPoint=definition.indexOf("'body',public.custodial_native_lunch_spoken_body");
 check('new content only after original replay and before current live/hash/size checks',helperPoint>definition.indexOf('native_lunch_outcome_unknown_no_resend')&&helperPoint<definition.indexOf(' if public.custodial_native_lunch_live(p_job,data'),true);
 check('recovery has exact current helper/function and grant definitions',await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory i where case when object_kind in ('function','grant') and object_identity like '%(%' then to_regprocedure(object_identity) else null end in ('public.custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)'::regprocedure,'public.custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),4);
 check('new private formatter has required canary membership',await one("select count(*)::int as v from public.custodial_release_canary_authority_surface() where object_identity='custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)' and object_kind in ('function','grant')"),2);
 check('existing inventory ALWAYS guard is preserved',await one("select tgenabled::text as v from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'"),'A');
 }
 current='actual-lunch-reservation-dispatch';
 const device=randomUUID(),credential=randomUUID(),credentialHash=sha('synthetic-cue-credential'),token='SYNTHETIC-CUE-NOT-PROVIDER-TOKEN-'+randomUUID();
 await sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},'KIOSK_08','Synthetic cue device',true,${q(coverer.person)},1);
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,confirmed_at,expires_at) values(${q(credential)},${q(device)},${q(credentialHash)},now()-interval '2 days',now()-interval '1 day',now()+interval '4 days');`);
 const registration={schema:'custodial.native-provider-register.v1',operation_id:randomUUID(),generation_id:randomUUID(),credential_id:credential,employee_id:coverer.person,device_id:'KIOSK_08',assignment_epoch:1,principal_digest:sha('synthetic-cue-principal'),token_digest:sha(token),token,
  native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
 const registered=await call('custodial_native_provider_registration',{p_credential:credential,p_credential_hash:credentialHash,p_native_request:randomUUID(),p_attestation_digest:'b'.repeat(64),p_body:registration,p_status:false});assert.ok(registered.registration_id);
 async function job(event){
  const intent=document.notification_intents.find(i=>i.loan_id===loan.loan_id&&i.coverer_slot_id===coverer.id&&i.event===event),id=randomUUID(),lease=randomUUID();assert.ok(intent);
  const scheduled=await one(`select public.custodial_native_location_utc((${q(dates.date)}::date+${q(intent.scheduled_time)}::time) at time zone 'America/Chicago') as v`);
  const at=await one(`select public.custodial_native_location_utc(${q(scheduled)}::timestamptz+interval '1 second') as v`);
  const data={kind:'employee_lunch_coverage',projection_id:projection,notification_key:intent.notification_key,loan_id:loan.loan_id,event,coverer_slot_id:coverer.id,service_date:dates.date,scheduled_time:intent.scheduled_time,scheduled_at:scheduled,document_identity:document.document_identity};
  const payload={credential_id:credential,device_id:device,device_identifier:'KIOSK_08',employee_id:coverer.person,assignment_epoch:1,data_json:data};
  await sql(`insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,leased_at,leased_until,lease_token,payload_json) values(${q(id)},${q('employee-lunch-push:'+intent.notification_key+':'+credential)},'employee_native_push',${q(projection)},'leased',${q(at)},${q(at)}::timestamptz+interval '2 minutes',${q(lease)},${j(payload)});`);
  return {id,lease,at};
 }
 const first=await job('start');
 const target=await call('custodial_native_lunch_target_at',{p_job:first.id,p_lease:first.lease,p_test_at:first.at},'supabase_admin');assert.equal(target.current,true,JSON.stringify(target));
 const reserveArgs={p_job:first.id,p_lease:first.lease,p_expected:target.expected,p_test_at:first.at};
 // Reproduce the old generic body with the exact historical function, in a
 // rolled-back fixture transaction. Preserve every predicate and assertion.
 const historical=old.slice(old.indexOf('create function public.custodial_native_lunch_reserve_at('),old.indexOf('create function public.custodial_native_lunch_reserve('));
 await sql('begin');try{
  await sql(historical.replace('create function','create or replace function'));
  const before=await call('custodial_native_lunch_reserve_at',reserveArgs,'supabase_admin');
  check('historical actual SQL reproduces generic speech missing accepted lunch owner/end time',before.payload.body,'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.');
 }finally{await sql('rollback');}
 const dispatch=await call('custodial_native_lunch_dispatch_prepare_at',reserveArgs,'supabase_admin');
 const permit=validateNativeLunchDispatch(dispatch,{jobId:first.id,leaseToken:first.lease,expected:target.expected});
 check('actual new reservation carries exact accepted speech',permit.reservation.payload.body,body);
 let sent=0;
 const sender=prepareNativeLunchDataSender({projectId:'synthetic-zoo',accessToken:'synthetic-only',fetchImpl:async(url,options)=>{
  sent++;assert.equal(url,'https://fcm.googleapis.com/v1/projects/synthetic-zoo/messages:send');
  const message=JSON.parse(options.body).message;
  check('unchanged strict data-only native dispatch preserves exact body',message.data.body,body);
  check('dispatch uses bound original recipient token',message.token,token);
  return new Response(JSON.stringify({name:'projects/synthetic-zoo/messages/cue'}),{status:200});
 }});
 check('one fake provider dispatch', (await sender({permit,expected:target.expected,token})).outcome,'provider_accepted');
 await assert.rejects(()=>sender({permit,expected:target.expected,token}),/already_consumed/);checks++;
 const replay=await call('custodial_native_lunch_reserve_at',reserveArgs,'supabase_admin');
 check('existing reservation replay preserves body/hash/wire and denies resend',[replay.dispatch_authorized,replay.payload,replay.wire],[false,dispatch.reservation.payload,dispatch.reservation.wire]);
 check('repeated dispatch preparation creates no second attempt',(await call('custodial_native_lunch_dispatch_prepare_at',reserveArgs,'supabase_admin')).dispatch_authorized,false);
 check('only one receipt, attempt and fake send',[await one(`select count(*)::int as v from public.employee_native_push_delivery_receipts where job_id=${q(first.id)}`),await one(`select count(*)::int as v from public.employee_native_lunch_dispatch_attempts where job_id=${q(first.id)}`),sent],[1,1,1]);
 const last=await job('end');const endTarget=await call('custodial_native_lunch_target_at',{p_job:last.id,p_lease:last.lease,p_test_at:last.at},'supabase_admin');assert.equal(endTarget.current,true);
 check('actual end reservation carries accepted end speech',(await call('custodial_native_lunch_reserve_at',{p_job:last.id,p_lease:last.lease,p_expected:endTarget.expected,p_test_at:last.at},'supabase_admin')).payload.body,ended);
 check('speech/reservation changes no accepted area loan or partial timing records',await one(`select document_json as v from public.weekly_schedule_lunch_documents where projection_id=${q(projection)}`),acceptedBefore);
 put('CONTENT_READBACK.json',{schema:'custodial.accepted-lunch-spoken-readback.v1',projection_id:projection,document_identity:document.document_identity,body,end_body:ended,coverage_start:loan.coverage_start,coverage_end:loan.coverage_end,coverer_person_id:coverer.person,owner_person_id:slots[0].person,production:false,physical_playback:false});
 put('SQL_RESULT.json',{status:'PASS',mode,checks,migrations:manifest.length,automatic_table_sequence_grants_absent:true,actual_sql:true,official_accepted_projection:true,production:false,physical_playback:false});step('PASS',{checks});
}catch(error){put('SQL_RESULT.json',{status:'FAIL',checks,phase:current,code:error.code??null,message:error.message,production:false});throw error;}
finally{if(c)await c.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
