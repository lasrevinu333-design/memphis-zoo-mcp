import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertDecisionMigrationManifest,readDecisionSource,assertDecisionTarget,compareDecisionRecoverySets,
 DECISION_IMAGE,DECISION_RPC,DECISION_HEAD,DECISION_217,DECISION_218,DECISION_INPUT_PINS} from './native-provider-event-decisions-database-tests.mjs';

// Only actual source reads, pure hostile-data cases and --source-check. No
// database/container/HTTP/solver process or forged engine receipt is permitted.
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const source=readDecisionSource();
check('actual exact218 and independently pinned217 prefix',()=>{assert.equal(source.migrations.length,218);assert.equal(source.manifest_sha256,DECISION_218);assert.equal(source.migrations.at(-1).file,DECISION_HEAD);assert.equal(DECISION_217,'e07cee99644bc1d22f61e89e5e14f383b4c250cb0cb012e723a318a89bf5da87');});
for(const mutate of [x=>x.pop(),x=>x.push({...x.at(-1),file:'20261005000000_unowned.sql'}),x=>x.reverse(),x=>x[0].sha256='0'.repeat(64),
 x=>x[216].sha256='0'.repeat(64),x=>x[217].sha256='0'.repeat(64),x=>x[217].file='20261003000000_wrong_order.sql',x=>x[5]={...x[4]},
 x=>x[0].extra=true,x=>x[0].file='../supabase.sql',x=>x[0].sha256=null])check('manifest mutation fails closed',()=>{const bad=structuredClone(source.migrations);mutate(bad);assert.throws(()=>assertDecisionMigrationManifest(bad));});
check('immutable five-file source and authenticated dependencies pinned',()=>{for(const file of ['src/native-provider-api.js','src/native-provider-event-decisions.js','scripts/fixtures/native-provider-event-decisions-database-cases.mjs','src/auth/device-credential-auth.js','src/request-json-parser.js'])assert.match(DECISION_INPUT_PINS[file],/^[0-9a-f]{64}$/);});
const target={id:'a'.repeat(64),fixture_id:'12345678-1234-4234-8234-123456789012'};target.name='mz_schema_rebuild_native_decisions_'+target.fixture_id.replaceAll('-','');
const row={Id:target.id,Name:'/'+target.name,Image:DECISION_IMAGE.split('@')[1],State:{Running:true},HostConfig:{NetworkMode:'none',PortBindings:{}},
 NetworkSettings:{Ports:{'5432/tcp':null}},Config:{Labels:{'custodial.owner':'native-provider-event-decisions','custodial.synthetic':'true','custodial.fixture-id':target.fixture_id}},
 Mounts:[{Type:'tmpfs',Destination:'/var/lib/postgresql/data',Source:'',RW:true}]};
check('exact owned running network-none target accepted as pure data only',()=>assert.deepEqual(assertDecisionTarget(row,target),target));
check('stopped exact owned target may be cleaned but never queried',()=>{const r={...row,State:{Running:false}};assert.throws(()=>assertDecisionTarget(r,target));assertDecisionTarget(r,target,{allowStopped:true});});
for(const mutate of [x=>x.Id='b'.repeat(64),x=>x.Name='/foreign',x=>x.Image='sha256:'+'b'.repeat(64),x=>x.HostConfig.NetworkMode='bridge',
 x=>x.HostConfig.PortBindings={'5432/tcp':[{HostPort:'5432'}]},x=>x.NetworkSettings.Ports={'5432/tcp':[{HostPort:'5432'}]},
 x=>x.Config.Labels['custodial.owner']='other',x=>x.Config.Labels['custodial.fixture-id']='other',x=>x.Config.Labels['custodial.synthetic']='false',
 x=>x.Mounts=[{Type:'bind',Source:'/data',Destination:'/var/lib/postgresql/data',RW:true}],x=>x.Mounts[0].Destination='/other',
 x=>x.Mounts[0].RW=false,x=>x.State.Running=null])check('hostile target refused before command',()=>{const bad=structuredClone(row);mutate(bad);assert.throws(()=>assertDecisionTarget(bad,target));});
