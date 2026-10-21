import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as fixtureApi from './fixtures/native-provider-event-decisions-database-cases.mjs';
import {validateNativeDecisionInput,nativeDecisionSeed,assertNativeDecisionHttpCapture,NATIVE_DECISION_INPUT_SCHEMA,NATIVE_DECISION_PATH} from './fixtures/native-provider-event-decision-native-wire.mjs';
import {assertDecisionMigrationManifest,assertCurrentDecisionMigrationManifest,decisionMigrationProfile,assertDecisionLookupBoundary,assertDecisionLookupPredecessor,
 readDecisionSource,assertDecisionTarget,compareDecisionRecoverySets,buildDecisionRecoveryProtocol,parseDecisionRecoveryProtocol,
 DECISION_IMAGE,DECISION_RPC,DECISION_HEAD,DECISION_217,DECISION_218,DECISION_219,DECISION_MESSAGE_FILE,DECISION_MESSAGE_SHA,DECISION_INPUT_PINS} from './native-provider-event-decisions-database-tests.mjs';

// Only actual source reads, pure hostile-data cases and --source-check. No
// database/container/HTTP/solver process or forged engine receipt is permitted.
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
// Explicit pure DTO models, NOT Java preparation or engine evidence.
const wireSha=x=>createHash('sha256').update(x).digest('hex'),uid=n=>'44000000-0000-4000-8000-'+String(n).padStart(12,'0');
const wireToken='synthetic-pure-data-NOT-JVM';
const register={schema:'custodial.native-provider-register.v1',operation_id:uid(1),generation_id:uid(2),credential_id:uid(3),employee_id:uid(4),device_id:'KIOSK_08',assignment_epoch:4,principal_digest:'a'.repeat(64),token_digest:wireSha(wireToken),token:wireToken,native_app:{version_name:'synthetic'}};
const wirePayload={schema:'custodial.native-provider-payload.v1',generation_id:uid(2),principal_digest:register.principal_digest,token_digest:register.token_digest,receipt_job_id:uid(5),receipt_credential_id:uid(3),receipt_employee_id:uid(4),receipt_device_id:'KIOSK_08',receipt_assignment_epoch:'4',notification_key:'b'.repeat(64),reservation_at:'2026-09-24T17:00:00.000000Z',valid_until:'2026-09-24T18:00:00.000000Z',kind:'employee_lunch_coverage',notification_type:'lunch_coverage',title:'Synthetic',body:'Pure DTO only',channel_id:'employee-lunch-coverage',route:'employee-schedule.html?hub=employee',service_date:'2026-09-24',event:'start',loan_id:'c'.repeat(64),scheduled_time:'12:00',scheduled_at:'2026-09-24T17:00:00.000000Z',coverer_slot_id:'staff-slot-2',projection_id:uid(6),document_identity:'d'.repeat(64)};
const signedPayload=value=>({...value,content_sha256:wireSha(JSON.stringify(Object.fromEntries(Object.entries(value).filter(([k])=>k!=='content_sha256').sort(([a],[b])=>a<b?-1:1))))});
Object.assign(wirePayload,signedPayload(wirePayload));
const observation={earliest_at:'2026-09-24T17:00:00.123457Z',latest_at:'2026-09-24T17:00:00.123459Z',clock_profile_id:'SYNTHETIC_ONLY_PC01',elapsed_realtime_ms:101,boot_count:7};
const wireEvent=(action,n,p=wirePayload)=>({schema:'custodial.native-provider-event.v2',event_id:uid(n),record_id:wireSha(p.generation_id+'\n'+p.receipt_job_id+'\n'+p.notification_key),action,...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(k=>[k,p[k]])),receipt_assignment_epoch:4,admission_bounds:observation,original_observation:observation});
const originals=['received','displayed','opened','acknowledged'].map((a,i)=>wireEvent(a,10+i));
const requester={current_generation_id:uid(2),...Object.fromEntries(['principal_digest','token_digest','credential_id','employee_id','device_id','assignment_epoch'].map(k=>[k,register[k]]))};
const queryFor=events=>{const raw=JSON.stringify({schema:'custodial.native-provider-event-decision-query.v1',requester,events});return {path:NATIVE_DECISION_PATH,method:'POST',body_base64:Buffer.from(raw).toString('base64'),body_sha256:wireSha(raw)};};
const eventRow=e=>({domain:'EVENT',id:e.event_id,json:JSON.stringify({...e,schema:'custodial.native-provider-journal.v1',state:'PENDING',receipt_assignment_epoch:String(e.receipt_assignment_epoch)})});
const fixturePrefix='mobile/plugins/custodial-native-vault/android/src/';
const wireModel={schema:NATIVE_DECISION_INPUT_SCHEMA,synthetic:true,production:false,frontend:{commit:'a'.repeat(40),tree:'b'.repeat(40),files:[{path:fixturePrefix+'main/java/org/memphiszoo/custodial/vault/NativeProviderEventDecisions.java',sha256:'a'.repeat(64)},{path:fixturePrefix+'main/java/org/memphiszoo/custodial/vault/NativeProviderJournal.java',sha256:'b'.repeat(64)},{path:fixturePrefix+'test/java/org/memphiszoo/custodial/vault/NativeProviderEventDecisionSqlWireTest.java',sha256:'c'.repeat(64)},{path:'mobile/scripts/custodial-provider-storage-tests.mjs',sha256:'d'.repeat(64)}],jars:['JUNIT_JAR','HAMCREST_JAR','JSON_JAR','ANDROID_API_JAR'].map(name=>({name,sha256:'e'.repeat(64)}))},
 seed:{principal:Object.fromEntries(['credential_id','employee_id','device_id','assignment_epoch'].map(k=>[k,register[k]])),registration:register,registration_receipt:{generation_id:uid(2),registration_id:uid(7),activated_at:'2026-09-24T12:00:00.123456Z'},payload:wirePayload,journal_revision:8,records:[...originals.map(eventRow),{domain:'METADATA',id:'synthetic-meta',json:'{}'},{domain:'GENERATION',id:uid(2),json:'{}'}]},query:queryFor(originals)};
