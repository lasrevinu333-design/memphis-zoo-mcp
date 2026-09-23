import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {consolidateScheduleItems} from '../src/schedule-display.js';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
const container=process.env.LUNCH_PUBLICATION_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_rebuild_lunch_[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const j=value=>`${q(JSON.stringify(value))}::jsonb`;
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1',
 '-U','supabase_admin','-d','postgres'],{input:text,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});}
const query=text=>sql(text).trim().split('\n').at(-1);
const parsed=text=>JSON.parse(query(text));
const manager=randomUUID(),serviceDate=process.env.LUNCH_PUBLICATION_TEST_DATE||'2026-09-21';
assert.match(serviceDate,/^\d{4}-\d{2}-\d{2}$/);
const serviceDay=new Date(`${serviceDate}T12:00:00Z`),dayOfWeek=serviceDay.getUTCDay();
const weekStartDate=new Date(serviceDay);weekStartDate.setUTCDate(weekStartDate.getUTCDate()-((dayOfWeek+6)%7));
const week=weekStartDate.toISOString().slice(0,10),nextDay=new Date(serviceDay.getTime()+86400000).toISOString().slice(0,10);
const nextWeek=new Date(weekStartDate.getTime()+7*86400000).toISOString().slice(0,10);
const slots=['a','b','c','d'].map((key,i)=>({key,id:randomUUID(),person:randomUUID(),name:`Synthetic lunch ${i}`}));
const codes=['W','E','B','B2','C','C2','D','D2'];
const locations=Object.fromEntries(codes.map(code=>[code,{id:randomUUID(),group:randomUUID(),code:`LUNCH_${code}`} ]));
const ownerCodes=[['W','E'],['B','B2'],['C','C2'],['D','D2']];
const lunches=[['12:00','13:00'],['12:30','13:30'],['10:00','11:00'],['14:00','15:00']];
sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic lunch manager');`);
for(const slot of slots)sql(`insert into public.employees(id,display_name,role) values(${q(slot.person)},${q(slot.name)},'staff');`);
for(const location of Object.values(locations))sql(`insert into public.locations(id,location_code,location_name,location_type,form_type)
 values(${q(location.id)},${q(location.code)},${q(location.code)},'restroom','restroom');
 insert into public.location_groups(id,group_code,group_name) values(${q(location.group)},${q(location.code)},${q(location.code)});
 insert into public.location_group_memberships(location_group_id,location_id) values(${q(location.group)},${q(location.id)});`);
const source={serviceDate:week,timezone:'America/Chicago',exceptions:[],
 slots:slots.map(s=>({id:s.id,label:s.name,incumbencies:[{personId:s.person,displayName:s.name,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
 proximity:codes.flatMap(from=>codes.filter(to=>from!==to).map(to=>({from:locations[from].id,to:locations[to].id,
  minutes:(from==='B'&&to==='W')||(from==='C'&&to==='E')?1:10,verified:true,provenance:'synthetic geometry'}))),
 versions:[{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:week,effectiveEnd:null,
 objective:{requireVerifiedProximity:true},slotAvailability:slots.map((s,i)=>({slotId:s.id,dayOfWeek,status:'working',
 shift:{start:'07:00',end:'17:00'},lunch:{start:lunches[i][0],end:lunches[i][1]},
 productiveCapacityProvenance:'fixture-shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'fixture-capacity',
 qualifications:['general'],qualificationProvenance:'fixture-role',restrictions:[],restrictionProvenance:'fixture-restrictions',
 acceptedRouteAnchorLocationId:locations[ownerCodes[i][0]].id,acceptedRouteProvenance:'fixture-normal-area'})),
 assignments:slots.flatMap((s,i)=>ownerCodes[i].map(code=>({workId:code,dayOfWeek,ownerSlotId:s.id,
 locationId:locations[code].id,locationCodeSnapshot:locations[code].code,locationNameSnapshot:locations[code].code,
 includedLocations:[{locationId:locations[code].id,locationNameSnapshot:locations[code].code}],
 schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:'16:00'},serviceEffortMinutes:20,
 serviceEffortProvenance:'fixture-effort',priority:2,priorityProvenance:'fixture-priority',requiredQualifications:['general'],
 qualificationProvenance:'fixture-work-role',restrictions:[],restrictionProvenance:'fixture-work-restrictions'})))}]};
const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[serviceDate],source,label:'lunch-publication-test',mode:'official'});
const projectionId=fixture.projectionIds[week],result=fixture.compiledByWeek[week];
const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result,publicationId:fixture.publicationId,expectedRevision:0,
 actor:{managerId:manager,managerName:'Synthetic lunch manager',idempotencyKey:'synthetic-lunch'}});