const canary={object_kind:'function',object_identity:'custodial_release_canary_authority_surface()',restore_order:100071,definition_sql:'synthetic-prior',definition_sha256:'a'.repeat(64),captured_at:'synthetic-time'};
const other={object_kind:'relation',object_identity:'public.synthetic_protected',restore_order:1001,definition_sql:'synthetic-definition',definition_sha256:'b'.repeat(64),captured_at:'synthetic-time'};
const before={inventory:[canary,other],surface:[{object_kind:'relation',object_identity:other.object_identity,purpose:'prior'}]};
const additions=['function','grant'].map((object_kind,i)=>({object_kind,object_identity:DECISION_RPC,restore_order:100072+i,definition_sql:'synthetic-new-'+i,definition_sha256:'c'.repeat(64),captured_at:'synthetic-time'}));
const after={inventory:[{...canary,definition_sql:'synthetic-next',definition_sha256:'d'.repeat(64)},other,...additions],surface:[...before.surface,...additions.map(({object_kind,object_identity})=>({object_kind,object_identity,purpose:'new'}))]};
check('pure delta model permits only two fixed members and canary bytes',()=>assert.equal(compareDecisionRecoverySets(before,after).all_other_predecessor_rows_exact,true));
for(const mutate of [x=>x.inventory.pop(),x=>x.inventory.push({...other,object_identity:'public.unowned'}),x=>x.inventory[1].definition_sql='drift',
 x=>x.inventory[1].definition_sha256='d'.repeat(64),x=>x.inventory[1].restore_order++,x=>x.inventory[1].captured_at='recaptured',
 x=>x.inventory[0].restore_order++,x=>x.surface.pop(),x=>x.surface[0].purpose='changed',x=>x.surface.push({...x.surface[0]}),
 x=>x.inventory[2].object_kind='view',x=>x.inventory[3].object_identity='public.other()',x=>x.surface[1].object_kind='view'])
 check('recovery delta mutation refused',()=>{const bad=structuredClone(after);mutate(bad);assert.throws(()=>compareDecisionRecoverySets(before,bad));});
const runnerPath=fileURLToPath(new URL('./native-provider-event-decisions-database-tests.mjs',import.meta.url)),runner=readFileSync(runnerPath,'utf8');
for(const [name,pattern] of [
 ['explicit source/execute distinction',/process\.argv\[2\]==='--source-check'[\s\S]+assert\.equal\(process\.argv\[2\],'--execute'\)/],
 ['pinned local socket no endpoint',/\['--host','unix:\/\/\/var\/run\/docker\.sock'/],
 ['no image pulling',/\['run','-d','--pull','never','--network','none'/],
 ['source-bound exceptions preserve absent defaults',/sql\(ABSENT\+'\\n'\+bytes\+'\\n'\+\(EXCEPTIONS\[m\.file\]\?REMOVE_DEFAULTS:''\)\+'\\n'\+ABSENT\)/],
 ['actual owning cases mandatory',/nativeProviderEventDecisionDatabaseCases\(\{scope:'network-none-synthetic-no-auto-grants'/],
 ['events actual admission not direct insert',/const admitted=JSON\.parse\(sql\(`select public\.custodial_native_provider_events_at/],
 ['current middleware actual rows',/findCredential:async id=>JSON\.parse\(sql/],
 ['HMAC actual HTTP',/createHmac\('sha256',secret\)\.update\(proof\)/],
 ['actual SQL service-only lookup',/set role service_role;select public\.custodial_native_provider_event_decisions/],
 ['before rollback protected readback',/scoped restore preserves protected rows BEFORE rollback/],
 ['scope does not configure recovery authority',/global_controller_restore:false/],
 ['normal and signal finally cleanup',/finally\{if\(server\)[\s\S]+cleanup\(\);process\.removeListener/],
 ['ambiguous launch exact named reconciliation',/launchAttempted&&!created[\s\S]+assertDecisionTarget\(row,target,\{allowStopped:true\}\)/],
 ['exact-ID cleanup',/docker\(\['rm','-f',target\.id\]\)/],
 ['private no-overwrite outputs',/flag:'wx',mode:0o600/],
 ['readonly source identity end fence',/assert\.deepEqual\(readDecisionSource\(\),source\)/],
 ['migration failure binds exact unapplied file',/save\('failed-migration\.json',\{file:m\.file,sha256:m\.sha256,index,applied_predecessors:index,status:'FAIL'\}\)/],
 ['PASS receipt written only after verified cleanup',/assert\.equal\(cleaned,true\);assert\.equal\(created,false\);assert\.ok\(receipt\);\s+save\('receipt\.json'/],
 ])check(name,()=>assert.match(runner,pattern));
check('no accepted-event INSERT or original migration rewrite',()=>{assert.doesNotMatch(runner,/insert into public\.employee_native_provider_events\b/i);assert.doesNotMatch(runner,/writeFileSync\([^\n]*(?:migration|supabase)/);});
check('no solver browser JVM full controller or runtime activation',()=>assert.doesNotMatch(runner,/custodial_configure_backend_execution_key|custodial_control_release_canary|seedCompiledEventAuthority|spawn\([^\n]*(?:java|playwright)|run-isolated-shift-end-tests/));
check('actual CLI source check runs without engine',()=>{const value=JSON.parse(execFileSync(process.execPath,[runnerPath,'--source-check'],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024}));assert.equal(value.scope,'SOURCE_ONLY_NO_ENGINE');assert.equal(value.status,'PASS');assert.deepEqual(value.migrations,source.migrations);});
console.log(JSON.stringify({status:'PASS',checks,scope:'SOURCE_CONTRACT_AND_PURE_HOSTILE_DATA_ONLY',actualSourceCheck:true,databaseExecuted:false,containerCreated:false,httpExecuted:false,engineEvidence:false}));
