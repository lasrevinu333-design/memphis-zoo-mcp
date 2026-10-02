import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {reserveNativeLocation,canonicalNativeLocation,validateNativeLocationReservation} from '../src/native-location-reservation.js';
import {resolveNativeLocationTarget,recordNativeLocationOutcome,readNativeLocationOutcome,nativeLocationOutcomeBinding,validateNativeLocationInventoryResponse} from '../src/native-location-lifecycle.js';
import express from 'express';
import {createHmac} from 'node:crypto';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
import {writeNativeSqlFixture} from './fixtures/native-sql-fixture-output.mjs';
const container=`mz_schema_rebuild_location_lifecycle_${process.pid}`;
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
assert.ok(files.includes('20261003010000_native_location_lifecycle.sql'),'owning migration must be replayed');
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
 const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-location-inventory-fixture-root-long-enough'};
 const secret='syntheticInventoryNativeSecret-abcdefghijklmnopqrstuvwxyz1234567890',credentialHash=deviceCredentialInternals.tokenHash(secret,env);
 const serviceDate='2026-10-02',at=serviceDate+'T15:00:00.123456Z',week=eventAuthorityWeekStart(serviceDate);
 const {source,slots,places}=nativeLocationAuthoritySource(week,5);
 const extraPlaces=Array.from({length:40},(_,i)=>({id:randomUUID(),group:randomUUID(),code:'PROVIDER_X'+i,name:'Synthetic inventory location '+i}));
 for(const [i,place] of extraPlaces.entries())places['X'+i]=place;
 source.versions[0].assignments.find(work=>work.workId==='W').includedLocations.push(...extraPlaces.map(place=>({locationId:place.id,locationNameSnapshot:place.name})));
 const employee=slots[0].person,other=slots[1].person,location=places.W.id;
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
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(credential)},${q(device)},${q(credentialHash)},now()-interval '1 day',${q(at)}::timestamptz+interval '1 day');
 insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes)
 values(${q(randomUUID())},${q(randomUUID())},${q(location)},${q(employee)},${q(device)},'closed',${q(at)}::timestamptz-interval '2 hours 10 minutes',${q(at)}::timestamptz-interval '2 hours',10);`);
 for(const place of extraPlaces)sql(`insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes)
 values(${q(randomUUID())},${q(randomUUID())},${q(place.id)},${q(employee)},${q(device)},'closed',${q(at)}::timestamptz-interval '2 hours 10 minutes',${q(at)}::timestamptz-interval '2 hours',10);`);
 const token='synthetic-native-location-token-not-production';
 const nativePrincipal={schema_version:'custodial-protected-principal.v1',device_id:'KIOSK_08',employee_id:employee,assignment_epoch:1,credential_id:credential,
  credential_operation_id:randomUUID(),installation_seal:'synthetic-inventory-seal-00000001',enrolled_at:'2026-07-01T12:00:00.000Z'};
 const principalDigest=hash(JSON.stringify(['custodial.native-provider-principal.v1',...Object.keys(nativePrincipal).sort().map(k=>[k,nativePrincipal[k]])]));
 const body={schema:'custodial.native-provider-register.v1',operation_id:randomUUID(),generation_id:randomUUID(),credential_id:credential,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:1,principal_digest:principalDigest,token_digest:hash(token),token,
  native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
 const registered=JSON.parse(sql(`set role service_role;select public.custodial_native_provider_registration(${q(credential)},${q(credentialHash)},${q(randomUUID())},repeat('b',64),${j(body)},false);`));
 const expected={assignment_epoch:'1',credential_id:credential,device_id:'KIOSK_08',employee_id:employee,generation_id:body.generation_id,principal_digest:body.principal_digest,registration_id:registered.registration_id,token_digest:body.token_digest};
 sql(`set role service_role;select public.mz_enqueue_employee_location_pushes(${q(at)});`);
 const job=JSON.parse(sql(`select to_jsonb(j) from public.operational_notification_jobs j where payload_json->>'credential_id'=${q(credential)} and source_id=${q(location)};`)),lease=randomUUID();
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
 const first=result(),packet=validateNativeLocationReservation(first,{jobId:job.job_id,expected});
 check('shared predicate admits actual compiled location',first.dispatch_authorized,true);
 const targetQuery=(jobId=job.job_id,e=lease,time=at)=>`select public.custodial_native_location_target_at(${q(jobId)},${q(e)},${q(time)})`;
 const target=JSON.parse(sql(targetQuery()));check('typed resolver derives exact original eight fields',target.expected,expected);
 const typedTarget=await resolveNativeLocationTarget({jobId:job.job_id,leaseToken:lease,db:{rpc:async(name,args)=>{
  check('typed target RPC has no caller clock',name,'custodial_native_location_target');check('typed target exact args',args,{p_job:job.job_id,p_lease:lease});return{data:JSON.parse(sql(targetQuery()))};}}});
 check('actual SQL target through strict adapter',typedTarget.expected,expected);
 check('typed resolver token digest matches stored authority',hash(target.token),expected.token_digest);
 check('wrong lease cannot resolve token',JSON.parse(sql(targetQuery(job.job_id,randomUUID()))).current,false);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  reject(role+' cannot choose target clock',`set role ${role};${targetQuery()}`,/permission denied/);
  if(role!=='service_role')reject(role+' cannot resolve target',`set role ${role};select public.custodial_native_location_target(${q(job.job_id)},${q(lease)})`,/permission denied/);
 }
 const jobs=JSON.parse(sql(`select jsonb_agg(to_jsonb(j) order by job_id) from public.operational_notification_jobs j where payload_json->>'credential_id'=${q(credential)}`));
 check('real expanded accepted schedule yields41 logical locations',jobs.length,41);
 const initialJobs=[job,...jobs.filter(x=>x.job_id!==job.job_id).sort((a,b)=>b.job_id.localeCompare(a.job_id))].slice(0,36),laterJobs=jobs.filter(x=>!initialJobs.some(y=>y.job_id===x.job_id));
 const reservations=new Map([[job.job_id,first]]);
 const reserveJob=x=>{
  sql(`update public.operational_notification_jobs set status='leased',lease_token=${q(lease)},leased_until=${q(at)}::timestamptz+interval '1 hour' where job_id=${q(x.job_id)}`);
  const got=JSON.parse(sql(`select public.custodial_native_location_reserve_at(${q(x.job_id)},${q(lease)},${j(expected)},${q(at)})`));
  assert.equal(got.dispatch_authorized,true);reservations.set(x.job_id,got);return got;
 };
 for(const x of initialJobs.slice(1))reserveJob(x);
 const bindingFor=id=>{const p=reservations.get(id).payload;return Object.fromEntries([
  ...['receipt_job_id','generation_id','reservation_at','content_sha256','token_digest','principal_digest','receipt_credential_id','receipt_assignment_epoch','receipt_employee_id','receipt_device_id'].map(k=>[k,p[k]]),
  ['lease_token',lease],['registration_id',registered.registration_id]]);};
 const outcome=(binding,evidence)=>`select public.custodial_native_location_outcome_at(${j(binding)},${j(evidence)},'2026-10-02T15:00:01.123456Z')`;
 const unknown={operation_id:randomUUID(),outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'synthetic_response_lost'};
 const statusQuery=(binding=bindingFor(job.job_id))=>`select public.custodial_native_location_outcome_status(${j(binding)})`;
 check('readback before provider result is prepared',JSON.parse(sql(statusQuery())).provider_outcome,'prepared');
 const unknownFirst=JSON.parse(sql(outcome(bindingFor(job.job_id),unknown))),unknownReplay=JSON.parse(sql(outcome(bindingFor(job.job_id),unknown)));
 check('typed outcome binding derived from exact original packet',nativeLocationOutcomeBinding({reservation:first,leaseToken:lease,expected}),bindingFor(job.job_id));
 const typedOutcome=await recordNativeLocationOutcome({binding:bindingFor(job.job_id),evidence:unknown,db:{rpc:async(name,args)=>{
  check('typed outcome exact service RPC',name,'custodial_native_location_outcome');return{data:JSON.parse(sql(outcome(args.p_binding,args.p_evidence)))};}}});
 check('strict adapter admits exact SQL replay',typedOutcome.replayed,true);
 check('unknown exact response loss replay retains original receipt',{...unknownReplay,replayed:false},unknownFirst);
 check('unknown replay flag true',unknownReplay.replayed,true);
 check('unknown status preserves evidence',JSON.parse(sql(statusQuery())).evidence,unknown);
 for(const key of Object.keys(bindingFor(job.job_id))){const hostile={...bindingFor(job.job_id),[key]:'different'};reject('outcome exact original '+key,outcome(hostile,unknown));}
 reject('same operation changed outcome conflicts',outcome(bindingFor(job.job_id),{...unknown,error_code:'changed'}),/conflict/);
 const accepted={operation_id:randomUUID(),outcome:'provider_accepted',provider_message_id:'synthetic-provider-receipt-only',error_code:null};
 const acceptance=JSON.parse(sql(outcome(bindingFor(job.job_id),accepted)));
 check('recorded provider acceptance no longer mislabeled unknown',result().reason,'native_location_final_outcome_no_resend');
 const readback=await readNativeLocationOutcome({binding:bindingFor(job.job_id),db:{rpc:async(name,args)=>{check('exact status RPC',name,'custodial_native_location_outcome_status');return{data:JSON.parse(sql(statusQuery(args.p_binding)))}}}});
 check('actual SQL terminal readback keeps exact provider evidence',readback.evidence,accepted);
 check('provider acceptance never authorizes dispatch',acceptance.dispatch_authorized,false);
 reject('different terminal outcome cannot overwrite acceptance',outcome(bindingFor(job.job_id),{...unknown,operation_id:randomUUID(),outcome:'known_nonacceptance'}),/final outcome/);
 const invBody={schema:'custodial.native-provider-inventory-request.v1',scan_id:randomUUID(),principal_digest:expected.principal_digest,
  device_id:expected.device_id,credential_id:credential,employee_id:employee,assignment_epoch:1,generation_ids:[body.generation_id],limit:32,cursor:null,ceiling:null,server_now:null};
 const invQuery=(request=invBody,time='2026-10-02T15:00:02.123456Z')=>`select public.custodial_native_location_inventory_at(${q(credential)},${q(credentialHash)},${q(randomUUID())},repeat('b',64),${j(request)},${q(time)})`;
 const inv=(request=invBody,time)=>JSON.parse(sql(invQuery(request,time)));
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']){
  reject(role+' cannot nominate inventory clock',`set role ${role};${invQuery()}`,/permission denied/);
  reject(role+' cannot nominate outcome clock',`set role ${role};${outcome(bindingFor(job.job_id),accepted)}`,/permission denied/);
  if(role!=='service_role'){
   reject(role+' cannot read provider outcome',`set role ${role};${statusQuery()}`,/permission denied/);
   reject(role+' cannot invoke inventory',`set role ${role};select public.custodial_native_location_inventory(${q(credential)},repeat('c',64),${q(randomUUID())},repeat('b',64),${j(invBody)})`,/permission denied/);
   reject(role+' cannot settle provider outcome',`set role ${role};select public.custodial_native_location_outcome(${j(bindingFor(job.job_id))},${j(accepted)})`,/permission denied/);
  }
 }
 const page1=inv();check('first page bounded32 and more', [page1.data.rows.length,page1.data.has_more],[32,true]);
 check('later arrivals deterministically sort below frozen ceiling',laterJobs.every(x=>x.job_id<page1.data.ceiling.job_id),true);
 check('strict server response validator accepts actual SQL page',validateNativeLocationInventoryResponse(page1,invBody),page1);
 check('initial response loss replays frozen window and rows',inv(),page1);
 check('no inventory token secret',JSON.stringify(page1).includes(token),false);
 check('accepted provider state is not device receipt',inv({...invBody,scan_id:randomUUID()}).data.rows.filter(x=>x.provider_outcome==='provider_accepted').length,
  page1.data.rows.some(x=>x.payload.receipt_job_id===job.job_id)?1:0);
 const page1Ids=new Set(page1.data.rows.map(x=>x.payload.receipt_job_id));
 const remaining=initialJobs.filter(x=>!page1Ids.has(x.job_id)).sort((a,b)=>a.job_id.localeCompare(b.job_id));
 const invalidated=remaining.find(x=>x.job_id!==job.job_id),nonaccepted=remaining.find(x=>x.job_id!==job.job_id&&x.job_id!==invalidated.job_id);
 const decline={operation_id:randomUUID(),outcome:'known_nonacceptance',provider_message_id:null,error_code:'synthetic_provider_refused'};
 sql(outcome(bindingFor(nonaccepted.job_id),decline));
 sql(`update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,projection_id}',to_jsonb(${q(randomUUID())}::text)) where job_id=${q(invalidated.job_id)};`);
 for(const x of laterJobs)reserveJob(x);
 sql(`update public.operational_notification_jobs set leased_until=${q(at)}::timestamptz-interval '1 second' where payload_json->>'credential_id'=${q(credential)};`);
 const continuation={...invBody,cursor:page1.data.cursor,ceiling:page1.data.ceiling,server_now:page1.data.server_now};
 const page2=inv(continuation);
 check('expired worker lease does not prevent recovery',page2.ok,true);
 check('filter invalidation preserves other older rows and excludes new arrivals',page2.data.rows.map(x=>x.payload.receipt_job_id),remaining.filter(x=>![invalidated.job_id,nonaccepted.job_id].includes(x.job_id)).map(x=>x.job_id));
 check('exact end of frozen scan',page2.data.has_more,false);
 check('page response loss replay retains cursor/window',inv(continuation),page2);
 check('new arrivals excluded even from initial-page retry',inv().data.ceiling,page1.data.ceiling);
 const restarts=[];
 for(const change of [{cursor:{...continuation.cursor,job_id:randomUUID()}},{ceiling:{...continuation.ceiling,job_id:randomUUID()}},{server_now:'2026-10-02T15:00:03.123456Z'}]){
  const request={...continuation,...change},bad=inv(request);check('exact invalid cursor restart '+Object.keys(change)[0],bad.error,'custodial_native_provider_cursor_invalid');
  check('restart echoes exact original requested bounds',[bad.cursor,bad.ceiling,bad.server_now],[request.cursor,request.ceiling,request.server_now]);
  restarts.push({request,response:bad});
 }
 for(const change of [{principal_digest:'d'.repeat(64)},{employee_id:other},{assignment_epoch:2},{generation_ids:[randomUUID()]},{generation_ids:[body.generation_id,body.generation_id]},{extra:true},{limit:33}])
  reject('foreign/malformed inventory '+Object.keys(change)[0],invQuery({...invBody,...change}));
 check('fresh scan includes new arrivals under new ceiling',inv({...invBody,scan_id:randomUUID()}).data.has_more,true);
 check('expired bucket returns no current rows',inv({...invBody,scan_id:randomUUID()},'2026-10-02T15:05:00.123456Z').data.rows.length,0);
 const originalRows=sql('select md5(jsonb_agg(to_jsonb(r) order by job_id)::text) from public.employee_native_push_delivery_receipts r');
 const authDevice={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:device,device_id:'KIOSK_08',device_name:'Synthetic',
  device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP990',role:'staff',assignment_epoch:1,assigned_employee_id:employee,assigned_employee_name:'Synthetic'};
 const authCredential={credential_id:credential,device_id:device,token_hash:credentialHash,created_at:'2026-01-01T00:00:00.000Z',confirmed_at:'2026-01-01T00:00:00.000Z',
  last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
 let httpSqlCalls=0;const app=express();app.use(createGeneralJsonMiddleware());
 installNativeProviderRoutes(app,{env,requireCurrentCredential:makeDeviceCredentialMiddleware({env,requireEnrolledCredential:true,
  store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async id=>id===credential?authCredential:null,touchCredential:async()=>{},audit:async()=>{}},runReadOnlySql:async()=>[authDevice]}),
  db:{rpc:async(name,args)=>{httpSqlCalls++;assert.equal(name,'custodial_native_location_inventory');assert.equal(args.p_credential_hash,credentialHash);assert.match(args.p_attestation_digest,/^[0-9a-f]{64}$/);
   return{data:JSON.parse(sql(`select public.custodial_native_location_inventory_at(${q(args.p_credential)},${q(args.p_credential_hash)},${q(args.p_native_request)},${q(args.p_attestation_digest)},${j(args.p_body)},'2026-10-02T15:00:02.123456Z')`))};}}});
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:'synthetic_error'}));
 const server=await new Promise(resolve=>{const ownedServer=app.listen(0,'127.0.0.1',()=>resolve(ownedServer));});
 console.log('OWNED_INVENTORY_HTTP_SQL_SERVER',server.address().port,'cleanup in finally');
 try{
  const path='/employee-notifications-api/native-provider/inventory';
  const send=async(request=invBody,mutate=()=>{})=>{const bytes=' \n'+JSON.stringify(request,null,2)+'\n',requestId=randomUUID(),timestamp=new Date().toISOString();
   const proof=['custodial-native-request.v1',credential,'KIOSK_08','POST',path,hash(bytes),requestId,timestamp,'custodial'].join('\n');
   const headers={'content-type':'application/json',authorization:`Device ${credential}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
    'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':timestamp,
    'x-memphis-native-request-attestation':createHmac('sha256',secret).update(proof).digest('hex')};mutate(headers);
   return fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers,body:bytes,signal:AbortSignal.timeout(10000)});};
  let response=await send();check('actual HTTP raw-body HMAC SQL inventory200',response.status,200);
  check('actual HTTP delivers same current filtered SQL page',await response.json(),inv());
  response=await send(continuation);check('actual HTTP continuation bound',await response.json(),page2);
  response=await send(restarts[0].request);check('actual HTTP exact invalid cursor409',response.status,409);check('actual HTTP restart exact echo',await response.json(),restarts[0].response);
  const calls=httpSqlCalls;response=await send(invBody,headers=>delete headers['x-memphis-native-request-attestation']);await response.text();
  check('unsigned inventory rejected before SQL',[response.status,httpSqlCalls],[403,calls]);
  response=await send({...invBody,employee_id:other});await response.text();check('foreign current recipient rejected before SQL',[response.status,httpSqlCalls],[403,calls]);
 }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_INVENTORY_HTTP_SQL_SERVER_CLOSED');}
 const retiredQuery=`begin;update public.employee_native_push_generations set dispatch_retired_at='2026-10-02T15:00:01.123456Z' where generation_id=${q(body.generation_id)};`;
 check('original pre-retirement reservations recover unchanged',JSON.parse(sql(retiredQuery+invQuery()+`;rollback;`)),inv());
 check('exact provider outcome replay survives retirement',JSON.parse(sql(retiredQuery+outcome(bindingFor(job.job_id),accepted)+`;rollback;`)).replayed,true);
 reject('revoked generation cannot recover',`begin;update public.employee_native_push_generations set dispatch_retired_at='2026-10-02T15:00:01.123456Z',revoked_at='2026-10-02T15:00:01.123456Z' where generation_id=${q(body.generation_id)};${invQuery()}`);
 reject('reassigned phone cannot recover',`begin;update public.devices set assigned_employee_id=${q(other)} where id=${q(device)};${invQuery()}`);
 for(const rel of ['employee_native_location_outcomes','employee_native_location_inventory_scans'])for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])
  reject(role+' direct populated '+rel+' denied',`set role ${role};select * from public.${rel}`,/permission denied/);
 for(const rel of ['employee_native_location_outcomes','employee_native_location_inventory_scans'])reject(rel+' immutable',`delete from public.${rel}`,/immutable/);
 check('all lifecycle work preserves original receipts',sql('select md5(jsonb_agg(to_jsonb(r) order by job_id)::text) from public.employee_native_push_delivery_receipts r'),originalRows);
 // Actual accepted publication invalidation; no job lease or fake current reader.
 await authority.applyException({exceptionType:'pto',serviceDate,payload:{slotId:source.slots[0].id},reason:'Synthetic inventory current ownership test'});
 await authority.recompile(week);publishLunch();
 check('accepted successor current authority suppresses all old rows',inv().data.rows.length,0);
 const ownedNames=['utc','live','target_at','target','append_only','outcome_at','outcome','outcome_status','tuple','inventory_rows','inventory_at','inventory','reserve_at'].map(n=>'custodial_native_location_'+n);
 for(const name of ownedNames)for(const kind of ['function','grant'])check('exact lifecycle recovery '+kind+' '+name,sql(`select count(*) from pg_proc p join public.custodial_release_authority_restore_inventory i on i.object_kind=${q(kind)} and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=p.oid where p.pronamespace='public'::regnamespace and p.proname=${q(name)} and i.definition_sha256=public.static_weekly_digest_text(case when i.object_kind='function' then pg_get_functiondef(p.oid) else public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) end)`),'1');
 const restore=JSON.parse(sql(`select jsonb_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where object_identity like '%employee_native_location_%' or (object_kind in ('function','grant') and object_identity like '%custodial_native_location_%')`));
 sql('grant select on public.employee_native_location_outcomes to anon;alter table public.employee_native_location_outcomes disable trigger trg_native_location_outcome_immutable;');
 // Restore exact grant/function/trigger ownership without replaying table CREATE.
 const restoration=JSON.parse(sql(`select jsonb_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant','trigger') and (object_identity like '%employee_native_location_%' or object_identity like '%custodial_native_location_%')`));
 sql(restoration.join(';\n')+';');
 reject('restored private table grant denies anon','set role anon;select * from public.employee_native_location_outcomes',/permission denied/);
 reject('restored ALWAYS outcome guard','delete from public.employee_native_location_outcomes',/immutable/);
 check('recovery retains exact original receipt bytes',sql('select md5(jsonb_agg(to_jsonb(r) order by job_id)::text) from public.employee_native_push_delivery_receipts r'),originalRows);
 const fixture=writeNativeSqlFixture({envName:'NATIVE_LOCATION_INVENTORY_FIXTURE',fileName:'native-location-inventory.json',payload:{provenance:'actual SQL private synthetic clock; accepted compiled source; no provider send',nativePrincipal,request:invBody,page1,continuation,page2,restarts},manifest,owningMigration:'20261003010000_native_location_lifecycle.sql',scriptPath:'scripts/native-location-lifecycle-database-tests.mjs'});
 if(fixture)console.log('SQL_INVENTORY_FIXTURE',fixture.path,fixture.sha256);
 assert.equal(sql(defaults),'0');console.log(JSON.stringify({status:'PASS',checks,migrations:manifest,automatic_grants_absent_before_and_after_each:true,actualPostgres:true,syntheticClock:true,production:false,independentAudit:false,providerClock:false,delivery:false}));
}finally{cleanup();}
