// Executes the actual index route declarations without starting its servers/workers.
// Synthetic manager store and dependency probes; no sockets, DB or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomBytes,randomUUID} from 'node:crypto';
import {setAllowedCorsOrigin,requireHealthDiagnostics,healthResponse} from '../src/security-http-boundaries.js';
import {makeOpsAccessMiddleware,createOpsManagerSession} from '../src/auth/shared-access-auth.js';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const env={NODE_ENV:'test',OPS_MANAGER_AUTH_REQUIRED:'true',OPS_MANAGER_SESSION_SECRET:randomBytes(32).toString('hex')};
const manager={manager_id:randomUUID(),display_name:'Synthetic manager',roles:['OPS_MANAGER'],system_key:'synthetic_manager',is_system_principal:false,active:true,revoked_at:null};
const row={credential_id:randomUUID(),device_id:'synthetic-security-browser',manager_id:manager.manager_id,manager,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),max_access_level:'full_access',revoked_at:null};
const sign=now=>createOpsManagerSession({credentialId:row.credential_id,deviceId:row.device_id,manager,accessLevel:'full_access',env,...(now?{now}:{})}).token;
const token=sign(),expired=sign(new Date(Date.now()-3600000)),requireOpsManagerAuth=makeOpsAccessMiddleware({env,trustedDeviceStore:{find:async id=>id===row.credential_id?row:null}});
let probes=0,probeError=false,healthy=true;const routes=[];
const context=vm.createContext({app:{get:(path,...stack)=>routes.push({paths:Array.isArray(path)?path:[path],stack})},requireOpsManagerAuth,requireHealthDiagnostics,healthResponse,setAllowedCorsOrigin,
 CORS_ORIGINS_SET:new Set(['https://allowed.invalid']),setPublicDashboardCors(){},configuredReleaseCanaryDeviceId:()=> 'SYNTHETIC-CANARY-PRIVATE',releaseCanaryConfigurationRequired:()=>true,
 runReadOnlySql:async()=>{probes++;if(probeError)throw Error('SYNTHETIC-RAW-SECRET');return [{database_reachable:healthy,transaction_read_only:true,dedicated_reader_member:true,reader_role_restricted:true,sessions_table:true,messages_table:true,notification_outbox_table:true,message_audit_table:true,exact_finish_rpc:true,manager_messaging_rpc:true,worker_claim_rpc:true,notification_backlog:7}];},
 runRpc:async()=>false,offlineAuthoritySecret:()=> 'SYNTHETIC-NO-PROVIDER',getDeviceCredentialSecretReadiness:async()=>({ready:true,private_count:9}),supabaseAdmin:null,process:{env:{}},
 buildHealthPayload:(area,extra)=>({area,release_id:'SYNTHETIC-RELEASE-PRIVATE',...extra}),buildReleaseManifest:()=>({schema:{fingerprint:'SYNTHETIC-SCHEMA-PRIVATE'}}),APP_VERSION:'test',RELEASE_ID:'test',
 runCanaryChecks:async()=>{probes++;return {ok:true,private_canary:true};},collectBackendAuthorityHealth:async()=>{probes++;return {ok:true,private_authority:true};},
 authorityHttpFailure:()=>({status:503,body:{ok:false,error:'private failure'}}),console:{error(){}},});