const missingOriginal=wireEvent('received',99,signedPayload({...wirePayload,receipt_job_id:'77000000-0000-4000-8000-000000000099'}));
wireModel.unresolved={seed:{...structuredClone(wireModel.seed),journal_revision:9,records:[...structuredClone(wireModel.seed.records),eventRow(missingOriginal)]},query:queryFor([...originals,missingOriginal])};
const modelPrepared=validateNativeDecisionInput(wireModel);
check('pure native input model preserves exact serialized body instead of pretty reserialization',()=>{assert.equal(modelPrepared.raw.toString('base64'),wireModel.query.body_base64);assert.notEqual(wireSha(' \n'+JSON.stringify(modelPrepared.body,null,2)+'\n'),wireModel.query.body_sha256);assert.deepEqual(nativeDecisionSeed(modelPrepared).request.events,originals);});
for(const [name,mutate] of [
 ['unknown envelope',x=>x.extra=true],['wrong schema',x=>x.schema='other'],['production',x=>x.production=true],['not synthetic',x=>x.synthetic=false],
 ['unknown source',x=>x.frontend.extra=true],['missing source',x=>x.frontend.files.pop()],['unsafe source path',x=>x.frontend.files[0].path='../private'],['duplicate source',x=>x.frontend.files.push(x.frontend.files[0])],['bad source hash',x=>x.frontend.files[0].sha256='bad'],
 ['missing jar',x=>x.frontend.jars.pop()],['reordered jar',x=>x.frontend.jars.reverse()],['unknown jar',x=>x.frontend.jars[0].name='OTHER'],['bad jar hash',x=>x.frontend.jars[0].sha256='bad'],
 ['wrong route',x=>x.query.path='/other'],['wrong method',x=>x.query.method='GET'],['wrong query hash',x=>x.query.body_sha256='0'.repeat(64)],['bad base64',x=>x.query.body_base64+='!'],
 ['crossed requester',x=>x.seed.registration.assignment_epoch=5],['real-token marker refused',x=>x.seed.registration.token='not-synthetic'],['unknown record domain',x=>x.seed.records[0].domain='CLEANING'],['duplicate record',x=>x.seed.records.push(x.seed.records[0])],
 ['altered original stored event',x=>{const v=JSON.parse(x.seed.records[0].json);v.action='opened';x.seed.records[0].json=JSON.stringify(v);}],['missing original',x=>x.seed.records.shift()],['already settled',x=>{const v=JSON.parse(x.seed.records[0].json);v.state='SETTLED';x.seed.records[0].json=JSON.stringify(v);}],
 ['too many reconstruction commits',x=>x.seed.journal_revision=33],['missing unresolved case',x=>delete x.unresolved],['same unresolved revision',x=>x.unresolved.seed.journal_revision=8],['crossed supplemental principal',x=>x.unresolved.seed.principal.assignment_epoch=5],
 ])check('pure native input rejects '+name,()=>{const bad=structuredClone(wireModel);mutate(bad);assert.throws(()=>validateNativeDecisionInput(bad));});
check('duplicate raw JSON keys reject even with internally matching hash',()=>{const bad=structuredClone(wireModel);const raw=modelPrepared.raw.toString().replace('{','{"schema":"other",');bad.query.body_base64=Buffer.from(raw).toString('base64');bad.query.body_sha256=wireSha(raw);assert.throws(()=>validateNativeDecisionInput(bad));});
const httpCapture=(prepared,missing=false)=>{const value={ok:true,data:{schema:'custodial.native-provider-event-decisions.v1',native_request_id:uid(40),request_body_sha256:prepared.input.query.body_sha256,requester:prepared.body.requester,results:prepared.body.events.map(e=>missing&&e.event_id===missingOriginal.event_id?{event_id:e.event_id,decision:'UNRESOLVED'}:{event_id:e.event_id,decision:'ORIGINAL_ACCEPTED',receipt:{...e,schema:'custodial.native-provider-event-receipt.v2',admitted_state:'ACCEPTED',replayed:true,server_received_at:'2026-09-24T17:00:01.000000Z'}})}};const raw=JSON.stringify(value);return {status:200,content_type:'application/json; charset=utf-8',body_base64:Buffer.from(raw).toString('base64'),body_sha256:wireSha(raw),request_id:uid(40),request_body_sha256:prepared.input.query.body_sha256};};
check('pure captured-body models validate original acceptance and honest unresolved without rewriting',()=>{assertNativeDecisionHttpCapture(modelPrepared,httpCapture(modelPrepared));assertNativeDecisionHttpCapture(modelPrepared.missing,httpCapture(modelPrepared.missing,true),{missing:true});});
for(const mutate of [x=>x.status=403,x=>x.content_type='text/html',x=>x.request_id=uid(41),x=>x.request_body_sha256='0'.repeat(64),x=>x.body_sha256='0'.repeat(64),x=>x.extra=true,x=>x.body_base64+='!'])
 check('pure response framing refuses altered context or content',()=>{const bad=httpCapture(modelPrepared);mutate(bad);assert.throws(()=>assertNativeDecisionHttpCapture(modelPrepared,bad));});
