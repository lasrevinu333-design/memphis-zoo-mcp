import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_EXCEPTIONS,OFFICIAL_FIXTURE,PREDECESSOR_FIXTURE,SEED_TABLES,localReplaySource,runRecoveryReplay,validateReplayPlan} from './current-release-recovery-replay.mjs';
import {RECOVERY_KINDS} from './current-release-recovery-probe.mjs';
import {stableSchemaJson} from './schema-fingerprint-catalog.mjs';

// Explicit fake process AND output-filesystem interfaces only. No Docker,
// PostgreSQL, authority call, image, output fixture or child process is used.
const root=fileURLToPath(new URL('../',import.meta.url)),hash=x=>createHash('sha256').update(x).digest('hex');
const canon=x=>JSON.stringify(stableSchemaJson(x)),id=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ok=stdout=>({status:0,stdout:String(stdout),stderr:''}),asJson=x=>ok(JSON.stringify(x));
const sort=rows=>rows.sort((a,b)=>JSON.stringify([a.kind,a.identity])<JSON.stringify([b.kind,b.identity])?-1:1);
const migrations=new Map([['00000000000000_synthetic_baseline.sql',Buffer.from('select 1;')],
  ...Object.keys(DEFAULT_EXCEPTIONS).map(file=>[file,readFileSync(join(root,'supabase/migrations',file))]),
  ['20261003220000_current_release_authority_completion.sql',Buffer.from('begin;select 1;commit;')]]);
const source={commit:'a'.repeat(40),tree:'b'.repeat(40),migrations:[...migrations].map(([file,b])=>({file,sha256:hash(b)})),
  probe_files:[{file:'scripts/current-release-recovery-probe.mjs',sha256:'c'.repeat(64)},{file:'scripts/current-release-recovery-probe-contract-tests.mjs',sha256:'d'.repeat(64)}]};
const runner_files=['scripts/current-release-recovery-replay.mjs','scripts/current-release-recovery-replay-contract-tests.mjs'].map(file=>({file,sha256:hash(readFileSync(join(root,file)))}));
const seed={schema:'custodial.current-recovery-replay-plan.v1',stage:'prepare',lane:'no-auto',synthetic:true,production:false,
 target:{name:'mz_schema_rebuild_fake_combined',id:'e'.repeat(64),image:'sha256:'+'f'.repeat(64),fixture_id:id(1),database:'postgres'},
 source,runner_files,official_fixture:{file:OFFICIAL_FIXTURE,sha256:hash('fake official')},
 predecessor_fixture:{file:PREDECESSOR_FIXTURE,sha256:hash('fake predecessor'),migration:source.migrations.at(-1)},
 output_dir:'/explicit/fake/private-evidence',required_surface:[{kind:'relation',identity:'public.synthetic_required'}],
 protected_relations:[...SEED_TABLES],seed:Object.fromEntries(['manager','employee','device','location','session','completion','completion_operation','work_ticket','feedback','feedback_operation'].map((key,i)=>[key,id(i+2)])),
 cleanup_lease:{owner:'/root',container_id:'e'.repeat(64),fixture_id:id(1),remove_on_terminal:true,retain_on_prepared:true},prepared:null,probe_manifest:null};
const inventory=sort(RECOVERY_KINDS.map((kind,i)=>({kind,identity:kind==='relation'?'public.synthetic_required':'public.synthetic_'+kind,sha256:String(i%9+1).repeat(64),order:i+1})));
const surface=inventory.map(({kind,identity})=>({kind,identity}));
const protectedRows=SEED_TABLES.map(relation=>({relation,count:1,sha256:'1'.repeat(64)}));
function probeReceipt(bound){
  const health={ok:true,authority:'offline-authority.v5',canonical_objects_expected:bound.inventory.length,canary_surface_objects_expected:bound.surface.length,checks:Object.fromEntries(bound.health_checks.map(k=>[k,true])),missing_objects:[],mismatched_objects:[],surface_missing_objects:[],surface_uncovered_objects:[]};
  const denied=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'];
  return {schema:'custodial.current-release-recovery-probe-receipt.v1',engine_executed:false,execution:'FAKE_SUBPROCESS_UNIT_ONLY',production:false,release_admission:false,source:bound.source,manifest_sha256:hash(canon(bound)),target:{id:bound.target.id,name:bound.target.name,image:bound.target.image,network:'none',fixture_id:bound.target.fixture_id},inventory_count:bound.inventory.length,inventory_sha256:hash(canon(bound.inventory)),surface_count:bound.surface.length,restored_objects:bound.inventory.length,canary_left_paused:true,automatic_grants_absent:true,protected_rows:bound.protected_rows,health_before:health,health_after:structuredClone(health),rollback_faults:[...bound.faults.map(x=>({...x,fault:'captured_digest_mismatch',rollback_readback:true})),{...bound.omitted_surface,fault:'required_surface_inventory_omission',rollback_readback:true}],
    controls:['pause_canary','restore_authority'].map((action,i)=>({manager_id:bound.manager_id,request_id:id(60+i),audit_id:id(70+i),device_identifier:'KIOSK_08',action,reason:'synthetic current-source recovery probe',authoritative_health:{ok:false,scope:'current-source-synthetic'},result:{device_identifier:'KIOSK_08',canary_paused:true,restored_objects:i?bound.inventory.length:0}})),
    caller_checks:{intended_health_role:'service_role',denied_configuration_roles:denied,denied_health_roles:denied.filter(x=>x!=='service_role'),wrong_health_proof_denied:true}};
}

