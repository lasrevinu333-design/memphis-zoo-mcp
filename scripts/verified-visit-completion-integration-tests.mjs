import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
// Synthetic native-route inputs in an isolated database; never field NFC proof.
const container=process.env.VERIFIED_VISIT_TEST_CONTAINER;
assert.match(container??'',/^mz_verified_visit_[0-9]+$/);
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
const q=value=>`'${String(value??'').replaceAll("'","''")}'`;
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-q',
 '-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres'],
 {input:text,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}).trim().split('\n').at(-1);}
let passed=0;
function check(name,actual,expected){assert.deepEqual(actual,expected,name);passed++;}
function reject(name,text,pattern){assert.throws(()=>sql(text),pattern,name);passed++;}
const id={employee:randomUUID(),device:randomUUID(),credential:randomUUID(),location:randomUUID()};
const suffix=randomUUID().slice(0,8).toUpperCase();
const deviceCode=`VISIT-TEST-${suffix}`,locationCode=`VT${suffix}`;
const secret='isolated-visit-execution-secret-012345678901234';
const routeSecret='isolated-visit-native-route-secret-0123456789';
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>`${q(JSON.stringify(value))}::jsonb`;
const iso=value=>new Date(value).toISOString();
sql(`select public.custodial_configure_backend_execution_key(${q(hash(secret))},'isolated-visit-test');
select public.custodial_configure_native_route_proof_key(${q(hash(routeSecret))},'isolated-visit-test');
insert into public.employees(id,employee_code,display_name,active,role)
values(${q(id.employee)},${q(`VE${suffix}`)},'Synthetic Visit Employee',true,'staff');
insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
values(${q(id.device)},${q(deviceCode)},'Synthetic Visit Device',true,${q(id.employee)});
insert into public.locations(id,location_code,location_name,location_type,form_type,active)
values(${q(id.location)},${q(locationCode)},'Synthetic Visit Restroom','restroom','restroom',true);
insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
values(${q(id.credential)},${q(id.device)},${q(hash(suffix))},now(),now()+interval '1 day');
insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,
 new_employee_id,new_employee_name,change_reason,source)
values(${q(id.device)},${q(deviceCode)},${q(id.employee)},'Synthetic Visit Employee','test fixture','test');`);
const snapshot=JSON.parse(sql(`select public.tool_get_offline_scan_authority_snapshot(
 ${q(deviceCode)},${q(id.credential)},${q(secret)})::text;`));
let nextTime=Date.parse(snapshot.generated_at)+1;
function startVisit(){
 const session=randomUUID(),start=iso(nextTime++),finish=iso(nextTime++),scan=randomUUID();
 const context=JSON.parse(sql(`select public.tool_start_offline_occurrence(
 ${q(deviceCode)},${q(locationCode)},${q(session)},${q(start)},${q(snapshot.snapshot_id)},
 ${q(snapshot.employee_id)},${snapshot.assignment_epoch},${q(id.credential)},${q(id.credential)},
 ${q(scan)},'custodial-native-start.v1',${q('a'.repeat(64))},${q(routeSecret)},${q(secret)})::text;`));
 return {session,start,finish,scan,finishScan:randomUUID(),completion:randomUUID(),context};
}
function completeSql(visit,response,options={}){
 const finishScan=options.finishScan??visit.finishScan;
 const scans=options.scans??[{client_event_id:finishScan,event_type:'scan_finish',result:'ok',
  notes:'SYNTHETIC INTEGRATION FIXTURE',scanned_at:visit.finish,payload_json:{entry_source:'native-nfc'}}];
 return `select public.tool_commit_cleaning_workflow_authoritative(
 ${q(visit.session)},${q(visit.completion)},${q(deviceCode)},${q(locationCode)},${q(visit.start)},${q(visit.finish)},
 ${json(response)},${json(scans)},'synthetic-visit-integration',${q(visit.context.context_id)},
 ${q(visit.context.submission_proof)},${q(id.credential)},${q(finishScan)},
 'custodial-native-completion.v2',${q('b'.repeat(64))},${q(routeSecret)},${q(secret)})::text;`;
}
const status=()=>JSON.parse(sql(`select json_build_object(
 'cleaned',public.custodial_canonical_utc_millis(latest_completed_at),
 'checked',public.custodial_canonical_utc_millis(latest_checked_at),
 'status',status_code,'services',services_performed) from public.v_location_dashboard_status
 where location_id=${q(id.location)}::uuid;`));
