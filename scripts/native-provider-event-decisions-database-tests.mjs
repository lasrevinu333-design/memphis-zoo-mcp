import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicit CLI execution only. Import/source-contract tests NEVER launch Docker.
// This is F6 fixture preparation, not a replacement for current-manager217 or
// the independently bound global218 paused-controller restore/canonical proof.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const DECISION_IMAGE='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const IMAGE_ID=DECISION_IMAGE.slice(DECISION_IMAGE.indexOf('@')+1);
export const DECISION_HEAD='20261004000000_native_provider_event_decision_lookup.sql';
export const DECISION_217='e07cee99644bc1d22f61e89e5e14f383b4c250cb0cb012e723a318a89bf5da87';
export const DECISION_218='24503cfe852d7668ac94744b2f9ed21d8d2556906b917c7016e0f6c2d3b8d7a1';
export const DECISION_RPC='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)';
const CANARY='custodial_release_canary_authority_surface()';
const CANARY_PRIOR='661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471';
const hex=/^[0-9a-f]{64}$/,q=x=>"'"+String(x).replaceAll("'","''")+"'",j=x=>q(JSON.stringify(x))+'::jsonb';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(Array.isArray(x)?x.map(stable):stable(x));
function stable(x){return Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;}
const key=x=>JSON.stringify([x.object_kind,x.object_identity]);
const sorted=rows=>[...rows].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
export const DECISION_INPUT_PINS=Object.freeze({
 'src/native-provider-api.js':'d330398f959ca4c5682ca6195152b9d0d82d72704fc853af8fe5c3361e93b1e6',
 'src/native-provider-event-decisions.js':'b79128fbcecddff73116b3720e6954f2b876fce5567c54c84a4b1c9ccbd18efe',
 'scripts/fixtures/native-provider-event-decisions-database-cases.mjs':'2849d8e928829f81ade07b2a07a65ade996638dda59aeb2be2e923e8c02cd25e',
 'src/auth/device-credential-auth.js':'a94b58013f872b9ee439f9d960bee3d9230a370bd73967980ef5a8b8a7a3de86',
 'src/device-identity.js':'240170fedc316004e22dfa9501f658d1582cb184bcaa936530d40361b8a66288',
 'src/request-json-parser.js':'c7d44c3795c3642246fb7db8090958842bbb3de8ce9406b05a5849cf30993689',
 'src/native-provider-json.js':'8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294',
 'src/native-provider-events.js':'928debaeaf0af1c76c1bf3ff62d42c5f6665c6682eadd96da1ef494c86e33047',
 'src/native-lunch-reservation.js':'9d256fb50f7a374a7e85210afdd1fef4869a884c9c9f2a8071530a722914a3b2',
 'src/native-location-reservation.js':'bfba6b5909b628a8307373ea2785da0a8132038026c5360f7a4262ce569cdcf2',
 'scripts/fixtures/current-manager-publication-source.mjs':'fb8ac53c6c6925ce63385bd13b0f68cc27572c0976efa1943bd7cee32eafaad1',
});
const EXCEPTIONS=Object.freeze({
 '20260718083100_reconstruct_public_grant_hardening.sql':'ed9aac28cb07f3565f3289d15d67458297222910ac44b1a77e8b5ae71b4c59c3',
 '20260729150527_audit_defense_in_depth_hardening.sql':'420157f3073a3ea1b0055fc6e6246374a9babf2db576cda3bc4272a01e27cc4f',
 '20260815160613_normalize_managed_production_schema_security.sql':'fcc15cab9a3c492f9958d91643e5c88f88f0917b31a3507d340c6fab67cb011a',
});
const DEFAULTS="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const REMOVE_DEFAULTS=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].map(scope=>`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`)).join('\n');
const ABSENT=`do $absent$begin if (${DEFAULTS})<>0 then raise exception 'automatic table/sequence grants present';end if;end $absent$;`;
const INVENTORY="select jsonb_agg(to_jsonb(i) order by object_kind,object_identity) from public.custodial_release_authority_restore_inventory i;";
const SURFACE="select jsonb_agg(to_jsonb(s) order by object_kind,object_identity) from public.custodial_release_canary_authority_surface() s;";
const PROTECTED=['devices','employees','device_auth_credentials','employee_push_registrations','employee_native_push_generations','employee_native_push_delivery_receipts',
 'employee_native_provider_events','employee_native_provider_event_requests','operational_notification_jobs','device_notification_acknowledgements',
 'sessions','completion_responses','maintenance_tickets','system_feedback_items','system_feedback_email_intents'];
