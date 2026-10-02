import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';

const container=`mz_completion_taxonomy_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=statement=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;set statement_timeout=30000;'+statement}).trim();
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const j=value=>`${q(JSON.stringify(value))}::jsonb`;
const reject=(label,statement,pattern)=>{let error;try{sql(statement)}catch(e){error=e}assert.ok(error,label);assert.match(String(error.stderr),pattern,label);checks++;console.log('PASS',label)};
const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;console.log('PASS',label)};
const defaultCount="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`)};
let owned=false,checks=0;
const cleanup=()=>{if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container)}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup()}finally{process.exit(143)}});
const files=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')).sort();
assert.ok(files.includes('20261003120000_completion_taxonomy_evidence.sql'));
assert.ok(files.includes('20261003143000_issue_constraint_index_recovery.sql'));
assert.ok(files.indexOf('20261003120000_completion_taxonomy_evidence.sql') <
  files.indexOf('20261003143000_issue_constraint_index_recovery.sql'));
const manifest=createHash('sha256').update(files.map(file=>`${file} ${createHash('sha256').update(readFileSync(`supabase/migrations/${file}`)).digest('hex')}`).join('\n')).digest('hex');
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log(JSON.stringify({container,image,manifest,migrations:files.length,synthetic:true}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++}catch{ready=0}await new Promise(resolve=>setTimeout(resolve,500))}assert.equal(ready,4);
 removeDefaults();let defaultRepairs=0;
 for(const file of files){assert.equal(sql(defaultCount),'0','defaults before '+file);try{sql(readFileSync(`supabase/migrations/${file}`,'utf8'))}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error}if(Number(sql(defaultCount))){defaultRepairs++;removeDefaults()}assert.equal(sql(defaultCount),'0','defaults after '+file)}
 console.log('REPLAY_COMPLETE',files.length,'default_repairs',defaultRepairs);
 const expectedFunctions=[
  'public.custodial_completion_taxonomy_immutable()',
  'public.custodial_completion_assert_taxonomy(jsonb)',
  'public.custodial_completion_taxonomy_response_guard()',
  'public.custodial_completion_taxonomy_read(text)',
  'public.custodial_manager_completion_evidence(uuid,text,text)',
 ];
 const expectedArray=`array[${expectedFunctions.map(q).join(',')}]::regprocedure[]`;
 const resolved=`case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end=any(${expectedArray})`;
 check('five exact restore functions captured',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and ${resolved};`),'5');
 check('five exact function grants captured',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and ${resolved};`),'5');
 check('taxonomy trigger restore entries',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind='trigger' and object_identity in ('public.custodial_completion_taxonomy_versions.custodial_completion_taxonomy_immutable','public.completion_responses.custodial_completion_taxonomy_response_guard');"),'2');
 check('private catalog relation captured',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_kind in ('relation','relation_state','column_set','grant') and object_identity='public.custodial_completion_taxonomy_versions';"),'4');
 check('taxonomy restore hashes exact',sql(`select bool_and(definition_sha256=public.static_weekly_digest_text(definition_sql)) from public.custodial_release_authority_restore_inventory where ${resolved} or (object_kind='trigger' and object_identity in ('public.custodial_completion_taxonomy_versions.custodial_completion_taxonomy_immutable','public.completion_responses.custodial_completion_taxonomy_response_guard')) or (object_identity='public.custodial_completion_taxonomy_versions');`),'t');
 const catalogText=readFileSync('src/completion-taxonomy-v1.json','utf8').trimEnd(),catalog=JSON.parse(catalogText),hash=createHash('sha256').update(catalogText).digest('hex');
 const observed=JSON.parse(sql("set role service_role;select public.custodial_completion_taxonomy_read('COMP011-20261003-v1');"));
 check('catalog exact immutable source',observed,{version:catalog.version,digest:hash,catalog,source_note:'Captured current form taxonomy plus corrected v17 SCREEN12-13 historical crosswalk and OC24-preserved issue distinctions; inspection choices historical only'});
 for(const role of ['anon','authenticated','custodial_application_reader'])reject(`${role} cannot read catalog RPC`,`set role ${role};select public.custodial_completion_taxonomy_read('COMP011-20261003-v1');`,/permission denied/);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader'])reject(`${role} cannot read private catalog table`,`set role ${role};select * from public.custodial_completion_taxonomy_versions;`,/permission denied/);
 reject('catalog update denied',"update public.custodial_completion_taxonomy_versions set source_note='changed' where version='COMP011-20261003-v1';",/immutable/);
 reject('catalog delete denied',"delete from public.custodial_completion_taxonomy_versions where version='COMP011-20261003-v1';",/immutable/);
 const employee=randomUUID(),device=randomUUID(),location=randomUUID(),session=randomUUID(),manager=randomUUID(),secret='synthetic-completion-taxonomy-secret-long-enough';
 sql(`select public.custodial_configure_backend_execution_key(encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'completion-taxonomy-synthetic');
 insert into public.employees(id,employee_code,display_name,active,role) values(${q(employee)},'TAXONOMY01','Synthetic Employee',true,'staff');
 insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(location)},'TAXONOMY01','Synthetic Restroom','restroom','restroom',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id) values(${q(device)},'TAXONOMY_DEVICE','Synthetic Phone',true,${q(employee)});
 insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic Taxonomy Manager',array['OPS_MANAGER','DIRECTOR'],true,false);
 insert into public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at)
 values(${q(session)},'taxonomy-session-1','taxonomy-session-1',${q(location)},${q(employee)},${q(device)},'active',now()-interval '10 minutes');`);
 const service=catalog.areas.restroom.services[1],issue=catalog.areas.restroom.issues[0];
 const metadata=(services,issues)=>({version:catalog.version,digest:hash,services,issues});
 const base={form_type:'restroom',work_result:'details',attention_needed:true,services_performed:[service.label,'Custom cleaning'],maintenance_issues_found:[issue.label],note:'Exact employee raw note',taxonomy:metadata([{id:service.id,label:service.label},{id:'OTHER',label:'Custom cleaning'}],[{id:issue.id,label:issue.label}])};
 const insert=(id,response)=>`insert into public.completion_responses(id,session_id,location_id,submitted_by_employee_id,device_id,response_json,client_completion_id) values(${q(id)},${q(session)},${q(location)},${q(employee)},${q(device)},${j(response)},${q(randomUUID())});`;
 const responseId=randomUUID();sql(insert(responseId,base));
 check('stored response exact and no enrichment',JSON.parse(sql(`select response_json from public.completion_responses where id=${q(responseId)};`)),base);
 const data=JSON.parse(sql(`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1',${q(secret)});`));
 check('manager exact raw response',data.original_response,base);check('catalog version readback',data.catalog_digest,hash);
 check('non-native row not promoted to cleaned',data.classification,'historical_or_unverified_completion');check('explicit issue retained',data.issue_reported,true);
 check('no area ticket fabrication',data.linked_ticket_count,0);
 for(const [label,change] of [
  ['digest tamper',r=>{r.taxonomy.digest='0'.repeat(64)}],
  ['service ID tamper',r=>{r.taxonomy.services[0].id='exhibit.service.02'}],
  ['raw label tamper',r=>{r.taxonomy.services[0].label='Different'}],
  ['known service as OTHER',r=>{r.taxonomy.services[0].id='OTHER'}],
  ['issue ID tamper',r=>{r.taxonomy.issues[0].id='OTHER'}],
 ]){const altered=structuredClone(base);change(altered);reject(label,`update public.completion_responses set response_json=${j(altered)} where id=${q(responseId)};`,/completion taxonomy|known completion service/)}
 const checkOnly={...base,work_result:'checked_no_cleaning_needed',services_performed:[],taxonomy:metadata([],[{id:issue.id,label:issue.label}])};
 sql(`update public.completion_responses set response_json=${j(checkOnly)} where id=${q(responseId)};`);
 check('check-only issue remains independent',JSON.parse(sql(`select response_json from public.completion_responses where id=${q(responseId)};`)),checkOnly);
 const full={...base,work_result:'full',attention_needed:false,services_performed:['Full cleaning services'],maintenance_issues_found:[],taxonomy:metadata([{id:catalog.areas.restroom.services[0].id,label:'Full cleaning services'}],[])};
 sql(`update public.completion_responses set response_json=${j(full)} where id=${q(responseId)};`);
 check('full choice one service',JSON.parse(sql(`select response_json from public.completion_responses where id=${q(responseId)};`)),full);
 const legacy={form_type:'restroom',work_result:'details',attention_needed:false,services_performed:['Legacy custom service'],maintenance_issues_found:[],note:'Old protected draft'};
 sql(`update public.completion_responses set response_json=${j(legacy)} where id=${q(responseId)};`);
 const unversioned=JSON.parse(sql(`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1',${q(secret)});`));
 check('legacy draft exact',unversioned.original_response,legacy);check('legacy version honest',unversioned.taxonomy_status,'unversioned_historical_or_protected_draft');
 check('legacy not claimed clean',unversioned.classification,'historical_or_unverified_completion');
 for(const role of ['anon','authenticated','custodial_application_reader'])reject(`${role} denied manager RPC`,`set role ${role};select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1',${q(secret)});`,/permission denied/);
 reject('wrong backend secret denied',`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1','wrong');`,/backend|secret|permission denied/i);
 reject('missing exact session denied',`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},'other-session',${q(secret)});`,/not found/);
 // Exercise the real snapshot -> native start -> same-tag finish -> protected
 // authoritative commit chain. Direct fixture rows above never count as a
 // verified cleaning, even when their response JSON looks plausible.
 const nativeEmployee=randomUUID(),nativeDevice=randomUUID(),nativeCredential=randomUUID(),nativeLocation=randomUUID();
 const suffix=randomUUID().slice(0,8).toUpperCase(),deviceCode=`TAX_NATIVE_${suffix}`,locationCode=`TX${suffix}`;
 const routeSecret='synthetic-completion-taxonomy-native-route-secret-long-enough';
 const sha=value=>createHash('sha256').update(value).digest('hex');
 sql(`select public.custodial_configure_native_route_proof_key(${q(sha(routeSecret))},'completion-taxonomy-synthetic');
 insert into public.employees(id,employee_code,display_name,active,role) values(${q(nativeEmployee)},${q('TN'+suffix)},'Synthetic Native Employee',true,'staff');
 insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(nativeLocation)},${q(locationCode)},'Synthetic Native Restroom','restroom','restroom',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id) values(${q(nativeDevice)},${q(deviceCode)},'Synthetic Native Phone',true,${q(nativeEmployee)});
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
 values(${q(nativeCredential)},${q(nativeDevice)},${q(sha(suffix))},now(),now()+interval '1 day');
 insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,new_employee_id,new_employee_name,change_reason,source)
 values(${q(nativeDevice)},${q(deviceCode)},${q(nativeEmployee)},'Synthetic Native Employee','taxonomy test','test');`);
 const snapshot=JSON.parse(sql(`select public.tool_get_offline_scan_authority_snapshot(${q(deviceCode)},${q(nativeCredential)},${q(secret)});`));
 let nextTime=Date.parse(snapshot.generated_at)+1;
 const startVisit=()=>{
  const sessionUuid=randomUUID(),startedAt=new Date(nextTime++).toISOString(),endedAt=new Date(nextTime++).toISOString(),scanId=randomUUID();
  const context=JSON.parse(sql(`select public.tool_start_offline_occurrence(${q(deviceCode)},${q(locationCode)},${q(sessionUuid)},${q(startedAt)},${q(snapshot.snapshot_id)},${q(snapshot.employee_id)},${snapshot.assignment_epoch},${q(nativeCredential)},${q(nativeCredential)},${q(scanId)},'custodial-native-start.v1',${q('a'.repeat(64))},${q(routeSecret)},${q(secret)});`));
  return {sessionUuid,startedAt,endedAt,scanId,finishScanId:randomUUID(),completionId:randomUUID(),context};
 };
 const complete=(visit,response)=>{
  const scanEvidence=[{client_event_id:visit.finishScanId,event_type:'scan_finish',result:'ok',notes:'SYNTHETIC TAXONOMY TEST',scanned_at:visit.endedAt,payload_json:{entry_source:'native-nfc'}}];
  return JSON.parse(sql(`select public.tool_commit_cleaning_workflow_authoritative(${q(visit.sessionUuid)},${q(visit.completionId)},${q(deviceCode)},${q(locationCode)},${q(visit.startedAt)},${q(visit.endedAt)},${j(response)},${j(scanEvidence)},'synthetic-taxonomy-native',${q(visit.context.context_id)},${q(visit.context.submission_proof)},${q(nativeCredential)},${q(visit.finishScanId)},'custodial-native-completion.v2',${q('b'.repeat(64))},${q(routeSecret)},${q(secret)});`));
 };
 const evidence=visit=>JSON.parse(sql(`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},${q(visit.sessionUuid)},${q(secret)});`));
 const fullClean={form_type:'restroom',work_result:'full',attention_needed:false,services_performed:['Full cleaning services'],maintenance_issues_found:[],note:'Synthetic exact native finish',taxonomy:metadata([{id:'restroom.service.01',label:'Full cleaning services'}],[])};
 const cleanVisit=startVisit(),cleanAccepted=complete(cleanVisit,fullClean);
 check('official native completion accepted',cleanAccepted.status,'closed');
 const cleanEvidence=evidence(cleanVisit);
 check('official native exact receipt admitted',cleanEvidence.native_exact_receipt_admitted,true);
 check('official no-issue clean class',cleanEvidence.classification,'cleaned_no_issues_reported');
 check('original identity/location returned',cleanEvidence.location_id,nativeLocation);
 check('original actor returned',cleanEvidence.employee_id,nativeEmployee);
 check('original response unchanged in official writer',cleanEvidence.original_response,fullClean);
 const unrelatedLocation=randomUUID();sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(unrelatedLocation)},${q('TO'+suffix)},'Other Synthetic Restroom','restroom','restroom',true);
 insert into public.maintenance_tickets(location_id,issue_source,status,issue_summary) values(${q(unrelatedLocation)},'manager_report','open','Unrelated synthetic other-place concern');`);
 check('other location ticket cannot taint exact clean',evidence(cleanVisit).classification,'cleaned_no_issues_reported');
 const changed={...fullClean,note:'tampered after native commit'};
 const tampered=JSON.parse(sql(`begin;update public.completion_responses set response_json=${j(changed)} where id=${q(cleanEvidence.completion_response_id)};set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},${q(cleanVisit.sessionUuid)},${q(secret)});rollback;`));
 check('receipt payload mismatch loses native admission',tampered.native_exact_receipt_admitted,false);
 check('tamper did not persist',evidence(cleanVisit).native_exact_receipt_admitted,true);
 const sink=catalog.areas.restroom.issues.find(x=>x.label==='Sink leaking'),floor=catalog.areas.restroom.issues.find(x=>x.id==='restroom.issue.floor_drain');
 const twoIssues={...fullClean,attention_needed:true,maintenance_issues_found:[sink.label,floor.label],taxonomy:metadata([{id:'restroom.service.01',label:'Full cleaning services'}],[{id:sink.id,label:sink.label},{id:floor.id,label:floor.label}])};
 const issueVisit=startVisit(),issueAccepted=complete(issueVisit,twoIssues);check('two-issue native accepted',issueAccepted.status,'closed');
 let issueEvidence=evidence(issueVisit);check('two native issues require follow-up',issueEvidence.classification,'cleaned_follow_up_required');check('exact linked ticket count',issueEvidence.linked_ticket_count,2);
 const issueTickets=issueEvidence.linked_completion_tickets.map(x=>x.ticket_id);
 sql(`set role service_role;select public.custodial_set_maintenance_ticket_outcome(${q(issueTickets[0])},'mark_fixed',${q(manager)},null,'Synthetic first fix',${q(secret)});`);
 issueEvidence=evidence(issueVisit);check('one fixed of two still requires follow-up',issueEvidence.classification,'cleaned_follow_up_required');check('one fixed count',issueEvidence.linked_mark_fixed_count,1);
 sql(`set role service_role;select public.custodial_set_maintenance_ticket_outcome(${q(issueTickets[1])},'mark_fixed',${q(manager)},null,'Synthetic second fix',${q(secret)});`);
 issueEvidence=evidence(issueVisit);check('all linked fixed never means inspection pass',issueEvidence.classification,'cleaned_linked_tickets_marked_fixed_coverage_unverified');check('raw issues preserved after fixes',issueEvidence.original_response.maintenance_issues_found,twoIssues.maintenance_issues_found);
 const orderVisit=startVisit(),orderAccepted=complete(orderVisit,{...twoIssues,maintenance_issues_found:[sink.label],taxonomy:metadata([{id:'restroom.service.01',label:'Full cleaning services'}],[{id:sink.id,label:sink.label}])});
 check('work-order visit accepted',orderAccepted.status,'closed');
 const orderTicket=evidence(orderVisit).linked_completion_tickets[0].ticket_id;
 sql(`set role service_role;select public.custodial_set_maintenance_ticket_outcome(${q(orderTicket)},'work_order_sent',${q(manager)},'SYNTHETIC-WO-1','Synthetic outside order',${q(secret)});`);
 check('work order sent remains follow-up',evidence(orderVisit).classification,'cleaned_follow_up_required');
 const checkVisit=startVisit(),checked=complete(checkVisit,{...twoIssues,work_result:'checked_no_cleaning_needed',services_performed:[],taxonomy:metadata([],[{id:sink.id,label:sink.label},{id:floor.id,label:floor.label}])});
 check('native check-only accepted',checked.status,'closed');check('check-only not promoted to clean',evidence(checkVisit).classification,'checked_only');
 const falseIssueVisit=startVisit(),falseIssue=complete(falseIssueVisit,{...twoIssues,attention_needed:false});
 check('contradictory false attention native answer retained',falseIssue.status,'closed');check('positive issues override false flag',evidence(falseIssueVisit).issue_reported,true);
 const canary='KIOSK_08';
 const pause=JSON.parse(sql(`set role service_role;select public.custodial_control_release_canary(${q(manager)},${q(randomUUID())},${q(canary)},'pause_canary','synthetic taxonomy restore proof','{"ok":false,"scope":"completion-taxonomy"}'::jsonb,${q(secret)});`));
 check('synthetic canary paused for restore',pause.canary_paused,true);
 const restored=JSON.parse(sql(`set role service_role;select public.custodial_control_release_canary(${q(manager)},${q(randomUUID())},${q(canary)},'restore_authority','synthetic taxonomy exact restore','{"ok":false,"scope":"completion-taxonomy"}'::jsonb,${q(secret)});`));
 assert.ok(restored.restored_objects>40);checks++;console.log('PASS complete authority restore executed',restored.restored_objects);
 const grantIdentity='public.custodial_manager_completion_evidence(uuid,text,text)';
 const grantDefinition=sql(`select definition_sql from public.custodial_release_authority_restore_inventory where object_kind='grant' and to_regprocedure(object_identity)=${q(grantIdentity)}::regprocedure;`);
 sql(`revoke execute on function ${grantIdentity} from service_role;`);
 reject('scoped reader grant drift denies service',`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1',${q(secret)});`,/permission denied/);
 sql(grantDefinition);
 check('scoped exact reader grant restored',JSON.parse(sql(`set role service_role;select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1',${q(secret)});`)).original_response,legacy);
 const guardDefinition=sql("select definition_sql from public.custodial_release_authority_restore_inventory where object_kind='trigger' and object_identity='public.completion_responses.custodial_completion_taxonomy_response_guard';");
 sql('drop trigger custodial_completion_taxonomy_response_guard on public.completion_responses;');
 sql(guardDefinition);
 check('scoped taxonomy guard restored always-on',sql("select tgenabled from pg_trigger where tgrelid='public.completion_responses'::regclass and tgname='custodial_completion_taxonomy_response_guard';"),'A');
 const invalid=structuredClone(base);invalid.taxonomy.digest='0'.repeat(64);
 reject('restored guard rejects tampered metadata',`update public.completion_responses set response_json=${j(invalid)} where id=${q(responseId)};`,/completion taxonomy/);
 reject('scoped restore keeps table private',"set role service_role;select * from public.custodial_completion_taxonomy_versions;",/permission denied/);
 reject('scoped restore keeps anonymous RPC denied',`set role anon;select public.custodial_manager_completion_evidence(${q(manager)},'taxonomy-session-1',${q(secret)});`,/permission denied/);
 console.log('GLOBAL_RESTORE_STATUS','PASS');
 console.log('PASS_COUNT',checks);
}finally{cleanup()}