const document=prepared.lunchDocument;let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++;};
const reject=(name,statement,pattern)=>{assert.throws(()=>sql(statement),pattern,name);passed++;};
const persist=(value=document,id=projectionId,actor=manager)=>`set role static_weekly_control_plane; select public.static_weekly_v8_materialize_lunch_document(${q(id)}::uuid,${j(value)},${q(actor)}::uuid)::text;`;
const read=()=>parsed(`select public.static_weekly_v8_read_lunch_document(${q(serviceDate)}::date)::text;`);
const original=query(`select md5(jsonb_agg(to_jsonb(o) order by occurrence_id)::text) from public.weekly_schedule_occurrences o;`);
check('missing lunch is not falsely published',read().persistence_status,'MISSING');
const initial=parsed(persist());check('persist accepted',initial.persistence_status,'PERSISTED');
check('first write not replay',initial.replayed,false);
check('same document replay',parsed(persist()).replayed,true);
check('one immutable row',Number(query('select count(*) from public.weekly_schedule_lunch_documents;')),1);
check('current lunch read',read().document_identity,document.document_identity);
check('normal owners unchanged',query(`select md5(jsonb_agg(to_jsonb(o) order by occurrence_id)::text) from public.weekly_schedule_occurrences o;`),original);
const monday=read();check('every scheduled lunch represented',monday.loans.length,4);
check('two helpers per planned loan',monday.loans.filter(l=>l.status==='PLANNED').every(l=>l.helper_slot_ids.length===2),true);
check('read contains actual borrowed areas',monday.responsibilities.length>0,true);
const tuesday=parsed(`select public.static_weekly_v8_read_lunch_document(${q(nextDay)}::date)::text;`);
check('day filtering excludes Monday loans',tuesday.loans,[]);
function rehash(value){value.semantic_snapshot={schema:'memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
 loans_digest:digest(value.loans),responsibilities_digest:digest(value.responsibilities),notification_intents_digest:digest(value.notification_intents)};
 delete value.document_identity;value.document_identity=digest(value);return value;}
function invalid(name,mutate){const bad=structuredClone(document);mutate(bad);rehash(bad);
 reject(name,`set role static_weekly_control_plane; select public.static_weekly_v8_assert_lunch_document(${q(projectionId)}::uuid,${j(bad)});`,/ERROR/);}
invalid('wrong base projection',d=>{d.base_authority_digest='f'.repeat(64);});
invalid('missing scheduled lunch',d=>{d.loans.pop();});
invalid('longer lunch forbidden',d=>{d.loans[0].coverage_end='16:45';});
invalid('null status rejected',d=>{d.loans[0].status=null;});
invalid('omitted coverage cannot be disguised as no areas',d=>{
 const id=d.loans[0].loan_id;Object.assign(d.loans[0],{status:'NO_AREAS',helper_slot_ids:[],fallback:null});
 d.responsibilities=d.responsibilities.filter(r=>r.loan_id!==id);
 d.notification_intents=d.notification_intents.filter(n=>n.loan_id!==id);
});