function fake(m,change=()=>undefined){
  const calls=[],outputs=new Map();let sourceCalls=0;
  function mutate(phase,result,extra={}){calls.push({phase,...extra});return change({phase,result,calls,outputs,...extra})??result}
  const io={
    source(){sourceCalls++;return mutate('source_'+sourceCalls,{source:m.source,runner_files:m.runner_files})},
    outputDirectory(path){assert.equal(path,m.output_dir);if(mutate('output',true)===false)throw new Error('private_output_directory')},
    read(path){let value;if(outputs.has(path))value=Buffer.from(outputs.get(path));else if(path===join(root,OFFICIAL_FIXTURE))value=Buffer.from('fake official');else if(path===join(root,PREDECESSOR_FIXTURE))value=Buffer.from('fake predecessor');else value=migrations.get(path.split('/').at(-1));assert.ok(value,'fake read must be exact known path');return mutate('read_'+path.split('/').at(-1),value)},
    write(path,bytes){assert.ok(path.startsWith(m.output_dir+'/'));assert.ok(!outputs.has(path),'exclusive fake artifact cannot overwrite');const result=mutate('write_'+path.split('/').at(-1),true,{path,bytes});if(result===false)throw new Error('output_write_failed');outputs.set(path,bytes)},
    async run(command,args,{input,signal}={}){
      let phase,result;const call={command,args,input,signal};
      if(command==='docker'){
        assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);
        if(args[2]==='inspect'){phase='inspect';assert.equal(args.at(-1),m.target.id);result=asJson([{Id:m.target.id,Name:'/'+m.target.name,Image:m.target.image,State:{Running:true},HostConfig:{NetworkMode:'none',PortBindings:{}},NetworkSettings:{Ports:{'5432/tcp':null},Networks:{none:{}}},Config:{Labels:{'org.memphiszoo.custodial.fixture':'synthetic','org.memphiszoo.custodial.owner':'/root','org.memphiszoo.custodial.fixture-id':m.target.fixture_id}}}])}
        else if(args[2]==='rm'){phase='cleanup_rm';assert.deepEqual(args.slice(2),['rm','-f',m.target.id]);result=ok(m.target.id)}
        else if(args[2]==='ps'){phase='cleanup_absent';assert.ok(args.includes('id='+m.target.id));result=ok('')}
        else{
          assert.equal(args[2],'exec');assert.equal(args[4],m.target.id);phase=input.match(/^\/\* current-replay:([a-z0-9_]+) \*\//)?.[1];assert.ok(phase,'SQL needs finite named phase');
          if(phase==='empty_catalog')result=asJson({relations:0,functions:0,types:0});
          else if(phase.startsWith('defaults_'))result=ok('0');
          else if(phase.startsWith('remove_')||phase.startsWith('migration_')||phase==='synthetic_seed')result=ok('');
          else if(phase==='seed_readback')result=asJson({active_work:true,response:true,work_ticket:true,feedback:true});
          else if(phase==='inventory_observed')result=asJson(inventory);
          else if(phase==='surface_observed')result=asJson(surface);
          else if(phase.startsWith('snapshot_'))result=asJson(protectedRows.find(x=>x.relation==='public.'+phase.slice(9)));
          else if(phase.startsWith('catalog_'))result=asJson([]);
          else assert.fail('Unexpected fake SQL phase '+phase);
        }
      }else{
        assert.equal(command,process.execPath);
        if(args[0]===join(root,PREDECESSOR_FIXTURE)){phase='predecessor';assert.deepEqual(JSON.parse(input),{target:m.target,migration:m.predecessor_fixture.migration});result=asJson({schema:'custodial.current-release-canary-predecessor-receipt.v1',status:'PASS',checks:4,engine_executed:false,synthetic:true,production:false,target:m.target,migration:m.predecessor_fixture.migration,source_sha256:m.predecessor_fixture.sha256,predecessor:{inventory_count:11,inventory_sha256:'a'.repeat(64),feedback_stored:'b'.repeat(64),feedback_live:'c'.repeat(64),immutable:'O'},cases:['captured_feedback_digest_changed','live_feedback_shape_changed','inventory_immutability_missing','later_surface_failure_rolls_back_feedback_rebind'].map(id=>({id,rejected:true,rollback_exact:true,expected_reason:'explicit fake rejection'})),successful_final_migration_applied:false,authority_configured:false,container_retained:true})}
        else if(args.includes('--input-type=module')){phase='official';assert.equal(JSON.parse(args.at(-1)).id,m.target.id);result=asJson({status:'PASS',scope:'synthetic official dated exception and occurrence SCH022 paths',checks:12,target:{id:m.target.id,image:m.target.image,fixture_id:m.target.fixture_id,network:'none'},source:Object.fromEntries(['publication_id','group_id','member_id','baseline_projection_id','accepted_projection_id','repaired_projection_id'].map((k,i)=>[k,id(80+i)])),limitations:['fake only']})}
        else{
          phase='probe';assert.equal(args[0],join(root,'scripts/current-release-recovery-probe.mjs'));const bound=JSON.parse(outputs.get(args[2]));result=asJson(probeReceipt(bound));
        }
      }
      return mutate(phase,result,{call});
    }
  };
  return {io,calls,outputs};
}
const editJson=fn=>r=>{const x=JSON.parse(r.stdout);fn(x);return asJson(x)};
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS',name)}
async function rejectPlan(name,change,pattern){await test(name,async()=>{const m=structuredClone(seed);change(m);const f=fake(m);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),pattern);assert.equal(f.calls.length,0)})}
async function boundary(name,phase,change,pattern,{cleanup=true}={}){await test(name,async()=>{const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase===phase?change(ctx.result,ctx):undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),pattern);assert.equal(f.calls.some(x=>x.phase==='cleanup_rm'),cleanup)})}
async function prepared(change){const m=structuredClone(seed),f=fake(m,change);const receipt=await runRecoveryReplay(m,{root,io:f.io});return{m,f,receipt}}
function verifyPlan(m,f){const plan=structuredClone(m);plan.stage='verify';plan.prepared={file:'no-auto-prepare-receipt.json',sha256:hash(f.outputs.get(join(m.output_dir,'no-auto-prepare-receipt.json')))};plan.probe_manifest={schema:'custodial.current-release-recovery-probe-manifest.v1',synthetic:true,production:false,target:plan.target,source:plan.source,inventory,surface,required_surface:plan.required_surface,health_checks:['canary_authority_surface_captured','restore_inventory_exact'],protected_rows:protectedRows,faults:inventory.map(({kind,identity})=>({kind,identity})),omitted_surface:plan.required_surface[0],manager_id:plan.seed.manager};return plan}

