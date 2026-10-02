import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {validateNativeLocationReservation} from '../src/native-location-reservation.js';
import {validateNativeProviderEventsRequest,validateNativeProviderEventsResponse} from '../src/native-provider-events.js';
import {deliverNativeLocationJob,prepareNativeLocationDataSender,validateNativeLocationDispatch} from '../src/native-location-dispatch.js';
import {nativeLocationOutcomeBinding} from '../src/native-location-lifecycle.js';
import {deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
const container=`mz_schema_rebuild_location_dispatch_${process.pid}`;
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
assert.ok(files.includes('20261003080000_native_location_dispatch_and_ack.sql'));
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
 // Registration samples the real database clock; every synthetic dispatch
 // instant must remain after that immutable activation, even on later CI days.
 const today=new Date(),daysUntilFriday=(5-today.getUTCDay()+7)%7||7;
 const serviceDate=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+daysUntilFriday))
  .toISOString().slice(0,10);
 const onDate=time=>serviceDate+'T'+time+'Z';
 const at=onDate('15:00:00.123456'),week=eventAuthorityWeekStart(serviceDate);
 const {source,slots,places}=nativeLocationAuthoritySource(week,5);
 const extraPlaces=Array.from({length:8},(_,i)=>({id:randomUUID(),group:randomUUID(),code:'PROVIDER_X'+i,name:'Synthetic inventory location '+i}));
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
 check('synthetic activation precedes fixed dispatch instant',sql(`select (activated_at<${q(at)}::timestamptz)::text
  from public.employee_native_push_generations where generation_id=${q(body.generation_id)}`),'true');
 const expected={assignment_epoch:'1',credential_id:credential,device_id:'KIOSK_08',employee_id:employee,generation_id:body.generation_id,principal_digest:body.principal_digest,registration_id:registered.registration_id,token_digest:body.token_digest};
 sql(`set role service_role;select public.mz_enqueue_employee_location_pushes(${q(at)});`);
 const job=JSON.parse(sql(`select to_jsonb(j) from public.operational_notification_jobs j where payload_json->>'credential_id'=${q(credential)} and source_id=${q(location)};`)),lease=randomUUID();
 assert.ok(job?.job_id);sql(`update public.operational_notification_jobs set status='leased',lease_token=${q(lease)},leased_until=${q(at)}::timestamptz+interval '1 hour' where job_id=${q(job.job_id)};`);
 const claimed={...job,lease_token:lease};

 const later=onDate('15:00:04.123456'),admissionAt=onDate('15:00:00.123457'),requests=[];let prepares=0,lastPermit=null;
 const defaultFetch=async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return new Response(JSON.stringify({name:'projects/synthetic-project/messages/exact-original'}));};
 const runtime=(fetchImpl=defaultFetch)=>({prepareNativeLocationSender:async()=>{prepares++;return prepareNativeLocationDataSender({projectId:'synthetic-project',accessToken:'synthetic-oauth-not-a-real-secret',fetchImpl});}});
 const dbFor=({lostPrepare=false,lostOutcome=false,failOutcome=false,beforePrepare=null}={})=>({rpc:async(name,args)=>{
  let statement;
  if(name==='custodial_native_location_dispatch_status')statement='set role service_role;select public.'+name+'('+q(args.p_job)+')';
  else if(name==='custodial_native_location_target')statement='select public.custodial_native_location_target_at('+[q(args.p_job),q(args.p_lease),q(at)].join(',')+')';
  else if(name==='custodial_native_location_dispatch_prepare'){
   statement='select public.custodial_native_location_dispatch_prepare_at('+[q(args.p_job),q(args.p_lease),j(args.p_expected),q(admissionAt)].join(',')+')';
   if(beforePrepare)statement='begin;'+beforePrepare+';'+statement+';rollback;';
  }else if(name==='custodial_native_location_outcome'){
   if(failOutcome)return{error:{code:'synthetic_precommit_failure'}};
   statement='select public.custodial_native_location_outcome_at('+[j(args.p_binding),j(args.p_evidence),q(later)].join(',')+')';
  }else if(name==='custodial_native_location_outcome_status')statement='set role service_role;select public.'+name+'('+j(args.p_binding)+')';
  else throw new Error('unexpected SQL RPC '+name);
  const data=JSON.parse(sql(statement));
  if(name==='custodial_native_location_dispatch_prepare')lastPermit=data;
  if((name==='custodial_native_location_dispatch_prepare'&&lostPrepare)||(name==='custodial_native_location_outcome'&&lostOutcome))return{error:{code:'synthetic_committed_response_loss'}};
  return{data};
 }});
 const deliver=(item=claimed,options={},fetchImpl=defaultFetch)=>deliverNativeLocationJob({db:dbFor(options),pushRuntime:runtime(fetchImpl),job:item});
 const denied=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);checks++;console.log('PASS',name);};
 const nextJob=index=>{
  const value=JSON.parse(sql('select to_jsonb(j) from public.operational_notification_jobs j where source_id='+q(extraPlaces[index].id)+" and payload_json->>'credential_id'="+q(credential)));
  const leaseToken=randomUUID();sql("update public.operational_notification_jobs set status='leased',lease_token="+q(leaseToken)+',leased_until='+q(at)+"::timestamptz+interval '1 hour' where job_id="+q(value.job_id));
  return {...value,lease_token:leaseToken};
 };
 const accepted=await deliver(),originalPermit=lastPermit,payload=originalPermit.reservation.payload;
 check('SQL reservation to data-only synthetic provider acceptance',accepted,{provider_message_id:'projects/synthetic-project/messages/exact-original',replayed:false,native_location:true});
 const wire=requests[0].body;
 check('exact canonical SQL payload survives transport',wire.message.data,payload);
 check('only data token Android transport keys',Object.keys(wire.message).sort(),['android','data','token']);
 check('no collapse notification APNs or sound',wire.message.android,{priority:'high',ttl:originalPermit.ttl_seconds+'s',restricted_package_name:'org.memphiszoo.custodial'});
 check('fractional TTL floors rather than rounds',originalPermit.ttl_seconds,299);
 check('one frozen target token',wire.message.token,token);
 check('fixed provider host and no redirect', [requests[0].url,requests[0].options.redirect],['https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send','error']);
 check('original accepted retry is exact readback',(await deliver()).replayed,true);
 check('accepted retry prepares no second OAuth sender',prepares,1);check('accepted retry sends once',requests.length,1);
 const binding=nativeLocationOutcomeBinding({reservation:originalPermit.reservation,leaseToken:lease,expected});
 reject('operation ownership cannot change','select public.custodial_native_location_outcome_at('+[j(binding),j({operation_id:randomUUID(),outcome:'provider_accepted',provider_message_id:'foreign',error_code:null}),q(later)].join(',')+')',/original dispatch outcome operation/);
 const statusBefore=JSON.parse(sql('set role service_role;select public.custodial_native_location_dispatch_status('+q(job.job_id)+')'));
 check('persisted operation and attempt recovered',[statusBefore.attempt_id,statusBefore.outcome_operation_id],[originalPermit.attempt_id,originalPermit.outcome_operation_id]);
 check('status never exposes target token',Object.hasOwn(statusBefore,'token'),false);
 const newLease=randomUUID();sql('update public.operational_notification_jobs set lease_token='+q(newLease)+' where job_id='+q(job.job_id));
 check('lease change keeps original outcome identity',(await deliver({...claimed,lease_token:newLease})).replayed,true);
 check('original lease stays immutable',JSON.parse(sql('select public.custodial_native_location_dispatch_status('+q(job.job_id)+')')).binding.lease_token,lease);
 for(const mutate of [v=>v.ttl_seconds++,v=>v.ttl_seconds='299',v=>v.extra=true,v=>v.reservation.payload.projection_id=randomUUID(),v=>v.attempt_id=v.outcome_operation_id,v=>v.attempt_id=[v.attempt_id]]){
  const changed=structuredClone(originalPermit);mutate(changed);assert.throws(()=>validateNativeLocationDispatch(changed,{jobId:job.job_id,leaseToken:lease,expected}));checks++;
 }
 const frozen=validateNativeLocationDispatch(originalPermit,{jobId:job.job_id,leaseToken:lease,expected});
 let calls=0;
 const once=prepareNativeLocationDataSender({projectId:'synthetic-project',accessToken:'synthetic',fetchImpl:async()=>{calls++;return new Response('{"name":"projects/synthetic-project/messages/one"}');}});
 await once({permit:frozen,expected,token});await denied('one prepared closure refuses a second call',()=>once({permit:frozen,expected,token}),/already_consumed/);check('one closure makes one HTTP attempt',calls,1);
 for(const [label,response,wanted] of [
  ['explicit 400',()=>new Response('{}',{status:400}),'known_nonacceptance'],
  ['server 503',()=>new Response('{}',{status:503}),'delivery_outcome_unknown'],
  ['malformed successful reply',()=>new Response('{}'),'delivery_outcome_unknown'],
  ['wrong project receipt',()=>new Response('{"name":"projects/foreign/messages/id"}'),'delivery_outcome_unknown'],
  ['oversized successful reply',()=>new Response(' '.repeat(16385)),'delivery_outcome_unknown'],
  ['network exception',()=>{throw new Error('synthetic');},'delivery_outcome_unknown']]){
  const sender=prepareNativeLocationDataSender({projectId:'synthetic-project',accessToken:'synthetic',fetchImpl:async()=>response()});
  check(label+' finite outcome',(await sender({permit:frozen,expected,token})).outcome,wanted);
 }
 const refusal=nextJob(0);let refusedCalls=0;
 await denied('explicit provider refusal is terminal',()=>deliver(refusal,{},async()=>{refusedCalls++;return new Response('{}',{status:400});}),/provider_refused/);
 await denied('refused original never resends',()=>deliver(refusal),/provider_refused/);check('one refused attempt',refusedCalls,1);
 const ambiguous=nextJob(1);await denied('provider ambiguity does not become success',()=>deliver(ambiguous,{},async()=>{throw new Error('synthetic network response loss');}),/unknown_no_resend/);
 await denied('ambiguous original never resends',()=>deliver(ambiguous),/unknown_no_resend/);
 const responseLoss=nextJob(2);check('committed outcome response loss reads original evidence',(await deliver(responseLoss,{lostOutcome:true})).replayed,true);
 const precommit=nextJob(3);await denied('missing outcome persistence is still pending',()=>deliver(precommit,{failOutcome:true}),/reconciliation_pending/);
 await denied('restart after missing outcome never resends',()=>deliver(precommit),/unknown_no_resend/);
 const prepareLoss=nextJob(4),beforeLoss=requests.length;
 await denied('committed reservation response loss is not a send permit',()=>deliver(prepareLoss,{lostPrepare:true}),/prepare_pending/);
 await denied('reservation response-loss retry never resends',()=>deliver(prepareLoss),/unknown_no_resend/);
 check('lost fresh permit caused no HTTP',requests.length,beforeLoss);
 const killed=nextJob(5);const killedPermit=JSON.parse(sql('select public.custodial_native_location_dispatch_prepare_at('+[q(killed.job_id),q(killed.lease_token),j(expected),q(at)].join(',')+')'));
 check('death fixture reserved once',killedPermit.dispatch_authorized,true);
 await denied('process death between reserve and send cannot reissue permit',()=>deliver(killed),/unknown_no_resend/);
 check('prepared recovery record survives',sql('select count(*) from public.employee_native_location_dispatch_attempts where job_id='+q(killed.job_id)),'1');
 const changedOwner=nextJob(6);
 await denied('reassignment after target and before reservation rejects',()=>deliver(changedOwner,{beforePrepare:'update public.devices set assigned_employee_id='+q(other)+' where id='+q(device)}),/admission_superseded/);
 await denied('projection change before reservation rejects',()=>deliver(changedOwner,{beforePrepare:"update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,projection_id}',"+j(randomUUID())+') where job_id='+q(changedOwner.job_id)}),/admission_superseded/);
 check('failed authority admits no immutable receipt',sql('select count(*) from public.employee_native_push_delivery_receipts where job_id='+q(changedOwner.job_id)),'0');
 const mutation={...changedOwner};const mutatingDb=dbFor();const originalRpc=mutatingDb.rpc;
 mutatingDb.rpc=async(name,args)=>{if(name==='custodial_native_location_dispatch_status'){mutation.job_id=randomUUID();mutation.lease_token=randomUUID();}return originalRpc(name,args);};
 check('caller job mutation during await cannot relabel original',(await deliverNativeLocationJob({db:mutatingDb,pushRuntime:runtime(),job:mutation})).replayed,false);

 // Exact admitted original observations project ACK only, inside receipt txn.
 const recordId=hash(payload.generation_id+'\n'+payload.receipt_job_id+'\n'+payload.notification_key);
 const observation=(instant,elapsed)=>({earliest_at:instant,latest_at:instant,
  clock_profile_id:'SYNTHETIC_ONLY_PC01',elapsed_realtime_ms:elapsed,boot_count:1});
 const event=(action,change={})=>({schema:'custodial.native-provider-event.v2',event_id:randomUUID(),record_id:recordId,action,
  ...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(k=>[k,payload[k]])),
  receipt_assignment_epoch:1,admission_bounds:observation(onDate('15:00:02.123456'),100),
  original_observation:observation(action==='received'?onDate('15:00:01.123456'):onDate('15:00:03.123456'),
   action==='received'?90:200),...change});
 const received=event('received'),opened=event('opened'),ack=event('acknowledged');
 const batch=events=>({schema:'custodial.native-provider-events.v2',events});
 const receiptQuery=(events,time=later)=>'select public.custodial_native_provider_events_at('+[q(credential),q(credentialHash),q(randomUUID()),q('b'.repeat(64)),j(batch(events)),q(time)].join(',')+')';
 const submit=(events,time=later)=>JSON.parse(sql(receiptQuery(events,time)));
 check('before ACK current reservation remains live',sql('select public.custodial_native_location_live('+[q(job.job_id),j(payload),q(later)].join(',')+')'),'t');
 submit([opened,received]);check('received and Open never synthesize ACK',sql('select count(*) from public.device_notification_acknowledgements'),'0');
 reject('private projector rejects Open','select public.custodial_native_location_project_ack('+q(opened.event_id)+','+q(later)+')',/exact admitted native ACK/);
 reject('local dismiss is not a native server action',receiptQuery([event('dismissed')]),/exact finite native event required/);
 const cleaningBefore=sql('select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.sessions s');
 const ackResult=submit([ack]);validateNativeProviderEventsResponse(ackResult,batch([ack]));
 const legacy=JSON.parse(sql('select to_jsonb(a) from public.device_notification_acknowledgements a'));
 check('only acknowledged timestamp projected',[legacy.received_at,legacy.displayed_at,legacy.opened_at,legacy.dismissed_at],[null,null,null,null]);
 check('legacy original actor/job/key identity',[legacy.credential_id,legacy.assignment_epoch,legacy.employee_id,legacy.notification_job_id,legacy.notification_key],[credential,1,employee,job.job_id,payload.notification_key]);
 check('ACK uses server receipt instant not claimed client wall time',sql('select public.custodial_native_location_utc(acknowledged_at) from public.device_notification_acknowledgements'),later);
 check('exact legacy suppression reader now sees ACK',sql('select public.custodial_native_location_live('+[q(job.job_id),j(payload),q(later)].join(',')+')'),'f');
 const projectionBefore=sql('select md5(jsonb_agg(to_jsonb(a) order by event_id)::text) from public.employee_native_location_ack_projections a');
 check('after-expiry ACK replay keeps original observation',submit([ack],onDate('16:00:00.123456')).data.results[0].server_received_at,later);
 check('projection immutable on replay',sql('select md5(jsonb_agg(to_jsonb(a) order by event_id)::text) from public.employee_native_location_ack_projections a'),projectionBefore);
 check('legacy record byte-preserved on replay',JSON.parse(sql('select to_jsonb(a) from public.device_notification_acknowledgements a')),legacy);
 check('ACK never resets verified cleaning baseline',sql('select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.sessions s'),cleaningBefore);
 reject('current actor change blocks even ACK replay','begin;update public.devices set assigned_employee_id='+q(other)+' where id='+q(device)+';'+receiptQuery([ack])+';rollback;',/current event credential/);
 // A conflicting legacy original actor/job rolls back receipt admission too.
 const collisionJob=nextJob(7),collision=JSON.parse(sql('select public.custodial_native_location_dispatch_prepare_at('+[q(collisionJob.job_id),q(collisionJob.lease_token),j(expected),q(at)].join(',')+')')).reservation.payload;
 const ce=action=>event(action,{receipt_job_id:collision.receipt_job_id,content_sha256:collision.content_sha256,notification_key:collision.notification_key,record_id:hash(collision.generation_id+'\n'+collision.receipt_job_id+'\n'+collision.notification_key)});
 const cr=ce('received'),ca=ce('acknowledged');
 reject('ACK collision aborts entire receipt transaction','begin;insert into public.device_notification_acknowledgements(device_identifier,notification_key,notification_type,credential_id,assignment_epoch,employee_id,notification_job_id) values('+[q('KIOSK_08'),q(collision.notification_key),q('location_status'),q(credential),'1',q(other),q(job.job_id)].join(',')+');'+receiptQuery([cr,ca])+';rollback;',/legacy ACK original actor\/job conflict/);
 check('failed ACK transaction did not retire receipt',sql('select count(*) from public.employee_native_provider_events where event_id in ('+q(cr.event_id)+','+q(ca.event_id)+')'),'0');
 const successorTime=onDate('15:05:00.123457');
 sql('set role service_role;select public.mz_enqueue_employee_location_pushes('+q(successorTime)+')');
 const successor=JSON.parse(sql('select to_jsonb(j) from public.operational_notification_jobs j where source_id='+q(location)+' and job_id<>'+q(job.job_id)+" and payload_json->>'credential_id'="+q(credential)));
 const successorLease=randomUUID();sql("update public.operational_notification_jobs set status='leased',lease_token="+q(successorLease)+',leased_until='+q(successorTime)+"::timestamptz+interval '1 hour' where job_id="+q(successor.job_id));
 const successorPrepare='select public.custodial_native_location_dispatch_prepare_at('+[q(successor.job_id),q(successorLease),j(expected),q(successorTime)].join(',')+')';
 const concurrent=await Promise.all([1,2].map(()=>promisify(execFile)('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',successorPrepare],{encoding:'utf8',timeout:30000})));
 const successorReplies=concurrent.map(r=>JSON.parse(r.stdout));
 check('two concurrent owners get exactly one fresh permission',successorReplies.filter(v=>v.dispatch_authorized).length,1);
 const successorPayload=successorReplies.find(v=>v.dispatch_authorized).reservation.payload;
 check('next five-minute cadence uses distinct original key',successorPayload.notification_key!==payload.notification_key,true);
 check('old ACK cannot suppress actual next canonical episode',sql('select public.custodial_native_location_live('+[q(successor.job_id),j(successorPayload),q(successorTime)].join(',')+')'),'t');
 const retired="update public.employee_native_push_generations set dispatch_retired_at="+q(onDate('15:00:01.123456'))+" where generation_id="+q(body.generation_id);
 check('retired same-principal original outcome remains readable',JSON.parse(sql('begin;'+retired+';select public.custodial_native_location_dispatch_status('+q(job.job_id)+');rollback;')).binding,binding);
 check('retired same-principal ACK replay remains original',JSON.parse(sql('begin;'+retired+';'+receiptQuery([ack])+';rollback;')).data.results[0].replayed,true);

 const roles=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'];
 const relations=['employee_native_location_dispatch_attempts','employee_native_location_ack_projections'];
 for(const role of roles){
  reject(role+' denied private dispatch time','set role '+role+';select public.custodial_native_location_dispatch_prepare_at('+[q(job.job_id),q(lease),j(expected),q(at)].join(',')+')',/permission denied/);
  reject(role+' denied direct projector','set role '+role+';select public.custodial_native_location_project_ack('+q(ack.event_id)+','+q(later)+')',/permission denied/);
  for(const rel of relations)reject(role+' denied direct '+rel,'set role '+role+';select * from public.'+rel,/permission denied/);
  if(role!=='service_role')for(const call of ['custodial_native_location_dispatch_status('+q(job.job_id)+')','custodial_native_location_dispatch_prepare('+[q(job.job_id),q(lease),j(expected)].join(',')+')'])reject(role+' denied service wrapper','set role '+role+';select public.'+call,/permission denied/);
 }
 check('production prepare wrapper executes but stale lease cannot dispatch',JSON.parse(sql('set role service_role;select public.custodial_native_location_dispatch_prepare('+[q(job.job_id),q(lease),j(expected)].join(',')+')')).dispatch_authorized,false);
 for(const rel of relations){reject(rel+' immutable','delete from public.'+rel,/immutable/);check(rel+' forced RLS',sql('select relrowsecurity and relforcerowsecurity from pg_class where oid='+q('public.'+rel)+'::regclass'),'t');}
 const names=['custodial_native_location_dispatch_status','custodial_native_location_dispatch_prepare_at','custodial_native_location_dispatch_prepare','custodial_native_location_project_ack','custodial_native_provider_events_at','custodial_native_location_outcome_at'];
 for(const name of names)for(const kind of ['function','grant'])check('exact dispatch recovery '+kind+' '+name,sql(
  'select count(*) from pg_proc p join public.custodial_release_authority_restore_inventory i on i.object_kind='+q(kind)+" and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=p.oid where p.pronamespace='public'::regnamespace and p.proname="+q(name)+" and i.definition_sha256=public.static_weekly_digest_text(case when i.object_kind='function' then pg_get_functiondef(p.oid) else public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) end)"),'1');
 const restoration=JSON.parse(sql("select jsonb_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant','trigger') and (object_identity like '%native_location_dispatch%' or object_identity like '%native_location_ack_projection%' or object_identity like '%custodial_native_location_project_ack%' or object_identity like '%custodial_native_provider_events_at%' or object_identity like '%custodial_native_location_outcome_at%')"));
 sql('grant select on public.employee_native_location_dispatch_attempts to anon;alter table public.employee_native_location_ack_projections disable trigger trg_native_location_ack_projection_immutable;');sql(restoration.join(';\n')+';');
 reject('restored explicit table grants deny anon','set role anon;select * from public.employee_native_location_dispatch_attempts',/permission denied/);
 reject('restored ALWAYS immutable projection','delete from public.employee_native_location_ack_projections',/immutable/);
 check('restore preserves exact original projection data',sql('select md5(jsonb_agg(to_jsonb(a) order by event_id)::text) from public.employee_native_location_ack_projections a'),projectionBefore);
 check('automatic grants remain absent',sql(defaults),'0');
 console.log(JSON.stringify({status:'PASS',checks,migrations:manifest,automatic_grants_absent_before_and_after_each:true,actualPostgres:true,syntheticFetch:true,syntheticClock:true,production:false,independentAudit:false,providerClock:false,delivery:false}));
}finally{cleanup();}
