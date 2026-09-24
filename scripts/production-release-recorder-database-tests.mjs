import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import pg from 'pg';
import {buildRecordingPlan,sameReleaseIdentity,sameReleaseOccurrence,archivedReleaseId,archivedReleaseRecord} from '../src/production-release-deployment-recorder.js';
// Exercise the exact CLI transaction body against disposable SQL fixtures.
// External signature/live-service gates are NOT simulated as production proof.
const container=process.env.RECORDER_TEST_CONTAINER;
assert.match(container??'',/^mz_recorder_test_[0-9]+$/);
const socket=realpathSync(process.env.RECORDER_TEST_SOCKET??'');
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
assert.ok(inspection.Mounts.some(m=>m.Destination==='/var/run/postgresql'&&m.Source===socket));
const connection={host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:5000};
const admin=new pg.Client(connection);await admin.connect();
const source=readFileSync(new URL('./record-production-release-deployment.mjs',import.meta.url),'utf8');
const marker='await client.connect();';assert.equal(source.split(marker).length-1,1);
const transaction=source.slice(source.indexOf(marker));
assert.ok(transaction.endsWith('}\n'));
const target={release_id:'synthetic-release',backend_commit:'a'.repeat(40),frontend_commit:'b'.repeat(40),
 migration_head:'20260922090000',migration_manifest_sha256:'c'.repeat(64),
 environment_contract_version:'synthetic.v1',status:'deployed'};
const prior={...target,backend_commit:'d'.repeat(40),migration_head:'20260920010000',status:'retired',
 details_json:{preserve:'prior historical details'},created_at:'2026-09-20T00:00:00.123456Z',deployed_at:'2026-09-20T00:00:00.654321Z'};
const liveCheck={ok:true,release_id:target.release_id,backend_commit_sha:target.backend_commit,
 backend_tree_sha:'e'.repeat(40),backend_evidence_sha256:'f'.repeat(64),frontend_commit_sha:target.frontend_commit,
 observed_production_schema_fingerprint:'1'.repeat(64),schema_alignment_mode:'exact',schema_transition_id:null,
 backend_health_latency_ms:50,operational_backlog:0};
const provenance={kind:'github-actions',repository:'synthetic/repo',run_id:'101',run_attempt:'1',
 workflow_sha:target.backend_commit,actor:'synthetic-reviewer'};
const runtimeConfigurationSha256='2'.repeat(64);
const runtimeConfiguration={services:{backend:{service_id:'synthetic-backend',deployment_id:'synthetic-deploy'},
 static_weekly_control_plane:{service_id:'synthetic-scheduler',deployment_id:'synthetic-scheduler-deploy'}}};
const state={target:{production_ledger_count:1,source_migration_version:target.migration_head}};
const attestation={schema_fingerprint:liveCheck.observed_production_schema_fingerprint,
 backend_tree_sha:liveCheck.backend_tree_sha,backend_evidence_sha256:liveCheck.backend_evidence_sha256};