await test('import and local source identity use no replay or hidden container',()=>{const local=localReplaySource(root,()=>source);assert.equal(local.source,source);assert.deepEqual(local.runner_files,runner_files)});
await test('fake no-auto prepare retains only exact lease and never adopts inventory',async()=>{const {f,receipt}=await prepared();assert.equal(receipt.status,'OBSERVED_NOT_ACCEPTED');assert.equal(receipt.engine_executed,false);assert.equal(receipt.execution,'FAKE_SUBPROCESS_UNIT_ONLY');assert.equal(receipt.release_admission,false);assert.ok(!f.calls.some(x=>x.phase==='probe'||x.phase==='cleanup_rm'));assert.ok(f.calls.findIndex(x=>x.phase==='official')<f.calls.findIndex(x=>x.phase==='synthetic_seed'));assert.equal(f.calls.filter(x=>x.phase==='predecessor').length,1);assert.ok(f.calls.findIndex(x=>x.phase==='predecessor')<f.calls.findIndex(x=>x.phase==='migration_0004'));assert.equal(receipt.inventory.length,11)});
await test('normal lane captures separately and performs exact cleanup without probe or seeds',async()=>{const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m),r=await runRecoveryReplay(m,{root,io:f.io});assert.equal(r.status,'NORMAL_CATALOG_OBSERVED_NOT_ACCEPTED');assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));assert.ok(!f.calls.some(x=>/^(probe|official|synthetic_seed|remove_)/.test(x.phase)));assert.ok(f.outputs.has(join(m.output_dir,'normal-prepare-replayed-catalog.json')))});
await test('independent fake verify consumes root-bound manifest then closes exact lease',async()=>{const {m,f}=await prepared(),v=verifyPlan(m,f);const receipt=await runRecoveryReplay(v,{root,io:f.io});assert.equal(receipt.status,'SYNTHETIC_PROBE_COMPLETED_NOT_RELEASE_ADMITTED');assert.equal(receipt.engine_executed,false);assert.equal(f.calls.filter(x=>x.phase==='probe').length,1);assert.equal(f.calls.filter(x=>x.phase==='cleanup_rm').length,1)});

