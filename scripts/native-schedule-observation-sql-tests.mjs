import {loadNativeScheduleEventOriginals} from '../src/native-schedule-event-originals.js';
import {validateNativeProviderEventsRequest,validateNativeProviderEventsResponse} from '../src/native-provider-events.js';
import {validateNativeProviderEventDecisions} from '../src/native-provider-event-decisions.js';
import {validateNativeSchedulePayload,nativeScheduleRecordId,NATIVE_SCHEDULE_PAYLOAD_KEYS} from '../src/native-schedule-payload.js';
import {canonicalNativeLocation} from '../src/native-location-reservation.js';
import {buildNativeScheduleContentCandidate,prepareNativeScheduleContent} from '../src/native-schedule-delivery-preparation.js';
// Actual isolated PostgreSQL source eligibility, no provider/job/phone effect.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import pg from 'pg';
import {deriveNativeScheduleOccurrence} from '../src/native-schedule-occurrence.js';
import {deriveNativeScheduleValiditySource} from '../src/native-schedule-validity-source.js';
import {nativeScheduleSnapshotSql} from '../src/native-schedule-preparation.js';
import {migrationReplayNames} from './migration-replay-order.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
const [socket,out,container]=process.argv.slice(2),q=x=>`'${String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")}'`;
assert.match(socket,/^\/tmp\/mz-msg-[A-Za-z0-9_-]+\/socket$/);assert.match(container,/^mz_schema_rebuild_lunch_[a-z0-9]+$/);
const sha=x=>createHash('sha256').update(x).digest('hex');
const put=(name,x)=>writeFileSync(out+'/'+name,JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});
let c,checks=0,current='startup';
const step=(name,detail={})=>{const row={at:new Date().toISOString(),name,...detail};appendFileSync(out+'/PROGRESS.jsonl',JSON.stringify(row)+'\n',{mode:0o600});console.log(JSON.stringify(row));};
const eq=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;step('CHECK',{test:name,checks});};
const sql=async text=>{const r=await c.query(text);return Array.isArray(r)?r.findLast(x=>x.rows?.length)||r.at(-1):r;};
const one=async text=>(await sql(text)).rows[0]?.v;
async function deny(name,text){await sql('begin');let error;try{await sql(text);}catch(e){error=e;}finally{await sql('rollback');}
 assert.equal(error?.code,'42501',name);checks++;step('CHECK',{test:name,checks});}