if(process.argv.includes('--seed-pre-cutover-legacy')){
 const visit=startVisit(),response={services_performed:['Sweep the floor'],note:'Exact pre-cutover saved answers'};
 const statement=completeSql(visit,response),accepted=JSON.parse(sql(statement));
 assert.equal(accepted.status,'closed');
 const fresh=startVisit();
 const fixture={visit,response,statement,location:id.location,accepted,
  freshStatement:completeSql(fresh,response),
  forgedStatement:completeSql(fresh,{...response,legacy:true,created_at:'2020-01-01',schema_version:1}),
  tamperedStatement:completeSql(visit,{...response,note:'changed'}),
  bytes:sql(`select to_jsonb(cr)::text from public.completion_responses cr where client_completion_id=${q(visit.completion)}`),
  dashboard:status()};
 console.log(JSON.stringify(fixture));process.exit(0);
}
const checkOnly={work_result:'checked_no_cleaning_needed',services_performed:[]};
const cleaning={work_result:'full',services_performed:['Full cleaning services']};
const preclean=startVisit();
check('native start alone does not establish a cleaning',status().cleaned,null);
check('check-only completion accepted',JSON.parse(sql(completeSql(preclean,checkOnly))).status,'closed');
check('check-only does not fabricate first cleaning',status().cleaned,null);
check('completed check visible as last checked',status().checked,preclean.finish);
check('no recurring reminder before actual first cleaning',Number(sql(`select count(*) from
 public.mz_location_reminder_candidates(public.sch_service_date(now()),now())
 where location_id=${q(id.location)}::uuid`)),0);
const cleaned=startVisit();
check('actual cleaning accepted',JSON.parse(sql(completeSql(cleaned,cleaning))).status,'closed');
check('actual last cleaned updated',status().cleaned,cleaned.finish);
const serviceDate=sql('select public.sch_service_date(now())::text;');
function reminder(when){return JSON.parse(sql(`select coalesce(json_agg(row_to_json(candidate)),'[]')::text
 from public.mz_location_reminder_candidates(${q(serviceDate)}::date,${q(when)}::timestamptz) candidate
 where location_id=${q(id.location)}::uuid;`));}
const oldOverdue=iso(Date.parse(cleaned.finish)+90*60000);
check('first overdue candidate',reminder(oldOverdue)[0]?.status_code,'overdue');
const pending=startVisit();
check('scan-in preserves last completed visit',status().checked,cleaned.finish);
check('scan-in alone leaves reminder overdue',reminder(oldOverdue)[0]?.status_code,'overdue');
reject('empty finish evidence rejected',completeSql(pending,checkOnly,{scans:[]}),/physical NFC finish scan/i);
reject('different same-tag finish identity rejected',completeSql(pending,checkOnly,{finishScan:pending.scan}),/different|finish|start/i);
reject('fake services in check rejected',completeSql(pending,{...checkOnly,services_performed:['Floor']}),/check-only outcome cannot claim/i);
reject('unknown completion outcome rejected',completeSql(pending,{work_result:'invented',services_performed:['Floor']}),/unsupported completion outcome/i);
check('invalid attempts did not clear overdue',reminder(oldOverdue)[0]?.status_code,'overdue');
const statement=completeSql(pending,checkOnly);
const completed=JSON.parse(sql(statement));
check('protected check completed',completed.status,'closed');
check('actual cleaning time preserved after check',status().cleaned,cleaned.finish);
check('last checked advances to checkout',status().checked,pending.finish);
check('cleaning services are not replaced with check',status().services,['Full cleaning services']);
check('old overdue replaced by new visit cycle',reminder(oldOverdue)[0]?.status_code,'due_soon');
assert.equal(typeof completed.session_uuid,'string');
check('completion replay returns same session',JSON.parse(sql(statement)).session_uuid,completed.session_uuid);
check('replay did not duplicate closed session',Number(sql(`select count(*) from public.sessions
 where client_session_id=${q(pending.session)} and status='closed'`)),1);
check('replay did not duplicate response',Number(sql(`select count(*) from public.completion_responses
 where client_completion_id=${q(pending.completion)}`)),1);
const nextOverdue=Date.parse(pending.finish)+90*60000;
const repeated=[0,5,10].map(minutes=>reminder(iso(nextOverdue+minutes*60000))[0]);
check('all subsequent unresolved reminders remain overdue',repeated.map(row=>row.status_code),['overdue','overdue','overdue']);
check('repeated reminders have distinct identities',new Set(repeated.map(row=>row.notification_key)).size,3);
sql(`select public.ack_device_notification(${q(deviceCode)},${q(repeated[0].notification_key)},
 'location_status','dismissed','{}'::jsonb);`);