invalid('same helper twice cannot satisfy two-custodian coverage',d=>{
 const loan=d.loans.find(l=>l.status==='PLANNED');const chosen=loan.helper_slot_ids[0];
 const person=d.responsibilities.find(r=>r.loan_id===loan.loan_id&&r.coverer_slot_id===chosen).coverer_person_id;
 loan.helper_slot_ids=[chosen,chosen];
 for(const row of d.responsibilities.filter(r=>r.loan_id===loan.loan_id)){
  row.coverer_slot_id=chosen;row.coverer_person_id=person;
 }
 for(const row of d.notification_intents.filter(r=>r.loan_id===loan.loan_id))row.coverer_slot_id=chosen;
});
invalid('different recipient rejected',d=>{d.responsibilities[0].coverer_person_id=randomUUID();});
invalid('changed borrowed area rejected',d=>{d.responsibilities[0].segments[0].includedLocations[0].locationId=randomUUID();});
invalid('changed borrowed window rejected',d=>{d.responsibilities[0].segments[0].window.end='17:00';});
invalid('deep cleaning not introduced',d=>{d.responsibilities[0].creates_deep_clean=true;});
invalid('missing end notification rejected',d=>{d.notification_intents.pop();});
invalid('fake delivery claim rejected',d=>{d.notification_intents[0].delivery_state='DELIVERED';});
invalid('duplicate responsibility rejected',d=>{d.responsibilities.push(structuredClone(d.responsibilities[0]));});
reject('public cannot publish',`set role anon; select public.static_weekly_v8_materialize_lunch_document(${q(projectionId)}::uuid,${j(document)},${q(manager)}::uuid);`,/permission denied/i);
reject('ordinary API cannot publish',`set role service_role; select public.static_weekly_v8_materialize_lunch_document(${q(projectionId)}::uuid,${j(document)},${q(manager)}::uuid);`,/permission denied/i);
reject('unknown manager cannot publish',persist(document,projectionId,randomUUID()),/manager/i);
reject('normal admin cannot silently become control plane',`select public.static_weekly_v8_materialize_lunch_document(${q(projectionId)}::uuid,${j(document)},${q(manager)}::uuid);`,/control_plane identity/i);
reject('immutable document cannot be changed',`update public.weekly_schedule_lunch_documents set document_identity=repeat('0',64);`,/append-only/i);
reject('immutable history cannot be deleted','delete from public.weekly_schedule_lunch_documents;',/append-only/i);
check('unrelated date does not reuse old coverage',parsed(`select public.static_weekly_v8_read_lunch_document(${q(nextWeek)}::date)::text;`).persistence_status,'UNAVAILABLE');
check('reader retains accepted source identity',read().document_identity,document.document_identity);
check('base ownership still byte-identical',query(`select md5(jsonb_agg(to_jsonb(o) order by occurrence_id)::text) from public.weekly_schedule_occurrences o;`),original);
check('canary covers lunch relation and functions',Number(query("select count(*) from public.custodial_release_canary_authority_surface() where object_identity like '%lunch_document%'")),4);
check('reader role can execute date-filtered read',query("select has_function_privilege('custodial_application_reader','public.static_weekly_v8_read_lunch_document(date)','EXECUTE')::text"),'true');
// Accepted-publication consumer checks; no provider/phone activity.
const offset=new Intl.DateTimeFormat('en',{timeZone:'America/Chicago',timeZoneName:'longOffset'}).formatToParts(serviceDay).find(p=>p.type==='timeZoneName').value.replace('GMT','');
const at=time=>`${serviceDate}T${time}:00${offset}`;
const employeeDay=(slot,time)=>parsed(`select public.static_weekly_v5_read_employee_day(
 ${q(serviceDate)}::date,${q(slot.person)}::uuid,${q(at(time))}::timestamptz)::text;`);
const firstLoan=document.loans.find(loan=>loan.normal_owner_slot_id===slots[0].id);
const firstResponsibilities=document.responsibilities.filter(r=>r.loan_id===firstLoan.loan_id);
const helper=slots.find(slot=>slot.id===firstResponsibilities[0].coverer_slot_id);
const helperDay=employeeDay(helper,'12:00');
check('employee schedule consumes accepted lunch publication',helperDay.lunch_coverage_status,'PERSISTED');
check('employee gets current lunch section',helperDay.current_items.some(item=>item.coverage_purpose==='lunch_coverage'),true);
check('all-day list retains planned lunch before start',employeeDay(helper,'11:59').all_items.some(item=>item.loan_id===firstLoan.loan_id),true);
check('lunch not active before exact start',employeeDay(helper,'11:59').current_items.some(item=>item.loan_id===firstLoan.loan_id),false);
check('that loan ends exactly on scheduled boundary',employeeDay(helper,'13:00').current_items.some(item=>item.loan_id===firstLoan.loan_id),false);
check('normal employee assignments stay in all-day list',helperDay.all_items.filter(item=>item.coverage_purpose!=='lunch_coverage').length,2);
check('caller cannot see another helpers borrowed area',helperDay.all_items.filter(item=>item.coverage_purpose==='lunch_coverage').every(item=>item.coverer_person_id===helper.person),true);
const currentOwners=(time)=>parsed(`select coalesce(jsonb_agg(jsonb_build_object('location',location_id,
 'employee',assigned_employee_id,'occurrence',occurrence_id) order by location_id),'[]')::text
 from public.custodial_operational_location_assignments(${q(serviceDate)}::date)
 where coverage_start<=${q(time)}::time and ${q(time)}::time<coverage_end;`);