const SNAPSHOT='select jsonb_build_object('+PROTECTED.map(t=>`${q(t)},(select jsonb_build_object('count',count(*),'sha256',public.static_weekly_digest_text(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text)) from public.${t} r)`).join(',')+');';

export function assertDecisionMigrationManifest(rows){
 assert.ok(Array.isArray(rows));assert.equal(rows.length,218,'exact218 required');
 for(const r of rows){assert.deepEqual(Object.keys(r).sort(),['file','sha256']);assert.match(r.file,/^\d{14}_[a-zA-Z0-9_]+\.sql$/);assert.match(r.sha256,hex);}
 assert.deepEqual(rows.map(r=>r.file),[...new Set(rows.map(r=>r.file))].sort());
 assert.deepEqual(rows[216],{file:'20261003230000_static_weekly_named_handoff_derivation.sql',sha256:'ef4c6fc1183002af23797b5ac226660a3b1c2b85f3a543df75c1afa61d8fd500'});
 assert.equal(hash(JSON.stringify(rows.slice(0,217))),DECISION_217,'complete217 predecessor bytes');
 assert.deepEqual(rows[217],{file:DECISION_HEAD,sha256:'ab4e6eb848bd214f8616fb52f094829786df9a9a81d2eb8d00d247b1f28e52fd'});
 assert.equal(hash(JSON.stringify(rows)),DECISION_218,'complete218 ordered bytes');return rows;
}
export function readDecisionSource(root=ROOT){
 const directory=join(root,'supabase/migrations');
 const migrations=assertDecisionMigrationManifest(readdirSync(directory).filter(x=>x.endsWith('.sql')).sort().map(file=>({file,sha256:hash(readFileSync(join(directory,file)))})));
 const inputs=Object.entries(DECISION_INPUT_PINS).map(([file,sha256])=>{assert.equal(hash(readFileSync(join(root,file))),sha256,file);return {file,sha256};});
 return {migrations,manifest_sha256:DECISION_218,inputs};
}
export function assertDecisionTarget(row,target,{allowStopped=false}={}){
 assert.match(target.id,hex);assert.match(target.fixture_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(target.name,'mz_schema_rebuild_native_decisions_'+target.fixture_id.replaceAll('-',''));
 assert.equal(row.Id,target.id);assert.equal(row.Name,'/'+target.name);assert.equal(row.Image,IMAGE_ID);
 assert.ok(row.State?.Running===true||(allowStopped&&row.State?.Running===false));
 assert.equal(row.HostConfig?.NetworkMode,'none');assert.deepEqual(row.HostConfig?.PortBindings??{},{});
 assert.ok(Object.values(row.NetworkSettings?.Ports??{}).every(x=>x===null||(Array.isArray(x)&&x.length===0)),'no published port');
 assert.equal(row.Config?.Labels?.['custodial.owner'],'native-provider-event-decisions');
 assert.equal(row.Config?.Labels?.['custodial.synthetic'],'true');assert.equal(row.Config?.Labels?.['custodial.fixture-id'],target.fixture_id);
 assert.ok(Array.isArray(row.Mounts??[])&&(row.Mounts??[]).length<=1);
 for(const mount of row.Mounts??[])assert.ok(mount.Type==='tmpfs'&&mount.Destination==='/var/lib/postgresql/data'
  &&(!mount.Source||mount.Source==='tmpfs')&&mount.RW===true,'only owned memory data; no host/data mount');return target;
}
export function compareDecisionRecoverySets(before,after){
 for(const value of [before,after]){
  assert.ok(Array.isArray(value.inventory)&&Array.isArray(value.surface));
  assert.equal(new Set(value.inventory.map(key)).size,value.inventory.length);assert.equal(new Set(value.surface.map(key)).size,value.surface.length);
 }
 const oldCanary=before.inventory.filter(r=>r.object_kind==='function'&&r.object_identity===CANARY);
 const newCanary=after.inventory.filter(r=>r.object_kind==='function'&&r.object_identity===CANARY);
 assert.equal(oldCanary.length,1);assert.equal(newCanary.length,1);
 const additions=['function','grant'].map(object_kind=>({object_kind,object_identity:DECISION_RPC}));
 const isNew=r=>additions.some(a=>key(a)===key(r)),isCanary=r=>r.object_kind==='function'&&r.object_identity===CANARY;
 assert.equal(before.inventory.filter(isNew).length,0);assert.equal(after.inventory.filter(isNew).length,2);
 assert.deepEqual(sorted(before.inventory.filter(r=>!isCanary(r))),sorted(after.inventory.filter(r=>!isCanary(r)&&!isNew(r))),'all other217 inventory rows byte-exact');
 assert.deepEqual({...oldCanary[0],definition_sql:null,definition_sha256:null,captured_at:null},
  {...newCanary[0],definition_sql:null,definition_sha256:null,captured_at:null},'canary identity/order immutable');
 assert.equal(after.inventory.length,before.inventory.length+2);assert.equal(after.surface.length,before.surface.length+2);
 assert.deepEqual(sorted(after.surface.filter(r=>!isNew(r))),sorted(before.surface),'all old surface members preserved');
 assert.deepEqual(sorted(after.surface.filter(isNew).map(({object_kind,object_identity})=>({object_kind,object_identity}))),sorted(additions));
 return {added:additions,changed:[{object_kind:'function',object_identity:CANARY}],all_other_predecessor_rows_exact:true};
}

async function execute(output){
 const source=readDecisionSource(),git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8'}).trim();
 assert.equal(git('status','--porcelain'),'','clean committed source required');
 const identity={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 assert.ok(isAbsolute(output)&&realpathSync(output)===output&&!output.startsWith(ROOT));
 const st=lstatSync(output);assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid());assert.equal(st.mode&0o077,0);assert.equal(readdirSync(output).length,0);
 const save=(file,value)=>writeFileSync(join(output,file),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 const target={name:'',id:null,fixture_id:randomUUID()};target.name='mz_schema_rebuild_native_decisions_'+target.fixture_id.replaceAll('-','');
 let sequence=0,checks=0,created=false,launchAttempted=false,createdEver=false,cleaned=false,server=null,receipt=null,phase='target';
 const docker=(args,input)=>execFileSync('docker',['--host','unix:///var/run/docker.sock',...args],{encoding:'utf8',input,timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
 const inspect=()=>{const rows=JSON.parse(docker(['inspect',target.id??target.name]));assert.equal(rows.length,1);return rows[0];};
 const log=(label,stdout,stderr='')=>save(String(sequence++).padStart(4,'0')+'-'+label+'.log',stdout+(stderr?'\nSTDERR\n'+stderr:''));
 const sql=text=>{assertDecisionTarget(inspect(),target);try{return docker(['exec','-i',target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-U','supabase_admin','-d','postgres'],
  'set standard_conforming_strings=on;set client_min_messages=warning;set statement_timeout=30000;set lock_timeout=5000;'+text).trim();}
  catch(error){log('sql-failure','',String(error.stderr??''));throw error;}};
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
 const reject=(name,text,pattern=/ERROR/)=>{let failure;try{sql(text);}catch(e){failure=e;}assert.ok(failure,name);assert.match(String(failure.stderr),pattern,name);checks++;console.log('PASS',name);};
 function cleanup(){
  if(cleaned)return;
  // A timed-out docker-run response is ambiguous: reconcile only this unique
  // named/labelled fixture, never another process's name or a broad filter.
  if(launchAttempted&&!created){let row;try{row=inspect();}catch(error){if(!/No such (?:object|container)/i.test(String(error.stderr)))throw error;}
   if(row){target.id=row.Id;assertDecisionTarget(row,target,{allowStopped:true});created=true;createdEver=true;}}
  if(created){const row=inspect();assertDecisionTarget(row,target,{allowStopped:true});docker(['rm','-f',target.id]);
   assert.equal(docker(['ps','-a','--filter','id='+target.id,'--format','{{.ID}}']).trim(),'');created=false;}
  cleaned=true;save('cleanup.json',{target,created_ever:createdEver,removed:createdEver,no_owned_container:true,source_unchanged:git('rev-parse','HEAD')===identity.commit});
 }
 const stop=()=>{try{server?.closeAllConnections();server?.close();cleanup();}finally{process.exit(143);}};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 save('intent.json',{schema:'custodial.native-event-decision-run-intent.v1',source:{...identity,...source},target,image:DECISION_IMAGE,synthetic:true,production:false,scope:'F6_LOOKUP_AND_SCOPED_RECOVERY_ONLY',global_controller_restore:false});
 try{
  const image=JSON.parse(docker(['image','inspect',DECISION_IMAGE]));assert.equal(image.length,1);assert.equal(image[0].Id,IMAGE_ID);
  assert.equal(docker(['ps','-a','--filter','name=^/'+target.name+'$','--format','{{.ID}}']).trim(),'');
  launchAttempted=true;target.id=docker(['run','-d','--pull','never','--network','none','--name',target.name,
   '--label','custodial.owner=native-provider-event-decisions','--label','custodial.synthetic=true','--label','custodial.fixture-id='+target.fixture_id,
   '--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',DECISION_IMAGE,
   '-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']).trim();created=true;createdEver=true;assert.match(target.id,hex);
  assertDecisionTarget(inspect(),target);save('target.json',target);
  let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1;');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,4);
  sql(REMOVE_DEFAULTS+ABSENT);let predecessor;phase='migrations';
  for(const [index,m]of source.migrations.entries()){
   const bytes=readFileSync(join(ROOT,'supabase/migrations',m.file));assert.equal(hash(bytes),m.sha256);
   if(index===217){predecessor={inventory:JSON.parse(sql(INVENTORY)),surface:JSON.parse(sql(SURFACE))};
    const row=predecessor.inventory.find(x=>x.object_kind==='function'&&x.object_identity===CANARY);
    assert.equal(row?.definition_sha256,CANARY_PRIOR);assert.equal(hash(row.definition_sql),CANARY_PRIOR);save('predecessor217.json',predecessor);}
   if(EXCEPTIONS[m.file]){assert.equal(m.sha256,EXCEPTIONS[m.file]);assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);}
   let stdout;try{stdout=sql(ABSENT+'\n'+bytes+'\n'+(EXCEPTIONS[m.file]?REMOVE_DEFAULTS:'')+'\n'+ABSENT);}
   catch(error){save('failed-migration.json',{file:m.file,sha256:m.sha256,index,applied_predecessors:index,status:'FAIL'});console.error('FAILED_MIGRATION',m.file);throw error;}
   log('migration-'+String(index).padStart(4,'0'),stdout);
   if((index+1)%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',index+1);await new Promise(r=>setImmediate(r));
  }
  const after={inventory:JSON.parse(sql(INVENTORY)),surface:JSON.parse(sql(SURFACE))};const delta=compareDecisionRecoverySets(predecessor,after);save('after218.json',after);
  phase='synthetic_seed';const {nativeProviderEventDecisionDatabaseCases}=await import('./fixtures/native-provider-event-decisions-database-cases.mjs');
  const {deviceCredentialInternals,makeDeviceCredentialMiddleware}=await import('../src/auth/device-credential-auth.js');
  const {validateNativeProviderEventsRequest,validateNativeProviderEventsResponse}=await import('../src/native-provider-events.js');
  const {validateNativeProviderEventDecisions}=await import('../src/native-provider-event-decisions.js');
  const {validateNativeLunchPayload}=await import('../src/native-lunch-reservation.js');
  const {canonicalNativeLocation}=await import('../src/native-location-reservation.js');
  const ids=Object.fromEntries(['employee','device','credential','generation','operation','registration','job','lease','projection','location','session','completion','completion_operation','ticket','manager','feedback','feedback_operation'].map(k=>[k,randomUUID()]));
  const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-F6-current-credential-root-long-enough'};
  const secret='syntheticF6Secret-abcdefghijklmnopqrstuvwxyz1234567890',credential=ids.credential,credentialHash=deviceCredentialInternals.tokenHash(secret,env);
  const token='synthetic-F6-original-registration-token-not-production';
  const body={schema:'custodial.native-provider-register.v1',operation_id:ids.operation,generation_id:ids.generation,credential_id:credential,employee_id:ids.employee,
   device_id:'KIOSK_08',assignment_epoch:1,principal_digest:'a'.repeat(64),token_digest:hash(token),token,
   native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
  const times=JSON.parse(sql("select jsonb_build_object('activated',public.custodial_native_location_utc(t-interval '1 minute'),'reserved',public.custodial_native_location_utc(t),'valid_until',public.custodial_native_location_utc(t+interval '1 hour'),'received',public.custodial_native_location_utc(t+interval '1 second'),'admitted',public.custodial_native_location_utc(t+interval '2 seconds'),'effect',public.custodial_native_location_utc(t+interval '3 seconds'),'server',public.custodial_native_location_utc(t+interval '4 seconds'),'date',(t at time zone 'America/Chicago')::date,'scheduled_time',to_char(t at time zone 'America/Chicago','HH24:MI')) from (select date_trunc('second',clock_timestamp())-interval '2 hours' t) x;"));
  // Historical generation/reservation inputs ONLY are seeded. Server ACCEPTED
  // events/receipts below are produced exclusively by real existing events_at.
  const payload={schema:'custodial.native-provider-payload.v1',generation_id:ids.generation,principal_digest:body.principal_digest,token_digest:body.token_digest,
   receipt_job_id:ids.job,receipt_credential_id:credential,receipt_employee_id:ids.employee,receipt_device_id:'KIOSK_08',receipt_assignment_epoch:'1',
   notification_key:hash('synthetic F6 lunch occurrence'),reservation_at:times.reserved,valid_until:times.valid_until,kind:'employee_lunch_coverage',notification_type:'lunch_coverage',
   title:'Synthetic historical notice',body:'Synthetic original lookup fixture only',channel_id:'employee-lunch-coverage',route:'employee-schedule.html?hub=employee',
   service_date:times.date,event:'start',loan_id:hash('synthetic F6 loan'),scheduled_time:times.scheduled_time,scheduled_at:times.reserved,coverer_slot_id:'synthetic-slot',projection_id:ids.projection,document_identity:hash('synthetic F6 document')};
  payload.content_sha256=hash(canonicalNativeLocation(payload));validateNativeLunchPayload(payload,{jobId:ids.job,expected:{generation_id:ids.generation}});
  const jobKey='employee-lunch-push:'+payload.notification_key+':'+credential;
  sql(`begin;
insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(ids.manager)},'Synthetic F6 manager',array['OPS_MANAGER','DIRECTOR'],true,false);
insert into public.employees(id,employee_code,display_name,role,active) values(${q(ids.employee)},'EMP997','Synthetic F6 employee','staff',true);
insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(ids.device)},'KIOSK_08','Synthetic F6 fixture',true,${q(ids.employee)},1);
insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at,last_used_at,metadata_json) values(${q(credential)},${q(ids.device)},${q(credentialHash)},clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',clock_timestamp(),${j(deviceCredentialInternals.deviceCredentialSecretMetadata(env))});
insert into public.employee_push_registrations(registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash) values(${q(ids.registration)},${q(ids.device)},${q(credential)},${q(ids.employee)},1,'android',${q(token)},${q(body.token_digest)});
insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,credential_id,employee_id,assignment_epoch,principal_digest,token_digest,native_app,request_fingerprint,first_native_request_id,first_attestation_digest,activated_at)
values(${q(ids.generation)},${q(ids.operation)},${q(ids.registration)},${q(ids.device)},'KIOSK_08',${q(credential)},${q(ids.employee)},1,${q(body.principal_digest)},${q(body.token_digest)},${j(body.native_app)},repeat('b',64),${q(randomUUID())},repeat('c',64),${q(times.activated)});
insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,payload_json) values(${q(ids.job)},${q(jobKey)},'employee_native_push',${q(ids.projection)},${j({credential_id:credential,employee_id:ids.employee,device_identifier:'KIOSK_08',assignment_epoch:1,data_json:{kind:'employee_lunch_coverage',notification_key:payload.notification_key}})});
insert into public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,registration_id,token_hash,prepared_at,native_generation_id,native_payload,native_payload_sha256,native_valid_until)
values(${q(ids.job)},${q(jobKey)},${q(ids.projection)},${q(ids.lease)},${q(credential)},1,${q(ids.registration)},${q(body.token_digest)},${q(times.reserved)},${q(ids.generation)},${j(payload)},${q(payload.content_sha256)},${q(times.valid_until)});
insert into public.locations(id,location_code,location_name,location_type,form_type) values(${q(ids.location)},'F6_SYNTHETIC','Synthetic protected location','restroom','restroom');
insert into public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at) values(${q(ids.session)},${q(ids.session)},${q(ids.session)},${q(ids.location)},${q(ids.employee)},${q(ids.device)},'active',clock_timestamp()-interval '10 minutes');
insert into public.completion_responses(id,session_id,location_id,submitted_by_employee_id,device_id,response_json,client_completion_id) values(${q(ids.completion)},${q(ids.session)},${q(ids.location)},${q(ids.employee)},${q(ids.device)},${j({form_type:'restroom',work_result:'details',attention_needed:false,services_performed:['Synthetic protected custom work'],maintenance_issues_found:[],note:'Synthetic historical protected draft; NOT verified cleaning'})},${q(ids.completion_operation)});
insert into public.maintenance_tickets(id,location_id,issue_source,status,issue_summary) values(${q(ids.ticket)},${q(ids.location)},'manager_report','open','Synthetic protected pending work');
insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json) values(${q(ids.feedback)},${q(ids.feedback_operation)},repeat('9',64),'other','normal','Synthetic protected feedback','Synthetic F6 manager','manager',${j({identity_verification:{status:'verified',kind:'named_manager_session',manager_id:ids.manager}})});
commit;`);
  const observation=(time,elapsed)=>({earliest_at:time,latest_at:time,clock_profile_id:'SYNTHETIC_ONLY_PC01',elapsed_realtime_ms:elapsed,boot_count:1});
  const request={schema:'custodial.native-provider-events.v2',events:['acknowledged','opened','displayed','received'].map(action=>({schema:'custodial.native-provider-event.v2',event_id:randomUUID(),
   record_id:hash(ids.generation+'\n'+ids.job+'\n'+payload.notification_key),action,...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(k=>[k,payload[k]])),
   receipt_assignment_epoch:1,admission_bounds:observation(times.admitted,200),original_observation:observation(action==='received'?times.received:times.effect,action==='received'?100:300)}))};
  validateNativeProviderEventsRequest(request);
  check('no fabricated accepted event exists before actual admission',sql('select count(*) from public.employee_native_provider_events;'),'0');
  const admitted=JSON.parse(sql(`select public.custodial_native_provider_events_at(${q(credential)},${q(credentialHash)},${q(randomUUID())},repeat('b',64),${j(request)},${q(times.server)});`));
  validateNativeProviderEventsResponse(admitted,request);check('actual events_at accepts exactly four originals',admitted.data.results.map(x=>x.action),['received','displayed','opened','acknowledged']);
  check('all originals genuinely admitted',admitted.data.results.every(x=>x.admitted_state==='ACCEPTED'&&!x.replayed),true);
  save('synthetic-admission.json',{classification:'SYNTHETIC_PRODUCER_INPUTS_ACTUAL_SQL_EVENT_ADMISSION',times,payload,request,admitted,producer_proof:false,native_receipt_proof:false});
  const protectedBefore=JSON.parse(sql(SNAPSHOT));for(const table of ['sessions','completion_responses','maintenance_tickets','system_feedback_items','employee_native_provider_events'])assert.ok(protectedBefore[table].count>0);
  phase='sql_cases';const decisions=nativeProviderEventDecisionDatabaseCases({scope:'network-none-synthetic-no-auto-grants',sql,q,j,check,reject,credential,credentialHash,body,request,admitted});
  save('decision-fixture.json',decisions);check('all SQL cases preserve protected rows',JSON.parse(sql(SNAPSHOT)),protectedBefore);

  phase='http';const express=(await import('express')).default,{createGeneralJsonMiddleware}=await import('../src/request-json-parser.js'),{installNativeProviderRoutes}=await import('../src/native-provider-api.js');
  const app=express();app.use(createGeneralJsonMiddleware());let rpcCalls=0;
  installNativeProviderRoutes(app,{env,requireCurrentCredential:makeDeviceCredentialMiddleware({env,requireEnrolledCredential:true,
   store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async id=>JSON.parse(sql(`select coalesce((select to_jsonb(c) from public.device_auth_credentials c where credential_id=${q(id)}),'null'::jsonb);`)),touchCredential:async()=>{},audit:async()=>{}},
   runReadOnlySql:async text=>JSON.parse(sql('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\'::jsonb) from ('+text.trim().replace(/;$/,'')+') t;'))}),
   db:{rpc:async(name,a)=>{rpcCalls++;assert.equal(name,'custodial_native_provider_event_decisions');return {data:JSON.parse(sql('set role service_role;select public.custodial_native_provider_event_decisions('+[q(a.p_credential),q(a.p_credential_hash),q(a.p_native_request),q(a.p_attestation_digest),q(a.p_raw_body_sha256),j(a.p_body)].join(',')+');'))};}}});
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:'synthetic_http_error'}));
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});console.log('OWNED_F6_HTTP_SERVER',server.address().port);
  const route='/employee-notifications-api/native-provider/event-decisions';
  const send=async(mutate=()=>{},input=decisions.request)=>{const bytes=' \n'+JSON.stringify(input,null,2)+'\n',requestId=randomUUID(),timestamp=new Date().toISOString();
   const proof=['custodial-native-request.v1',credential,'KIOSK_08','POST',route,hash(bytes),requestId,timestamp,'custodial'].join('\n');
   const headers={'content-type':'application/json',authorization:`Device ${credential}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
    'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':timestamp,'x-memphis-native-request-attestation':createHmac('sha256',secret).update(proof).digest('hex')};mutate(headers);
   const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers,body:bytes,signal:AbortSignal.timeout(15000)});
   return {status:r.status,value:await r.json(),requestId,raw:hash(bytes)};};
  try{
   const response=await send();check('actual current credential HMAC route to real RPC',response.status,200);
   validateNativeProviderEventDecisions(response.value,decisions.request,{credentialId:credential,credentialHash,nativeRequestId:response.requestId,attestationDigest:'b'.repeat(64),rawBodySha256:response.raw});
   check('HTTP accepted originals exactly match SQL',response.value.data.results,decisions.response.data.results);
   const count=rpcCalls,bad=await send(h=>delete h['x-memphis-native-request-attestation']);check('unsigned HTTP never reaches SQL',[bad.status,rpcCalls],[403,count]);
   const retry=await send();check('actual fresh HTTP loss-recovery returns same original facts',retry.value.data.results,response.value.data.results);
   assert.notEqual(retry.requestId,response.requestId);save('http-receipts.json',{first:response,retry,missingHmacStatus:bad.status,credential_records_actual:true,policy_fixture:'enforce',touch_and_audit_telemetry_stubbed:true});
  }finally{server.closeAllConnections();await new Promise((r,reject)=>server.close(e=>e?reject(e):r()));server=null;console.log('OWNED_F6_HTTP_SERVER_CLOSED');}
  check('HTTP lookup preserves protected records',JSON.parse(sql(SNAPSHOT)),protectedBefore);

  // Scope-limited rollback recovery: only this new function and EXECUTE ACL.
  // Existing global paused-controller/full inventory authority is NOT invoked.
  phase='scoped_recovery';const newRows=after.inventory.filter(x=>x.object_identity===DECISION_RPC);assert.equal(newRows.length,2);
  const fn=newRows.find(x=>x.object_kind==='function'),grant=newRows.find(x=>x.object_kind==='grant');
  const live=`select jsonb_build_object('function',public.static_weekly_digest_text(pg_get_functiondef(${q(DECISION_RPC)}::regprocedure)),'grant',public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(${q(DECISION_RPC)})));`;
  const originalLive=JSON.parse(sql(live));check('scoped recovery starts at source-captured bytes',originalLive,{function:fn.definition_sha256,grant:grant.definition_sha256});
  const fault="create or replace function public.custodial_native_provider_event_decisions(p_credential uuid,p_credential_hash text,p_native_request uuid,p_attestation_digest text,p_raw_body_sha256 text,p_body jsonb) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $fault$begin raise exception 'synthetic new-RPC body fault';end $fault$;grant execute on function "+DECISION_RPC+' to anon;';
  const recovered=sql('begin;'+fault+live+fn.definition_sql+';'+grant.definition_sql+';'+live+SNAPSHOT+'rollback;').split('\n').map(JSON.parse);
  assert.equal(recovered.length,3);assert.notEqual(recovered[0].function,originalLive.function);assert.notEqual(recovered[0].grant,originalLive.grant);
  check('exact new function and grant definitions restore after actual scoped fault',recovered[1],originalLive);
  check('scoped restore preserves protected rows BEFORE rollback',recovered[2],protectedBefore);
  check('scoped recovery rollback exact live definitions',JSON.parse(sql(live)),originalLive);
  for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
   reject('restored exact lookup ACL denies '+role,'set role '+role+';select public.custodial_native_provider_event_decisions(null,null,null,null,null,null);',/permission denied/);
  check('all218 inventory rows exactly preserved after scoped recovery',JSON.parse(sql(INVENTORY)),after.inventory);
  check('all218 surface members exactly preserved',JSON.parse(sql(SURFACE)),after.surface);
  check('all protected records exactly preserved',JSON.parse(sql(SNAPSHOT)),protectedBefore);check('automatic grants still absent',sql(DEFAULTS),'0');
  phase='final_source';assert.deepEqual(readDecisionSource(),source);assert.equal(git('rev-parse','HEAD'),identity.commit);assert.equal(git('status','--porcelain'),'');
  receipt={schema:'custodial.native-event-decision-engine-receipt.v1',status:'PASS',checks,source:{...identity,...source},target,delta,
   actual_sql:true,actual_http_hmac:true,automatic_grants_absent_before_after_each:true,scoped_body_acl_recovery:true,global_controller_restore:false,
   producer_inputs:'EXPLICIT_SYNTHETIC_HISTORICAL',native_receipt_proof:false,delivery:false,policy_selection:false,independent_audit:false,release_admission:false};
 }catch(error){save('failure.json',{status:'FAIL',phase,error_class:error.name,message_sha256:hash(String(error.message)),engine_pass:false});throw error;}
 finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}cleanup();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 assert.equal(cleaned,true);assert.equal(created,false);assert.ok(receipt);
 save('receipt.json',{...receipt,cleanup_verified:true,cleanup_sha256:hash(readFileSync(join(output,'cleanup.json')))});
 console.log('F6_SQL_HTTP_SCOPED_RECOVERY_PASS',checks);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--source-check')console.log(JSON.stringify({status:'PASS',scope:'SOURCE_ONLY_NO_ENGINE',...readDecisionSource()}));
 else{assert.equal(process.argv.length,4,'use --source-check or --execute PRIVATE_EMPTY_OUTPUT_DIRECTORY');assert.equal(process.argv[2],'--execute');await execute(process.argv[3]);}
}