function evaluate(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);vm.runInContext(source.slice(a,b),context);}
evaluate('function setCorsOrigin(', '\nfunction setAdminApiCors(');
evaluate('app.get(["/health", "/health/dependencies"]', 'app.get("/admin-api/health"');
evaluate('app.get("/dashboard-api/canary"', 'app.get("/dashboard-api/current-attendance"');
evaluate('app.get("/scan-api/authority-health"', '// Fixed original readback only.');
function response(){return {statusCode:200,headers:{},status(n){this.statusCode=n;return this;},json(value){this.body=JSON.parse(JSON.stringify(value));return this;},setHeader(k,v){this.headers[k.toLowerCase()]=v;},removeHeader(k){delete this.headers[k.toLowerCase()];},vary(k){this.headers.vary=[...new Set([...(this.headers.vary||'').split(/,\s*/).filter(Boolean),k])].join(', ');}};}
async function request(path,auth){const route=routes.find(r=>r.paths.includes(path));assert.ok(route);const headers=auth?{authorization:'Bearer '+auth}:{};const req={path,url:path,originalUrl:path,method:'GET',headers,get:k=>headers[k.toLowerCase()]||'',header:k=>headers[k.toLowerCase()]||''},res=response();for(const fn of route.stack){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}return res;}
const checks=[];const pass=s=>{checks.push(s);console.log('PASS '+s);};
for(const origin of [undefined,'https://unapproved.invalid','null','https://allowed.invalid.evil']){const res=response();res.setHeader('Access-Control-Allow-Origin','https://stale.invalid');res.setHeader('Access-Control-Allow-Credentials','true');res.vary('Accept-Encoding');context.setCorsOrigin(res,{headers:origin?{origin}:{}});assert.equal(res.headers['access-control-allow-origin'],undefined);assert.equal(res.headers['access-control-allow-credentials'],undefined);assert.equal(res.headers.vary,'Accept-Encoding, Origin');}pass('actual CORS helper omits absent/disallowed origins and removes stale grants while preserving Vary');
{const res=response();context.setCorsOrigin(res,{headers:{origin:'https://allowed.invalid'}});assert.equal(res.headers['access-control-allow-origin'],'https://allowed.invalid');assert.equal(res.headers['access-control-allow-credentials'],'true');}pass('allowed incoming origin is echoed exactly');
for(const path of ['/health/dependencies','/dashboard-api/canary','/scan-api/authority-health']){
 for(const auth of [undefined,'SYNTHETIC-EMPLOYEE-NONMANAGER',expired]){const before=probes,r=await request(path,auth);assert.equal(r.statusCode,401);assert.equal(probes,before);assert.ok(!JSON.stringify(r.body).includes('PRIVATE'));}pass(path+' rejects anonymous, nonmanager and expired sessions before probes');
 row.revoked_at=new Date().toISOString();const before=probes,r=await request(path,token);assert.equal(r.statusCode,401);assert.equal(probes,before);row.revoked_at=null;pass(path+' rejects revoked manager before probes');
 const allowed=await request(path,token);assert.equal(allowed.statusCode,200);assert.ok(JSON.stringify(allowed.body).includes('private')||JSON.stringify(allowed.body).includes('PRIVATE'));pass(path+' retains detailed response for current manager');
}
for(const [ready,error,status] of [[true,false,200],[false,false,503],[true,true,503]]){healthy=ready;probeError=error;const r=await request('/health');assert.equal(r.statusCode,status);assert.deepEqual(r.body,{ok:status===200,process_alive:true});}pass('public health preserves successful, unhealthy and failed-probe readiness status with only minimal payload');
const runtime=readFileSync(new URL('../src/auth/custodial-leadership-runtime.js',import.meta.url),'utf8'),start=runtime.indexOf('function allowedPath('),end=runtime.indexOf('\nfunction controlOrigin(',start);const allow=vm.runInNewContext(runtime.slice(start,end)+';allowedPath');
for(const path of ['/health/dependencies','/scan-api/authority-health','/status/deep']){assert.equal(allow({method:'GET',originalUrl:path}),true);assert.equal(allow({method:'POST',originalUrl:path}),false);}pass('exact cohort diagnostics GET scope retains mutation denial');
const notifications=readFileSync(new URL('../src/manager-notifications.js',import.meta.url),'utf8');assert.match(notifications,/app.get\("\/manager-notifications-api\/health", requireManager,/);assert.match(notifications,/Access-Control-Allow-Headers[^\n]+X-CSRF-Token/);pass('notification diagnostics uses current manager auth and preflight permits browser CSRF');
console.log(JSON.stringify({suite:'security-http-boundaries',status:'PASS',checks:checks.length,noNetwork:true,noDatabase:true}));