const ownersBefore=currentOwners('11:59'),ownersAt=currentOwners('12:00'),ownersAfter=currentOwners('13:00');
for(const r of firstResponsibilities)for(const s of r.segments)for(const location of s.includedLocations){
 const before=ownersBefore.filter(row=>row.location===location.locationId);
 const during=ownersAt.filter(row=>row.location===location.locationId);
 const after=ownersAfter.filter(row=>row.location===location.locationId);
 check('one normal owner before lunch '+location.locationId,before.map(row=>row.employee),[slots[0].person]);
 check('one covering custodian during lunch '+location.locationId,during.map(row=>row.employee),[r.coverer_person_id]);
 check('normal owner restored at exact end '+location.locationId,after.map(row=>row.employee),[slots[0].person]);
 check('handoff retains original occurrence identity '+location.locationId,during[0].occurrence,before[0].occurrence);
}

const overlappingLoan=document.loans.find(loan=>loan.normal_owner_slot_id===slots[1].id);
check('overlapping loans shown independently',employeeDay(helper,'12:45').current_items.filter(item=>item.coverage_purpose==='lunch_coverage').some(item=>item.loan_id===firstLoan.loan_id)
 &&employeeDay(helper,'12:45').current_items.some(item=>item.loan_id===overlappingLoan.loan_id),true);
check('ending first loan does not end overlapping second loan',employeeDay(helper,'13:00').current_items.some(item=>item.loan_id===overlappingLoan.loan_id),true);
check('second loan ends on its own boundary',employeeDay(helper,'13:30').current_items.some(item=>item.loan_id===overlappingLoan.loan_id),false);
check('canonical normal owners are not replaced',Number(query(`select count(*) from public.static_weekly_v6_read_schedule_segments(${q(serviceDate)}::date) where assigned_employee_id=${q(slots[0].person)}::uuid`)),2);
for(const functionName of ['static_weekly_v8_read_lunch_segments(date)','custodial_operational_location_assignments(date)','static_weekly_v5_read_employee_day(date,uuid,timestamp with time zone)']){
 check('reader recovery definition '+functionName,Number(query(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity=${q(functionName)}`)),1);
 check('reader recovery grant '+functionName,Number(query(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity=${q(functionName)}`)),1);
}
const lunchDisplay=consolidateScheduleItems(helperDay.all_items).items.filter(item=>item.coverage_purpose==='lunch_coverage');
check('existing display retains every independent lunch source',lunchDisplay.length,helperDay.all_items.filter(item=>item.coverage_purpose==='lunch_coverage').length);
check('display never merges separate lunch loans',lunchDisplay.every(item=>item.source_rows===1),true);
check('no missing or duplicate physical responsibility at any minute',Number(query(`
 with responsibilities as materialized(select * from public.custodial_operational_location_assignments(${q(serviceDate)}::date)),
 counts as(select minute,count(a.location_id) as total,count(distinct a.location_id) as distinct_locations
 from generate_series(585,959) minute left join responsibilities a
 on a.coverage_start<=(time '00:00'+make_interval(mins=>minute)) and (time '00:00'+make_interval(mins=>minute))<a.coverage_end
 group by minute) select count(*) from counts where total<>8 or distinct_locations<>8;`)),0);