let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++;};
async function invoke(apply,expected,overrides={}){
 const output=[];
 const client=new pg.Client(connection);
 if(overrides.afterSelection){const query=client.query.bind(client);client.query=async(...args)=>{
   const result=await query(...args);
   if(String(args[0]).includes("where status='deployed' order by release_id for update"))await overrides.afterSelection();
   return result;
 };}
 const actualTarget=overrides.target||target;
 const context={client,apply,state,target:actualTarget,liveCheck:{...liveCheck,release_id:actualTarget.release_id,...overrides.liveCheck},
  provenance:{...provenance,...overrides.provenance},runtimeConfigurationSha256,runtimeConfiguration,
  attestation,buildRecordingPlan,sameReleaseIdentity,sameReleaseOccurrence,archivedReleaseRecord,assert,JSON,Date,
  requiredEnv:name=>{assert.equal(name,'PRODUCTION_RELEASE_RECORD_EXPECTED_PLAN_SHA256');return expected;},
  console:{log:text=>output.push(JSON.parse(text))}};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction(...Object.keys(context),transaction);
 await execute(...Object.values(context));assert.equal(output.length,1);return output[0];
}
async function insertRelease(row,details=row.details_json||{}){
 await admin.query(`insert into public.release_deployment_manifest(release_id,backend_commit,
 frontend_commit,migration_head,migration_manifest_sha256,environment_contract_version,status,
 details_json,created_at,deployed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
 [row.release_id,row.backend_commit,row.frontend_commit,row.migration_head,row.migration_manifest_sha256,
 row.environment_contract_version,row.status,details,row.created_at||'2026-09-20',row.deployed_at||'2026-09-20']);
}
try {
 const baseline=readFileSync(new URL('../supabase/migrations/00000000000000_production_baseline.sql',import.meta.url),'utf8');
 for(const table of ['release_deployment_manifest','release_validation_runs']){
  const ddl=baseline.match(new RegExp(`create table "public"\\."${table}" \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(ddl,`${table} canonical columns required`);await admin.query(ddl);
 }
 await admin.query(`alter table public.release_deployment_manifest add primary key(release_id);
 create schema supabase_migrations;
 create table supabase_migrations.schema_migrations(version text primary key);
 insert into supabase_migrations.schema_migrations values('20260922090000');
 create table public.recorder_test_fence_calls(id integer generated always as identity);
 create schema custodial_dr;
 create table custodial_dr.restore_control(singleton boolean primary key,mutations_paused boolean not null);
 insert into custodial_dr.restore_control values(true,false);
 create function public.custodial_begin_application_mutation() returns void language sql as
 'insert into public.recorder_test_fence_calls default values';`);
 await admin.query(readFileSync(new URL('../supabase/migrations/20260924022250_release_selection_and_occurrence_guards.sql',import.meta.url),'utf8'));
 await insertRelease(prior,{preserve:'prior historical details'});
 const unrelated={...prior,release_id:'synthetic-other-history',status:'deployed',details_json:{preserve:'untouched'}};await insertRelease(unrelated);
 const snapshot=async()=>({
  releases:(await admin.query('select * from public.release_deployment_manifest order by release_id')).rows,
  validation:(await admin.query('select * from public.release_validation_runs order by id')).rows,
  fences:(await admin.query('select * from public.recorder_test_fence_calls order by id')).rows});
 const before=await snapshot();const planned=await invoke(false);
 check('planning is read only',await snapshot(),before);
 check('plan produced review hash',/^[0-9a-f]{64}$/.test(planned.plan.plan_sha256),true);
 await assert.rejects(()=>invoke(true,'0'.repeat(64)),/Recording plan changed/);passed++;
 check('wrong plan leaves everything unchanged',await snapshot(),before);
 const applied=await invoke(true,planned.plan.plan_sha256,{provenance:{run_id:'102',actor:'applying-operator'},
 liveCheck:{backend_health_latency_ms:150}});
 check('reviewed plan applies in separate run',applied.apply,true);
 check('apply hash matches reviewed plan',applied.plan_sha256,planned.plan.plan_sha256);
 const after=await snapshot();
 check('fence called only for actual apply',after.fences.length,1);
 const archive=after.releases.find(row=>row.release_id===archivedReleaseId(prior));
 check('prior release archived',archive.status,'retired');
 check('prior backend retained',archive.backend_commit,prior.backend_commit);
 check('prior details retained',archive.details_json.preserve,'prior historical details');
 const retiredOther=after.releases.find(row=>row.release_id===unrelated.release_id);
 check('superseded deployed release retired',retiredOther.status,'retired');
 check('superseded release details retained',retiredOther.details_json.preserve,'untouched');
 const otherArchive=after.releases.find(row=>row.release_id===archivedReleaseId(unrelated));
 check('superseded release archived',otherArchive.status,'retired');
 check('superseded archive backend retained',otherArchive.backend_commit,unrelated.backend_commit);
 check('exactly one deployed release remains',after.releases.filter(row=>row.status==='deployed').map(row=>row.release_id),[target.release_id]);
 check('one validation row recorded',after.validation.length,1);
 check('recorded apply run retained',after.releases.find(row=>row.release_id===target.release_id).details_json.provenance.run_id,'102');
 const replayPlan=await invoke(false);check('same-code redeployment archives previous occurrence',typeof replayPlan.plan.archive_release_id,'string');
 await invoke(true,replayPlan.plan.plan_sha256,{provenance:{run_id:'103'}});
 check('same-code redeployment retains another occurrence',(await snapshot()).releases.length,5);
 await admin.query("update supabase_migrations.schema_migrations set version='20260922090001'");
 const drifted=await snapshot();await assert.rejects(()=>invoke(true,replayPlan.plan.plan_sha256),/exact admitted target/);passed++;
 check('ledger drift cannot mutate registry',await snapshot(),drifted);
 await admin.query("update supabase_migrations.schema_migrations set version='20260922090000'");
 const nextTarget={...target,backend_commit:'9'.repeat(40)};
 await admin.query('update public.release_deployment_manifest set backend_commit=$1 where release_id=$2',
 [nextTarget.backend_commit,target.release_id]);
 const rollbackPlan=await invoke(false),rollbackBefore=await snapshot();
 await admin.query(`create function public.recorder_test_fail_validation() returns trigger language plpgsql as
 'begin raise exception ''injected validation write failure''; end';
 create trigger recorder_test_inject_failure before insert on public.release_validation_runs
 for each row execute function public.recorder_test_fail_validation();`);
 await assert.rejects(()=>invoke(true,rollbackPlan.plan.plan_sha256),/injected validation write failure/);passed++;
 check('archive and replacement roll back together',await snapshot(),rollbackBefore);
 await admin.query('drop trigger recorder_test_inject_failure on public.release_validation_runs');

 // Exact report reproduction: repeated A deployments may not overwrite A2.
 const occurrenceRecords=new Map();
 for(const [name,run] of [['A','201'],['B','202'],['A','203'],['C','204'],['A','205']]){
  const next={...target,release_id:`synthetic-${name}`};
  const plan=await invoke(false,null,{target:next});
  await invoke(true,plan.plan.plan_sha256,{target:next,provenance:{run_id:run,actor:`actor-${run}`}});
  const row=(await admin.query(`select details_json,
   to_char(deployed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') deployed_at
   from public.release_deployment_manifest where release_id=$1`,[next.release_id])).rows[0];
  occurrenceRecords.set(run,row);
 }
 for(const [run,expected] of occurrenceRecords){
  const records=(await admin.query(`select details_json,
   to_char(deployed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') deployed_at
   from public.release_deployment_manifest where details_json#>>'{provenance,run_id}'=$1`,[run])).rows;
  check(`deployment occurrence ${run} retained`,records.length>0,true);
  check(`deployment occurrence ${run} exact provenance and time`,records.some(row=>
   JSON.stringify(row.details_json.provenance)===JSON.stringify(expected.details_json.provenance)
   &&row.deployed_at===expected.deployed_at),true);
 }

 // Same archive key with conflicting provenance must abort before overwrite.
 const collisionTarget={...target,release_id:'synthetic-A'};
 const collisionPlan=await invoke(false,null,{target:collisionTarget});
 const expectedArchive=archivedReleaseRecord(collisionPlan.plan.current_base);
 await insertRelease(expectedArchive,{tampered:true});
 const collisionBefore=await snapshot();
 await assert.rejects(()=>invoke(true,collisionPlan.plan.plan_sha256,{target:collisionTarget}),/occurrence provenance or timestamps conflict/);passed++;
 check('archive collision leaves selected release unchanged',await snapshot(),collisionBefore);

 // Both recorder transactions see an empty deployed set before either inserts.
 // External admission is synthetic; these are the exact CLI SQL transactions.
 await admin.query('truncate public.release_deployment_manifest,public.release_validation_runs');
 const contenders=['race-A','race-B'].map(name=>({...target,release_id:name}));
 const plans=await Promise.all(contenders.map(next=>invoke(false,null,{target:next})));
 let arrivals=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const afterSelection=async()=>{arrivals++;if(arrivals===2)release();await barrier;};
 const results=await Promise.allSettled(contenders.map((next,i)=>invoke(true,plans[i].plan.plan_sha256,{target:next,afterSelection})));
 check('two admitted recorders reached empty selector',arrivals,2);
 check('only one concurrent recorder commits',results.filter(row=>row.status==='fulfilled').length,1);
 check('loser fails unique deployed database invariant',results.filter(row=>row.status==='rejected').map(row=>row.reason.code),['23505']);
 check('exactly one committed deployed selector',(await admin.query("select count(*)::int n from public.release_deployment_manifest where status='deployed'")).rows[0].n,1);

 // Paused restore may stage both identities, including replica-mode inserts;
 // it must remain paused until exactly one is reconciled. Caller flags cannot
 // create an ordinary uniqueness bypass.
 await assert.rejects(()=>admin.query(`insert into public.release_deployment_manifest(release_id,backend_commit,frontend_commit,migration_head,
  migration_manifest_sha256,environment_contract_version,status,recovery_staged) values('forged','a','b','c','d','e','deployed',true)`),error=>error.code==='23505');passed++;
 await admin.query('update custodial_dr.restore_control set mutations_paused=true where singleton=true');
 await admin.query('set session_replication_role=replica');
 await insertRelease({...target,release_id:'restore-staged'});
 await admin.query('set session_replication_role=origin');
 check('replica-mode restore is marked staged',(await admin.query("select recovery_staged from public.release_deployment_manifest where release_id='restore-staged'")).rows[0].recovery_staged,true);
 await assert.rejects(()=>admin.query('update custodial_dr.restore_control set mutations_paused=false where singleton=true'),/exactly one deployed identity/);passed++;
 check('ambiguous restore cannot resume',(await admin.query('select mutations_paused from custodial_dr.restore_control')).rows[0].mutations_paused,true);
 await admin.query("update public.release_deployment_manifest set status='retired' where release_id='restore-staged'");
 await admin.query('update custodial_dr.restore_control set mutations_paused=false where singleton=true');
 check('reconciled restore resumes without staging bypass',(await admin.query('select count(*)::int n from public.release_deployment_manifest where recovery_staged')).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role']){
  await admin.query(`set role ${role}`);
  try{await assert.rejects(()=>admin.query('select custodial_dr.guard_release_selection()'),error=>error.code==='42501');passed++;}
  finally{await admin.query('reset role');}
 }
 console.log(JSON.stringify({passed,failed:0,fixture:'isolated recorder transaction',
 external_attestation_tested:false,live_alignment_tested:false,production_mutation:false},null,2));
} finally {await admin.end();}
