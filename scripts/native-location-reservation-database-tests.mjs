import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {reserveNativeLocation,canonicalNativeLocation,validateNativeLocationReservation} from '../src/native-location-reservation.js';
const container=`mz_schema_rebuild_native_location_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:'set statement_timeout=30000;'+text}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const hash=v=>createHash('sha256').update(v).digest('hex');
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
let owned=false,checks=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const reject=(name,query,pattern=/ERROR/)=>{let error;try{sql(query);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;console.log('PASS',name);};
const cleanup=()=>{if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container);}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup();}finally{process.exit(143);}});
const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),manifest=[];
assert.equal(files.at(-1),'20261002180000_native_provider_location_reservation.sql');
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',image,network:'none',production:false}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
 removeDefaults();for(const file of files){
  assert.equal(sql(defaults),'0','before '+file);const bytes=readFileSync('supabase/migrations/'+file);
  try{sql(bytes.toString());}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error;}
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  assert.equal(sql(defaults),'0','after '+file);manifest.push({file,sha256:hash(bytes)});
  if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
  await new Promise(resolve=>setImmediate(resolve)); // Signals can clean the owned container between migrations.
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 const manager=randomUUID(),device=randomUUID(),credential=randomUUID();
 const serviceDate='2026-10-02',at=serviceDate+'T15:00:00.123456Z',week=eventAuthorityWeekStart(serviceDate);
 const {source,slots,places}=nativeLocationAuthoritySource(week,5),employee=slots[0].person,other=slots[1].person,location=places.W.id;
 sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic location manager');`);
 for(const [index,slot] of slots.entries())sql(`insert into public.employees(id,employee_code,display_name,role,active) values(${q(slot.person)},${q('EMP99'+index)},${q(slot.name)},'staff',true)`);
 for(const place of Object.values(places))sql(`insert into public.locations(id,location_code,location_name,location_type,form_type) values(${q(place.id)},${q(place.code)},${q(place.name)},'restroom','restroom');
 insert into public.location_groups(id,group_code,group_name) values(${q(place.group)},${q(place.code)},${q(place.name)});
 insert into public.location_group_memberships(location_group_id,location_id) values(${q(place.group)},${q(place.id)});`);
 const authority=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[serviceDate],source,mode:'official',label:'native-location'});
 const publishLunch=()=>{const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[week],publicationId:authority.publicationId,expectedRevision:0,
  actor:{managerId:manager,managerName:'Synthetic location manager',idempotencyKey:'native-location-lunch'}});
  sql(`set role static_weekly_control_plane;select public.static_weekly_v8_materialize_lunch_document(${q(authority.projectionIds[week])},${j(prepared.lunchDocument)},${q(manager)})`);};
 publishLunch();
 const assignment=JSON.parse(sql(`select to_jsonb(a) from public.custodial_operational_location_assignments(${q(serviceDate)}) a where location_id=${q(location)} and coverage_start<='10:00' and coverage_end>'10:00';`));
 assert.equal(assignment.projection_id,authority.projectionIds[week]);
 sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},'KIOSK_08','Synthetic native location device',true,${q(employee)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(credential)},${q(device)},repeat('c',64),now()-interval '1 day',${q(at)}::timestamptz+interval '1 day');
 insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes)
 values(${q(randomUUID())},${q(randomUUID())},${q(location)},${q(employee)},${q(device)},'closed',${q(at)}::timestamptz-interval '2 hours 10 minutes',${q(at)}::timestamptz-interval '2 hours',10);`);
 const token='synthetic-native-location-token-not-production';
 const body={schema:'custodial.native-provider-register.v1',operation_id:randomUUID(),generation_id:randomUUID(),credential_id:credential,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:1,principal_digest:'a'.repeat(64),token_digest:hash(token),token,
  native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
 const registered=JSON.parse(sql(`set role service_role;select public.custodial_native_provider_registration(${q(credential)},repeat('c',64),${q(randomUUID())},repeat('b',64),${j(body)},false);`));
 const expected={assignment_epoch:'1',credential_id:credential,device_id:'KIOSK_08',employee_id:employee,generation_id:body.generation_id,principal_digest:body.principal_digest,registration_id:registered.registration_id,token_digest:body.token_digest};
 sql(`set role service_role;select public.mz_enqueue_employee_location_pushes(${q(at)});`);
 const job=JSON.parse(sql(`select to_jsonb(j) from public.operational_notification_jobs j where payload_json->>'credential_id'=${q(credential)};`)),lease=randomUUID();
 assert.ok(job?.job_id);sql(`update public.operational_notification_jobs set status='leased',lease_token=${q(lease)},leased_until=${q(at)}::timestamptz+interval '1 hour' where job_id=${q(job.job_id)};`);
 const call=(e=expected,time=at)=>`select public.custodial_native_location_reserve_at(${q(job.job_id)},${q(lease)},${j(e)},${q(time)})`;
 const result=(e=expected,time=at)=>JSON.parse(sql(call(e,time)));
 const changed=(statement,e=expected,time=at)=>JSON.parse(sql(`begin;${statement};${call(e,time)};rollback;`));
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  reject(role+' cannot nominate server time',`set role ${role};${call()}`,/permission denied/);
  if(role!=='service_role')reject(role+' cannot reserve',`set role ${role};select public.custodial_native_location_reserve(${q(job.job_id)},${q(lease)},${j(expected)})`,/permission denied/);
 }
 // Production wrapper has no caller time field; current wall-clock is sampled
 // after locks. Test location is intentionally at10AM, not this overnight time.
 const liveClock=JSON.parse(sql(`set role service_role;select public.custodial_native_location_reserve(${q(job.job_id)},${q(lease)},${j({...expected,employee_id:other})})`));
 check('service callable wrapper rejects different current owner',liveClock.current,false);
 for(const [field,value] of [['employee_id',other],['device_id','KIOSK_09'],['credential_id',randomUUID()],['assignment_epoch','2'],['generation_id',randomUUID()],['registration_id',randomUUID()],['principal_digest','d'.repeat(64)],['token_digest','e'.repeat(64)]])
  check('full original '+field+' binding',result({...expected,[field]:value}).current,false);
 for(const [name,statement] of [
  ['revoked credential',`update public.device_auth_credentials set revoked_at=now() where credential_id=${q(credential)}`],
  ['expired credential',`update public.device_auth_credentials set expires_at=${q(at)} where credential_id=${q(credential)}`],
  ['deactivated employee',`update public.employees set active=false where id=${q(employee)}`],
  ['reassigned device',`update public.devices set assigned_employee_id=${q(other)} where id=${q(device)}`],
  ['retired generation',`update public.employee_native_push_generations set dispatch_retired_at=${q(at)} where generation_id=${q(body.generation_id)}`],
  ['expired lease',`update public.operational_notification_jobs set leased_until=${q(at)} where job_id=${q(job.job_id)}`],
  ['cross projection',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,projection_id}',to_jsonb(${q(randomUUID())}::text)) where job_id=${q(job.job_id)}`],
  ['cross publication',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,publication_id}',to_jsonb(${q(randomUUID())}::text)) where job_id=${q(job.job_id)}`],
  ['wrong employee job',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{employee_id}',to_jsonb(${q(other)}::text)) where job_id=${q(job.job_id)}`],
  ['noncanonical duplicate episode key',`update public.operational_notification_jobs set job_key='forged-second-logical-episode' where job_id=${q(job.job_id)}`],
  ['manager test forbidden',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,test_delivery}','true'::jsonb) where job_id=${q(job.job_id)}`]
 ])check(name+' cannot acquire reservation',changed(statement).current,false);
 check('negative attempts leave no receipt',sql('select count(*) from public.employee_native_push_delivery_receipts'),'0');
 const first=result();check('first private fixed-clock SQL reservation admitted',first.dispatch_authorized,true);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  // The existing dedicated reader has a legacy SELECT grant but no receipt
  // RLS policy. Preserve its ACL and prove denial on a POPULATED private row.
  try{check(role+' cannot see populated protected receipt',sql(`set role ${role};select count(*) from public.employee_native_push_delivery_receipts`),'0');}
  catch(error){if(error.code==='ERR_ASSERTION')throw error;assert.match(String(error.stderr),/permission denied/);checks++;console.log('PASS',role,'direct populated receipt denied');}
 }
 const packet=validateNativeLocationReservation(first,{jobId:job.job_id,expected});
 check('exact42 native fields',Object.keys(packet.payload).length,42);
 check('SQL canonical matches independent JS canonical',packet.wire,canonicalNativeLocation(packet.payload));
 for(const mutate of [v=>{v.payload.extra='forged';},v=>{v.payload.body='tampered';},v=>{v.wire+=' ';},
  v=>{v.payload.receipt_employee_id=other;},v=>{v.dispatch_authorized=false;},v=>{v.delivery_outcome_unknown=true;},
  v=>{v.payload.receipt_assignment_epoch=1;},v=>{v.extra='forged';}]){
  const hostile=structuredClone(first);mutate(hostile);assert.throws(()=>validateNativeLocationReservation(hostile,{jobId:job.job_id,expected}));checks++;
 }
 check('exact source identity',packet.payload.authority_source_id,authority.sourceId);
 check('personalized authoritative employee and location text',packet.payload.body,slots[0].name+', '+places.W.name+' on your assigned route is overdue and needs attention now.');
 check('exact source version',packet.payload.version_id,authority.versionId);
 check('exact projection publication occurrence',[packet.payload.projection_id,packet.payload.publication_id,packet.payload.occurrence_id],[assignment.projection_id,assignment.publication_id,assignment.occurrence_id]);
 check('unchanged five minute bucket end',packet.payload.valid_until,'2026-10-02T15:05:00.123456Z');
 const second=result(expected,'2026-10-02T15:00:01.123456Z');
 check('lost response original replay cannot resend',second.dispatch_authorized,false);
 check('lost response is explicit unknown',second.delivery_outcome_unknown,true);
 check('replay bytes immutable',second.wire,first.wire);
 check('one frozen receipt after replay',sql('select count(*) from public.employee_native_push_delivery_receipts'),'1');
 const wrapped=await reserveNativeLocation({jobId:job.job_id,leaseToken:lease,expected,db:{rpc:async(name,args)=>{
  check('actual adapter RPC name',name,'custodial_native_location_reserve');check('actual adapter original exact args',args,{p_job:job.job_id,p_lease:lease,p_expected:expected});
  // Only this disposable postgres fixture injects the fixed time. Production
  // adapter invokes the service-only three-argument wrapper above.
  return {data:result(args.p_expected)};
 }}});
 check('actual SQL to adapter immutable wire',wrapped.wire,first.wire);
 for(const [name,statement] of [
  ['reassignment',`update public.devices set assigned_employee_id=${q(other)} where id=${q(device)}`],
  ['retirement',`update public.employee_native_push_generations set dispatch_retired_at=${q(at)} where generation_id=${q(body.generation_id)}`],
  ['wrong projection',`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,projection_id}',to_jsonb(${q(randomUUID())}::text)) where job_id=${q(job.job_id)}`]
 ])check('retry after '+name+' refused',changed(statement).dispatch_authorized,false);
 check('expired bucket cannot replay as current',result(expected,'2026-10-02T15:05:00.123456Z').current,false);
 const before=sql('select md5(row_to_json(r)::text) from public.employee_native_push_delivery_receipts r');
 reject('immutable original payload',`update public.employee_native_push_delivery_receipts set native_payload=jsonb_set(native_payload,'{body}','"changed"')`,/immutable/);
 reject('legacy release cannot erase protected evidence',`set role service_role;select public.mz_release_employee_native_push_delivery(${q(job.job_id)},${q(lease)},${q(credential)},1,${q(registered.registration_id)},${q(body.token_digest)})`,/immutable/);
 check('failed mutation preserves exact row',sql('select md5(row_to_json(r)::text) from public.employee_native_push_delivery_receipts r'),before);
 // Actual row-lock barrier: reservation must wait for native device ownership
 // serialization, then return the original unknown row without new authority.
 const asyncExec=promisify(execFile);
 const holder=asyncExec('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',
  `set application_name='native_location_owned_lock';begin;select 1 from public.devices where id=${q(device)} for update;select pg_sleep(1.5);rollback;`],{timeout:10000});
 try{
  let seen=false;for(let i=0;i<30&&!seen;i++){seen=sql("select exists(select 1 from pg_stat_activity where application_name='native_location_owned_lock' and wait_event='PgSleep')")==='t';if(!seen)await new Promise(r=>setTimeout(r,20));}
  assert.ok(seen,'owned device lock observed');
  const start=performance.now(),fenced=result();
  check('reservation waits for current-owner row lock',performance.now()-start>400,true);
  check('after lock original replay is still no-resend',fenced.dispatch_authorized,false);
 }finally{await holder;console.log('OWNED_DEVICE_LOCK_PROCESS_CLOSED');}
 // Real accepted exception/recompile changes the current projection, not just
 // packet labels. Old prepared evidence survives but no new authority returns.
 await authority.applyException({exceptionType:'pto',serviceDate,payload:{slotId:source.slots[0].id},reason:'Synthetic successor projection ownership test'});
 await authority.recompile(week);
 publishLunch();
 check('accepted successor projection denies old reservation',result().current,false);
 check('successor leaves original bytes intact',sql('select md5(row_to_json(r)::text) from public.employee_native_push_delivery_receipts r'),before);
 const signatures=['custodial_native_location_canonical(jsonb)','custodial_native_location_receipt_guard()','custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','custodial_native_location_reserve(uuid,uuid,jsonb)'];
 for(const signature of signatures)for(const kind of ['function','grant'])check('exact recovery '+kind+' '+signature,sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind=${q(kind)} and object_identity like '%(%' and to_regprocedure(object_identity)=${q(signature)}::regprocedure and definition_sha256=public.static_weekly_digest_text(case when object_kind='function' then pg_get_functiondef(${q(signature)}::regprocedure) else public.custodial_release_authority_current_grant_definition(${q(signature)}) end)`),'1');
 const recovery=JSON.parse(sql(`select jsonb_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory
  where (object_kind in ('function','grant') and object_identity like 'custodial_native_location_%')
   or (object_kind='trigger' and object_identity='public.employee_native_push_delivery_receipts.trg_native_location_receipt_guard')`));
 check('four functions four grants one ALWAYS trigger captured',recovery.length,9);
 sql("grant execute on function public.custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamptz) to authenticated;alter table public.employee_native_push_delivery_receipts disable trigger trg_native_location_receipt_guard;");
 check('disposable helper privilege drift visible',sql("select has_function_privilege('authenticated','public.custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamptz)','EXECUTE')"),'t');
 sql(recovery.join(';\n')+';');
 reject('restored helper caller denied',`set role authenticated;${call()}`,/permission denied/);
 check('restored ALWAYS trigger',sql("select tgenabled from pg_trigger where tgrelid='public.employee_native_push_delivery_receipts'::regclass and tgname='trg_native_location_receipt_guard'"),'A');
 reject('restored immutable guard still rejects mutation',`update public.employee_native_push_delivery_receipts set native_payload=jsonb_set(native_payload,'{body}','"changed"')`,/immutable/);
 check('recovery preserves all original receipt bytes',sql('select md5(row_to_json(r)::text) from public.employee_native_push_delivery_receipts r'),before);
 if(process.env.NATIVE_LOCATION_WIRE_FIXTURE){assert.match(process.env.NATIVE_LOCATION_WIRE_FIXTURE,/^\/home\/eric\/Documents\/Codex\/2026-10-02\/native-provider-worker\/evidence\/reservation\/[A-Za-z0-9._-]+\.json$/);
  writeFileSync(process.env.NATIVE_LOCATION_WIRE_FIXTURE,JSON.stringify({provenance:'actual isolated SQL reserve -> strict Node adapter; fixed synthetic server time; no live delivery',migrationSha256:manifest.at(-1).sha256,expected,envelope:first},null,2)+'\n');console.log('SQL_WIRE_FIXTURE',process.env.NATIVE_LOCATION_WIRE_FIXTURE);}
 assert.equal(sql(defaults),'0');console.log(JSON.stringify({status:'PASS',checks,migrations:manifest,automatic_grants_absent_before_and_after_each:true,actualPostgres:true,syntheticClock:true,production:false,independentAudit:false,providerClock:false,delivery:false}));
}finally{cleanup();}