for(const mutate of [x=>x.data.native_request_id=uid(41),x=>x.data.request_body_sha256='0'.repeat(64),x=>x.data.requester.assignment_epoch=5,
 x=>x.data.results.pop(),x=>x.data.results.push(x.data.results[0]),x=>x.data.results[0].event_id=uid(90),x=>x.data.results[0].decision='PERMANENTLY_DENIED',
 x=>x.data.results[0].receipt.replayed=false,x=>x.data.results[0].receipt.original_observation.boot_count=8,x=>x.data.results[0].receipt.receipt_job_id=uid(90)])
 check('pure hostile raw response derivative rejects even with recomputed transport checksum',()=>{const bad=httpCapture(modelPrepared),value=JSON.parse(Buffer.from(bad.body_base64,'base64'));mutate(value);const raw=JSON.stringify(value);bad.body_base64=Buffer.from(raw).toString('base64');bad.body_sha256=wireSha(raw);assert.throws(()=>assertNativeDecisionHttpCapture(modelPrepared,bad));});
const source=readDecisionSource();
const historicalMigrations=source.migrations.filter(r=>r.file!==DECISION_MESSAGE_FILE);
// Retained actual first218 engine stderr (run actual218-Jj4seo). This literal
// is PostgreSQL evidence of rejection, not a synthetic engine PASS receipt.
const dismissedPrimary='ERROR:  exact finite native event required\n';
const fixture=readFileSync(new URL('./fixtures/native-provider-event-decisions-database-cases.mjs',import.meta.url),'utf8');
check('full direct-read matrix distinguishes privilege denial from forced-RLS visibility',()=>{assert.equal(typeof fixtureApi.assertNativeEventDecisionAccess,'function');assert.equal(fixtureApi.NATIVE_EVENT_DECISION_DENIED_READS.length,20);assert.equal(new Set(fixtureApi.NATIVE_EVENT_DECISION_DENIED_READS.map(x=>x.join(':'))).size,20);assert.equal(fixtureApi.NATIVE_EVENT_DECISION_DENIED_READS.some(([r,t])=>r==='custodial_application_reader'&&t==='employee_native_push_delivery_receipts'),false);});
const ownerAcl=['postgres','supabase_admin'].flatMap(grantee=>['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'].map(privilege=>({grantee,privilege,grantable:false})));
const access={migration_authority:{current_user:'supabase_admin',session_user:'supabase_admin'},reader:{name:'custodial_application_reader',superuser:false,create_db:false,create_role:false,inherit:false,login:false,replication:false,bypassrls:false},
 relations:['employee_native_provider_events','employee_native_provider_event_requests','employee_native_push_delivery_receipts'].map(name=>({identity:'public.'+name,owner:'supabase_admin',rls:true,force_rls:true,policies:[],acl:[...ownerAcl,...(name==='employee_native_push_delivery_receipts'?[{grantee:'custodial_application_reader',privilege:'SELECT',grantable:false}]:[])]})),
 rpc:{identity:DECISION_RPC,owner:'supabase_admin',acl:['postgres','supabase_admin','service_role'].map(grantee=>({grantee,privilege:'EXECUTE',grantable:false}))},visibility:{owner_rows:1,reader_rows:0},
 delivery_recovery:{identity:'public.employee_native_push_delivery_receipts',recorded_sha256:'7aced0abd578cfce5bd83b2763e395a3618390790319a4c85d17eb7f7a48ee07',stored_sha256:'7aced0abd578cfce5bd83b2763e395a3618390790319a4c85d17eb7f7a48ee07',current_sha256:'7aced0abd578cfce5bd83b2763e395a3618390790319a4c85d17eb7f7a48ee07',definition_equal:true}};
