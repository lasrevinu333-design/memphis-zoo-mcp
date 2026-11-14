// Execute the real observer URL/header plan and fetch batch with synthetic responses.
// No provider, credential enrollment, database, workflow dispatch or server startup.
import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const source=readFileSync(new URL('./live-release-alignment-check.mjs',import.meta.url),'utf8');
const start=source.indexOf('const healthUrl ='),end=source.indexOf('const [frontend,',start);assert.ok(start>0&&end>start);
const plan=source.slice(start,end),fetchStart=source.indexOf('async function fetchJson('),fetchEnd=source.indexOf('const attestation =',fetchStart);
const batchEnd=source.indexOf('const health = healthProbe.json;',end);assert.ok(batchEnd>end);
const token='SYNTHETIC-EXISTING-OBSERVER-NOT-A-REAL-CREDENTIAL';const backendUrl='https://canonical.invalid/release-manifest';
const hasDashboard=source.includes('const dashboardCanaryUrl');let checks=0;
function context(env={}){return vm.createContext({process:{env},URL,assert,backendUrl,schemaToken:token,requiredEnv:()=> 'https://scheduler.invalid/ready'});}
const good=context();vm.runInContext(plan+';globalThis.plan={healthUrl,authorityHealthUrl,monitorHeaders'+(hasDashboard?',dashboardCanaryUrl':'')+'};',good);
assert.equal(good.plan.healthUrl,'https://canonical.invalid/admin-api/release-monitor/dependencies');assert.equal(good.plan.authorityHealthUrl,'https://canonical.invalid/admin-api/release-monitor/authority');checks+=2;
for(const key of ['BACKEND_HEALTH_URL','BACKEND_AUTHORITY_HEALTH_URL'])for(const bad of ['https://foreign.invalid/admin-api/release-monitor/dependencies','https://canonical.invalid/health','https://canonical.invalid/admin-api/release-monitor/dependencies?token=x','https://user:pass@canonical.invalid/admin-api/release-monitor/dependencies']){
 assert.throws(()=>vm.runInContext(plan,context({[key]:bad})));checks++;
}
const calls=[];Object.assign(good,{performance,AbortSignal,frontendReleaseUrl:'https://frontend.invalid/release.json',frontendDeploymentUrl:'https://frontend.invalid/deployment.json',identityUrl:'https://canonical.invalid/admin-api/release-schema-identity',fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})};}});
vm.runInContext(source.slice(fetchStart,fetchEnd),good);
await vm.runInContext('(async()=>{'+source.slice(end,batchEnd)+'})()',good);
for(const call of calls){const path=new URL(call.url).pathname;assert.equal(call.options.redirect,'error');if(path.startsWith('/admin-api/release-monitor/')||path==='/admin-api/release-schema-identity')assert.equal(call.options.headers.authorization,'Bearer '+token);else assert.equal(call.options.headers.authorization,undefined);checks++;}
assert.equal(calls.filter(c=>new URL(c.url).pathname.startsWith('/admin-api/release-monitor/')).length,hasDashboard?3:2);checks++;
console.log(JSON.stringify({suite:'release-monitor-contract',checks,client_probes:hasDashboard?3:2,network:false,production_mutations:0,status:'PASS'}));
