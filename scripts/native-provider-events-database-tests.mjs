import {migrationReplayNames} from './migration-replay-order.mjs';
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {validateNativeLocationReservation} from '../src/native-location-reservation.js';
import {validateNativeProviderEventsRequest,validateNativeProviderEventsResponse} from '../src/native-provider-events.js';
import express from 'express';
import {createHmac} from 'node:crypto';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
import {writeNativeSqlFixture} from './fixtures/native-sql-fixture-output.mjs';
import {nativeIntervalDatabaseCases} from './fixtures/native-provider-interval-database-cases.mjs';
const container=`mz_schema_rebuild_provider_events_${process.pid}`;
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
const files=migrationReplayNames(process.cwd()),manifest=[];
assert.ok(files.includes('20261003050000_native_provider_events.sql'),'owning migration must be replayed');
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
 const extraPlaces=Array.from({length:2},(_,i)=>({id:randomUUID(),group:randomUUID(),code:'PROVIDER_X'+i,name:'Synthetic inventory location '+i}));
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
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,confirmed_at,expires_at) values(${q(credential)},${q(device)},${q(credentialHash)},${q(at)}::timestamptz-interval '1 day',${q(at)}::timestamptz-interval '1 day',greatest(now(),${q(at)}::timestamptz)+interval '1 day');
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
 const reservation=result(),payload=validateNativeLocationReservation(reservation,{jobId:job.job_id,expected}).payload;
 const recordId=hash(payload.generation_id+'\n'+payload.receipt_job_id+'\n'+payload.notification_key);
 const observation=(first,elapsed=150,boot=1,last=first===null?null:first.replace(/(\d{6})Z$/,(_,n)=>String(BigInt(n)+2n).padStart(6,'0')+'Z'))=>
  ({earliest_at:first,latest_at:last,clock_profile_id:first===null?null:'SYNTHETIC_ONLY_PC01',elapsed_realtime_ms:elapsed,boot_count:boot});
 const event=(action,change={})=>({schema:'custodial.native-provider-event.v2',event_id:randomUUID(),record_id:recordId,action,
  ...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(k=>[k,payload[k]])),
  receipt_assignment_epoch:1,admission_bounds:observation('2026-10-02T15:00:02.123456Z'),
  original_observation:observation(action==='received'?'2026-10-02T15:00:01.123456Z':'2026-10-02T15:00:03.123456Z',action==='received'?100:200),...change});
 const batch=events=>({schema:'custodial.native-provider-events.v2',events});
 const receiptTime='2026-10-02T15:00:04.123456Z';
 const query=(b,time=receiptTime,nonce=randomUUID(),proof='b'.repeat(64))=>
  'select public.custodial_native_provider_events_at('+[q(credential),q(credentialHash),q(nonce),q(proof),j(b),q(time)].join(',')+');';
 const submit=(b,time=receiptTime,nonce=randomUUID(),proof='b'.repeat(64))=>JSON.parse(sql(query(b,time,nonce,proof)));
 const interval=nativeIntervalDatabaseCases({sql,q,j,check,reject,credential,credentialHash,body,at,event,batch,query,payload,observation});
 const received=event('received'),displayed=event('displayed'),opened=event('opened'),ack=event('acknowledged');
 const originalRows=sql('select md5(jsonb_agg(to_jsonb(r) order by job_id)::text) from public.employee_native_push_delivery_receipts r where job_id='+q(job.job_id));
 const count=()=>sql('select count(*) from public.employee_native_provider_events');
 check('action without received stays pending',submit(batch([displayed])).data.results[0].code,'native_provider_transition_pending');
 check('pending transition did not store event',count(),'0');
 const request=batch([ack,opened,displayed,received]);
 validateNativeProviderEventsRequest(request);
 const admitted=submit(request);validateNativeProviderEventsResponse(admitted,request);
 check('out of order batch admits exact four transitions',admitted.data.results.map(r=>r.action),['received','displayed','opened','acknowledged']);
 check('all admitted without provider accepted prerequisite',admitted.data.results.every(r=>r.admitted_state==='ACCEPTED'&&!r.replayed),true);
 const replay=submit(request,'2026-10-02T16:00:00.123456Z');
 check('response loss drains after display expiry with original timestamp',replay.data.results.map(r=>({...r,replayed:false})),admitted.data.results);
 check('replay does not duplicate events',count(),'4');
 for(const field of ['admission_bounds','original_observation']){
  const changed=structuredClone(received);if(field==='admission_bounds')changed.admission_bounds.earliest_at='2026-10-02T15:00:02.123457Z';else changed.original_observation.elapsed_realtime_ms=101;
  check('changed original '+field+' conflicts',submit(batch([changed])).data.results[0].code,'native_provider_event_conflict');
 }
 check('new UUID cannot repeat one finite transition',submit(batch([{...received,event_id:randomUUID()}])).data.results[0].code,'native_provider_event_conflict');
 for(const [field,value] of [['content_sha256','d'.repeat(64)],['principal_digest','d'.repeat(64)],['token_digest','d'.repeat(64)],['generation_id',randomUUID()],['receipt_job_id',randomUUID()],['notification_key','foreign']]){
  const changed={...received,event_id:randomUUID(),[field]:value};changed.record_id=hash(changed.generation_id+'\n'+changed.receipt_job_id+'\n'+changed.notification_key);
  check('immutable reservation rejects '+field,submit(batch([changed])).data.results[0].code,'native_provider_original_binding_invalid');
 }
 for(const [field,value] of [['receipt_credential_id',randomUUID()],['receipt_employee_id',other],['receipt_device_id','KIOSK_09'],['receipt_assignment_epoch',2]])
  reject('foreign current tuple '+field,query(batch([{...received,[field]:value}])),/current event credential required/);
 const nonce=randomUUID();submit(request,receiptTime,nonce);check('same nonce exact body/proof replays',submit(request,receiptTime,nonce).data.results.every(r=>r.replayed),true);
 reject('same nonce changed observation rejected',query(batch([received]),receiptTime,nonce),/native request identity conflict/);
 reject('same nonce changed attestation rejected',query(request,receiptTime,nonce,'c'.repeat(64)),/native request identity conflict/);
 for(const changed of [{...received,action:'dismissed'},{...received,receipt_assignment_epoch:'1'},{...received,record_id:'c'.repeat(64)},
  {...received,extra:true},{...received,admission_bounds:observation('2026-02-30T15:00:00.000000Z')},
  {...received,original_observation:{...received.admission_bounds,boot_count:null,elapsed_realtime_ms:1}}])
  reject('SQL strict native shape '+Object.keys(changed).join(','),query(batch([changed])));
 reject('duplicate event in batch',query(batch([received,received])),/unique native events/);
 reject('oversized batch',query(batch(Array.from({length:17},()=>received))),/exact native event batch/);
 for(const [name,statement] of [
  ['revoked credential','update public.device_auth_credentials set revoked_at=now() where credential_id='+q(credential)],
  ['expired credential','update public.device_auth_credentials set expires_at='+q(receiptTime)+' where credential_id='+q(credential)],
  ['inactive device','update public.devices set active=false where id='+q(device)],
  ['deactivated employee','update public.employees set active=false where id='+q(employee)],
  ['reassignment','update public.devices set assigned_employee_id='+q(other)+' where id='+q(device)],
  ['epoch change','update public.devices set assignment_epoch=2 where id='+q(device)]])
  reject(name+' denies even exact replay','begin;'+statement+';'+query(request)+'rollback;',/current event credential/);
 const retired='update public.employee_native_push_generations set dispatch_retired_at=\'2026-10-02T15:00:01.123456Z\' where generation_id='+q(body.generation_id);
 check('same-principal pre-retirement replay after expiry',JSON.parse(sql('begin;'+retired+';'+query(request,'2026-10-02T16:00:00.123456Z')+'rollback;')).data.results.every(r=>r.replayed),true);
 check('revoked generation cannot settle',JSON.parse(sql('begin;'+retired+';update public.employee_native_push_generations set revoked_at=\'2026-10-02T15:00:01.123456Z\' where generation_id='+q(body.generation_id)+';'+query(request)+'rollback;')).data.results.every(r=>r.admitted_state==='REJECTED'),true);
 // A separate actual reservation proves Open does not manufacture displayed,
 // unknown original arrival observations and exact transition chronology.
 const nextJob=JSON.parse(sql('select to_jsonb(j) from public.operational_notification_jobs j where source_id='+q(extraPlaces[0].id)+' and payload_json->>\'credential_id\'='+q(credential)));
 const nextLease=randomUUID();sql('update public.operational_notification_jobs set status=\'leased\',lease_token='+q(nextLease)+',leased_until='+q(at)+'::timestamptz+interval \'1 hour\' where job_id='+q(nextJob.job_id));
 const next=JSON.parse(sql('select public.custodial_native_location_reserve_at('+[q(nextJob.job_id),q(nextLease),j(expected),q(at)].join(',')+')')).payload;
 const e2=(action,changes={})=>event(action,{...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key'].map(k=>[k,next[k]])),record_id:hash(next.generation_id+'\n'+next.receipt_job_id+'\n'+next.notification_key),...changes});
 const received2=e2('received',{original_observation:observation(null,100,1)});
 const opened2=e2('opened',{original_observation:observation(null,200,1)});
 for(const [name,e] of [
  ['admission before reservation',e2('received',{admission_bounds:observation('2026-10-02T14:59:59.123456Z')})],
  ['admission after validity',e2('received',{admission_bounds:observation('2026-10-02T15:05:00.123456Z')})],
  ['original receive after admission',e2('received',{original_observation:observation('2026-10-02T15:00:03.123456Z',100,1)})]])
  check(name,submit(batch([e])).data.results[0].code,'native_provider_observation_invalid');
 submit(batch([received2]));
 for(const [name,e] of [
  ['mismatched admitted evidence',e2('opened',{admission_bounds:observation('2026-10-02T15:00:02.123457Z')})],
  ['same boot elapsed reversal',e2('opened',{original_observation:observation(null,99,1)})],
  ['boot count reversal',e2('opened',{original_observation:observation(null,999,0)})],
  ['claimed time before admission',e2('opened',{original_observation:observation('2026-10-02T15:00:01.123456Z',200,1)})],
  ['display beyond validity',e2('displayed',{original_observation:observation('2026-10-02T15:06:00.123456Z',200,1)})]])
  check(name,submit(batch([e]),'2026-10-02T16:00:00.123456Z').data.results[0].code,'native_provider_observation_invalid');
 check('offline Open after expiry binds original without display',submit(batch([opened2]),'2026-10-02T16:00:00.123456Z').data.results[0].admitted_state,'ACCEPTED');
 check('Open does not synthesize display',sql('select count(*) from public.employee_native_provider_events where record_id='+q(opened2.record_id)+" and action='displayed'"),'0');
 const concurrent=await Promise.all([e2('acknowledged'),e2('acknowledged')].map(async e=>{
  const {stdout}=await promisify(execFile)('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',query(batch([e]))],
   {encoding:'utf8',timeout:60000,maxBuffer:1024*1024});return JSON.parse(stdout.trim());
 }));
 check('concurrent duplicate transition exactly one admitted',concurrent.map(r=>r.data.results[0].admitted_state).sort(),['ACCEPTED','REJECTED']);
 check('concurrent transition retained once',sql('select count(*) from public.employee_native_provider_events where record_id='+q(opened2.record_id)+" and action='acknowledged'"),'1');
 const mixed=submit(batch([received,{...opened2,event_id:randomUUID()}]));
 check('mixed batch admits only exact original item',mixed.data.results.map(r=>r.admitted_state).sort(),['ACCEPTED','REJECTED']);
 validateNativeProviderEventsResponse(mixed,batch([received,{...opened2,event_id:mixed.data.results.find(r=>r.admitted_state==='REJECTED').event_id}]));
 const authDevice={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:device,device_id:'KIOSK_08',device_name:'Synthetic',
  device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP990',role:'staff',assignment_epoch:1,assigned_employee_id:employee,assigned_employee_name:'Synthetic'};
 const authCredential={credential_id:credential,device_id:device,token_hash:credentialHash,created_at:'2026-01-01T00:00:00.000Z',confirmed_at:'2026-01-01T00:00:00.000Z',
  last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
 let httpSqlCalls=0;const app=express();app.use(createGeneralJsonMiddleware());
 installNativeProviderRoutes(app,{env,requireCurrentCredential:makeDeviceCredentialMiddleware({env,requireEnrolledCredential:true,
  store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async id=>id===credential?authCredential:null,touchCredential:async()=>{},audit:async()=>{}},runReadOnlySql:async()=>[authDevice]}),
  db:{rpc:async(name,args)=>{httpSqlCalls++;assert.equal(args.p_credential_hash,credentialHash);assert.match(args.p_attestation_digest,/^[0-9a-f]{64}$/);
   if(name==='custodial_native_provider_inventory_clock')return{data:JSON.parse(sql(`select public.custodial_native_provider_inventory_clock_at(${q(args.p_credential)},${q(args.p_credential_hash)},${q(args.p_native_request)},${q(args.p_attestation_digest)},${j(args.p_body)},'2026-10-02T15:00:04.123456Z','2026-10-02T15:00:04.123456Z')`))};
   assert.equal(name,'custodial_native_provider_events');
   return{data:JSON.parse(sql(`select public.custodial_native_provider_events_at(${q(args.p_credential)},${q(args.p_credential_hash)},${q(args.p_native_request)},${q(args.p_attestation_digest)},${j(args.p_body)},'2026-10-02T15:00:04.123456Z')`))};}}});
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:'synthetic_error'}));
 const server=await new Promise(resolve=>{const ownedServer=app.listen(0,'127.0.0.1',()=>resolve(ownedServer));});
 console.log('OWNED_EVENTS_HTTP_SQL_SERVER',server.address().port,'cleanup in finally');
 try{
  const path='/employee-notifications-api/native-provider/events';
  const send=async(sent=request,mutate=()=>{},route=path)=>{const bytes=' \n'+JSON.stringify(sent,null,2)+'\n',requestId=randomUUID(),timestamp=new Date().toISOString();
   const proof=['custodial-native-request.v1',credential,'KIOSK_08','POST',route,hash(bytes),requestId,timestamp,'custodial'].join('\n');
   const headers={'content-type':'application/json',authorization:`Device ${credential}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
    'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':timestamp,
    'x-memphis-native-request-attestation':createHmac('sha256',secret).update(proof).digest('hex')};mutate(headers);
   return fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers,body:bytes,signal:AbortSignal.timeout(10000)});};
  let response=await send();check('actual HTTP raw-body HMAC SQL event200',response.status,200);
  const httpReceipt=await response.json();check('actual HTTP returns exact committed replay',httpReceipt,submit(request));
  const calls=httpSqlCalls;response=await send(request,headers=>delete headers['x-memphis-native-request-attestation']);await response.text();
  check('unsigned events rejected before SQL',[response.status,httpSqlCalls],[403,calls]);
  response=await send(batch([{...received,receipt_employee_id:other}]));await response.text();check('foreign current recipient rejected before SQL',[response.status,httpSqlCalls],[403,calls]);
  response=await send(interval.input,()=>{},'/employee-notifications-api/native-provider/inventory');
  check('actual HTTP raw-body HMAC fresh inventory SQL200',response.status,200);interval.http_response=await response.json();
  check('actual HTTP inventory retains frozen page and separate SQL clock',interval.http_response.data.server_now===interval.first.data.server_now
   &&interval.http_response.clock.server_now==='2026-10-02T15:00:04.123456Z',true);
  const inventoryCalls=httpSqlCalls;response=await send(interval.input,headers=>delete headers['x-memphis-native-request-attestation'],'/employee-notifications-api/native-provider/inventory');await response.text();
  check('unsigned fresh inventory rejected before SQL',[response.status,httpSqlCalls],[403,inventoryCalls]);
 }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_EVENTS_HTTP_SQL_SERVER_CLOSED');}
 const roles=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'];
 for(const role of roles){
  reject(role+' denied test time','set role '+role+';'+query(request),/permission denied/);
  for(const relation of ['employee_native_provider_events','employee_native_provider_event_requests'])
   reject(role+' denied direct '+relation,'set role '+role+';select * from public.'+relation,/permission denied/);
  for(const helper of ['custodial_native_provider_event_shape('+j(received)+')','custodial_native_provider_event_time('+j(received.admission_bounds.earliest_at)+')'])
   reject(role+' denied private helper','set role '+role+';select public.'+helper,/permission denied/);
  if(role!=='service_role')reject(role+' denied public wrapper','set role '+role+';select public.custodial_native_provider_events('+[q(credential),q(credentialHash),q(randomUUID()),q('b'.repeat(64)),j(request)].join(',')+')',/permission denied/);
 }
 // Use service-role public wrapper with intentional wrong hash: proof of real
 // EXECUTE admission followed by current-authority denial, not owner-only ACL.
 reject('public wrapper samples time and rejects wrong credential hash','set role service_role;select public.custodial_native_provider_events('+[q(credential),q('c'.repeat(64)),q(randomUUID()),q('b'.repeat(64)),j(request)].join(',')+')',/current event credential required/);
 for(const relation of ['employee_native_provider_events','employee_native_provider_event_requests']){
  reject(relation+' immutable','delete from public.'+relation,/immutable/);
  check(relation+' forced RLS',sql('select relrowsecurity and relforcerowsecurity from pg_class where oid='+q('public.'+relation)+'::regclass'),'t');
 }
 const eventRows=sql('select md5(jsonb_agg(to_jsonb(e) order by event_id)::text) from public.employee_native_provider_events e');
 const ownedNames=['custodial_native_provider_event_time','custodial_native_provider_event_shape','custodial_native_provider_events_at','custodial_native_provider_events','custodial_native_provider_interval_observation','custodial_native_provider_observation_order','custodial_native_provider_inventory_clock_at','custodial_native_provider_inventory_clock'];
 for(const name of ownedNames)for(const kind of ['function','grant'])check('exact receipt recovery '+kind+' '+name,sql(
  'select count(*) from pg_proc p join public.custodial_release_authority_restore_inventory i on i.object_kind='+q(kind)+" and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=p.oid where p.pronamespace='public'::regnamespace and p.proname="+q(name)+" and i.definition_sha256=public.static_weekly_digest_text(case when i.object_kind='function' then pg_get_functiondef(p.oid) else public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) end)"),'1');
 const restoration=JSON.parse(sql("select jsonb_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant','trigger') and (object_identity like '%employee_native_provider_event%' or object_identity like '%custodial_native_provider_event%')"));
 sql('grant select on public.employee_native_provider_events to anon;alter table public.employee_native_provider_events disable trigger trg_native_provider_event_immutable;');
 sql(restoration.join(';\n')+';');
 reject('restored grants deny anon','set role anon;select * from public.employee_native_provider_events',/permission denied/);
 reject('restored ALWAYS immutable trigger','delete from public.employee_native_provider_events',/immutable/);
 check('recovery preserves exact immutable observations',sql('select md5(jsonb_agg(to_jsonb(e) order by event_id)::text) from public.employee_native_provider_events e'),eventRows);
 check('all receipt work preserves original reservation bytes',sql('select md5(jsonb_agg(to_jsonb(r) order by job_id)::text) from public.employee_native_push_delivery_receipts r where job_id='+q(job.job_id)),originalRows);
 //03080000 projects only actual admitted original ACKs. This fixture admits
 //the primary ACK and exactly one concurrent e2 ACK; Open is still NOT ACK.
 check('only two admitted original ACK projections',sql('select count(*) from public.device_notification_acknowledgements'),'2');
 check('both ACKs bind exact native event, original job/key/actor and original server time',sql(`
  select count(*) from public.device_notification_acknowledgements a
  join public.employee_native_location_ack_projections p on p.acknowledgement_id=a.id
  join public.employee_native_provider_events e on e.event_id=p.event_id
  join public.employee_native_push_delivery_receipts r on r.job_id=e.job_id
  where e.action='acknowledged' and a.notification_job_id=e.job_id and p.job_id=e.job_id
   and a.notification_key=e.original_event->>'notification_key'
   and a.device_identifier=e.original_event->>'receipt_device_id'
   and a.employee_id=(e.original_event->>'receipt_employee_id')::uuid
   and a.credential_id=(e.original_event->>'receipt_credential_id')::uuid
   and a.assignment_epoch=(e.original_event->>'receipt_assignment_epoch')::bigint
   and a.acknowledged_at=e.server_received_at and p.acknowledged_at=a.acknowledged_at
   and r.native_payload_sha256=e.original_event->>'content_sha256'
   and e.record_id in (${q(recordId)},${q(opened2.record_id)})`),'2');
 check('ACK projection fabricates no receive/display/open/dismiss timestamps',sql(`select count(*) from public.device_notification_acknowledgements
  where received_at is not null or displayed_at is not null or opened_at is not null or dismissed_at is not null`),'0');
 const fixture=writeNativeSqlFixture({envName:'NATIVE_PROVIDER_EVENTS_FIXTURE',fileName:'native-provider-events.json',payload:{provenance:'actual SQL with private synthetic time; encrypted native input fixtures are synthetic',checks:checks+1,nativePrincipal,request,admitted,replay,mixed,registered,interval},manifest,owningMigration:'20261003150000_native_provider_interval_protocol.sql',scriptPath:'scripts/native-provider-events-database-tests.mjs'});
 if(fixture)console.log('SQL_PROVIDER_EVENTS_FIXTURE',fixture.path,fixture.sha256);
 check('automatic grants remain absent',sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',checks,migrations:manifest,automatic_grants_absent_before_and_after_each:true,actualPostgres:true,syntheticClock:true,production:false,independentAudit:false,providerClock:false,delivery:false}));
}finally{cleanup();}