check('pure source-intended SELECT with actual zero-visibility model is accepted',()=>fixtureApi.assertNativeEventDecisionAccess(access));
for(const mutate of [x=>x.visibility.reader_rows=1,x=>x.visibility.owner_rows=0,x=>x.relations[2].rls=false,x=>x.relations[2].force_rls=false,
 x=>x.reader.bypassrls=true,x=>x.reader.superuser=true,x=>x.reader.login=true,x=>x.reader.inherit=true,
 x=>x.relations[2].acl.push({grantee:'anon',privilege:'SELECT',grantable:false}),x=>x.relations[2].acl.push({grantee:'custodial_application_reader',privilege:'UPDATE',grantable:false}),
 x=>x.relations[2].acl.at(-1).grantable=true,x=>x.relations[2].policies.push('unexpected'),x=>x.rpc.acl.push({grantee:'authenticated',privilege:'EXECUTE',grantable:false}),
 x=>x.delivery_recovery.current_sha256='0'.repeat(64),x=>x.delivery_recovery.definition_equal=false])check('hostile ACL/RLS/visibility input fails closed without engine credit',()=>{const bad=structuredClone(access);mutate(bad);assert.throws(()=>fixtureApi.assertNativeEventDecisionAccess(bad));});
for(const mutate of [x=>x.migration_authority.current_user='postgres',x=>x.migration_authority.session_user='foreign',x=>x.relations[0].owner='postgres',x=>x.rpc.owner='postgres',
 x=>x.relations[0].acl.find(r=>r.grantee==='supabase_admin').grantable=true,x=>x.relations[0].acl=x.relations[0].acl.filter(r=>!(r.grantee==='supabase_admin'&&r.privilege==='MAINTAIN')),
 x=>x.rpc.acl=x.rpc.acl.filter(r=>r.grantee!=='postgres'),x=>x.rpc.acl.find(r=>r.grantee==='postgres').grantable=true,x=>x.rpc.acl.find(r=>r.grantee==='supabase_admin').privilege='SELECT'])
 check('fixed bootstrap owner and both exact administrative ACLs are mandatory',()=>{const bad=structuredClone(access);mutate(bad);assert.throws(()=>fixtureApi.assertNativeEventDecisionAccess(bad));});
check('access matrix is bound to historical explicit authority, not observed survivors',()=>{for(const [file,sha256] of [
 ['20260813210000_custodial_u4_ops_closure.sql','3fc7573beac21cf090fbf059c33ef59b472e88770382f7ff28d9f556a1e29f0b'],
 ['20260820133000_create_application_read_authority.sql','46635ef8ad01fce1b8540545961c60e75be0f8a524fc7213ed08aca60a0dc5e0'],
 ['20260823024500_provision_static_weekly_runtime_identity.sql','8b94b9a65bb58fb8739d171e19082398e7368cb8dc39684c7efec741649a5602'],
 ['20261003050000_native_provider_events.sql','cb665620d9612b0f6e7e4d15ace7aebc55a8a473ddf7ee88524bb4ca149d1e17'],
 ['20260815160613_normalize_managed_production_schema_security.sql','fcc15cab9a3c492f9958d91643e5c88f88f0917b31a3507d340c6fab67cb011a'],
 ['20260825174500_rebind_application_reader_release_recovery.sql','68f082382e9d9f05664e034716851121485d95d586b36c6b0714111b314be736']])assert.deepEqual(source.migrations.find(x=>x.file===file),{file,sha256});});
