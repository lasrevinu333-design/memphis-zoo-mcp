// Exercise the current closed request plan and all settled observations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertSchedulerObservation,observeReleaseEndpoints,releaseMonitorEndpointPlan} from './release-monitor-observations.mjs';

const token='SYNTHETIC-OBSERVER-TOKEN',input={
 backendUrl:'https://backend.invalid/release-manifest', frontendReleaseUrl:'https://frontend.invalid/release.json?fixed=1',
 frontendDeploymentUrl:'https://frontend.invalid/deploy.json', schedulerReadyUrl:'https://scheduler.invalid/ready', schemaToken:token,
};
const plan=releaseMonitorEndpointPlan(input);
assert.equal(plan.length,8);
for(const [field,path] of [
 ['identityUrl','/admin-api/release-schema-identity'],
 ['healthUrl','/admin-api/release-monitor/dependencies'],
 ['authorityHealthUrl','/admin-api/release-monitor/authority'],
]){
 for(const bad of ['https://foreign.invalid'+path,'http://backend.invalid'+path,'https://backend.invalid/other',
  'https://backend.invalid'+path+'?token=x','https://backend.invalid'+path+'#fragment','https://user:pass@backend.invalid'+path]) {
  assert.throws(()=>releaseMonitorEndpointPlan({...input,[field]:bad}),bad);
 }
 assert.doesNotThrow(()=>releaseMonitorEndpointPlan({...input,[field]:'https://backend.invalid'+path}));
}
let count=0;
const rows=await observeReleaseEndpoints(plan,async(url,options)=>{
 count++;
 const {origin,pathname}=new URL(url);
 assert.equal(options.redirect,'error');
 assert.equal(options.cache,'no-store');
 const protectedRoute=origin==='https://backend.invalid'&&pathname.startsWith('/admin-api/');
 assert.equal(options.headers.authorization,protectedRoute?'Bearer '+token:undefined);
 if(pathname==='/release-manifest'||pathname==='/ready')return new Response('synthetic private error',{status:503});
 if(pathname==='/release.json')return new Response('invalid body');
 if(pathname.endsWith('/authority'))throw Object.assign(new Error('synthetic private timeout'),{name:'TimeoutError'});
 return Response.json({ok:true,private_value:'NO_REPORT_ACCESS'},{headers:{age:'4'}});
});
const evidence=rows.map(row=>row.observed);
assert.equal(count,8);
assert.deepEqual(evidence.filter(row=>row.http===503).map(row=>row.id),['backend_release','scheduler_readiness']);
assert.equal(evidence.find(row=>row.id==='frontend_release').state,'invalid_json');
assert.equal(evidence.find(row=>row.id==='authority_health').state,'timeout');
assert.equal(evidence.find(row=>row.id==='backend_dependencies').cache_age_seconds,4);
assert.ok(evidence.every(row=>Number.isFinite(Date.parse(row.observed_at))&&row.elapsed_ms>=0));
assert.doesNotMatch(JSON.stringify(evidence),/SYNTHETIC-OBSERVER-TOKEN|private error|NO_REPORT_ACCESS/);

const common={release_id:'fixture',frontend_commit_sha:'a'.repeat(40),schema_fingerprint:'c'.repeat(64)};
const app={...common,backend_commit_sha:'b'.repeat(40),backend_tree_sha:'d'.repeat(40)};
const scheduler={...common,backend_commit_sha:'e'.repeat(40),backend_tree_sha:'f'.repeat(40)};
const ready={ok:true,data:{ready:true,solver:{available:true}},release_identity:scheduler};
assert.doesNotThrow(()=>assertSchedulerObservation(ready,scheduler,app));
assert.doesNotThrow(()=>assertSchedulerObservation({...ready,release_identity:app},app,app));
assert.throws(()=>assertSchedulerObservation(ready,app,app),/backend_commit_sha/);
assert.throws(()=>assertSchedulerObservation({...ready,release_identity:{...scheduler,backend_tree_sha:app.backend_tree_sha}},scheduler,app),/backend_tree_sha/);
assert.throws(()=>assertSchedulerObservation(ready,{...scheduler,frontend_commit_sha:app.backend_commit_sha},app),/frontend_commit_sha/);
const workflow=readFileSync(new URL('../.github/workflows/production-availability-monitor.yml',import.meta.url),'utf8');
assert.match(workflow,/LIVE_RELEASE_OBSERVATION_REPORT/);
assert.match(workflow,/if: always\(\) && steps\.live_probe\.outcome != 'skipped'[\s\S]*actions\/upload-artifact/);
console.log(JSON.stringify({suite:'release-monitor-contract',probes:count,network:false,production_mutations:0,status:'PASS'}));