// Durable lunch start/end notification producer: database queue proof only, never provider/phone proof.
const pushDevice=randomUUID(),pushCredential=randomUUID(),pushRegistration=randomUUID();
sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
 values(${q(pushDevice)}::uuid,'LUNCH-PUSH-TEST','Lunch push test phone',true,${q(helper.person)}::uuid,1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,metadata_json,created_at,confirmed_at,last_used_at,expires_at)
 values(${q(pushCredential)}::uuid,${q(pushDevice)}::uuid,repeat('a',64),'Lunch push test phone','{}'::jsonb,now(),now(),now(),now()+interval '1 day');
 insert into public.employee_push_registrations(registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash,active)
 values(${q(pushRegistration)}::uuid,${q(pushDevice)}::uuid,${q(pushCredential)}::uuid,${q(helper.person)}::uuid,1,'android','lunch-push-test-${'x'.repeat(40)}',repeat('b',64),true);`);
const expectedHelperIntents=document.notification_intents.filter(n=>n.coverer_slot_id===helper.id).length;
const producerEarly=parsed(`select public.mz_enqueue_employee_lunch_coverage_pushes(${q(at('09:00'))}::timestamptz)::text;`);
check('producer queues every accepted helper start/end intent',producerEarly.enqueued,expectedHelperIntents);
check('producer queue is credential-bound',Number(query(`select count(*) from public.operational_notification_jobs where job_type='employee_native_push' and payload_json->>'credential_id'=${q(pushCredential)} and payload_json->'data_json'->>'kind'='employee_lunch_coverage';`)),expectedHelperIntents);
check('producer keeps exact scheduled availability',Number(query(`select count(*) from public.operational_notification_jobs where payload_json->>'credential_id'=${q(pushCredential)} and payload_json->'data_json'->>'kind'='employee_lunch_coverage' and available_at<>(((payload_json->'data_json'->>'service_date')::date+(payload_json->'data_json'->>'scheduled_time')::time) at time zone 'America/Chicago');`)),0);
check('producer replay is idempotent',parsed(`select public.mz_enqueue_employee_lunch_coverage_pushes(${q(at('09:00'))}::timestamptz)::text;`).enqueued,0);
check('queueing never claims provider delivery',Number(query(`select count(*) from public.employee_native_push_delivery_receipts r join public.operational_notification_jobs j on j.job_id=r.job_id where j.payload_json->'data_json'->>'kind'='employee_lunch_coverage';`)),0);
const missingIntent=document.notification_intents.find(n=>n.coverer_slot_id!==helper.id);
check('fixture has an unregistered accepted lunch recipient',Boolean(missingIntent),true);
const missingDue=parsed(`select public.mz_enqueue_employee_lunch_coverage_pushes(${q(at(missingIntent.scheduled_time))}::timestamptz)::text;`);
check('due missing recipient becomes a truthful dead delivery job',Number(query(`select count(*) from public.operational_notification_jobs where job_key=${q(`employee-lunch-push:${missingIntent.notification_key}:recipient-unavailable`)} and status='dead' and payload_json->'data_json'->>'recipient_status'='unavailable';`)),1);
check('missing recipient does not claim provider send',Number(query(`select count(*) from public.employee_native_push_delivery_receipts r join public.operational_notification_jobs j on j.job_id=r.job_id where j.job_key=${q(`employee-lunch-push:${missingIntent.notification_key}:recipient-unavailable`)};`)),0);
check('producer is on release canary surface',Number(query(`select count(*) from public.custodial_release_canary_authority_surface() where object_identity='mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)'`)),1);
check('producer recovery function binding',Number(query(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity='mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)'`)),1);
check('producer recovery grant binding',Number(query(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity='mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)'`)),1);

const priorDocument=structuredClone(document);
await fixture.applyException({exceptionType:'lunch',serviceDate,startsAt:'11:30',endsAt:'12:30',reason:'Synthetic scheduled lunch change',
 payload:{slotId:slots[0].id}});
check('a new projection never reuses old lunch coverage',read().persistence_status,'MISSING');
reject('employee cannot silently omit missing current lunch',`select public.static_weekly_v5_read_employee_day(${q(serviceDate)}::date,${q(helper.person)}::uuid,${q(at('12:00'))}::timestamptz);`,/current lunch coverage is unavailable/i);
reject('reminder responsibility cannot fall back to old lunch',`select * from public.custodial_operational_location_assignments(${q(serviceDate)}::date);`,/current lunch coverage is unavailable/i);
reject('old projection cannot be republished as current',persist(priorDocument),/not current/i);
check('old accepted lunch document retained as history',Number(query('select count(*) from public.weekly_schedule_lunch_documents;')),1);
const changedResult=fixture.compiledByWeek[week];
const changedDocument=createStaticWeeklyProjectionWithLunchRpcInput({result:changedResult,
 publicationId:fixture.publicationId,expectedRevision:0,
 actor:{managerId:manager,managerName:'Synthetic lunch manager',idempotencyKey:'changed-lunch'}}).lunchDocument;
check('changed published lunch receives its own document',parsed(persist(changedDocument,fixture.projectionIds[week])).persistence_status,'PERSISTED');
check('new read selects new identity',read().document_identity,changedDocument.document_identity);
check('both immutable publications retained',Number(query('select count(*) from public.weekly_schedule_lunch_documents;')),2);

console.log(JSON.stringify({passed,failed:0,fixture:'official registered-source publication and lunch persistence',
 normal_ownership_preserved:true,provider_sent:false,physical_verification:false},null,2));