check('actual SQL fixture must collect visibility and invoke complete matrix checker',()=>{assert.match(fixture,/for\(const \[role,table\] of NATIVE_EVENT_DECISION_DENIED_READS\)\s*reject\(/);assert.ok(fixture.includes("reader_rows:Number(sql('set role custodial_application_reader;select count(*) from public.employee_native_push_delivery_receipts;'))"));assert.ok(fixture.includes("owner_rows:Number(sql('select count(*) from public.employee_native_push_delivery_receipts;'))"));assert.ok(fixture.includes("check('exact source ACL/RLS and non-bypass reader preserve zero row visibility',assertNativeEventDecisionAccess(authority),true)"));assert.ok(fixture.includes("for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])\n  reject(role+' denied lookup RPC'"));});
check('retained dismissed primary reproduces original generic matcher failure',()=>assert.doesNotMatch(dismissedPrimary,/exact native|unique original/));
const dismissal=fixture.match(/reject\('SQL rejects local Dismiss as unsupported event',[^\n]+,\/([^\n]+)\/\);/);
check('dismissed case has a standalone exact primary matcher',()=>{assert.ok(dismissal);assert.equal(dismissal[1],'^ERROR: {1,2}exact finite native event required\\n?$');assert.match(dismissedPrimary,new RegExp(dismissal[1]));});
check('dismissed exact matcher rejects unrelated or extended failures',()=>{const exact=new RegExp(dismissal[1]);for(const error of ['ERROR: permission denied\n','ERROR: exact native original event query required\n','prefix '+dismissedPrimary,dismissedPrimary+'CONTEXT: unaccepted detail\n',dismissedPrimary.replace('required','required but different')])assert.doesNotMatch(error,exact);});
check('six original generic malformed-shape expectations remain separate',()=>{const loop=fixture.match(/for\(const b of \[([\s\S]*?)\]\)\s*reject\('SQL strict decision query shape',[^\n]+,\/exact native\|unique original\/\);/);assert.ok(loop);assert.equal((loop[1].match(/\{\.\.\.input/g)||[]).length,6);assert.doesNotMatch(loop[1],/dismissed/);});
check('historical exact218 and independently pinned217 prefix remain strict',()=>{assertDecisionMigrationManifest(historicalMigrations);assert.equal(historicalMigrations.length,218);assert.equal(decisionMigrationProfile(historicalMigrations,'HISTORICAL_218').manifest_sha256,DECISION_218);assert.equal(historicalMigrations.at(-1).file,DECISION_HEAD);assert.equal(DECISION_217,'e07cee99644bc1d22f61e89e5e14f383b4c250cb0cb012e723a318a89bf5da87');});
for(const mutate of [x=>x.pop(),x=>x.push({...x.at(-1),file:'20261005000000_unowned.sql'}),x=>x.reverse(),x=>x[0].sha256='0'.repeat(64),
 x=>x[216].sha256='0'.repeat(64),x=>x[217].sha256='0'.repeat(64),x=>x[217].file='20261003000000_wrong_order.sql',x=>x[5]={...x[4]},
 x=>x[0].extra=true,x=>x[0].file='../supabase.sql',x=>x[0].sha256=null])check('historical manifest mutation fails closed',()=>{const bad=structuredClone(historicalMigrations);mutate(bad);assert.throws(()=>assertDecisionMigrationManifest(bad));assert.throws(()=>decisionMigrationProfile(bad,'HISTORICAL_218'));});
check('actual current219 binds full bytes plus only the exact additive MESSAGE row',()=>{assertCurrentDecisionMigrationManifest(source.migrations);assert.equal(source.migrations.length,219);assert.equal(source.manifest_sha256,DECISION_219);assert.equal(source.migration_profile,'CURRENT_219');assert.deepEqual(source.migrations[205],{file:DECISION_MESSAGE_FILE,sha256:DECISION_MESSAGE_SHA});assert.deepEqual(decisionMigrationProfile(source.migrations),{migration_profile:source.migration_profile,manifest_sha256:source.manifest_sha256,lookup_boundary:source.lookup_boundary});});
check('historical and current profiles cannot silently substitute for one another',()=>{assert.throws(()=>assertDecisionMigrationManifest(source.migrations));assert.throws(()=>assertCurrentDecisionMigrationManifest(historicalMigrations));assert.throws(()=>decisionMigrationProfile(historicalMigrations));assert.throws(()=>decisionMigrationProfile(source.migrations,'HISTORICAL_218'));});
for(const profile of [null,'',218,219,'AUTO','HISTORICAL_217','CURRENT_220',{}])
 check('unknown profile rejects instead of guessing from count',()=>assert.throws(()=>decisionMigrationProfile(source.migrations,profile)));
for(const [name,mutate] of [
 ['missing MESSAGE',x=>x.splice(205,1)],['duplicate MESSAGE',x=>x.push({...x[205]})],['missing old row',x=>x.splice(30,1)],
 ['extra row',x=>x.push({file:'20261005000000_unowned.sql',sha256:'a'.repeat(64)})],['wrong order',x=>x.reverse()],
 ['wrong old bytes',x=>x[30].sha256='0'.repeat(64)],['wrong MESSAGE bytes',x=>x[205].sha256='0'.repeat(64)],
 ['renamed MESSAGE',x=>x[205].file='20261003121758_employee_message_source_admission.sql'],['extra MESSAGE field',x=>x[205].extra=true],
 ['wrong head bytes',x=>x[218].sha256='0'.repeat(64)],['head renamed',x=>x[218].file='20261004000001_other.sql'],
 ['head not last',x=>[x[217],x[218]]=[x[218],x[217]]],['duplicate old identity',x=>x[4]={...x[5]}],
 ['old extra field',x=>x[0].extra=true],['malformed hash',x=>x[0].sha256=null],['malformed row',x=>x[205]=null],
 ['path escape',x=>x[0].file='../source.sql'],
 ])check('current219 hostile '+name+' is rejected by invoked validator and profile',()=>{const bad=structuredClone(source.migrations);mutate(bad);assert.throws(()=>assertCurrentDecisionMigrationManifest(bad));assert.throws(()=>decisionMigrationProfile(bad,'CURRENT_219'));});
for(const [profile,rows,count,prefix] of [
 ['HISTORICAL_218',historicalMigrations,217,DECISION_217],
 ['CURRENT_219',source.migrations,218,'af2f80877b572e24e8046df0a45d838dd5fddbc69a02d1050988ac400d2fbaf5'],
 ]){
 check(profile+' exact head boundary binds predecessor count and full prefix',()=>{const binding=assertDecisionLookupBoundary(rows,count,profile);assert.deepEqual(binding,{file:DECISION_HEAD,sha256:'ab4e6eb848bd214f8616fb52f094829786df9a9a81d2eb8d00d247b1f28e52fd',predecessor_count:count,predecessor_manifest_sha256:prefix});});
 for(const index of [count-1,count+1,0,null,String(count)])check(profile+' rejects misplaced predecessor snapshot',()=>assert.throws(()=>assertDecisionLookupBoundary(rows,index,profile)));
}
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
check('historical218 verifier bytes and constants are preserved exactly without Git-object dependency',()=>{
 const start=runner.indexOf('export function assertDecisionMigrationManifest(rows){'),end=runner.indexOf('// Explicit current profile',start);
 assert.ok(start>0&&end>start);assert.equal(wireSha(runner.slice(start,end)),'c169cb9c47828cb46dfb662fe756a9197b013466ea1b5f92f85ebd522a6c23f5');
 assert.equal(DECISION_218,'24503cfe852d7668ac94744b2f9ed21d8d2556906b917c7016e0f6c2d3b8d7a1');
});
const currentCanonical=JSON.parse(readFileSync(new URL('../supabase/canonical/schema-fingerprint-input.json',import.meta.url)));
const currentCanary=currentCanonical.functions.find(f=>f.function_name==='custodial_release_canary_authority_surface').definition;
const lookupSource=readFileSync(new URL('../supabase/migrations/'+DECISION_HEAD,import.meta.url),'utf8');
const additionsEscaped=lookupSource.match(/ additions text:=E'([^\n]*)';/)[1];
const additionsText=additionsEscaped.replaceAll("''","'").replaceAll('\\n','\n');
const originalCanary=currentCanary.replace('  values\n'+additionsText,'  values');
const predecessor={inventory:[{object_kind:'function',object_identity:'custodial_release_canary_authority_surface()',definition_sql:originalCanary,definition_sha256:wireSha(originalCanary)}],surface:[]};
check('source-derived exact original canary is accepted by invoked predecessor guard',()=>{assert.equal(wireSha(currentCanary),'4f2cac31af750c5bc10a50445583b27ae2c6e67b0f66fe72c078b53c533d00db');assert.notEqual(originalCanary,currentCanary);assert.equal(wireSha(originalCanary),'661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471');assertDecisionLookupPredecessor(predecessor);});
for(const mutate of [x=>x.inventory.pop(),x=>x.inventory.push({...x.inventory[0]}),x=>x.inventory[0].object_kind='grant',
 x=>x.inventory[0].object_identity='public.other()',x=>x.inventory[0].definition_sha256='0'.repeat(64),x=>x.inventory[0].definition_sql+=' ',
 x=>{x.inventory[0].definition_sql+=' ';x.inventory[0].definition_sha256=wireSha(x.inventory[0].definition_sql);},x=>delete x.surface])
 check('missing duplicate or changed canary predecessor fails before migration',()=>{const bad=structuredClone(predecessor);mutate(bad);assert.throws(()=>assertDecisionLookupPredecessor(bad));});
check('actual runner snapshots by exact head with mandatory boundary and canary guards',()=>{assert.ok(runner.includes('if(m.file===DECISION_HEAD){'));assert.ok(runner.includes('assertDecisionLookupBoundary(source.migrations,index,source.migration_profile)'));assert.ok(runner.includes('assertDecisionLookupPredecessor(predecessor)'));assert.ok(runner.includes("save('lookup-boundary.json',{migration_profile:source.migration_profile,...boundary})"));assert.doesNotMatch(runner,/if\(index===217\)/);assert.ok(runner.includes("save('after'+source.migrations.length+'.json',after)"));});
check('native fixture validation is before target creation or any SQL',()=>assert.ok(runner.indexOf('readNativeDecisionInput(nativePath,')<runner.indexOf("docker(['run'")));
check('actual bytes enter HMAC and fetch unchanged with no JSON reserialization in native mode',()=>{assert.ok(runner.includes("const bytes=prepared?prepared.raw:' \\n'+JSON.stringify(input,null,2)+'\\n'"));assert.ok(runner.includes("hash(bytes),requestId,timestamp"));assert.ok(runner.includes("headers,body:bytes"));assert.ok(runner.includes('Buffer.from(await r.arrayBuffer())'));});
check('unknown native original is actually sent through the same authenticated route',()=>{assert.ok(runner.includes('await send(()=>{},nativePrepared.missing.body,nativePrepared.missing)'));assert.ok(runner.includes('assertNativeDecisionHttpCapture(nativePrepared.missing,unresolved.capture,{missing:true})'));});
check('native export happens only after original success receipt and normal cleanup',()=>{assert.ok(runner.indexOf('writeNativeSqlFixture({envName:')>runner.indexOf("save('receipt.json'"));assert.ok(runner.includes("native_input_sha256:nativePrepared.input_sha256"));assert.ok(runner.includes('first:response.capture,retry:retry.capture,unresolved:unresolved.capture'));});
check('native request/response hash and nonce are never rewritten to match Java',()=>assert.doesNotMatch(runner,/\.native_request_id\s*=|\.request_body_sha256\s*=|\.request_id\s*=/));
check('new helper and unchanged private fixture writer are exact owning input pins',()=>{assert.match(DECISION_INPUT_PINS['scripts/fixtures/native-provider-event-decision-native-wire.mjs'],/^[0-9a-f]{64}$/);assert.equal(DECISION_INPUT_PINS['scripts/fixtures/native-sql-fixture-output.mjs'],'9f84c9e62d33dfeb48be4321db03a757bad96d059233941695feb3399d7d1e06');});
const digest=value=>createHash('sha256').update(value).digest('hex');
const recoveryGrant="select public.custodial_release_authority_reset_grants('"+DECISION_RPC+"'); grant execute on function custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to postgres; grant execute on function custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to service_role;";
const recoveryRows=['function','grant'].map(object_kind=>{const definition_sql=object_kind==='grant'?recoveryGrant:'-- synthetic captured function bytes; never executed by this test\n';return {object_kind,object_identity:DECISION_RPC,definition_sql,definition_sha256:digest(definition_sql)};});
const recoverySchema='custodial.native-event-decision-scoped-recovery-observation.v1';
const control={statement:'public.custodial_release_authority_reset_grants(text)',result:'EMPTY_VOID_RECORD',grant_sha256:'a45510c8ae211642dbd8fe79ba48f12be93f7c5a248a0184cc8b63959d0da6bc'};
const protectedNames=['devices','employees','device_auth_credentials','employee_push_registrations','employee_native_push_generations','employee_native_push_delivery_receipts',
 'employee_native_provider_events','employee_native_provider_event_requests','operational_notification_jobs','device_notification_acknowledgements',
 'sessions','completion_responses','maintenance_tickets','system_feedback_items','system_feedback_email_intents'];
const recoverySnapshot=Object.fromEntries(protectedNames.map(k=>[k,{count:1,sha256:'c'.repeat(64)}]));
const envelope=(phase,value)=>({schema:recoverySchema,phase,value});
const protocol=[envelope('FAULTED',{function:'a'.repeat(64),grant:'b'.repeat(64)}),envelope('GRANT_REPLAY_CONTROL',control),'',
 envelope('RESTORED',{function:'c'.repeat(64),grant:'d'.repeat(64)}),envelope('PROTECTED',recoverySnapshot)];
const encodeProtocol=rows=>rows.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n')+'\n';
check('source-derived void record reproduces prior JSON-only parser failure, not engine proof',()=>{const prior=[protocol[0].value,'',protocol[3].value,recoverySnapshot].map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n');assert.throws(()=>prior.split('\n').map(JSON.parse),{name:'SyntaxError',message:'Unexpected end of JSON input'});});
check('fixed four labelled observations and positioned void control parse without dropping data',()=>assert.deepEqual(parseDecisionRecoveryProtocol(encodeProtocol(protocol)),[protocol[0].value,protocol[3].value,recoverySnapshot]));
for(const [name,mutate] of [
 ['missing void record',x=>x.splice(2,1)],['extra void record',x=>x.splice(2,0,'')],['nonempty void record',x=>x[2]='null'],
 ['whitespace is not void',x=>x[2]=' '],['missing observation',x=>x.pop()],['additional observation',x=>x.push(x[4])],
 ['reordered labels',x=>[x[0],x[3]]=[x[3],x[0]]],['duplicate label',x=>x[3]=x[0]],['reordered void control',x=>[x[1],x[2]]=[x[2],x[1]]],
 ['malformed JSON',x=>x[3]='{'],['unlabelled null',x=>x[0]=null],['unlabelled array',x=>x[0]=[]],
 ['wrong schema',x=>x[0].schema='other'],['extra envelope field',x=>x[0].extra=true],['missing value',x=>delete x[0].value],
 ['wrong reset target',x=>x[1].value.statement='other(text)'],['wrong grant identity',x=>x[1].value.grant_sha256='0'.repeat(64)],
 ['control result mismatch',x=>x[1].value.result='IGNORED'],['extra control field',x=>x[1].value.extra=true],
 ['fault digest malformed',x=>x[0].value.function='bad'],['missing restored grant',x=>delete x[3].value.grant],
 ['extra live digest',x=>x[3].value.other='a'.repeat(64)],['missing protected table',x=>delete x[4].value.sessions],
 ['extra protected table',x=>x[4].value.other={count:0,sha256:'a'.repeat(64)}],['negative count',x=>x[4].value.sessions.count=-1],
 ['unsafe count',x=>x[4].value.sessions.count=Number.MAX_SAFE_INTEGER+1],['string count',x=>x[4].value.sessions.count='1'],
 ['protected digest malformed',x=>x[4].value.sessions.sha256=null],['extra protected field',x=>x[4].value.sessions.extra=true],
 ['raw error line',x=>x[3]='ERROR: synthetic failure']])check('recovery protocol rejects '+name,()=>{const bad=structuredClone(protocol);mutate(bad);assert.throws(()=>parseDecisionRecoveryProtocol(encodeProtocol(bad)));});
for(const bad of [encodeProtocol(protocol).slice(0,-1),encodeProtocol(protocol)+'\n','\n'+encodeProtocol(protocol),encodeProtocol(protocol).replaceAll('\n','\r\n'),'x'.repeat(65537),null])
 check('recovery framing rejects missing/extra terminator, CRLF, overflow and nonstring',()=>assert.throws(()=>parseDecisionRecoveryProtocol(bad)));
check('recovery builder replays exact captured bytes once in one rollback transaction',()=>{const text=buildDecisionRecoveryProtocol(...recoveryRows);assert.ok(text.startsWith('begin;'));assert.ok(text.endsWith('rollback;'));assert.doesNotMatch(text,/\bcommit;/i);for(const r of recoveryRows)assert.equal(text.split(r.definition_sql).length,2);const offsets=['synthetic new-RPC body fault','FAULTED',recoveryRows[0].definition_sql,'GRANT_REPLAY_CONTROL',recoveryGrant,'RESTORED','PROTECTED','rollback;'].map(x=>text.indexOf(x));assert.ok(offsets.every((n,i)=>n>=0&&(i===0||n>offsets[i-1])));});
for(const [name,mutate] of [['wrong kind',x=>x[0].object_kind='grant'],['wrong object',x=>x[1].object_identity='public.other()'],
 ['function bytes drift',x=>x[0].definition_sql+='changed'],['grant bytes drift',x=>x[1].definition_sql+='select 1;'],
 ['self-consistent but unapproved grant',x=>{x[1].definition_sql=x[1].definition_sql.replace('to service_role','to anon');x[1].definition_sha256=digest(x[1].definition_sql);}],
 ['self-consistent extra SELECT',x=>{x[1].definition_sql+='select 1;';x[1].definition_sha256=digest(x[1].definition_sql);} ]])
 check('fixed recovery SQL rejects '+name,()=>{const bad=structuredClone(recoveryRows);mutate(bad);assert.throws(()=>buildDecisionRecoveryProtocol(...bad));});
check('void protocol is bound to exact current historical helper and renderer sources',()=>{const u4=readFileSync(new URL('../supabase/migrations/20260813210000_custodial_u4_ops_closure.sql',import.meta.url),'utf8');assert.equal(digest(u4),'3fc7573beac21cf090fbf059c33ef59b472e88770382f7ff28d9f556a1e29f0b');assert.match(u4,/function public\.custodial_release_authority_reset_grants\(p_object_identity text\)\s+returns void/);assert.equal(digest(recoveryGrant),control.grant_sha256);});
check('raw scoped transcript and hashes persist UNVALIDATED before strict parser',()=>{assert.ok(runner.includes('recoveryStdout=sql(recoverySql,{raw:true})'));assert.ok(runner.includes('return raw?stdout:stdout.trim()'));assert.equal((runner.match(/\{raw:true\}/g)||[]).length,1);assert.ok(runner.indexOf("save('scoped-recovery-UNVALIDATED.stdout',recoveryStdout)")<runner.indexOf('const recovered=parseDecisionRecoveryProtocol(recoveryStdout)'));assert.ok(runner.includes("classification:'UNVALIDATED_SYNTHETIC_SCOPED_RECOVERY_OUTPUT'"));assert.ok(runner.includes('stdout_sha256:hash(recoveryStdout)'));assert.doesNotMatch(runner,/filter\(Boolean\)|catch\s*\{\s*return\s*\[\]/);});
check('all original fault, repair, protected and rollback comparisons remain mandatory',()=>{for(const exact of [
 'assert.equal(recovered.length,3);assert.notEqual(recovered[0].function,originalLive.function);assert.notEqual(recovered[0].grant,originalLive.grant)',
 "check('exact new function and grant definitions restore after actual scoped fault',recovered[1],originalLive)",
 "check('scoped restore preserves protected rows BEFORE rollback',recovered[2],protectedBefore)",
 "check('scoped recovery rollback exact live definitions',JSON.parse(sql(live)),originalLive)",
 "check('all current inventory rows exactly preserved after scoped recovery',JSON.parse(sql(INVENTORY)),after.inventory)",
 "check('all current surface members exactly preserved',JSON.parse(sql(SURFACE)),after.surface)",
 "check('all protected records exactly preserved',JSON.parse(sql(SNAPSHOT)),protectedBefore)"] )assert.ok(runner.includes(exact),exact);});
check('fixed owning bootstrap and pre-assertion finite observation are not optional',()=>{assert.match(runner,/'-U','supabase_admin','-d','postgres'/);assert.ok(runner.includes("observeAccess:value=>save('access-matrix-observed.json',value)"));assert.ok(fixture.includes("assert.equal(typeof observeAccess,'function'"));assert.ok(fixture.indexOf("observeAccess({classification:'UNVALIDATED_SYNTHETIC_ACCESS_OBSERVATION',authority})")<fixture.indexOf("check('exact source ACL/RLS"));});
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
check('actual CLI source check runs current219 without engine or historical attribution',()=>{const value=JSON.parse(execFileSync(process.execPath,[runnerPath,'--source-check'],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024}));assert.equal(value.scope,'SOURCE_ONLY_NO_ENGINE');assert.equal(value.status,'PASS');assert.deepEqual(value.migrations,source.migrations);assert.equal(value.migration_profile,'CURRENT_219');assert.equal(value.manifest_sha256,DECISION_219);assert.deepEqual(value.lookup_boundary,source.lookup_boundary);});
console.log(JSON.stringify({status:'PASS',checks,scope:'SOURCE_CONTRACT_AND_PURE_HOSTILE_DATA_ONLY',actualSourceCheck:true,databaseExecuted:false,containerCreated:false,httpExecuted:false,engineEvidence:false}));