await rejectPlan('production plan refused',m=>m.production=true,/synthetic/);
await rejectPlan('arbitrary SQL input refused',m=>m.sql='drop database x',/plan_shape/);
await rejectPlan('URL target refused',m=>m.target.name='https://example.test',/target_identity/);
await rejectPlan('short target ID refused',m=>m.target.id='abc',/target_identity/);
await rejectPlan('foreign database refused',m=>m.target.database='production',/target_identity/);
await rejectPlan('relative output refused',m=>m.output_dir='tmp',/output_directory/);
await rejectPlan('cleanup exact target required',m=>m.cleanup_lease.container_id='1'.repeat(64),/cleanup_lease_binding/);
await rejectPlan('cleanup cannot silently be disabled',m=>m.cleanup_lease.remove_on_terminal=false,/cleanup_lease_binding/);
await rejectPlan('root literal requirements mandatory',m=>m.required_surface=[],/literal_required/);
await rejectPlan('required unknown object kind refused',m=>m.required_surface[0].kind='unknown',/required_identity/);
await rejectPlan('required duplicate identity refused',m=>m.required_surface.push(m.required_surface[0]),/duplicate/);
await rejectPlan('protected seed coverage mandatory',m=>m.protected_relations.pop(),/seed_protection/);
await rejectPlan('SQL relation injection refused',m=>m.protected_relations[0]='public.x;drop x',/protected_relations/);
await rejectPlan('seed identities are not executable strings',m=>m.seed.manager="';select 1",/seed_identity/);
await rejectPlan('seed original identities cannot collide',m=>m.seed.employee=m.seed.manager,/seed_identity/);
await rejectPlan('prepare cannot accept a probe manifest automatically',m=>m.probe_manifest={},/prepare_never/);
await rejectPlan('normal lane cannot claim no-auto verify',m=>{m.stage='verify';m.lane='normal'},/lane_stage/);
await rejectPlan('arbitrary fixture executable path refused',m=>m.official_fixture.file='arbitrary.mjs',/official_fixture_pin/);
await rejectPlan('final predecessor proof cannot silently move before another migration',m=>m.source.migrations.push({file:'20261003230000_fake.sql',sha256:'a'.repeat(64)}),/final_migration_position/);
await boundary('source mismatch before target/cleanup','source_1',x=>({...x,source:{...x.source,commit:'9'.repeat(40)}}),/source_manifest/,{cleanup:false});
await boundary('unsafe output refused before ownership','output',()=>false,/private_output/,{cleanup:false});
await boundary('network bridge refused','inspect',editJson(x=>{x[0].HostConfig.NetworkMode='bridge'}),/target_network/,{cleanup:false});
await boundary('unowned fixture refused','inspect',editJson(x=>{x[0].Config.Labels['org.memphiszoo.custodial.owner']='other'}),/ownership/,{cleanup:false});
await boundary('nonempty catalog never reset or cleaned','empty_catalog',editJson(x=>{x.relations=1}),/empty_catalog_required/,{cleanup:false});
await boundary('existing public function is not empty admission','empty_catalog',editJson(x=>{x.functions=1}),/empty_catalog_required/,{cleanup:false});
await boundary('changed migration bytes fail before execution','read_00000000000000_synthetic_baseline.sql',()=>Buffer.from('different'),/migration_changed/);
await boundary('migration failure has raw output and cleanup','migration_0000',()=>({status:3,stdout:'synthetic stdout',stderr:'ERROR: 42601'}),/sql_migration/);
await boundary('unrecognized default widening cannot be repaired','defaults_after_0',()=>ok('1'),/unexpected_default/);
await test('only exact three legacy exceptions can remove changed defaults',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>/^defaults_after_[123]$/.test(ctx.phase)?ok('1'):undefined);await runRecoveryReplay(m,{root,io:f.io});assert.equal(f.calls.filter(x=>x.phase.startsWith('remove_known_defaults_')).length,3)});
await test('known exception still requires zero readback',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>['defaults_after_1','defaults_rechecked_1'].includes(ctx.phase)?ok('1'):undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/defaults_recheck/);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'))});
await boundary('predecessor challenge failure cannot reach final migration','predecessor',()=>({status:1,stdout:'',stderr:'synthetic mismatch'}),/predecessor_fixture_failed/);
await boundary('predecessor false-looking receipt refused','predecessor',editJson(x=>{x.status='FAIL'}),/predecessor_receipt/);
await boundary('predecessor generic PASS JSON is insufficient','predecessor',()=>asJson({status:'PASS'}),/predecessor_receipt_shape/);
await boundary('predecessor source hash must match input pin','predecessor',editJson(x=>{x.source_sha256='0'.repeat(64)}),/predecessor_source_receipt/);
await boundary('predecessor all four rollback cases required','predecessor',editJson(x=>{x.cases.pop()}),/predecessor_cases/);
await boundary('predecessor cannot claim configured authority','predecessor',editJson(x=>{x.authority_configured=true}),/predecessor_receipt/);
await boundary('predecessor unsuccessful rollback is fatal','predecessor',editJson(x=>{x.cases[0].rollback_exact=false}),/predecessor_rollback/);
await boundary('fake predecessor cannot be promoted to engine evidence','predecessor',editJson(x=>{x.engine_executed=true}),/predecessor_receipt/);
await boundary('official fixture false-looking receipt refused','official',editJson(x=>{x.status='FAIL'}),/official_fixture_receipt/);
await boundary('official fixture wrong target refused','official',editJson(x=>{x.target.id='a'.repeat(64)}),/official_fixture_target/);
await boundary('seed is not credited without original readback','seed_readback',editJson(x=>{x.feedback=false}),/seed_original_identity/);
await boundary('literal new member omission cannot be learned as expected','surface_observed',editJson(x=>{x.splice(x.findIndex(y=>y.identity==='public.synthetic_required'),1)}),/required_source_member_missing/);
await boundary('protected synthetic data must be populated','snapshot_sessions',editJson(x=>{x.count=0}),/seed_snapshot_populated/);
await boundary('observed inventory missing a kind is not silently skipped','inventory_observed',editJson(x=>{x.splice(x.findIndex(y=>y.kind==='policy'),1)}),/all_inventory_kinds_required/);
await boundary('changed source at handoff fails and cleans','source_2',x=>({...x,source:{...x.source,tree:'9'.repeat(40)}}),/source_changed/);
await test('abort during replay cleans exact lease without advancing',async()=>{const abort=new AbortController(),m=structuredClone(seed),f=fake(m,ctx=>{if(ctx.phase==='migration_0000')abort.abort()});await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io,signal:abort.signal}),/aborted/);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));assert.ok(!f.calls.some(x=>x.phase==='migration_0001'))});
await test('already-aborted operation touches no container',async()=>{const abort=new AbortController();abort.abort();const f=fake(seed);await assert.rejects(()=>runRecoveryReplay(seed,{root,io:f.io,signal:abort.signal}),/aborted/);assert.ok(!f.calls.some(x=>x.call))});
await test('wrong prepare digest cannot authorize verify or cleanup',async()=>{const {m,f}=await prepared(),v=verifyPlan(m,f);v.prepared.sha256='0'.repeat(64);await assert.rejects(()=>runRecoveryReplay(v,{root,io:f.io}),/prepared_hash/);assert.ok(!f.calls.some(x=>x.phase==='probe'||x.phase==='cleanup_rm'))});
await test('root inventory cannot disagree with observed prior source',async()=>{const {m,f}=await prepared(),v=verifyPlan(m,f);v.probe_manifest.inventory=structuredClone(inventory);v.probe_manifest.inventory[0].sha256='0'.repeat(64);await assert.rejects(()=>runRecoveryReplay(v,{root,io:f.io}),/independent_inventory_binding/);assert.ok(!f.calls.some(x=>x.phase==='probe'||x.phase==='cleanup_rm'))});
for(const [label,change,pattern] of [
  ['false engine credit',x=>x.engine_executed=true,/probe_execution_scope/],
  ['wrong manifest',x=>x.manifest_sha256='0'.repeat(64),/probe_manifest_receipt/],
  ['foreign target',x=>x.target.id='0'.repeat(64),/probe_receipt_target/],
  ['wrong full restore count',x=>x.restored_objects--,/probe_restore_receipt/],
  ['unhealthy postrestore',x=>x.health_after.ok=false,/probe_health/],
  ['missing full-health key',x=>delete x.health_after.checks.restore_inventory_exact,/probe_health_checks/],
  ['truthy health string',x=>x.health_after.checks.restore_inventory_exact='true',/probe_health_checks/],
  ['missing rollback kind',x=>x.rollback_faults.pop(),/probe_rollback_receipts/],
  ['wrong original actor',x=>x.controls[1].manager_id=id(99),/probe_original_control/],
  ['denied caller not checked',x=>x.caller_checks.wrong_health_proof_denied=false,/probe_caller_receipts/]
])await test('probe receipt rejects '+label,async()=>{let active=false;const {m,f}=await prepared(ctx=>active&&ctx.phase==='probe'?editJson(change)(ctx.result):undefined);active=true;await assert.rejects(()=>runRecoveryReplay(verifyPlan(m,f),{root,io:f.io}),pattern);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'))});
await test('probe loss is never rerun; pending original request stays in durable failure',async()=>{let loss=false;const {m,f}=await prepared(ctx=>loss&&ctx.phase==='probe'?{status:1,stdout:'',stderr:JSON.stringify({pending_control:{request_id:id(50),action:'restore_authority'}})}:undefined);loss=true;await assert.rejects(()=>runRecoveryReplay(verifyPlan(m,f),{root,io:f.io}),/probe_failed/);assert.equal(f.calls.filter(x=>x.phase==='probe').length,1);assert.ok([...f.outputs.values()].some(x=>x.includes(id(50))));assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'))});
await test('cleanup uncertainty cannot return overall success',async()=>{const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m,ctx=>ctx.phase==='cleanup_absent'?ok(m.target.id):undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/cleanup_not_confirmed/);assert.ok([...f.outputs.keys()].some(x=>x.includes('cleanup-failure')))});
await test('unsafe output produces no fallback writes',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase==='output'?false:undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/private_output/);assert.equal(f.outputs.size,0)});
await test('output inside source candidate rejected before target or writes',async()=>{const m=structuredClone(seed);m.output_dir=join(root,'evidence');const f=fake(m);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/output_outside_candidate/);assert.equal(f.outputs.size,0);assert.ok(!f.calls.some(x=>x.call))});
await test('raw partial migration failure output remains durable fake evidence',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase==='migration_0000'?{status:-1,stdout:'partial synthetic output',stderr:'terminated'}:undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/sql_migration/);assert.equal(f.outputs.get(join(m.output_dir,'no-auto-prepare-migration_0000.log')),'partial synthetic outputterminated')});
await test('seed readback keeps existing text completion operation type',async()=>{const {f}=await prepared();const sql=f.calls.find(x=>x.phase==='seed_readback').call.input;assert.ok(sql.includes("client_completion_id='"));assert.doesNotMatch(sql,/client_completion_id='[^']+'::uuid/)});
await test('actual source enforces private exclusive durable outputs without endpoint imports',()=>{const text=readFileSync(new URL('./current-release-recovery-replay.mjs',import.meta.url),'utf8');assert.match(text,/O_CREAT\|constants.O_EXCL\|constants.O_NOFOLLOW/);assert.match(text,/fsyncSync\(fd\)/);assert.match(text,/s.uid===process.getuid/);assert.doesNotMatch(text,/from ['"].*(?:native-target-source-database-tests|empty-database-rebuild-check|refresh-schema-fingerprint)/);assert.doesNotMatch(text,/DATABASE_URL|process\.env\.(?:PG|DOCKER)|docker.*pull/)});
console.log(JSON.stringify({schema:'custodial.current-recovery-replay-contract-receipt.v1',checks,engine_executed:false,database_connections:0,authority_configurations:0,containers_launched:0,output_files_created:0,subprocesses:'explicit in-memory fake only',release_admission:false}));
