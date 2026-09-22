import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import pg from 'pg';
import {buildRecordingPlan,sameReleaseIdentity,archivedReleaseId} from '../src/production-release-deployment-recorder.js';
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
const prior={...target,backend_commit:'d'.repeat(40),migration_head:'20260920010000'};
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
 const context={client,apply,state,target,liveCheck:{...liveCheck,...overrides.liveCheck},
  provenance:{...provenance,...overrides.provenance},runtimeConfigurationSha256,runtimeConfiguration,
  attestation,buildRecordingPlan,sameReleaseIdentity,assert,JSON,Date,
  requiredEnv:name=>{assert.equal(name,'PRODUCTION_RELEASE_RECORD_EXPECTED_PLAN_SHA256');return expected;},
  console:{log:text=>output.push(JSON.parse(text))}};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction(...Object.keys(context),transaction);
 await execute(...Object.values(context));assert.equal(output.length,1);return output[0];
}
async function insertRelease(row,details={}){
 await admin.query(`insert into public.release_deployment_manifest(release_id,backend_commit,
 frontend_commit,migration_head,migration_manifest_sha256,environment_contract_version,status,
 details_json,created_at,deployed_at) values($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-20','2026-09-20')`,
 [row.release_id,row.backend_commit,row.frontend_commit,row.migration_head,row.migration_manifest_sha256,
 row.environment_contract_version,row.status,details]);
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
 create function public.custodial_begin_application_mutation() returns void language sql as
 'insert into public.recorder_test_fence_calls default values';`);
 await insertRelease(prior,{preserve:'prior historical details'});
 const unrelated={...prior,release_id:'synthetic-other-history'};await insertRelease(unrelated,{preserve:'untouched'});
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
 const replayPlan=await invoke(false);check('replay plan does not archive again',replayPlan.plan.archive_release_id,null);
 await invoke(true,replayPlan.plan.plan_sha256,{provenance:{run_id:'103'}});
 check('replay creates no duplicate archive',(await snapshot()).releases.length,4);
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
 console.log(JSON.stringify({passed,failed:0,fixture:'isolated recorder transaction',
 external_attestation_tested:false,live_alignment_tested:false,production_mutation:false},null,2));
} finally {await admin.end();}
