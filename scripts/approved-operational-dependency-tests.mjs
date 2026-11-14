import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {requireHealthDiagnostics,healthResponse} from '../release/operational-live-health-contract/security-http-boundaries.mjs';
const target = JSON.parse(readFileSync(new URL('../release/operational-live-approved-target.json', import.meta.url)));
const policy = target.dependency_readiness_contract;
assert.equal(policy.source_commit, target.backend_commit_sha);
const routeBytes = readFileSync(new URL('../release/operational-live-health-contract/health-route.txt', import.meta.url));
const boundaryBytes = readFileSync(new URL('../release/operational-live-health-contract/security-http-boundaries.mjs', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(routeBytes), policy.route_fragment_sha256);
assert.equal(sha(boundaryBytes), policy.http_boundary_sha256);
const keys = ['database_reachable','transaction_read_only','dedicated_reader_member','reader_role_restricted',
  'sessions_table','messages_table','notification_outbox_table','message_audit_table','exact_finish_rpc','manager_messaging_rpc','worker_claim_rpc'];
let row = Object.fromEntries(keys.map(k => [k,true])), paused=false, secretReady=true, throws=false, probes=0;
const routes=[];
const context = vm.createContext({app:{get:(paths,...stack)=>routes.push({paths,stack})},
  requireHealthDiagnostics,healthResponse,
  requireOpsManagerAuth:(_req,res)=>res.status(401).json({ok:false,code:'manager_session_required'}),
  setPublicDashboardCors(){}, configuredReleaseCanaryDeviceId:()=> 'SYNTHETIC-PRIVATE',
  releaseCanaryConfigurationRequired:()=>true,
  runReadOnlySql:async()=>{probes++;if(throws)throw Error('SYNTHETIC-PRIVATE-FAILURE');return [{...row}];},
  runRpc:async()=>paused, offlineAuthoritySecret:()=> 'SYNTHETIC',
  getDeviceCredentialSecretReadiness:async()=>({ready:secretReady}),supabaseAdmin:null,process:{env:{}},
  buildHealthPayload:(_area,extra)=>({...extra,private_detail:'SYNTHETIC-PRIVATE'}),
  buildReleaseManifest:()=>({schema:{fingerprint:'SYNTHETIC-PRIVATE'}}),APP_VERSION:'synthetic',RELEASE_ID:'synthetic',
});
vm.runInContext(routeBytes.toString('utf8'),context);
assert.equal(routes.length,1);
async function request(path) {
  const req={path},res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=JSON.parse(JSON.stringify(body));return this;}};
  for(const fn of routes[0].stack){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
  return res;
}
let cases=0;
async function publicStatus(status) {
  const res=await request('/health');assert.equal(res.statusCode,status);
  assert.deepEqual(res.body,{ok:status===200,process_alive:true});cases++;
}
await publicStatus(200);
for(const key of keys){row[key]=false;await publicStatus(503);row[key]=true;}
paused=true;await publicStatus(503);paused=false;
secretReady=false;await publicStatus(503);secretReady=true;
throws=true;await publicStatus(503);throws=false;
const before=probes,diagnostics=await request('/health/dependencies');
assert.equal(diagnostics.statusCode,401);assert.equal(probes,before);assert.equal(diagnostics.body.ok,false);cases++;
console.log(JSON.stringify({ok:true,scope:'Exact qualified API readiness-route and boundary source; synthetic dependency inputs, no sockets/DB/real credentials',predicate_cases:cases,api_commit:policy.source_commit}));
