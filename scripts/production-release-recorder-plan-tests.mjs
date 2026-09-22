import assert from 'node:assert/strict';
import { buildRecordingPlan } from '../src/production-release-deployment-recorder.js';
const target = { release_id:'synthetic-release',backend_commit:'a'.repeat(40),
 frontend_commit:'b'.repeat(40),migration_head:'20260922090000',
 migration_manifest_sha256:'c'.repeat(64),environment_contract_version:'synthetic.v1',status:'deployed' };
const liveCheck = { ok:true,release_id:target.release_id,backend_commit_sha:target.backend_commit,
 backend_tree_sha:'d'.repeat(40),backend_evidence_sha256:'e'.repeat(64),
 frontend_commit_sha:target.frontend_commit,observed_production_schema_fingerprint:'f'.repeat(64),
 schema_alignment_mode:'exact',schema_transition_id:null,backend_health_latency_ms:123,operational_backlog:0 };
const provenance = { kind:'github-actions',repository:'synthetic/repository',run_id:'101',
 run_attempt:'1',workflow_sha:target.backend_commit,actor:'planning-operator' };
const input = { currentBase:null,otherDeployed:[],target,liveCheck,provenance,
 runtimeConfigurationSha256:'1'.repeat(64) };
let passed=0;const failures=[];
function test(name,fn){try{fn();passed++;}catch(error){failures.push({name,error:error.message});}}
const plan=buildRecordingPlan(input);
for(const [name,changes] of [
 ['separate apply run',{run_id:'102'}],['retry attempt',{run_attempt:'2'}],
 ['authorized different operator',{actor:'applying-operator'}],
])test(name,()=>assert.equal(buildRecordingPlan({...input,provenance:{...provenance,...changes}}).plan_sha256,plan.plan_sha256));
for(const [name,changes] of [
 ['health latency changes',{backend_health_latency_ms:250}],
 ['nonfatal backlog changes',{operational_backlog:1}],
])test(name,()=>assert.equal(buildRecordingPlan({...input,liveCheck:{...liveCheck,...changes}}).plan_sha256,plan.plan_sha256));
test('real schema change changes approval',()=>assert.notEqual(buildRecordingPlan({...input,
 liveCheck:{...liveCheck,observed_production_schema_fingerprint:'2'.repeat(64)}}).plan_sha256,plan.plan_sha256));
test('different backend tree changes approval',()=>assert.notEqual(buildRecordingPlan({...input,
 liveCheck:{...liveCheck,backend_tree_sha:'2'.repeat(40)}}).plan_sha256,plan.plan_sha256));
test('different evidence changes approval',()=>assert.notEqual(buildRecordingPlan({...input,
 liveCheck:{...liveCheck,backend_evidence_sha256:'2'.repeat(64)}}).plan_sha256,plan.plan_sha256));
test('runtime configuration change changes approval',()=>assert.notEqual(buildRecordingPlan({...input,
 runtimeConfigurationSha256:'2'.repeat(64)}).plan_sha256,plan.plan_sha256));
test('repository change changes approval',()=>assert.notEqual(buildRecordingPlan({...input,
 provenance:{...provenance,repository:'synthetic/other'}}).plan_sha256,plan.plan_sha256));
for(const [name,changes] of [
 ['failed live alignment',{ok:false}],['mismatched backend',{backend_commit_sha:'9'.repeat(40)}],
 ['mismatched frontend',{frontend_commit_sha:'9'.repeat(40)}],['mismatched release',{release_id:'another'}],
 ['missing observed schema',{observed_production_schema_fingerprint:null}],
])test(name,()=>assert.throws(()=>buildRecordingPlan({...input,liveCheck:{...liveCheck,...changes}})));
test('different workflow commit rejected',()=>assert.throws(()=>buildRecordingPlan({...input,
 provenance:{...provenance,workflow_sha:'9'.repeat(40)}})));
test('run evidence remains in returned plan',()=>assert.equal(plan.provenance.run_id,'101'));
test('health observation remains in returned plan',()=>assert.equal(plan.live_check.backend_health_latency_ms,123));
console.log(JSON.stringify({passed,failed:failures.length,failures,live_operation:false},null,2));
if(failures.length)process.exitCode=1;
