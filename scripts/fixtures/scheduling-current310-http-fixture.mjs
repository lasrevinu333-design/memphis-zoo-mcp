// Local qualification only. Borrows one exact current310 database from the
// constructor; never selects a URL/container, changes grants, or owns cleanup.
// The Supabase-shaped port changes transport only: its auth reads and restore
// RPCs execute as service_role. Runtime, store, auth, and schedule SQL are normal.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import {createHash,randomBytes,randomUUID,randomInt} from 'node:crypto';
import {types} from 'node:util';
import pg from 'pg';
import {readApprovedManualWeek} from '../../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../../src/approved-manual-source-draft.js';
import {readOwnerConfirmedEmploymentAdmissionData,prepareApprovedManualEmploymentAdmission,
 prepareApprovedManualEmploymentAvailability} from '../../src/approved-manual-employment-admission.js';
import {prepareApprovedStaticTemplateProjection} from '../../src/static-weekly-recurring-staffing-adaptation.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../../src/static-weekly-schedule-model.js';
import {createOpsManagerSession,installSharedAuthRoutes} from '../../src/auth/shared-access-auth.js';
import {createCustodialLeadershipPinVerifier,CUSTODIAL_LEADERSHIP_APPROVED_ACCOUNTS,CUSTODIAL_LEADERSHIP_COOKIE_NAMES} from '../../src/custodial-leadership-pin.js';
import {createStaticWeeklyControlPlaneRuntime} from '../../src/static-weekly-control-plane-runtime.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
const jsonValue=x=>JSON.parse(JSON.stringify(x));
const addDays=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
function realChicagoDate(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function loopbackOrigin(value){
 const u=new URL(value);assert.ok(u.protocol==='https:'&&['127.0.0.1','localhost'].includes(u.hostname)
  &&u.port&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash,'Exact loopback frontend origin required');
 return u.origin;
}

// Call only inside the exact descriptor-admitted consumer. Returned session is
// intentionally memory-only; do not serialize this object or attach auth bodies.
export async function setupCurrentOwnedSchedulerBrowser({fixture,frontendOrigin,tls,deadlineAt=performance.now()+170000}){
 const started=performance.now();
 assert.ok(fixture?.assertOwned&&fixture.pgClientConfig?.stream);
 assert.equal(fixture.receipt?.schema,'custodial.current310-local-ci-borrow.v1');
 assert.equal(fixture.receipt.source_profile.migration_count,310);
 assert.equal(fixture.receipt.production,false);assert.equal(fixture.receipt.release_admission,false);
 assert.equal(fixture.receipt.no_api_table_sequence_defaults,true);
 assert.ok(Number.isFinite(deadlineAt)&&deadlineAt>started&&deadlineAt-started<180000);
 frontendOrigin=loopbackOrigin(frontendOrigin);
 assert.ok(Buffer.isBuffer(tls?.key)&&Buffer.isBuffer(tls?.cert),'Parent-owned ephemeral localhost TLS key/certificate buffers required');
 await fixture.assertOwned();
 const remaining=()=>{const ms=Math.floor(deadlineAt-performance.now());assert.ok(ms>0,'Current browser fixture deadline elapsed; no retry');return ms;};
 const pool=new pg.Pool({...fixture.pgClientConfig,database:'postgres',user:'supabase_admin',max:3,
  connectionTimeoutMillis:5000,statement_timeout:120000});
 const connectionErrors=[],activeLeases=new Set(),allLeases=new Set(),rpcTrace=[],httpTrace=[];
 let runtime,server,closed=false,credentialReads=0,managerReads=0,phase='setup',baseline=null,baselineSql=null;
 const connectionError=e=>connectionErrors.push({code:e?.code??null,message:'Owned SQL connection failed'});
 pool.on('error',connectionError);pool.on('connect',c=>c.on('error',connectionError));
 const database={connect:async()=>{remaining();await fixture.assertOwned();return pool.connect();}};
 async function transaction(role,work,{readOnly=false,rest=false}={}){
  assert.ok(['supabase_admin','static_weekly_release_operator','static_weekly_control_plane','service_role'].includes(role));
  const c=await database.connect();let begun=false;
  try{await c.query(readOnly?'begin read only':'begin');begun=true;await c.query('set local role '+role);
   await c.query("select set_config('statement_timeout',$1,true)",[String(Math.min(rest?4000:120000,remaining()))]);
   const result=await work(c);await c.query('commit');begun=false;return result;
  }finally{if(begun)await c.query('rollback').catch(connectionError);c.release();}
 }
 const query=(sql,args=[])=>transaction('supabase_admin',c=>c.query(sql,args));
 const readonly=(sql,args=[])=>transaction('supabase_admin',c=>c.query(sql,args),{readOnly:true});
 const sqlRpc=(role,name,args=[])=>{
  assert.match(name,/^[a-z][a-z0-9_]+$/);
  return transaction(role,async c=>(await c.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value);
 };
 const permitted={
  ops_manager_trusted_devices:{key:'credential_id',columns:'credential_id,device_id,device_label,token_hash,max_access_level,manager_id,platform_summary,metadata_json,created_at,last_used_at,expires_at,revoked_at,revoked_reason'},
  ops_manager_managers:{key:'manager_id',columns:'manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at,system_key,is_system_principal'},
 };
 const leaseKeys={custodial_begin_application_mutation_lease:['p_request_id','p_service_name'],
  custodial_heartbeat_application_mutation_lease:['p_request_id'],custodial_release_application_mutation_lease:['p_request_id']};
 const supabase={
  from(table){assert.ok(Object.hasOwn(permitted,table),'No additional auth table admitted');let columns,key,value;
   const b={select(s){assert.equal(s,permitted[table].columns);columns=s;return b;},
    eq(k,v){assert.equal(k,permitted[table].key);key=k;value=v;return b;},
    async maybeSingle(){try{assert.ok(columns&&key);
     const rows=await transaction('service_role',c=>c.query('select '+columns+' from public.'+table+' where '+key+'=$1',[value]),{readOnly:true,rest:true});
     assert.ok(rows.rows.length<=1);if(table==='ops_manager_trusted_devices')credentialReads++;else managerReads++;
     return {data:rows.rows[0]?jsonValue(rows.rows[0]):null,error:null};
    }catch(error){return {data:null,error};}}};return b;
  },
  async rpc(name,args){try{assert.ok(Object.hasOwn(leaseKeys,name),'Only actual restore RPC transport is admitted');
   const keys=leaseKeys[name];assert.deepEqual(Object.keys(args).sort(),keys.slice().sort());
   const result=await transaction('service_role',c=>c.query('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') AS data',keys.map(k=>args[k])),{rest:true});
   const value=result.rows[0]?.data;
   if(name==='custodial_begin_application_mutation_lease'){assert.equal(value?.request_id,args.p_request_id);activeLeases.add(args.p_request_id);allLeases.add(args.p_request_id);}
   if(name==='custodial_release_application_mutation_lease'){assert.equal(value,true);activeLeases.delete(args.p_request_id);}
   rpcTrace.push(name);return {data:value,error:null};
  }catch(error){return {data:null,error};}},
 };
 async function leaseEvidence(){
  const r=await readonly('select count(*)::int AS n from custodial_dr.application_mutation_leases where request_id=any($1::uuid[])',[[...allLeases]]);
  assert.equal(activeLeases.size,0,'Original request restore lease not settled');assert.equal(r.rows[0].n,0,'Original SQL lease still present');
  return {leaseCount:allLeases.size,activeLeases:0,sqlLeaseRows:0};
 }
 const snapshotFields=['authority_revision','current_publication','assignments','availability','exceptions','latest_projection','canonical_staffing_absences'];
 const projectSnapshot=s=>Object.fromEntries(snapshotFields.map(k=>[k,s[k]??null]));
 async function sqlScheduleFingerprint(){
  const tables=['weekly_schedule_versions','weekly_schedule_publications','weekly_schedule_compiled_projections',
   'weekly_schedule_projection_assignments','weekly_schedule_lunch_documents','weekly_schedule_exception_commands',
   'static_weekly_staffing_absences','static_weekly_staffing_absence_cancellations'];
  const data={};
  for(const table of tables){const r=await readonly('select count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,\'\' order by to_jsonb(t)::text),\'\')) AS digest from public.'+table+' AS t');data[table]=r.rows[0];}
  return data;
 }
 async function close(){
  if(closed)return;closed=true;const failures=[];
  if(server)try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}catch(e){failures.push(e);}
  if(runtime?.controlPlane?.close)try{await runtime.controlPlane.close();}catch(e){failures.push(e);}
  try{await pool.end();}catch(e){failures.push(e);}
  // Parent alone settles the borrowed fixture and destroys its exact database.
  if(failures.length)throw new AggregateError(failures,'Current browser fixture local close incomplete');
 }
 try{
  installStaticWeeklySha256HexAccelerator(x=>hash(x),{schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,
   create(){const h=createHash('sha256');return{writeUtf8:x=>h.update(x),finishHex:()=>h.digest('hex')};}});
  const today=realChicagoDate(),dow=new Date(today+'T12:00:00Z').getUTCDay(),week=addDays(today,(8-dow)%7);
  assert.ok(week>=today);
  const sqlDate=(await readonly('select public.sch_service_date(statement_timestamp())::text AS current_day')).rows[0].current_day;
  assert.equal(sqlDate,today,'Application and actual SQL Chicago date differ');
  const existing=(await readonly('select (select count(*)::int from public.weekly_schedule_publications) AS publications,(select count(*)::int from public.static_weekly_staffing_commands) AS commands')).rows[0];
  assert.deepEqual(existing,{publications:0,commands:0},'Fresh owned scheduler data required; no existing original may be reused');
  const owners=(await readonly("select manager_id,display_name,roles,active,revoked_at,system_key,is_system_principal from public.ops_manager_managers where system_key='eric_custodial_manager'")).rows;
  assert.equal(owners.length,1,'Current seeded owner registry row required; no fixture owner promotion');const manager=owners[0];
  assert.equal(manager.active,true);assert.equal(manager.revoked_at,null);assert.equal(manager.is_system_principal,false);
  const managerId=manager.manager_id,credentialId=randomUUID(),deviceId='current-owned-browser-'+randomUUID();
  await query("insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,metadata_json,created_at,expires_at) values($1,$2,'Owned current browser qualification',$3,'full_access',$4,'{\"isolated_current_browser_fixture\":true}',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes')",
   [credentialId,deviceId,hash(randomBytes(32)),managerId]);
  const env={NODE_ENV:'test',OPS_MANAGER_AUTH_REQUIRED:'true',SUPABASE_URL:'https://local-owned-sql.invalid',
   SUPABASE_SERVICE_ROLE_KEY:'local-transport-only-never-sent',OPS_MANAGER_SESSION_SECRET:randomBytes(48).toString('hex'),
   STATIC_WEEKLY_CONTROL_PLANE_ALLOWED_ORIGINS:frontendOrigin,OPS_MANAGER_INVITE_ALLOWED_ORIGINS:frontendOrigin,
   CUSTODIAL_LEADERSHIP_PIN_ENABLED:'true',CUSTODIAL_LEADERSHIP_ALLOWED_ORIGINS:frontendOrigin,
   CUSTODIAL_LEADERSHIP_PIN_PEPPER:randomBytes(48).toString('hex')};
  let session=createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env}),csrfToken=null;
  const ownerSession=session;
  assert.equal(session.permissions.owner,true);assert.equal(session.permissions.manage_absences,true);assert.equal(session.read_only,false);
  const actor=await sqlRpc('static_weekly_control_plane','custodial_action_actor_v1',[managerId,credentialId,deviceId,'full_access','write']);
  assert.equal(actor.owner,true);assert.equal(actor.manager_id,managerId);
  phase='setup_owned_local_leadership_policy_and_pin';
  // The parent explicitly authorizes this disposable policy/PIN setup. These
  // rows are synthetic local fixture configuration, never live account changes
  // or a substitute for actual PIN challenge, enrollment, and session checks.
  const emptyLeadership=(await readonly('select (select count(*)::int from custodial_leadership_private.pin_versions) AS pins,(select count(*)::int from custodial_leadership_private.registrations) AS registrations,(select enabled from custodial_leadership_private.policy where singleton) AS enabled')).rows[0];
  assert.deepEqual(emptyLeadership,{pins:0,registrations:0,enabled:false},'Fresh disabled isolated leadership policy required');
  for(const approved of CUSTODIAL_LEADERSHIP_APPROVED_ACCOUNTS){
   await query("insert into public.ops_manager_managers(display_name,system_key,roles,active,is_system_principal) select $1,$2,array['OPS_MANAGER']::text[],true,false where not exists(select 1 from public.ops_manager_managers where system_key=$2)",['Owned synthetic registry fixture: '+approved.displayName,approved.systemKey]);
  }
  const names=(await readonly('select custodial_leadership_private.approved_names() AS names')).rows[0].names;
  assert.ok(Array.isArray(names)&&names.length===6);assert.equal(names[5].accountId,managerId);
  const cohortId=randomUUID(),approvalId=randomUUID(),cohortKey='owned_browser_'+randomUUID().replaceAll('-','');
  await query("insert into public.ops_manager_managers(manager_id,display_name,system_key,roles,active,is_system_principal,metadata_json) values($1,'Owned synthetic leadership cohort',$2,array['OPS_MANAGER']::text[],true,true,'{\"isolated_current_browser_fixture\":true}')",[cohortId,cohortKey]);
  const configured=await query("update custodial_leadership_private.policy set enabled=true,cohort_principal_id=$1,permissions=array['custodial.read','custodial.edit','custodialManagementAdmin']::text[],approved_by=$2,approved_at=clock_timestamp(),approval_ref=$3 where singleton and enabled=false",[cohortId,managerId,approvalId]);
  assert.equal(configured.rowCount,1);
  let localPin=String(randomInt(0,10000)).padStart(4,'0');
  const pinVerifier=await createCustodialLeadershipPinVerifier(localPin,env.CUSTODIAL_LEADERSHIP_PIN_PEPPER);
  const installed=(await query("select custodial_leadership_private.execute('install_initial',$1::jsonb) AS result",[JSON.stringify({owner_account_id:managerId,approval_id:approvalId,verifier:pinVerifier})])).rows[0].result;
  assert.equal(installed?.ok,true,'Actual private SQL PIN installation refused');
  phase='derive_exact_approved_manual_pattern';
  const approvedWeek=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week:approvedWeek,
   referenceBytes:readFileSync(new URL('../../'+approvedWeek.referenceBindings.reference.path,import.meta.url))});
  assert.equal(approvedWeek.activation.ownerApproved,true);assert.deepEqual(draft.restrictionConflicts,[]);
  const source=structuredClone(draft.sourceDraft);delete source.publicationAuthority;
  const sourceId=randomUUID(),templateId='current-owned-manual-'+randomUUID();
  source.serviceDate=week;Object.assign(source.version,{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:week});
  const ownerConfig=structuredClone(draft.ownerConfig);ownerConfig.effectiveDate=week;
  const roleSlotIds=approvedWeek.referenceBindings.people.map(p=>p.slotId).sort();
  const makeArgs=currentSource=>({templates:[{templateId,staffingCount:8,source:currentSource,roleSlotIds}],
   admittedBindings:[{schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:8,sourceDigest:contentDigest(currentSource),
    roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:approvedWeek.zipSha256,
    ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'}],currentSource,currentOwnerConfig:ownerConfig,
   selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,serviceDate:week,availablePersonIds:approvedWeek.referenceBindings.people.map(p=>p.employeeId)}});
  const initial=prepareApprovedStaticTemplateProjection(makeArgs(source));assert.equal(initial.solverInvoked,false);
  phase='seed_owned_exact_people_and_catalog';
  for(const p of approvedWeek.referenceBindings.people)await query("insert into public.employees(id,display_name,role,active) values($1,$2,'staff',true)",[p.employeeId,['Xavier Green','Jada Rawlings'].includes(p.approvedName)?p.approvedName:'Synthetic schedule custodian '+(approvedWeek.referenceBindings.people.indexOf(p)+1)]);
  const locations=new Map();
  for(const g of approvedWeek.referenceBindings.groups){locations.set(g.primaryLocationId,{locationId:g.primaryLocationId,locationNameSnapshot:g.approvedGroup});for(const l of g.includedLocations)locations.set(l.locationId,l);}
  for(const [id,l] of locations)await query("insert into public.locations(id,location_code,location_name,location_type,form_type) values($1,$2,$3,'restroom','restroom')",[id,'FIXTURE-'+id,l.locationNameSnapshot]);
  for(const g of approvedWeek.referenceBindings.groups){await query('insert into public.location_groups(id,group_code,group_name) values($1,$2,$3)',[g.primaryLocationId,g.referenceCode,g.approvedGroup]);for(const l of g.includedLocations)await query('insert into public.location_group_memberships(location_group_id,location_id) values($1,$2)',[g.primaryLocationId,l.locationId]);}
  phase='normal_source_roster_and_template_registration';
  const release=(name,args)=>sqlRpc('static_weekly_release_operator',name,args);
  await release('static_weekly_v3_configure_initial_authority_key',['static-weekly-authority-hmac-v2',randomBytes(48).toString('hex'),'Owned local browser fixture only']);
  await release('static_weekly_v3_register_authority_source',[sourceId,JSON.stringify(initial.compilerInput),'Exact approved manual pattern in owned local fixture']);
  await release('static_weekly_v6_initialize_registered_roster',[sourceId,managerId,'Owned local browser fixture only']);
  const registered=await sqlRpc('static_weekly_control_plane','static_weekly_v3_read_authority_source',[sourceId,week]);
  const args=makeArgs(registered.compiler_input),feasibility=prepareApprovedStaticTemplateProjection(args);
  assert.equal(feasibility.mapping.unchanged,true);assert.equal(feasibility.initialBaseline.projection.assignments.length,346);assert.equal(feasibility.lunchDocument.loans.length,40);
  const approval={classification:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:approvedWeek.zipSha256,
   sourceReference:'config/schedules/manual-approved-20261030/packet#'+approvedWeek.manifestSha256,
   ownerDecisionReference:'codex-chat:01a15718-2d88-7de1-8cec-6cdc241f0151; approved immutable manual week and full-hour lunch coverage'};
  await release('static_weekly_register_approved_template',[sourceId,JSON.stringify(args.templates[0]),JSON.stringify(args.admittedBindings[0]),JSON.stringify(ownerConfig),JSON.stringify(approval)]);
  await release('static_weekly_register_approved_initial_baseline',[sourceId,templateId,JSON.stringify(feasibility)]);
  phase='normal_runtime_signed_initial_http';
  // No custom controlPlane, auth store, compiler, clock, or release identity.
  runtime=createStaticWeeklyControlPlaneRuntime({env,database,supabase});
  installSharedAuthRoutes(runtime.app,{env,supabase,trustedDeviceStore:runtime.trustedDeviceStore});
  server=createServer({key:tls.key,cert:tls.cert},runtime.app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='https://127.0.0.1:'+server.address().port;
  runtime.app.get('/scheduler-runtime-config',(_req,res)=>res.json({ok:true,data:{configured:true,public_url:origin}}));
  const cookieJar=new Map();
  function absorbCookies(response){
   for(const raw of response.headers.getSetCookie()){
    const [first,...attributes]=raw.split(';'),at=first.indexOf('='),name=first.slice(0,at),value=first.slice(at+1);
    assert.ok(Object.values(CUSTODIAL_LEADERSHIP_COOKIE_NAMES).includes(name),'Unexpected cookie from local leadership router');
    if(attributes.some(v=>v.trim().toLowerCase()==='max-age=0'))cookieJar.delete(name);else cookieJar.set(name,value);
   }
  }
  async function leadershipRequest(path,body){
   const response=await fetch(origin+'/custodial-leadership-api/'+path,{method:body===undefined?'GET':'POST',
    headers:{Origin:frontendOrigin,'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{}),
     ...(cookieJar.size?{Cookie:[...cookieJar].map(([k,v])=>k+'='+v).join('; ')}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(Math.max(1,remaining()-100))});
   const value=await response.json();httpTrace.push({method:body===undefined?'GET':'POST',path:'/custodial-leadership-api/'+path,status:response.status,code:value.error??null});
   assert.equal(response.status,200,'Actual leadership '+path+' refused: '+String(value.error??response.status));assert.equal(value.ok,true);
   assert.equal(response.headers.get('access-control-allow-origin'),frontendOrigin);absorbCookies(response);
   if(value.csrfToken)csrfToken=value.csrfToken;return value;
  }
  async function request(path,body,{method=body===undefined?'GET':'POST',token=session.token}={}){
   const response=await fetch(origin+path,{method,headers:{Origin:frontendOrigin,'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Device-Id':session.device_id,...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(Math.max(1,remaining()-100))});
   const value=await response.json();httpTrace.push({method,path,status:response.status,code:value.code??null});
   assert.equal(response.status,200,'Actual HTTP refusal: '+JSON.stringify({path,status:response.status,code:value.code??null,error:value.error??null}));
   assert.equal(response.headers.get('access-control-allow-origin'),frontendOrigin);assert.equal(value.ok,true);await leaseEvidence();return value.data;
  }
  const verified=await request('/auth-api/session');assert.equal(verified.session.manager_id,managerId);assert.equal(verified.session.credential_id,credentialId);
  const expectedRevision=Number((await readonly('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
  const initialRequest={source_id:sourceId,effective_start:week,template_id:templateId,expected_revision:expectedRevision};
  const preview=await request('/static-weekly/approved-initial/preview',initialRequest);assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.solverInvoked,false);
  const accepted=await request('/static-weekly/approved-initial/confirm',{...initialRequest,preview_digest:preview.previewDigest,idempotency_key:'owned-current-browser-initial-'+randomUUID()});
  assert.equal(accepted.status,'PERSISTED_CURRENT');assert.equal(accepted.solverInvoked,false);assert.match(accepted.publication_id,UUID);
  phase='actual_owner_admission_of_recorded_employment_facts';
  // Initial publication does not admit employment facts. Use the separately
  // pinned current owner instruction and the actual credential-checked RPC;
  // retain its recorded effective dates and nullable actual hire dates.
  const employmentData=readOwnerConfirmedEmploymentAdmissionData(),employmentRevision=accepted.authority_revision;
  assert.equal((await readonly('select count(*)::int AS n from custodial_employment.admissions')).rows[0].n,0);
  const employmentCommands=employmentData.employees.map(e=>prepareApprovedManualEmploymentAdmission({employeeId:e.employeeId,
   requestId:randomUUID(),managerId,expectedAuthorityRevision:employmentRevision,expectedEmploymentRevision:0}).command);
  assert.equal(employmentCommands.length,2);
  const employmentReceipts=await transaction('static_weekly_control_plane',async client=>{
   const receipts=[];
   for(const command of employmentCommands){
    const receipt=(await client.query('select custodial_employment.admit($1::jsonb,$2::uuid,$3::text,$4::text) AS value',
     [JSON.stringify(command),credentialId,deviceId,'full_access'])).rows[0].value;
    assert.equal(receipt.schema,'custodial.employment-admission-receipt.v1');assert.equal(receipt.status,'ACCEPTED');
    assert.equal(receipt.employeeId,command.employeeId);assert.equal(receipt.employmentRevision,1);
    assert.equal(receipt.acceptedAuthorityRevision,employmentRevision);assert.equal(receipt.acceptedByManagerId,managerId);
    assert.deepEqual(receipt.command,command);receipts.push(receipt);
   }
   return receipts;
  });
  // Read committed admissions through the normal reader for each real frame
  // date. These fourteen bindings are derived only from actual SQL results.
  const employmentDayBindings=await transaction('static_weekly_control_plane',async client=>{
   const bindings=[];
   for(let offset=0;offset<7;offset++){
    const serviceDate=addDays(week,offset),acceptedRead=(await client.query(
     'select custodial_employment.read_admissions($1::date,$2::bigint,$3::uuid,$4::uuid,$5::text,$6::text) AS value',
     [serviceDate,employmentRevision,managerId,credentialId,deviceId,'full_access'])).rows[0].value;
    const availability=prepareApprovedManualEmploymentAvailability({serviceDate,expectedAuthorityRevision:employmentRevision,acceptedRead});
    assert.ok(availability.employees.every(e=>e.actualCoverageEligible&&e.actualLunchReliefEligible&&!e.preStart&&e.firstServiceDate===null));
    for(const employee of acceptedRead.employees){
     assert.deepEqual(employee.command,employmentCommands.find(c=>c.employeeId===employee.employeeId));
     assert.equal(employee.employmentRevision,1);assert.equal(employee.acceptedByManagerId,managerId);
     bindings.push({serviceDate,employeeId:employee.employeeId,employmentRevision:employee.employmentRevision,requestId:employee.command.requestId});
    }
   }
   return bindings;
  });
  assert.equal(employmentDayBindings.length,14);
  const employmentAuthorityAfter=Number((await readonly('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
  assert.equal(employmentAuthorityAfter,employmentRevision);
  const employmentAdmissionEvidence={recordedOwnerEvidenceSha256:employmentData.source.sha256,actualReceipts:employmentReceipts,
   dayBindings:employmentDayBindings,admissionCount:2,dayReadCount:7,bindingCount:14,
   authorityRevisionBefore:employmentRevision,authorityRevisionAfter:employmentAuthorityAfter,authorityRevisionUnchanged:true};
  phase='real_https_pin_challenge_and_browser_registration';
  const firstSession=await leadershipRequest('session');assert.equal(firstSession.enrolled,false);
  const challenged=await leadershipRequest('challenge',{pin:localPin});localPin=null;
  assert.deepEqual(challenged.approvedNames,names);
  const enrolled=await leadershipRequest('enroll',{accountId:names[0].accountId});assert.equal(enrolled.enrolled,true);
  const current=await leadershipRequest('session');assert.equal(current.enrolled,true);session=current.session.managerSession;
  assert.equal(session.auth_mode,'custodial_leadership_pin');assert.equal(session.manager_id,cohortId);
  assert.equal(session.owner,false);assert.equal(session.permissions.custodialManagementAdmin,true);assert.equal(session.permissions.manage_absences,true);
  const registration=(await readonly('select registration_id,browser_id,cohort_principal_id,claimed_account_id,revoked_at from custodial_leadership_private.registrations')).rows;
  assert.equal(registration.length,1);assert.equal(registration[0].registration_id,session.credential_id);
  assert.equal(registration[0].browser_id,session.device_id);assert.equal(registration[0].cohort_principal_id,cohortId);assert.equal(registration[0].revoked_at,null);
  phase='actual_cohort_approved_choices_context_and_denials';
  const choices=await request('/static-weekly/approved-choices');
  assert.equal(choices.schema,'custodial.approved-schedule-choices.v1');assert.ok(Array.isArray(choices.initial));
  const deniedAuth=[];
  for(const invalidToken of ['', 'invalid-current-fixture-token']){
   const response=await fetch(origin+'/static-weekly/approved-choices',{headers:{Origin:frontendOrigin,...(invalidToken?{Authorization:'Bearer '+invalidToken}:{}),'X-Device-Id':session.device_id},signal:AbortSignal.timeout(5000)});
   await response.arrayBuffer();assert.ok([401,403].includes(response.status),'Missing/corrupt auth must stay denied');deniedAuth.push(response.status);
  }
  await assert.rejects(()=>sqlRpc('static_weekly_control_plane','custodial_read_approved_schedule_choices_v1',[session.manager_id,session.credential_id,session.device_id,session.access_level]),e=>e.code==='42501');
  await assert.rejects(()=>sqlRpc('static_weekly_control_plane','static_weekly_leadership_bind_verified_request',[session.credential_id,randomUUID(),session.manager_id,randomUUID()]),e=>e.code==='42501');
  const boundClient=await database.connect();let boundTransaction=false;
  try{
   await boundClient.query('begin');boundTransaction=true;await boundClient.query('set local role static_weekly_control_plane');
   await boundClient.query('select public.static_weekly_leadership_bind_verified_request($1::uuid,$2::uuid,$3::uuid,$4::uuid)',[session.credential_id,session.device_id,session.manager_id,randomUUID()]);
   const ownedChoices=(await boundClient.query('select public.custodial_read_approved_schedule_choices_v1($1::uuid,$2::uuid,$3,$4) AS value',[session.manager_id,session.credential_id,session.device_id,session.access_level])).rows[0].value;
   assert.equal(ownedChoices.schema,'custodial.approved-schedule-choices.v1');await boundClient.query('commit');boundTransaction=false;
   await boundClient.query('begin');boundTransaction=true;await boundClient.query('set local role static_weekly_control_plane');
   await assert.rejects(()=>boundClient.query('select public.custodial_read_approved_schedule_choices_v1($1::uuid,$2::uuid,$3,$4)',[session.manager_id,session.credential_id,session.device_id,session.access_level]),e=>e.code==='42501');
   await boundClient.query('rollback');boundTransaction=false;
  }finally{if(boundTransaction)await boundClient.query('rollback');boundClient.release();}
  const approvedChoicesContextEvidence={normalCohortHttpRead:true,missingAndCorruptTokensDenied:deniedAuth,unboundSqlDenied:true,wrongBrowserBindingDenied:true,sameConnectionLaterTransactionCannotInheritContext:true};
  baseline=await request('/static-weekly/manager-snapshot?week_start='+week);
  assert.equal(baseline.current_publication.publication_id,accepted.publication_id);assert.equal(baseline.authority_revision,accepted.authority_revision);
  assert.equal(baseline.projection_status,'current');
  const monday=approvedWeek.days.find(d=>d.weekday===1);assert.ok(monday?.employees.length);
  const person=approvedWeek.referenceBindings.people.find(p=>p.approvedName===monday.employees[0].name);assert.ok(person);
  assert.ok(baseline.roster.some(r=>r.slot_id===person.slotId&&r.incumbencies.some(i=>i.person_id===person.employeeId)));
  baselineSql=await sqlScheduleFingerprint();phase='ready_for_actual_browser';
  async function assertSameOperation({operationId,expectedState='CANCELLED',semanticDigest=null}){
   assert.match(operationId,UUID);assert.equal(expectedState,'CANCELLED');
   const rows=(await readonly('select operation_id,prepared_by_manager_id,employee_id,start_date::text AS start_date,end_date::text AS end_date,expected_revision::text AS expected_revision,state,semantic_digest,accepted_revision,accepted_receipt,accepted_at from public.static_weekly_staffing_commands')).rows;
   assert.equal(rows.length,1,'Exactly one original staffing operation required');const row=rows[0];
   assert.equal(row.operation_id,operationId);assert.equal(row.prepared_by_manager_id,cohortId);assert.equal(row.employee_id,person.employeeId);
   assert.equal(row.start_date,week);assert.equal(row.end_date,week);assert.equal(row.expected_revision,String(accepted.authority_revision));
   assert.equal(row.state,expectedState);assert.equal(row.accepted_receipt,null);assert.equal(row.accepted_revision,null);assert.equal(row.accepted_at,null);
   if(semanticDigest!==null)assert.equal(row.semantic_digest,semanticDigest);
   const receipts=(await readonly('select event_kind,semantic_digest,actor_manager_id from public.static_weekly_staffing_command_receipts where operation_id=$1 order by recorded_at,receipt_id',[operationId])).rows;
   assert.equal(receipts.filter(r=>r.event_kind==='CANCELLED').length,1);assert.equal(receipts.filter(r=>r.event_kind==='ACCEPTED').length,0);
   assert.ok(receipts.every(r=>r.semantic_digest===row.semantic_digest&&r.actor_manager_id===cohortId));
   assert.deepEqual(await sqlScheduleFingerprint(),baselineSql,'Unpublished cancellation changed actual SQL schedule');
   const final=await request('/static-weekly/manager-snapshot?week_start='+week);
   assert.deepEqual(projectSnapshot(final),projectSnapshot(baseline),'Unpublished cancellation changed normal manager readback');
   return {operationId,state:row.state,semanticDigest:row.semantic_digest,oneCancellationReceipt:true,acceptedReceipt:null,
    unchangedSqlSchedule:true,unchangedManagerReadback:true,...await leaseEvidence()};
  }
  async function evidence(){
   assert.deepEqual(connectionErrors,[]);return {schema:'custodial.current310-owned-browser-fixture.v1',phase,week,actualChicagoDate:today,
    sourceId,publicationId:accepted.publication_id,versionId:baseline.current_publication.version_id,revision:accepted.authority_revision,
    approvedManifestSha256:approvedWeek.manifestSha256,approvedArtifactSha256:approvedWeek.zipSha256,assignments:346,lunches:40,
    normalRuntimeFactory:true,realSqlCredentialRegistry:true,actualHttps:true,actualPinChallenge:true,actualSqlBrowserRegistration:true,
    employmentAdmissionEvidence,approvedChoicesContextEvidence,cohortPrincipalId:cohortId,registrationId:session.credential_id,cohortOwner:false,credentialReads,managerReads,rpcTrace:[...rpcTrace],httpTrace:[...httpTrace],
    ...await leaseEvidence(),elapsedMs:performance.now()-started,production:false,releaseAdmission:false,deployedPostgREST:false,
    browserClaim:'OWNING_BROWSER_CONSUMER_MUST_SUPPLY_ITS_OWN_EVIDENCE',parentOwnsFinalDatabaseCleanup:true};
  }
  const bootstrapCookies=()=>[...cookieJar].map(([name,value])=>({name,value,url:origin+'/',httpOnly:true,secure:true,sameSite:'None'}));
  return {origin,ownerSession,session,csrfToken,bootstrapCookies,week,employeeId:person.employeeId,slotId:person.slotId,publicationId:accepted.publication_id,
   versionId:baseline.current_publication.version_id,revision:accepted.authority_revision,accepted,deadlineAt,request,
   assertSameOperation,evidence,close};
 }catch(error){
  error.currentOwnedBrowserFixturePhase=phase;
  try{await close();}catch(cleanupError){error.fixtureLocalCloseFailure=String(cleanupError.message);}
  throw error;
 }
}