const absent="select count(*)::int as v from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const remove=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].flatMap(scope=>['tables','sequences'].map(kind=>`alter default privileges for role ${owner}${scope} revoke all on ${kind} from public,anon,authenticated,service_role;`))).join('\n');
const exceptions=new Set(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql']);
const manifest=migrationReplayNames().map(file=>({file,sha256:sha(readFileSync('supabase/migrations/'+file))}));put('MIGRATIONS.json',manifest);
assert.equal(manifest.length,242);assert.equal(manifest.at(-1).file,'20261008111355_native_schedule_observation_binding.sql');
try{
 let ready=0;
 for(let n=0;n<40;n++){
  const next=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:30000});next.on('error',()=>{});
  try{await next.connect();assert.equal((await next.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')")).rows[0].n,4);
   if(++ready===4){c=next;break;}await next.end();}catch{ready=0;await next.end().catch(()=>{});}await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(c);step('READY');await sql(remove);
 for(const [i,row] of manifest.entries()){
  current=row.file;assert.equal(await one(absent),0,'before '+current);const bytes=readFileSync('supabase/migrations/'+current);assert.equal(sha(bytes),row.sha256);await sql(bytes.toString());
  if(await one(absent)){assert.ok(exceptions.has(current));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);await sql(remove);}
  assert.equal(await one(absent),0,'after '+current);if(i%25===24||i===manifest.length-1)step('REPLAY',{completed:i+1,file:current});
 }
 current='accepted-source-fixture';
 const dates=await one("select jsonb_build_object('date',public.sch_service_date(now())-1,'week',date_trunc('week',(public.sch_service_date(now())-1)::timestamp)::date) as v");
 const day=new Date(dates.date+'T12:00:00Z').getUTCDay(),manager=randomUUID();
 const {source,slots,places}=nativeLocationAuthoritySource(dates.week,day);
 // Fixture-only lunch at09:45. No incumbent schedule or live data is changed.
 source.versions[0].slotAvailability[0].lunch={start:'09:45',end:'10:45'};
 source.versions[0].assignments.forEach(x=>x.window.start='08:00');
 await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic09:45manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values ${slots.map((s,i)=>`(${q(s.person)},'EMP${960+i}',${q(s.name)},'staff',true)`).join(',')};`);
 for(const p of Object.values(places))await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(p.id)},${q(p.code)},${q(p.name)},'restroom','restroom',true);
 insert into public.location_groups(id,group_code,group_name,active) values(${q(p.group)},${q(p.code)},${q(p.name)},true);
 insert into public.location_group_memberships(location_id,location_group_id,active) values(${q(p.id)},${q(p.group)},true);`);
 const scalarSql=async text=>{await sql('reset role');const r=await sql(text),v=r.rows[0]&&Object.values(r.rows[0])[0];return v==null?'':typeof v==='object'?JSON.stringify(v):String(v);};
 step('OFFICIAL_FIXTURE_BEGIN');
 const authority=await seedCompiledEventAuthority({sql:scalarSql,container,managerId:manager,dates:[dates.date],source,label:'ownership0945-source',mode:'official'});
 const projection=authority.projectionIds[dates.week];await sql('reset role');
 const document=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[dates.week],publicationId:authority.publicationId,expectedRevision:0,
 actor:{managerId:manager,managerName:'Synthetic09:45manager',idempotencyKey:'ownership0945-source-document'}}).lunchDocument;
 await sql(`set role static_weekly_control_plane;select public.static_weekly_v8_materialize_lunch_document(${q(projection)},${q(document)}::jsonb,${q(manager)});reset role;`);
 const links=(await sql(`select normal_occurrence_id,normal_owner_id,coverer_id,coverage_start::text,coverage_end::text from public.static_weekly_v8_read_lunch_segments(${q(dates.date)}::date)
 where projection_id=${q(projection)} and normal_owner_id=${q(slots[0].person)} and coverage_start<=time '09:45' and coverage_end>=time '09:45' order by normal_occurrence_id,coverer_id`)).rows;
 assert.ok(links.length>0&&links.every(x=>x.coverer_id));const link=links[0];assert.notEqual(link.coverer_id,link.normal_owner_id);
 const registered=new Map();
 for(const [index,person] of [...new Set([link.normal_owner_id,link.coverer_id,...slots.map(s=>s.person)])].entries()){
  const device=randomUUID(),credential=randomUUID(),generation=randomUUID(),token='synthetic-0945-source-token-'+index,tokenHash=sha(token),identifier='KIOSK_'+String(index+2).padStart(2,'0');
  await sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},${q(identifier)},'Synthetic source phone',true,${q(person)},1);
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(credential)},${q(device)},${q(sha('synthetic-0945-source-credential-'+index))},now()-interval '4 days',${q(dates.date)}::date+interval '2 days');
  set role service_role;select public.mz_register_employee_push(${q(credential)},${q(token)},${q(tokenHash)},'android','synthetic-only','synthetic.custodial.df36d32368b6');reset role;`);
  const registration=await one(`select registration_id::text as v from public.employee_push_registrations where credential_id=${q(credential)} and active`);assert.ok(registration);
  const app={package_name:'org.memphiszoo.custodial',version_name:'synthetic-only',version_code:53,build_id:'synthetic.custodial.df36d32368b6'};
  await sql(`insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,credential_id,employee_id,assignment_epoch,
   principal_digest,token_digest,native_app,request_fingerprint,first_native_request_id,first_attestation_digest,activated_at)
   values(${q(generation)},${q(randomUUID())},${q(registration)},${q(device)},${q(identifier)},${q(credential)},${q(person)},1,repeat('a',64),${q(tokenHash)},${q(app)}::jsonb,repeat('b',64),${q(randomUUID())},repeat('c',64),now()-interval '3 days');`);
  registered.set(person,{device,credential,generation});
 }

 current='actual-content-source';
 const ctx=registered.get(link.coverer_id),at=dates.date+' 09:46:00 America/Chicago',operation=randomUUID();
 const sourceReport=await one("select public.custodial_native_schedule_window_source_at("+[link.normal_occurrence_id,link.coverer_id,ctx.generation].map(q).join(',')+","+q(at)+"::timestamptz) as v");
 const context={sourceKey:link.normal_occurrence_id,employeeId:link.coverer_id,generationId:ctx.generation,expectedSourceSha256:sourceReport.window.server_source_sha256,operationId:operation};
 const reserve="select public.custodial_native_schedule_source_reserve_at("+[context.sourceKey,context.employeeId,context.generationId,context.expectedSourceSha256,operation].map(q).join(',')+","+q(at)+"::timestamptz) as v";
 const first=await one(reserve),contentCall=(when=at,person=link.coverer_id,generation=ctx.generation)=>"select public.custodial_native_schedule_content_source_at("+[operation,person,generation].map(q).join(',')+","+q(when)+"::timestamptz) as v";
 const content=await one(contentCall()),expected=buildNativeScheduleContentCandidate(first,context);

 current='actual-finalization';
 const job=randomUUID(),lease=randomUUID(),sourceId=first.reservation.reservation_id;
 const recipient=sourceReport.window.recipient;
 const actor={assignment_epoch:String(recipient.assignment_epoch),credential_id:recipient.credential_id,device_id:recipient.device_identifier,
  employee_id:recipient.employee_id,generation_id:recipient.generation_id,principal_digest:recipient.principal_digest,
  registration_id:await one('select registration_id::text as v from public.employee_native_push_generations where generation_id='+q(ctx.generation)),token_digest:recipient.token_digest};
 const jobPayload={credential_id:actor.credential_id,device_id:recipient.device_id,device_identifier:actor.device_id,employee_id:actor.employee_id,
  assignment_epoch:actor.assignment_epoch,data_json:{kind:'employee_schedule_ownership',source_reservation_id:sourceId}};
 const jobKey='employee-schedule-push:'+sourceId+':'+actor.credential_id;
 await sql('insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,lease_token,leased_until,payload_json) values('
  +[job,jobKey,'employee_native_push',sourceId,'leased',lease].map(q).join(',')+','+q(dates.date+' 12:00 America/Chicago')+'::timestamptz,'+q(jobPayload)+'::jsonb)');
 const finalizeCall=(when=at,want=actor,id=job,token=lease,sid=sourceId)=>'select public.custodial_native_schedule_finalize_at('
  +[id,token,sid].map(q).join(',')+','+q(want)+'::jsonb,'+q(when)+'::timestamptz) as v';
 const publicFinalize='select public.custodial_native_schedule_finalize('+[job,lease,sourceId].map(q).join(',')+','+q(actor)+'::jsonb) as v';
 const stateCount=()=>one('select count(*)::int as v from public.employee_native_schedule_finalizations');

 current='historical-synthetic-original-observation';
 // Yesterday is a SYNTHETIC private-time receipt fixture only, allowing actual
 // current-clock readback after the model source window. No production or
 // handset event/time/qualification is asserted by this diagnostic fixture.
 const finalized=await one(finalizeCall()),p=finalized.payload;assert.equal(finalized.status,'FINALIZED_NATIVE_UNQUALIFIED');
 const credentialHash=await one('select token_hash as v from public.device_auth_credentials where credential_id='+q(actor.credential_id));
 const lookup=(jobs=[job],cid=actor.credential_id,hash=credentialHash)=>'select public.custodial_native_schedule_observation_originals('+[cid,hash].map(q).join(',')+','+q(jobs)+'::jsonb) as v';
 const originals=await one('set role service_role;'+lookup()+';reset role;');eq('actual current clock original lookup has one expired original',originals.originals.length,1);
 const recordId=nativeScheduleRecordId(p),original=originals.originals[0];eq('actual SQL original identity matches paired native source formula',original.record_id,recordId);
 eq('original source ID not substituted with job ID',original.source_reservation_id,sourceId);
 eq('source original expired but exact lookup retained',original.notification_key,p.notification_key);
 const bounds={earliest_at:p.reservation_at,latest_at:p.reservation_at,clock_profile_id:'SYNTHETIC_SQL_MODEL_NOT_NATIVE_QUALIFICATION',elapsed_realtime_ms:1,boot_count:1};
 const event=(action,observation={earliest_at:null,latest_at:null,clock_profile_id:null,elapsed_realtime_ms:null,boot_count:null})=>({schema:'custodial.native-provider-event.v2',event_id:randomUUID(),record_id:recordId,action,
  generation_id:p.generation_id,content_sha256:p.content_sha256,receipt_job_id:job,notification_key:p.notification_key,receipt_credential_id:p.receipt_credential_id,
  receipt_employee_id:p.receipt_employee_id,receipt_device_id:p.receipt_device_id,receipt_assignment_epoch:Number(p.receipt_assignment_epoch),
  principal_digest:p.principal_digest,token_digest:p.token_digest,admission_bounds:bounds,original_observation:observation});
 const received=event('received'),displayed=event('displayed',{...bounds,earliest_at:p.reservation_at.replace('46:00','46:01'),latest_at:p.reservation_at.replace('46:00','46:01'),elapsed_realtime_ms:2}),
  opened=event('opened'),ack=event('acknowledged');
 const batch=events=>({schema:'custodial.native-provider-events.v2',events});
 const map=await loadNativeScheduleEventOriginals({db:{rpc:async(name,args)=>{assert.equal(name,'custodial_native_schedule_observation_originals');return{data:await one(lookup(args.p_jobs,args.p_credential,args.p_credential_hash))};}},
  events:[received],credentialId:actor.credential_id,credentialHash});
 eq('actual SQL-backed JavaScript original map exact',map.get(job),original);
 eq('actual SQL-backed bound request validates',validateNativeProviderEventsRequest(batch([received]),{scheduleOriginals:map}),batch([received]));
 const admittedAt=dates.date+' 09:47:00 America/Chicago';
 const eventCall=(events,when=admittedAt,nativeRequest=randomUUID(),digest='a'.repeat(64))=>'select public.custodial_native_provider_events_at('+[actor.credential_id,credentialHash,nativeRequest,digest].map(q).join(',')+','+q(batch(events))+'::jsonb,'+q(when)+'::timestamptz) as v';
 // Isolate the interval guard BEFORE Received exists; otherwise the existing
 // once-per-record/action conflict properly wins before interval evaluation.
 const cutoff={...received,event_id:randomUUID(),admission_bounds:{...bounds,latest_at:p.valid_until}};
 eq('cutoff-straddling admission rejected',(await one(eventCall([cutoff],p.valid_until))).data.results[0].code,'native_provider_observation_invalid');
 const firstEvents=await one(eventCall([displayed,received]));
 eq('real SQL orders Received before Displayed',firstEvents.data.results.map(x=>[x.action,x.admitted_state]),[['received','ACCEPTED'],['displayed','ACCEPTED']]);
 eq('SQL received/displayed echo validates through JS',validateNativeProviderEventsResponse(firstEvents,batch([displayed,received]),{scheduleOriginals:map}),firstEvents);
 const publicEvents='select public.custodial_native_provider_events('+[actor.credential_id,credentialHash,randomUUID(),'b'.repeat(64)].map(q).join(',')+','+q(batch([ack,opened]))+'::jsonb) as v';
 const late=await one('set role service_role;'+publicEvents+';reset role;');eq('late original Open/Dismiss remain exact original facts',late.data.results.map(x=>[x.action,x.admitted_state]),[['opened','ACCEPTED'],['acknowledged','ACCEPTED']]);
 eq('schedule Dismiss never projects location cleaning/check ACK',[await one('select count(*)::int as v from public.employee_native_location_ack_projections'),await one('select count(*)::int as v from public.device_notification_acknowledgements')],[0,0]);
 eq('original wire stays immutable',await one('select native_payload as v from public.employee_native_push_delivery_receipts where job_id='+q(job)),p);
 eq('source original stays immutable',await one('select source_window as v from public.employee_native_schedule_source_reservations where reservation_id='+q(sourceId)),first.reservation.window);
 const replay=await one(eventCall([received],p.valid_until));eq('expired exact Received replay preserved',replay.data.results[0].replayed,true);
 const conflict={...received,original_observation:{...received.original_observation,boot_count:1}};
 eq('same event ID cannot rewrite original observation',(await one(eventCall([conflict],p.valid_until))).data.results[0].code,'native_provider_event_conflict');
 const altered={...received,event_id:randomUUID(),content_sha256:'d'.repeat(64)};
 eq('altered content cannot bind original',(await one(eventCall([altered],p.valid_until))).data.results[0].code,'native_provider_original_binding_invalid');
 const query={schema:'custodial.native-provider-event-decision-query.v1',requester:{current_generation_id:actor.generation_id,credential_id:actor.credential_id,
  employee_id:actor.employee_id,device_id:actor.device_id,assignment_epoch:Number(actor.assignment_epoch),principal_digest:actor.principal_digest,token_digest:actor.token_digest},events:[received,displayed,opened,ack]};
 const nativeRequest=randomUUID(),rawSha=sha(JSON.stringify(query)),contextProof={credentialId:actor.credential_id,credentialHash,nativeRequestId:nativeRequest,attestationDigest:'c'.repeat(64),rawBodySha256:rawSha};
 const decisionCall='select public.custodial_native_provider_event_decisions('+[actor.credential_id,credentialHash,nativeRequest,'c'.repeat(64),rawSha].map(q).join(',')+','+q(query)+'::jsonb) as v';
 const decisions=await one('set role service_role;'+decisionCall+';reset role;');eq('current clock late decision retrieves four exact originals',decisions.data.results.map(x=>x.decision),Array(4).fill('ORIGINAL_ACCEPTED'));
 eq('actual SQL decisions validate through bound JS',validateNativeProviderEventDecisions(decisions,query,contextProof,{scheduleOriginals:map}),decisions);
 eq('decision readback does not create events',await one('select count(*)::int as v from public.employee_native_provider_events'),4);
 eq('unknown job reveals no original',(await one(lookup([randomUUID()]))).originals,[]);
 const requesterOther=registered.get(link.normal_owner_id),otherHash=await one('select token_hash as v from public.device_auth_credentials where credential_id='+q(requesterOther.credential));
 eq('other employee cannot disclose original',(await one(lookup([job],requesterOther.credential,otherHash))).originals,[]);
 await deny('wrong current credential hash fails closed','set role service_role;'+lookup([job],actor.credential_id,'f'.repeat(64)));
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('original RPC denied '+role,'set role '+role+';'+lookup());
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('private time lookup denied '+role,
  'set role '+role+';select public.custodial_native_schedule_observation_originals_at('+[actor.credential_id,credentialHash].map(q).join(',')+','+q([job])+'::jsonb,'+q(admittedAt)+'::timestamptz)');
 await sql('begin');try{await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(actor.credential_id));
  const hidden=await one(decisionCall);eq('revocation decision stays unresolved without receipt',hidden.data.results.map(x=>Object.keys(x).sort()),Array(4).fill(['decision','event_id']));
 }finally{await sql('rollback');}
 for(const fn of ['custodial_native_schedule_original_record_id(uuid,uuid,text)','custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamp with time zone)',
  'custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)','custodial_native_schedule_observation_originals(uuid,text,jsonb)',
  'custodial_native_provider_event_shape(jsonb)','custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)',
  'custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)']){
  eq('exact recovery function '+fn,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+fn)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+fn)+"::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),1);
 }
 eq('shape lookup stable/private definer not cached immutable',await one("select jsonb_build_array(provolatile::text,prosecdef) as v from pg_proc where oid='public.custodial_native_provider_event_shape(jsonb)'::regprocedure"),['s',true]);
 eq('provider outcomes remain absent',await one('select count(*)::int as v from public.employee_native_location_outcomes'),0);
 put('OBSERVATION_READBACK.json',{first,finalized,originals,original,received,displayed,opened,ack,firstEvents,late,replay,decisions,
  execution:'Actual isolated242SQL with synthetic historical/private-timed original and modeled intervals. Public original lookup/Open/Dismiss/decision use current SQL clock; no real/native profile/provider/phone proof.',production:false,phone:false});
 put('SQL_RECEIPT.json',{status:'PASS',checks,migrations:manifest.length,actual_SQL:true,actual_SQL_JS_original_binding:true,schedule_cleaning_ACK_projection:false,
  native_qualified:false,provider_dispatch:false,phone:false});console.log(JSON.stringify({status:'PASS',checks,actual_SQL:true,native_qualified:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