check('dismissal cannot resolve overdue',reminder(iso(nextOverdue+5*60000))[0]?.status_code,'overdue');
check('dismissal cannot change last checked',status().checked,pending.finish);
// Exercise the real queue against an explicitly synthetic ungoverned assignment.
// This is not static-publication, lunch-allocation, or provider-delivery acceptance.
check('queue fixture is ungoverned',sql(`select governed::text from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date)`),'false');
const group=randomUUID(),token=`synthetic-fcm-${randomUUID()}`;
sql(`insert into public.location_groups(id,group_code,group_name,active)
 values(${q(group)},${q(`VG${suffix}`)},'Synthetic Restroom Family',true);
 insert into public.location_group_memberships(location_id,location_group_id,active)
 values(${q(id.location)},${q(group)},true);
 insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,active)
 values(${q(serviceDate)},${q(id.employee)},'04:00','23:59','synthetic-test',true);
 insert into public.daily_schedule_assignments(service_date,location_group_id,segment_number,
 assigned_employee_id,owner_type,coverage_start,coverage_end,status,load_points,source_type,coverage_purpose)
 values(${q(serviceDate)},${q(group)},1,${q(id.employee)},'EMPLOYEE','04:00','23:59','ASSIGNED',1,'synthetic-test','area_owner');
 select public.mz_register_employee_push(${q(id.credential)},${q(token)},${q(hash(token))},'android','test','test');`);
function enqueue(when){return JSON.parse(sql(`select public.mz_enqueue_employee_location_pushes(${q(when)}::timestamptz)::text`));}
const queueCount=()=>Number(sql(`select count(*) from public.operational_notification_jobs
 where payload_json->>'credential_id'=${q(id.credential)} and job_type='employee_native_push'`));
const queueTime=nextOverdue+10*60000;
check('unresolved overdue enqueues one job',enqueue(iso(queueTime)).enqueued,1);
check('same repeat retried does not duplicate',enqueue(iso(queueTime)).enqueued,0);
check('one queue record exists',queueCount(),1);
const key=reminder(iso(queueTime))[0].notification_key;
sql(`select public.ack_device_notification(${q(deviceCode)},${q(key)},'location_status','dismissed','{}'::jsonb)`);
check('dismissed repeat stays one record',enqueue(iso(queueTime)).enqueued,0);
check('next five-minute repeat still enqueues',enqueue(iso(queueTime+5*60000)).enqueued,1);
check('two distinct overdue jobs exist',queueCount(),2);

// OC24: independent issue reporting must survive the entire authenticated
// completion/persistence route for all outcomes, including no-cleaning checks.
for(const selection of [cleaning,{work_result:'details',services_performed:['Restock toilet paper']},checkOnly]){
 const visit=startVisit(),response={...selection,form_type:'restroom',maintenance_issues_found:['Sink leaking'],note:'Synthetic OC24 independent issue',out_of_order_signed:'Yes',out_of_order_details:'Sink one'};
 const before=status().cleaned;
 check('independent issue accepted with '+selection.work_result,JSON.parse(sql(completeSql(visit,response))).status,'closed');
 const saved=JSON.parse(sql(`select response_json from public.completion_responses where client_completion_id=${q(visit.completion)}`));
 for(const field of ['work_result','services_performed','maintenance_issues_found','note','out_of_order_signed','out_of_order_details'])check('persisted '+field+' for '+selection.work_result,saved[field],response[field]);
 check('truthful cleaned time for '+selection.work_result,status().cleaned,selection.work_result==='checked_no_cleaning_needed'?before:visit.finish);
}

// CB02: challenge the actual native-route precheck and final persisted answers.
const whitespaceVisit=startVisit(),cleanedBeforeWhitespace=status().cleaned;
for(const code of [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]){
 const ws=String.fromCodePoint(code);
 for(const services of [[ws],[ws+'Full cleaning services'+ws],[ws+'Full cleaning services'+ws,'Sweep the floor']])
  reject('SQL precheck rejects selective whitespace/alias U+'+code.toString(16),completeSql(whitespaceVisit,{work_result:'details',services_performed:services}),/selective cleaning/);
}
for(const service of [null,0,false,{},[]])reject('SQL precheck rejects nonstring service '+JSON.stringify(service),completeSql(whitespaceVisit,{work_result:'details',services_performed:[service]}),/selective cleaning/);
check('rejected whitespace does not advance last-cleaned',status().cleaned,cleanedBeforeWhitespace);
check('rejected whitespace does not insert completion',Number(sql(`select count(*) from public.completion_responses where client_completion_id=${q(whitespaceVisit.completion)}`)),0);
const wrappedFull={work_result:'full',services_performed:['\tFull cleaning services\u00a0']};
check('JS-valid wrapped full accepted',JSON.parse(sql(completeSql(whitespaceVisit,wrappedFull))).status,'closed');
check('wrapped full preserved exactly not normalized on write',JSON.parse(sql(`select response_json from public.completion_responses where client_completion_id=${q(whitespaceVisit.completion)}`)),wrappedFull);
check('wrapped full replay same operation',JSON.parse(sql(completeSql(whitespaceVisit,wrappedFull))).replayed,true);
const result={passed,failed:0,fixture:'synthetic native-route/database integration',
 physical_nfc_verified:false,provider_delivery_verified:false};
console.log(JSON.stringify(result,null,2));
