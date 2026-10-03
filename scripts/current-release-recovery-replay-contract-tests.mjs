import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_EXCEPTIONS,NORMAL_INVENTORY_SQL,NORMAL_RENDERER_PINS,OFFICIAL_FIXTURE,PREDECESSOR_FIXTURE,RECOVERY_FORWARD_218,SEED_TABLES,localReplaySource,runRecoveryReplay,validateReplayPlan} from './current-release-recovery-replay.mjs';
import {RECOVERY_KINDS} from './current-release-recovery-probe.mjs';
import {stableSchemaJson} from './schema-fingerprint-catalog.mjs';

// Explicit fake process AND output-filesystem interfaces only. No Docker,
// PostgreSQL, authority call, image, output fixture or child process is used.
const root=fileURLToPath(new URL('../',import.meta.url)),hash=x=>createHash('sha256').update(x).digest('hex');
const canon=x=>JSON.stringify(stableSchemaJson(x)),id=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ok=stdout=>({status:0,stdout:String(stdout),stderr:''}),asJson=x=>ok(JSON.stringify(x));
const sort=rows=>rows.sort((a,b)=>JSON.stringify([a.kind,a.identity])<JSON.stringify([b.kind,b.identity])?-1:1);
const predecessorReasons={
 captured_feedback_digest_changed:'Feedback relation captured predecessor changed',
 live_feedback_shape_changed:'Feedback relation current predecessor changed',
 inventory_immutability_missing:'Current release recovery inventory immutability unavailable',
 later_surface_failure_rolls_back_feedback_rebind:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)',
 captured_clock_grant_digest_changed:'Current release required grant recovery drift: custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)',
 live_clock_grant_changed:'Current release required grant recovery drift: custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)',
 second_equivalent_clock_grant_alias_corrupted:'Current release required grant recovery drift: custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)',
 captured_serialized_grant_canary_changed:'Current grant serialization captured predecessor changed: custodial_release_canary_authority_surface()',
 captured_serialized_grant_incumbency_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v3_assert_draft_incumbency(uuid)',
 captured_serialized_grant_hydrate_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
 captured_serialized_grant_materialize_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)',
 captured_serialized_grant_schedule_base_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v6_read_schedule_segments_dated_base(date)',
 captured_serialized_grant_lunch_base_changed:'Current grant serialization captured predecessor changed: public.static_weekly_v8_read_lunch_segments_dated_base(date)',
 live_serialized_private_grant_changed:'Current grant serialization live predecessor changed: public.static_weekly_v3_assert_draft_incumbency(uuid)',
 serialized_reset_redirected_with_recomputed_digest:'Current grant serialization captured predecessor changed: public.static_weekly_v3_assert_draft_incumbency(uuid)',
 second_equivalent_serialized_grant_alias_corrupted:'Current grant serialization captured alias changed: static_weekly_v3_assert_draft_incumbency(uuid)',
 later_surface_failure_rolls_back_all_six_grants:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)',
 event_column_order_ownership_changed:'Current Event column order captured scope changed',
 event_column_definition_digest_changed:'Current Event column order definition changed: public.events_app_events:start_instant_utc',
 later_surface_failure_rolls_back_column_canonicalization:'Current release required function recovery drift: static_weekly_sch022_work_witness(date,jsonb)'
};
const migrations=new Map([['00000000000000_synthetic_baseline.sql',Buffer.from('select 1;')],
  ...Object.keys(DEFAULT_EXCEPTIONS).map(file=>[file,readFileSync(join(root,'supabase/migrations',file))]),
  ['20261003220000_current_release_authority_completion.sql',readFileSync(join(root,'supabase/migrations/20261003220000_current_release_authority_completion.sql'))]]);
const forwardMigrations=new Map(readdirSync(join(root,'supabase/migrations')).filter(file=>file.endsWith('.sql')).sort()
  .map(file=>[file,readFileSync(join(root,'supabase/migrations',file))]));
const forwardSource={commit:'a'.repeat(40),tree:'b'.repeat(40),migrations:[...forwardMigrations].map(([file,bytes])=>({file,sha256:hash(bytes)})),
  probe_files:[{file:'scripts/current-release-recovery-probe.mjs',sha256:'c'.repeat(64)},{file:'scripts/current-release-recovery-probe-contract-tests.mjs',sha256:'d'.repeat(64)}]};
assert.deepEqual(forwardSource.migrations.slice(-3),RECOVERY_FORWARD_218);
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
for(const row of inventory)if(['function','grant'].includes(row.kind))row.identity='public.synthetic_function()';
const surface=inventory.map(({kind,identity})=>({kind,identity}));
const normalRows=inventory.map(row=>{const definition_sql='-- Explicit fake-only '+row.kind+' ñ\nselect 1;';const sha256=hash(definition_sql);return{...row,definition_sql,sha256,stored_sha256:sha256,live_sql:definition_sql,live_sha256:sha256}});
const normalSnapshot=()=>({count:normalRows.length,metadata:normalRows.map(({kind,identity,order,sha256})=>({kind,identity,order,sha256})),rows:structuredClone(normalRows),renderers:Object.entries(NORMAL_RENDERER_PINS).map(([identity,sha256])=>({identity,sha256}))});
const forwardNamed='public.static_weekly_v9_assert_shift_end_derivation(jsonb)';
const forwardNative='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)';
const forwardCanary='custodial_release_canary_authority_surface()';
const forwardNamedGrant="select public.custodial_release_authority_reset_grants('public.static_weekly_v9_assert_shift_end_derivation(jsonb)'); grant execute on function static_weekly_v9_assert_shift_end_derivation(jsonb) to postgres;";
const forwardCanaryGrant="select public.custodial_release_authority_reset_grants('custodial_release_canary_authority_surface()'); grant execute on function custodial_release_canary_authority_surface() to public; grant execute on function custodial_release_canary_authority_surface() to postgres; grant execute on function custodial_release_canary_authority_surface() to service_role;";
const forwardRows=structuredClone(normalRows);
// Existing recovery orders are not globally unique. Preserve a shared
// historical order in the fake preimage; identity remains the unique key.
forwardRows.find(x=>x.kind==='column').order=forwardRows.find(x=>x.kind==='relation').order;
function changeFakeRow(row,identity,definition_sql){row.identity=identity;row.definition_sql=definition_sql;row.live_sql=definition_sql;row.sha256=hash(definition_sql);row.stored_sha256=row.sha256;row.live_sha256=row.sha256}
const forwardNamedRow=forwardRows.find(x=>x.kind==='function');changeFakeRow(forwardNamedRow,forwardNamed,'CREATE OR REPLACE FUNCTION public.static_weekly_v9_assert_shift_end_derivation(jsonb) RETURNS void AS $$ select 1 $$ LANGUAGE sql;');forwardNamedRow.order=100201;
const forwardNamedGrantRow=forwardRows.find(x=>x.kind==='grant');changeFakeRow(forwardNamedGrantRow,forwardNamed,forwardNamedGrant);forwardNamedGrantRow.order=950022;
function fakeForwardRow(kind,identity,order,definition_sql){const sha256=hash(definition_sql);return {kind,identity,order,definition_sql,sha256,stored_sha256:sha256,live_sql:definition_sql,live_sha256:sha256}}
forwardRows.push(fakeForwardRow('function',forwardCanary,100071,`CREATE OR REPLACE FUNCTION public.custodial_release_canary_authority_surface() AS $function$ values ('function','${forwardNative}','original accepted native event lookup'), ('grant','${forwardNative}','server-only original event lookup ACL'); $function$`));
forwardRows.push(fakeForwardRow('grant',forwardCanary,1000073,forwardCanaryGrant));
forwardRows.push(fakeForwardRow('function',forwardNative,100001,'CREATE OR REPLACE FUNCTION public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) RETURNS jsonb AS $$ select null $$ LANGUAGE sql;'));
forwardRows.push(fakeForwardRow('grant',forwardNative,900001,`select public.custodial_release_authority_reset_grants('${forwardNative}'); grant execute on function custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to postgres; grant execute on function custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to service_role;`));
const forwardInventory=sort(forwardRows.map(({kind,identity,order,sha256})=>({kind,identity,order,sha256})));
const forwardPreimage=sort(forwardInventory.filter(x=>x.identity!==forwardNative).map(x=>{
 if(x.kind==='function'&&x.identity===forwardNamed)return {...x,sha256:'1d76c69cc34df8ffb18d9b07711da15c1dfed8c44c7f9b5fed5e5e8b63d93e85'};
 if(x.kind==='function'&&x.identity===forwardCanary)return {...x,sha256:'661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471'};
 return x;
}));
const forwardSurface=sort([...surface.filter(x=>!['function','grant'].includes(x.kind)),
  {kind:'function',identity:forwardNamed},{kind:'grant',identity:forwardNamed},
  {kind:'function',identity:forwardCanary},{kind:'grant',identity:forwardCanary},
  {kind:'function',identity:forwardNative},{kind:'grant',identity:forwardNative}]);
const forwardSurfacePreimage=forwardSurface.filter(x=>x.identity!==forwardNative);
const forwardSnapshot=()=>({count:forwardRows.length,metadata:forwardRows.map(({kind,identity,order,sha256})=>({kind,identity,order,sha256})),rows:structuredClone(forwardRows),renderers:Object.entries(NORMAL_RENDERER_PINS).map(([identity,sha256])=>({identity,sha256}))});
const resolutionRows=(required,surface,inventory)=>[['required',required],['surface',surface],['inventory',inventory]].flatMap(([origin,rows])=>rows.filter(row=>row.kind==='function'||row.kind==='grant'&&row.identity.includes('(')).map(({kind,identity})=>({origin,kind,identity,oid:'101'})));
const protectedRows=SEED_TABLES.map(relation=>({relation,count:1,sha256:'1'.repeat(64)}));
function probeReceipt(bound){
  const health={ok:true,authority:'offline-authority.v5',canonical_objects_expected:bound.inventory.length,canary_surface_objects_expected:bound.surface.length,checks:Object.fromEntries(bound.health_checks.map(k=>[k,true])),missing_objects:[],mismatched_objects:[],surface_missing_objects:[],surface_uncovered_objects:[]};
  const denied=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'];
  return {schema:'custodial.current-release-recovery-probe-receipt.v1',engine_executed:false,execution:'FAKE_SUBPROCESS_UNIT_ONLY',production:false,release_admission:false,source:bound.source,manifest_sha256:hash(canon(bound)),required_surface:bound.required_surface,required_surface_sha256:hash(canon(bound.required_surface)),required_membership:{before:resolutionRows(bound.required_surface,bound.surface,bound.inventory),after:resolutionRows(bound.required_surface,bound.surface,bound.inventory)},target:{id:bound.target.id,name:bound.target.name,image:bound.target.image,network:'none',fixture_id:bound.target.fixture_id},inventory_count:bound.inventory.length,inventory_sha256:hash(canon(bound.inventory)),surface_count:bound.surface.length,restored_objects:bound.inventory.length,canary_left_paused:true,automatic_grants_absent:true,protected_rows:bound.protected_rows,health_before:health,health_after:structuredClone(health),rollback_faults:[...bound.faults.map(x=>({...x,fault:'captured_digest_mismatch',rollback_readback:true})),{...bound.omitted_surface,fault:'required_surface_inventory_omission',rollback_readback:true}],
    controls:['pause_canary','restore_authority'].map((action,i)=>({manager_id:bound.manager_id,request_id:id(60+i),audit_id:id(70+i),device_identifier:'KIOSK_08',action,reason:'synthetic current-source recovery probe',authoritative_health:{ok:false,scope:'current-source-synthetic'},result:{device_identifier:'KIOSK_08',canary_paused:true,restored_objects:i?bound.inventory.length:0}})),
    caller_checks:{intended_health_role:'service_role',denied_configuration_roles:denied,denied_health_roles:denied.filter(x=>x!=='service_role'),wrong_health_proof_denied:true}};
}

function fake(m,change=()=>undefined){
  const calls=[],outputs=new Map(),forward=m.source.migrations.length===218;let sourceCalls=0;
  function mutate(phase,result,extra={}){calls.push({phase,...extra});return change({phase,result,calls,outputs,...extra})??result}
  const io={
    source(){sourceCalls++;return mutate('source_'+sourceCalls,{source:m.source,runner_files:m.runner_files})},
    outputDirectory(path){assert.equal(path,m.output_dir);if(mutate('output',true)===false)throw new Error('private_output_directory')},
    read(path){let value;if(outputs.has(path))value=Buffer.from(outputs.get(path));else if(path===join(root,OFFICIAL_FIXTURE))value=Buffer.from('fake official');else if(path===join(root,PREDECESSOR_FIXTURE))value=Buffer.from('fake predecessor');else value=(forward?forwardMigrations:migrations).get(path.split('/').at(-1));assert.ok(value,'fake read must be exact known path');return mutate('read_'+path.split('/').at(-1),value)},
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
          else if(phase==='inventory_observed')result=asJson(forward?forwardInventory:inventory);
          else if(phase==='normal_inventory')result=asJson(forward?forwardSnapshot():normalSnapshot());
          else if(phase==='surface_observed')result=asJson(forward?forwardSurface:surface);
          else if(phase==='forward_inventory_preimage')result=asJson(forwardPreimage);
          else if(phase==='forward_surface_preimage')result=asJson(forwardSurfacePreimage);
          else if(phase==='forward_surface_final')result=asJson(forwardSurface);
          else if(phase==='required_membership')result=asJson(resolutionRows(m.required_surface,forward?forwardSurface:surface,forward?forwardInventory:inventory));
          else if(phase.startsWith('snapshot_'))result=asJson(protectedRows.find(x=>x.relation==='public.'+phase.slice(9)));
          else if(phase.startsWith('catalog_'))result=asJson([]);
          else assert.fail('Unexpected fake SQL phase '+phase);
        }
      }else{
        assert.equal(command,process.execPath);
        if(args[0]===join(root,PREDECESSOR_FIXTURE)){phase='predecessor';assert.deepEqual(JSON.parse(input),{target:m.target,migration:m.predecessor_fixture.migration});result=asJson({schema:'custodial.current-release-canary-predecessor-receipt.v1',status:'PASS',checks:20,engine_executed:false,synthetic:true,production:false,target:m.target,migration:m.predecessor_fixture.migration,source_sha256:m.predecessor_fixture.sha256,predecessor:{inventory_count:forward?forwardRows.length-2:11,inventory_sha256:'a'.repeat(64),feedback_stored:'b'.repeat(64),feedback_live:'c'.repeat(64),immutable:'O'},cases:Object.entries(predecessorReasons).map(([id,expected_reason])=>({id,rejected:true,rollback_exact:true,expected_reason})),successful_final_migration_applied:false,authority_configured:false,container_retained:true})}
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
function verifyPlan(m,f){const plan=structuredClone(m);plan.stage='verify';plan.prepared={file:'no-auto-prepare-receipt.json',sha256:hash(f.outputs.get(join(m.output_dir,'no-auto-prepare-receipt.json')))};plan.probe_manifest={schema:'custodial.current-release-recovery-probe-manifest.v1',synthetic:true,production:false,target:plan.target,source:plan.source,inventory,surface,required_surface:plan.required_surface,health_checks:['canary_authority_surface_captured','restore_inventory_exact'],protected_rows:protectedRows,faults:inventory.map(({kind,identity})=>({kind,identity})),omitted_surface:plan.required_surface.find(x=>x.kind==='relation'),manager_id:plan.seed.manager};return plan}
function forwardPlan(lane='normal'){
 const m=structuredClone(seed);m.source=structuredClone(forwardSource);m.predecessor_fixture.migration=m.source.migrations.at(-3);
 m.lane=lane;if(lane==='normal')m.official_fixture=null;
 m.required_surface=sort([...m.required_surface,{kind:'function',identity:forwardNative},{kind:'grant',identity:forwardNative}]);
 return m;
}

await test('import and local source identity use no replay or hidden container',()=>{const local=localReplaySource(root,()=>source);assert.equal(local.source,source);assert.deepEqual(local.runner_files,runner_files)});
await test('exact 218 successor retains the 216 predecessor and independently required new identities',async()=>{
 const m=forwardPlan(),f=fake(m),r=await runRecoveryReplay(m,{root,io:f.io});
 assert.equal(r.status,'NORMAL_CATALOG_OBSERVED_NOT_ACCEPTED');
 assert.equal(r.recovery_inventory.count,forwardRows.length);
 const saved=JSON.parse(f.outputs.get(join(m.output_dir,r.recovery_inventory.file)));
 assert.equal(saved.predecessor_inventory_count,forwardRows.length-2);
 assert.deepEqual(saved.required_surface,m.required_surface);
 assert.ok(f.calls.findIndex(x=>x.phase==='predecessor')<f.calls.findIndex(x=>x.phase==='migration_0215'));
 assert.ok(f.calls.findIndex(x=>x.phase==='migration_0215')<f.calls.findIndex(x=>x.phase==='migration_0216'));
 assert.ok(f.calls.findIndex(x=>x.phase==='migration_0216')<f.calls.findIndex(x=>x.phase==='migration_0217'));
 assert.equal(f.calls.filter(x=>x.phase.startsWith('migration_')).length,218);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
});
await test('exact 218 no-auto preparation retains new source membership without adopting survivor hashes',async()=>{
 const m=forwardPlan('no-auto'),f=fake(m),r=await runRecoveryReplay(m,{root,io:f.io});
 assert.equal(r.status,'OBSERVED_NOT_ACCEPTED');
 assert.equal(r.inventory.length,forwardRows.length);
 for(const kind of ['function','grant'])assert.ok(r.inventory.some(x=>x.kind===kind&&x.identity===forwardNative));
 assert.deepEqual(r.required_surface,m.required_surface);
 assert.equal(f.calls.filter(x=>x.phase==='predecessor').length,1);
 assert.ok(!f.calls.some(x=>x.phase==='cleanup_rm'));
});
await test('218 no-auto refuses a missing literal native grant before retaining its target',async()=>{
 const m=forwardPlan('no-auto'),f=fake(m,ctx=>ctx.phase==='surface_observed'?editJson(x=>{
  const index=x.findIndex(row=>row.kind==='grant'&&row.identity===forwardNative);assert.ok(index>=0);x.splice(index,1);
 })(ctx.result):undefined);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/normal_inventory_forward_surface/);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
 assert.ok(!f.outputs.has(join(m.output_dir,'no-auto-prepare-receipt.json')));
});
await test('218 pre-217 predecessor drift fails before applying either successor',async()=>{
 const m=forwardPlan(),f=fake(m,ctx=>ctx.phase==='forward_inventory_preimage'?editJson(x=>{
  x.find(row=>row.kind==='function'&&row.identity===forwardNamed).sha256='0'.repeat(64);
 })(ctx.result):undefined);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/forward_preimage_source/);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
 assert.ok(!f.calls.some(x=>x.phase==='migration_0216'||x.phase==='migration_0217'));
});
await test('218 preimage accepts historical shared restore orders but not duplicate identities',async()=>{
 assert.ok(new Set(forwardPreimage.map(x=>x.order)).size<forwardPreimage.length);
 assert.equal(new Set(forwardPreimage.map(x=>JSON.stringify([x.kind,x.identity]))).size,forwardPreimage.length);
 const m=forwardPlan(),f=fake(m,ctx=>ctx.phase==='forward_inventory_preimage'?editJson(x=>{
  const duplicate=x.find(row=>row.kind==='column');
  Object.assign(duplicate,x.find(row=>row.kind==='relation'));
 })(ctx.result):undefined);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/forward_preimage_unique/);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
 assert.ok(!f.calls.some(x=>x.phase==='migration_0216'||x.phase==='migration_0217'));
});
await test('218 preimage altered source-bound order refuses before successor',async()=>{
 const m=forwardPlan(),f=fake(m,ctx=>ctx.phase==='forward_inventory_preimage'?editJson(x=>{
  x.find(row=>row.kind==='function'&&row.identity===forwardNamed).order++;
 })(ctx.result):undefined);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/forward_preimage_source/);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
 assert.ok(!f.calls.some(x=>x.phase==='migration_0216'||x.phase==='migration_0217'));
});
await test('218 no-auto rejects unrelated definition changes despite same row count',async()=>{
 const m=forwardPlan('no-auto'),f=fake(m,ctx=>ctx.phase==='inventory_observed'?editJson(x=>{
  x.find(row=>row.kind==='relation').sha256='0'.repeat(64);
 })(ctx.result):undefined);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/forward_delta_unrelated_definition/);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
 assert.ok(!f.outputs.has(join(m.output_dir,'no-auto-prepare-receipt.json')));
});
for(const [name,change,pattern=/final_migration_position/] of [
 ['changed 216 prefix',x=>{x.source.migrations[0].sha256='0'.repeat(64)}],
 ['missing successor',x=>{x.source.migrations.pop()}],
 ['reordered successors',x=>{[x.source.migrations[216],x.source.migrations[217]]=[x.source.migrations[217],x.source.migrations[216]]}],
 ['changed 217 bytes',x=>{x.source.migrations[216].sha256='0'.repeat(64)}],
 ['changed 218 bytes',x=>{x.source.migrations[217].sha256='0'.repeat(64)}],
 ['unknown successor',x=>{x.source.migrations[217]={file:'20261004000100_unknown.sql',sha256:'0'.repeat(64)}}],
 ['predecessor moved',x=>{x.predecessor_fixture.migration=x.source.migrations.at(-1)},/predecessor_migration_identity/]
])await test('218 source rejects '+name+' before resource ownership',async()=>{
 const m=forwardPlan();change(m);const f=fake(m);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),pattern);
 assert.equal(f.calls.length,0);
});
function changeNativeGrant(x,update){const row=x.rows.find(r=>r.kind==='grant'&&r.identity===forwardNative);
 row.definition_sql=update(row.definition_sql);row.live_sql=row.definition_sql;row.sha256=hash(row.definition_sql);
 row.stored_sha256=row.sha256;row.live_sha256=row.sha256;
 x.metadata.find(r=>r.kind===row.kind&&r.identity===row.identity).sha256=row.sha256;}
for(const [name,change,pattern] of [
 ['missing native grant',x=>{x.rows=x.rows.filter(r=>!(r.kind==='grant'&&r.identity===forwardNative));x.metadata=x.metadata.filter(r=>!(r.kind==='grant'&&r.identity===forwardNative));x.count--},/normal_inventory_forward_count/],
 ['added unrelated survivor',x=>{const row={...x.rows[0],identity:'public.unrelated'};x.rows.push(row);x.metadata.push({kind:row.kind,identity:row.identity,order:row.order,sha256:row.sha256});x.count++},/normal_inventory_forward_count/],
 ['stale named function',x=>{const row=x.rows.find(r=>r.kind==='function'&&r.identity===forwardNamed);row.sha256='1d76c69cc34df8ffb18d9b07711da15c1dfed8c44c7f9b5fed5e5e8b63d93e85'},/normal_inventory_live_integrity/],
 ['native public grant',x=>{const row=x.rows.find(r=>r.kind==='grant'&&r.identity===forwardNative);row.definition_sql+=' grant execute on function custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to public;';row.live_sql=row.definition_sql;row.sha256=hash(row.definition_sql);row.stored_sha256=row.sha256;row.live_sha256=row.sha256;x.metadata.find(r=>r.kind===row.kind&&r.identity===row.identity).sha256=row.sha256},/normal_inventory_forward_native/],
 ['native postgres grant omitted',x=>changeNativeGrant(x,s=>s.replace(/ grant execute on function [^;]+ to postgres;/,'')),/normal_inventory_forward_native/],
 ['native service grant omitted',x=>changeNativeGrant(x,s=>s.replace(/ grant execute on function [^;]+ to service_role;/,'')),/normal_inventory_forward_native/],
 ['native grant roles substituted',x=>changeNativeGrant(x,s=>s.replace(' to postgres;',' to authenticated;')),/normal_inventory_forward_native/],
 ['native grant order swapped',x=>changeNativeGrant(x,s=>s.replace(/( grant execute on function [^;]+ to postgres;)( grant execute on function [^;]+ to service_role;)/,'$2$1')),/normal_inventory_forward_native/],
 ['native admin grant added',x=>changeNativeGrant(x,s=>s+' grant execute on function custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to static_weekly_control_plane;'),/normal_inventory_forward_native/],
 ['native grant option changed',x=>changeNativeGrant(x,s=>s.replace(' to service_role;',' to service_role with grant option;')),/normal_inventory_forward_native/],
 ['native wrong free order',x=>{const row=x.rows.find(r=>r.kind==='function'&&r.identity===forwardNative);row.order++;x.metadata.find(r=>r.kind===row.kind&&r.identity===row.identity).order=row.order},/forward_delta_free_order/],
 ['native grant wrong free order',x=>{const row=x.rows.find(r=>r.kind==='grant'&&r.identity===forwardNative);row.order++;x.metadata.find(r=>r.kind===row.kind&&r.identity===row.identity).order=row.order},/forward_delta_free_order/],
 ['unrelated live-consistent definition change',x=>{const row=x.rows.find(r=>r.kind==='relation');row.definition_sql+=' -- unrelated rewrite';row.live_sql=row.definition_sql;row.sha256=hash(row.definition_sql);row.stored_sha256=row.sha256;row.live_sha256=row.sha256;x.metadata.find(r=>r.kind===row.kind&&r.identity===row.identity).sha256=row.sha256},/forward_delta_unrelated_definition/],
 ['canary omits new grant',x=>{const row=x.rows.find(r=>r.kind==='function'&&r.identity===forwardCanary);row.definition_sql=row.definition_sql.replace(`, ('grant','${forwardNative}','server-only original event lookup ACL')`,'');row.live_sql=row.definition_sql;row.sha256=hash(row.definition_sql);row.stored_sha256=row.sha256;row.live_sha256=row.sha256;x.metadata.find(r=>r.kind===row.kind&&r.identity===row.identity).sha256=row.sha256},/normal_inventory_forward_surface/]
])await test('218 NORMAL rejects '+name+' and cleans owned fixture',async()=>{
 const m=forwardPlan(),f=fake(m,ctx=>ctx.phase==='normal_inventory'?editJson(change)(ctx.result):undefined);
 await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),pattern);
 assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
 assert.ok(!f.outputs.has(join(m.output_dir,'normal-prepare-receipt.json')));
});
await test('fake no-auto prepare retains only exact lease and never adopts inventory',async()=>{const {f,receipt}=await prepared();assert.equal(receipt.status,'OBSERVED_NOT_ACCEPTED');assert.equal(receipt.engine_executed,false);assert.equal(receipt.execution,'FAKE_SUBPROCESS_UNIT_ONLY');assert.equal(receipt.release_admission,false);assert.ok(!f.calls.some(x=>x.phase==='probe'||x.phase==='cleanup_rm'));assert.ok(f.calls.findIndex(x=>x.phase==='official')<f.calls.findIndex(x=>x.phase==='synthetic_seed'));assert.equal(f.calls.filter(x=>x.phase==='predecessor').length,1);assert.ok(f.calls.findIndex(x=>x.phase==='predecessor')<f.calls.findIndex(x=>x.phase==='migration_0004'));assert.equal(receipt.inventory.length,11)});
await test('normal lane captures separately and performs exact cleanup without probe or seeds',async()=>{const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m),r=await runRecoveryReplay(m,{root,io:f.io});assert.equal(r.status,'NORMAL_CATALOG_OBSERVED_NOT_ACCEPTED');assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));assert.ok(!f.calls.some(x=>/^(probe|official|synthetic_seed|remove_)/.test(x.phase)));assert.ok(f.outputs.has(join(m.output_dir,'normal-prepare-replayed-catalog.json')));assert.ok(f.outputs.has(join(m.output_dir,'normal-prepare-recovery-inventory.json')))});
await test('normal complete inventory binds raw SQL all11 metadata query source and artifact before cleanup',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m),r=await runRecoveryReplay(m,{root,io:f.io});
  const ref=r.recovery_inventory,bytes=f.outputs.get(join(m.output_dir,ref.file)),a=JSON.parse(bytes);
  assert.equal(ref.sha256,hash(bytes));assert.ok(r.artifacts.some(x=>x.file===ref.file&&x.sha256===ref.sha256));
  assert.equal(a.schema,'custodial.normal-recovery-inventory-observation.v1');assert.equal(a.classification,'NORMAL_INVENTORY_OBSERVED_NOT_ACCEPTED');
  assert.equal(a.count,11);assert.equal(a.predecessor_inventory_count,11);assert.deepEqual(a.rows,normalRows);assert.deepEqual(a.metadata,normalSnapshot().metadata);
  assert.equal(a.inventory_sha256,hash(canon(a.metadata)));assert.equal(ref.inventory_sha256,a.inventory_sha256);assert.equal(ref.count,a.count);
  assert.deepEqual(a.renderers,normalSnapshot().renderers);assert.equal(a.query_sha256,hash(NORMAL_INVENTORY_SQL));assert.equal(ref.query_sha256,a.query_sha256);
  assert.deepEqual(a.source,m.source);assert.deepEqual(a.runner_files,m.runner_files);assert.deepEqual(a.target,m.target);assert.equal(a.catalog_fingerprint,r.fingerprint);
  assert.deepEqual(a.required_surface,m.required_surface);assert.equal(a.required_surface_sha256,r.required_surface_sha256);
  assert.equal(a.authority_configured,false);assert.equal(a.independently_accepted,false);assert.equal(a.production,false);assert.equal(a.release_admission,false);
  assert.equal(a.engine_executed,false);assert.equal(a.execution,'FAKE_SUBPROCESS_UNIT_ONLY');
  const rawBytes=f.outputs.get(join(m.output_dir,a.raw_observation.file)),raw=JSON.parse(rawBytes);
  assert.equal(a.raw_observation.sha256,hash(rawBytes));assert.deepEqual(raw.observed,normalSnapshot());assert.equal(raw.classification,'NORMAL_INVENTORY_UNVALIDATED_OBSERVATION');assert.equal(raw.independently_accepted,false);
  assert.ok(f.calls.findIndex(x=>x.phase==='normal_inventory')>f.calls.findIndex(x=>x.phase==='migration_0004'));
  assert.ok(f.calls.findIndex(x=>x.phase==='write_'+ref.file)<f.calls.findIndex(x=>x.phase==='cleanup_rm'));
  const input=f.calls.find(x=>x.phase==='normal_inventory').call.input;assert.ok(input.endsWith(NORMAL_INVENTORY_SQL));assert.ok(input.includes('repeatable read read only'));
  assert.ok(!f.calls.some(x=>/^(probe|official|synthetic_seed|remove_|defaults_)/.test(x.phase)));
});
for(const [name,change,pattern] of [
  ['empty inventory',x=>{x.count=0;x.rows=[];x.metadata=[]},/normal_inventory_count/],
  ['unbounded count',x=>{x.count=20001},/normal_inventory_count/],
  ['text count',x=>{x.count='11'},/normal_inventory_count/],
  ['omitted complete row',x=>{x.rows.pop()},/normal_inventory_count/],
  ['additional complete row',x=>{x.rows.push({...x.rows[0],identity:'public.unexpected'})},/normal_inventory_count/],
  ['coherent extra row beyond predecessor count',x=>{const row={...x.rows[0],identity:'public.unexpected'};x.rows.push(row);x.metadata.push({kind:row.kind,identity:row.identity,order:row.order,sha256:row.sha256});x.count++},/normal_inventory_predecessor_count/],
  ['missing metadata row',x=>{x.metadata.pop()},/normal_inventory_count/],
  ['substituted extra identity',x=>{x.rows[0].identity='public.unexpected'},/normal_inventory_membership/],
  ['missing kind despite paired count',x=>{x.rows=x.rows.filter(r=>r.kind!=='policy');x.metadata=x.metadata.filter(r=>r.kind!=='policy');x.count--},/normal_inventory_all_kinds/],
  ['unknown kind',x=>{x.rows[0].kind='unknown'},/normal_inventory_identity/],
  ['null row',x=>{x.rows[0]=null},/normal_inventory_row/],
  ['metadata wrong shape',x=>{delete x.metadata[0].order},/normal_inventory_metadata/],
  ['control character identity',x=>{x.rows[0].identity+='\n'},/normal_inventory_identity/],
  ['noninteger order',x=>{x.rows[0].order=1.5},/normal_inventory_order/],
  ['changed restore order',x=>{x.rows[0].order++},/normal_inventory_membership/],
  ['zero order',x=>{x.rows[0].order=0},/normal_inventory_order/],
  ['duplicate key',x=>{x.rows[0]={...x.rows[1]}},/normal_inventory_duplicate/],
  ['duplicate metadata key',x=>{x.metadata[0]={...x.metadata[1]}},/normal_inventory_duplicate/],
  ['malformed recorded hash',x=>{x.rows[0].sha256='bad'},/normal_inventory_hash/],
  ['stale recorded hash',x=>{x.rows[0].sha256='0'.repeat(64)},/normal_inventory_live_integrity/],
  ['metadata digest replaced',x=>{x.metadata[0].sha256='0'.repeat(64)},/normal_inventory_membership/],
  ['stale stored computed hash',x=>{x.rows[0].stored_sha256='0'.repeat(64)},/normal_inventory_computed_hash/],
  ['stale current computed hash',x=>{x.rows[0].live_sha256='0'.repeat(64)},/normal_inventory_computed_hash/],
  ['stored raw bytes changed',x=>{x.rows[0].definition_sql+='x'},/normal_inventory_computed_hash/],
  ['current raw bytes changed',x=>{x.rows[0].live_sql+='x'},/normal_inventory_computed_hash/],
  ['authentic current digest disagrees with stored',x=>{x.rows[0].live_sql+='x';x.rows[0].live_sha256=hash(x.rows[0].live_sql)},/normal_inventory_live_integrity/],
  ['missing live object',x=>{x.rows[0].live_sql=null;x.rows[0].live_sha256=null},/normal_inventory_sql/],
  ['empty SQL',x=>{x.rows[0].definition_sql=''},/normal_inventory_sql/],
  ['oversized SQL',x=>{x.rows[0].definition_sql='x'.repeat(4*1024*1024+1)},/normal_inventory_sql/],
  ['unexpected output field',x=>{x.accepted=true},/normal_inventory_shape/],
  ['missing renderer',x=>{x.renderers.pop()},/normal_renderer_count/],
  ['duplicate renderer',x=>{x.renderers[0]={...x.renderers[1]}},/normal_renderer_source/],
  ['unknown renderer',x=>{x.renderers[0].identity='public.other(text)'},/normal_renderer_source/],
  ['drifted renderer source',x=>{x.renderers[0].sha256='0'.repeat(64)},/normal_renderer_source/]
])await test('normal inventory rejects '+name+' and cleans without authority',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;
  const f=fake(m,ctx=>ctx.phase==='normal_inventory'?editJson(change)(ctx.result):undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),pattern);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
  assert.ok(!f.calls.some(x=>/^(probe|official|synthetic_seed|remove_)/.test(x.phase)));assert.ok(!f.outputs.has(join(m.output_dir,'normal-prepare-receipt.json')));
  const raw=JSON.parse(f.outputs.get(join(m.output_dir,'normal-prepare-recovery-inventory-observed.json')));
  assert.equal(raw.classification,'NORMAL_INVENTORY_UNVALIDATED_OBSERVATION');assert.equal(raw.independently_accepted,false);
  assert.ok(!f.outputs.has(join(m.output_dir,'normal-prepare-recovery-inventory.json')));
});
for(const [name,response,pattern] of [
  ['response loss',{status:3,stdout:'',stderr:'hidden failed response'},/sql_normal_inventory/],
  ['malformed JSON',ok('{'),/json_normal_inventory/]
])await test('normal inventory '+name+' remains failure with exact cleanup',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m,ctx=>ctx.phase==='normal_inventory'?response:undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),pattern);assert.equal(f.calls.filter(x=>x.phase==='normal_inventory').length,1);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
  assert.ok(!f.outputs.has(join(m.output_dir,'normal-prepare-receipt.json')));assert.ok([...f.outputs.values()].every(bytes=>!bytes.includes('hidden failed response')));
});
await test('normal artifact write failure cannot return successful preparation',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m,ctx=>ctx.phase==='write_normal-prepare-recovery-inventory.json'?false:undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/output_write_failed/);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));assert.ok(!f.outputs.has(join(m.output_dir,'normal-prepare-receipt.json')));
});
await test('normal unvalidated observation write failure aborts without accepting or retaining target',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m,ctx=>ctx.phase==='write_normal-prepare-recovery-inventory-observed.json'?false:undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/output_write_failed/);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));assert.ok(!f.outputs.has(join(m.output_dir,'normal-prepare-receipt.json')));
});
await test('normal capture normalizes observation order without changing restore order',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;
  const f=fake(m,ctx=>ctx.phase==='normal_inventory'?editJson(x=>{x.rows.reverse();x.metadata.reverse();x.renderers.reverse()})(ctx.result):undefined);
  const r=await runRecoveryReplay(m,{root,io:f.io}),a=JSON.parse(f.outputs.get(join(m.output_dir,r.recovery_inventory.file)));assert.deepEqual(a.rows,normalRows);
});
await test('no-auto and probe receipt remain outside NORMAL artifact capture',async()=>{
  const {m,f,receipt}=await prepared();await runRecoveryReplay(verifyPlan(m,f),{root,io:f.io});assert.equal(receipt.recovery_inventory,undefined);
  assert.ok(!f.calls.some(x=>x.phase==='normal_inventory'));assert.ok(![...f.outputs.keys()].some(x=>x.endsWith('-recovery-inventory.json')));
});
await test('fixed normal renderer SQL exactly preserves probe contract and cannot execute stored SQL',()=>{
  const probe=readFileSync(new URL('./current-release-recovery-probe.mjs',import.meta.url),'utf8'),text=readFileSync(new URL('./current-release-recovery-replay.mjs',import.meta.url),'utf8');
  const live=probe.match(/const LIVE = `([\s\S]*?)`;/)[1],normal=text.match(/const NORMAL_LIVE=`([\s\S]*?)`;/)[1];assert.equal(normal,live);
  assert.equal(Object.keys(NORMAL_RENDERER_PINS).length,9);assert.ok(Object.values(NORMAL_RENDERER_PINS).every(x=>/^[a-f0-9]{64}$/.test(x)));
  assert.match(NORMAL_INVENTORY_SQL,/^begin isolation level repeatable read read only;/);assert.match(NORMAL_INVENTORY_SQL,/set local search_path=pg_catalog,public;/);
  assert.match(NORMAL_INVENTORY_SQL,/select count\(\*\) from public\.custodial_release_authority_restore_inventory/);
  // Renderer evidence deliberately contains quoted DROP/ALTER text; only
  // outside-literal SQL tokens could execute here. Stored strings stay data.
  const tokens=NORMAL_INVENTORY_SQL.replace(/'(?:''|[^'])*'/g,"''");
  assert.doesNotMatch(tokens,/\b(?:insert|update|delete|truncate|alter|execute|configure_backend_execution_key)\b/i);
  assert.ok(NORMAL_INVENTORY_SQL.endsWith('\ncommit;'));
  assert.equal(hash(NORMAL_INVENTORY_SQL),'4734489a6d85f774d77ca7175c9dce511a8d9560fbb01f8942c8e317dff96449');
});
await test('independent fake verify consumes root-bound manifest then closes exact lease',async()=>{const {m,f}=await prepared(),v=verifyPlan(m,f);const receipt=await runRecoveryReplay(v,{root,io:f.io});assert.equal(receipt.status,'SYNTHETIC_PROBE_COMPLETED_NOT_RELEASE_ADMITTED');assert.equal(receipt.engine_executed,false);assert.equal(f.calls.filter(x=>x.phase==='probe').length,1);assert.equal(f.calls.filter(x=>x.phase==='cleanup_rm').length,1)});
await test('prepare and verify preserve original source requirements while binding captured callable aliases',async()=>{
  const m=structuredClone(seed);m.required_surface=sort([...m.required_surface,{kind:'function',identity:'synthetic_function()'},{kind:'grant',identity:'synthetic_function()'}]);
  const original=structuredClone(m.required_surface),f=fake(m),r=await runRecoveryReplay(m,{root,io:f.io});
  assert.deepEqual(r.required_surface,original);assert.equal(r.required_surface_sha256,hash(canon(original)));assert.deepEqual(m.required_surface,original);
  const artifact=JSON.parse(f.outputs.get(join(m.output_dir,'no-auto-prepare-required-membership.json')));assert.deepEqual(artifact.required,original);assert.equal(artifact.required_sha256,r.required_surface_sha256);assert.equal(artifact.independently_accepted,false);
  const verified=await runRecoveryReplay(verifyPlan(m,f),{root,io:f.io});assert.deepEqual(verified.required_surface,original);assert.deepEqual(verified.probe_receipt.required_surface,original);assert.equal(verified.required_surface_sha256,hash(canon(original)));
});
for(const [name,change,pattern] of [
  ['null resolution',x=>{x[0].oid=null},/required_resolution_oid/],
  ['duplicate resolution',x=>{x[0]={...x[1]}},/required_resolution_duplicate/],
  ['unknown resolution kind',x=>{x[0].kind='unknown'},/required_resolution_tuple_set/],
  ['missing resolution',x=>{x.pop()},/required_resolution_count/]
])await boundary('prepare rejects '+name,'required_membership',editJson(change),pattern);
await boundary('prepare resolution response loss cannot retain successful lease','required_membership',()=>({status:3,stdout:'',stderr:'ERROR:08006'}),/sql_required_membership/);
await test('prepared original requirement hash cannot be replaced',async()=>{
  const {m,f}=await prepared(),v=verifyPlan(m,f),path=join(m.output_dir,v.prepared.file),prior=JSON.parse(f.outputs.get(path));prior.required_surface_sha256='0'.repeat(64);f.outputs.set(path,JSON.stringify(prior));v.prepared.sha256=hash(f.outputs.get(path));
  await assert.rejects(()=>runRecoveryReplay(v,{root,io:f.io}),/prepared_requirement_digest/);assert.ok(!f.calls.some(x=>x.phase==='probe'));
});
await test('prepared resolution cannot substitute a malformed source binding',async()=>{
  const {m,f}=await prepared(),v=verifyPlan(m,f),path=join(m.output_dir,v.prepared.file),prior=JSON.parse(f.outputs.get(path));prior.required_resolution[0].oid=null;f.outputs.set(path,JSON.stringify(prior));v.prepared.sha256=hash(f.outputs.get(path));
  await assert.rejects(()=>runRecoveryReplay(v,{root,io:f.io}),/required_resolution_oid/);assert.ok(!f.calls.some(x=>x.phase==='probe'));
});

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
await test('hash-pinned final migration raw log keeps primary rejection without promoting success',async()=>{
  const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;
  const primary='ERROR:  synthetic required authority member mismatch\n';
  const f=fake(m,ctx=>ctx.phase==='migration_0004'?{status:3,stdout:'',stderr:ctx.call.args.includes('VERBOSITY=terse')?primary:'ERROR:  P0001\n'}:undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/sql_migration_0004/);
  assert.equal(f.outputs.get(join(m.output_dir,'normal-prepare-migration_0004.log')),primary);
  assert.equal(f.calls.filter(x=>x.phase==='predecessor').length,1);
  assert.ok(!f.calls.some(x=>x.phase.startsWith('catalog_')));
  assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
  for(const [path,bytes] of f.outputs)if(!path.endsWith('migration_0004.log'))assert.ok(!bytes.includes(primary.trim()));
});
await test('only hash-verified migration raw logs request terse mode across both replay lanes and verify',async()=>{
  const {m,f}=await prepared();await runRecoveryReplay(verifyPlan(m,f),{root,io:f.io});
  const normal=structuredClone(seed);normal.lane='normal';normal.official_fixture=null;
  const n=fake(normal);await runRecoveryReplay(normal,{root,io:n.io});
  for(const [plan,fixture] of [[m,f],[normal,n]]){
    const commands=fixture.calls.filter(x=>x.call?.command==='docker'&&x.call.args[2]==='exec');
    assert.equal(commands.filter(x=>/^migration_\d{4,}$/.test(x.phase)).length,plan.source.migrations.length);
    assert.ok(commands.some(x=>!x.phase.startsWith('migration_')));
    for(const {phase,call} of commands){
      const migration=/^migration_\d{4,}$/.test(phase);
      assert.deepEqual(call.args.filter(x=>x.startsWith('VERBOSITY=')),['VERBOSITY='+(migration?'terse':'sqlstate')]);
      if(migration){
        const entry=plan.source.migrations[Number(phase.slice(10))],bytes=migrations.get(entry.file);
        assert.equal(hash(bytes),entry.sha256);assert.ok(call.input.endsWith('\n'+bytes.toString()));
        assert.ok(fixture.calls.findIndex(x=>x.phase==='read_'+entry.file)<fixture.calls.findIndex(x=>x.phase===phase));
      }
    }
  }
});
await test('nonmigration error keeps sqlstate mode and cannot leak its arbitrary stderr into artifacts',async()=>{
  const marker='synthetic nonmigration primary text must stay private';
  const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase==='defaults_before_0'?{status:3,stdout:'',stderr:marker}:undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/sql_defaults_before_0/);
  assert.ok(f.calls.find(x=>x.phase==='defaults_before_0').call.args.includes('VERBOSITY=sqlstate'));
  assert.ok([...f.outputs.values()].every(bytes=>!bytes.includes(marker)));
  assert.ok(!f.calls.some(x=>x.phase==='migration_0000'));assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
});
await test('unverified migration bytes never reach diagnostic execution or raw log',async()=>{
  const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase==='read_00000000000000_synthetic_baseline.sql'?Buffer.from('select 2;'):undefined);
  await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/migration_changed/);
  assert.ok(!f.calls.some(x=>x.call?.args.includes('VERBOSITY=terse')));
  assert.ok(![...f.outputs.keys()].some(path=>/migration_\d+\.log$/.test(path)));
  assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'));
});
await boundary('unrecognized default widening cannot be repaired','defaults_after_0',()=>ok('1'),/unexpected_default/);
await test('only exact three legacy exceptions can remove changed defaults',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>/^defaults_after_[123]$/.test(ctx.phase)?ok('1'):undefined);await runRecoveryReplay(m,{root,io:f.io});assert.equal(f.calls.filter(x=>x.phase.startsWith('remove_known_defaults_')).length,3)});
await test('known exception still requires zero readback',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>['defaults_after_1','defaults_rechecked_1'].includes(ctx.phase)?ok('1'):undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/defaults_recheck/);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'))});
await boundary('predecessor challenge failure cannot reach final migration','predecessor',()=>({status:1,stdout:'',stderr:'synthetic mismatch'}),/predecessor_fixture_failed/);
await boundary('predecessor false-looking receipt refused','predecessor',editJson(x=>{x.status='FAIL'}),/predecessor_receipt/);
await boundary('predecessor generic PASS JSON is insufficient','predecessor',()=>asJson({status:'PASS'}),/predecessor_receipt_shape/);
await boundary('predecessor source hash must match input pin','predecessor',editJson(x=>{x.source_sha256='0'.repeat(64)}),/predecessor_source_receipt/);
await boundary('predecessor all twenty rollback cases required','predecessor',editJson(x=>{x.cases.pop()}),/predecessor_cases/);
await boundary('historical four-case predecessor receipt cannot close new grant boundary','predecessor',editJson(x=>{x.checks=4;x.cases=x.cases.slice(0,4)}),/predecessor_receipt/);
await boundary('historical seven-case predecessor receipt cannot close six serialization corrections','predecessor',editJson(x=>{x.checks=7;x.cases=x.cases.slice(0,7)}),/predecessor_receipt/);
await boundary('seventeen-case receipt cannot close deterministic column order','predecessor',editJson(x=>{x.checks=17;x.cases=x.cases.slice(0,17)}),/predecessor_receipt/);
for(const id of Object.keys(predecessorReasons).slice(4))await boundary('predecessor requires exact new case '+id,'predecessor',editJson(x=>{x.cases=x.cases.filter(c=>c.id!==id)}),/predecessor_cases/);
await boundary('predecessor generic grant failure does not prove the owning rejection','predecessor',editJson(x=>{x.cases[4].expected_reason='ERROR:  P0001'}),/predecessor_rollback/);
await boundary('predecessor function wording cannot stand in for grant drift','predecessor',editJson(x=>{x.cases[5].expected_reason=x.cases[5].expected_reason.replace('required grant','required function')}),/predecessor_rollback/);
await test('twenty-case predecessor keeps exact14-field receipt and fixed source-only challenge structure',async()=>{
  const {m,f}=await prepared(),r=JSON.parse(f.outputs.get(join(m.output_dir,'no-auto-prepare-predecessor-fixture.log')));
  assert.equal(Object.keys(r).length,14);assert.equal(r.checks,20);assert.equal(r.cases.length,20);
  assert.deepEqual(r.cases.map(x=>x.expected_reason),Object.values(predecessorReasons));
  const text=readFileSync(join(root,PREDECESSOR_FIXTURE),'utf8');
  for(const id of Object.keys(predecessorReasons).filter(id=>!id.startsWith('captured_serialized_grant_')))assert.ok(text.includes("id:'"+id+"'"));
  for(const key of ['canary','incumbency','hydrate','materialize','schedule_base','lunch_base'])assert.ok(text.includes("['"+key+"',"));
  assert.ok(text.includes("id:'captured_serialized_grant_'+p.key+'_changed'"));
  assert.ok(text.includes("positiveSixControl('valid clock grant alias final migration control',validAliasSetup)"));
  assert.ok(text.indexOf('valid clock grant alias final migration control')<text.indexOf("id:'second_equivalent_clock_grant_alias_corrupted'"));
  assert.ok(text.includes("rollbackExact(label+' complete rollback')"));
  assert.ok(text.includes("assert.deepEqual(clockSnapshot(),clockBefore,label+' clock grant/function')"));
  assert.ok(text.includes("assert.equal(clockBefore.exact,true,'no preexisting clock grant fault credit')"));
  assert.match(text,/id:'second_equivalent_clock_grant_alias_corrupted'[\s\S]*?object_identity='\$\{CLOCK\}'/);
});
await test('six serialized grant identities orders and old/current hashes are independently pinned',()=>{
  const text=readFileSync(join(root,PREDECESSOR_FIXTURE),'utf8');
  // Evaluate only the fixture's fixed literal-array/map expression, no fixture
  // entrypoint, subprocess, SQL, filesystem output or engine is invoked.
  const expression=text.match(/const SERIALIZED_GRANTS=([\s\S]*?);\nconst PRIVATE_GRANT/)[1];
  const pins=Function('return ('+expression+');')();assert.equal(pins.length,6);
  assert.equal(hash(JSON.stringify(pins)),'7a7f1b162156299d4a9e490ef2b00d770ea68a3358b3b97acc3af979bc648bdb');
  assert.ok(text.includes("source.includes(p.identity)&&source.includes(p.reset)&&source.includes(p.prior)&&source.includes(p.current)"));
  assert.ok(text.includes("source.indexOf('end $grant_serialization$;')<source.indexOf('do $current_surface$')"));
  assert.ok(text.includes("positiveSixControl('valid six-grant private alias final migration control',privateAliasSetup+permutedColumns,{permutedColumns:true})"));
  assert.ok(text.indexOf("positiveSixControl('valid six-grant private alias final migration control'")<text.indexOf("id:'second_equivalent_serialized_grant_alias_corrupted'"));
  assert.ok(text.includes("assert.deepEqual(sixSnapshot(),sixBefore,label+' all six live/stored grants/functions')"));
  assert.match(text,/id:'serialized_reset_redirected_with_recomputed_digest'[\s\S]*?definition_sha256=public\.static_weekly_digest_text\(replace\(definition_sql/);
  assert.match(text,/id:'second_equivalent_serialized_grant_alias_corrupted'[\s\S]*?object_identity='\$\{PRIVATE_ALIAS\}'/);
  assert.ok(text.includes("assert.equal(results.length,20,'seven original plus ten grant and three column-order challenges')"));
});
await test('actual fixture pure positive validator preserves six hashes ACL bodies metadata and rollback',()=>{
  const text=readFileSync(join(root,PREDECESSOR_FIXTURE),'utf8'),expression=text.match(/const SERIALIZED_GRANTS=([\s\S]*?);\nconst PRIVATE_GRANT/)[1];
  const pins=Function('return ('+expression+');')();
  const columns=Function('return ('+text.match(/const EVENT_COLUMNS=([\s\S]*?);\nconst quote=/)[1]+');')();
  const assertBody=text.slice(text.indexOf(' function assertSix('),text.indexOf('\n assertSix(sixBefore);'));
  const checkSix=Function('assert','SERIALIZED_GRANTS',assertBody+';return assertSix;')(assert,pins);
  const columnsBody=text.slice(text.indexOf(' function assertColumns('),text.indexOf('\n assertColumns(columnsBefore);'));
  const checkColumns=Function('assert','EVENT_COLUMNS',columnsBody+';return assertColumns;')(assert,columns);
  const validator=text.slice(text.indexOf(' function positiveSixControl('),text.indexOf('\n const off=',text.indexOf(' function positiveSixControl(')));
  const initial={six:pins.map(p=>({identity:p.identity,order:p.order,stored:p.prior,computed:p.prior,live:p.current,same_oid:true,function_sha256:p.key==='canary'?null:'a'.repeat(64)})),columns:{range_occupants:6,rows:columns.map(p=>({identity:p.identity,order:p.order,stored:p.sha256,computed:p.sha256,live:p.sha256,preserved_sha256:'e'.repeat(64)}))},count:12,identity_order_sha256:'b'.repeat(64),other_rows_sha256:'c'.repeat(64),feedback_stored:'old',immutable:'O'};
  const completed=structuredClone(initial);completed.feedback_stored='live';for(const r of completed.six){r.stored=r.live;r.computed=r.live}
  function exercise(states,options={}){const commands=[],rollbacks=[];
    const control=Function('assert','run','succeeded','assertSix','assertColumns','EVENT_COLUMNS','rollbackExact','POSITIVE_STATE','body','before','OLD','LIVE',validator+';return positiveSixControl;')(
      assert,sql=>{commands.push(sql);return states.map(x=>JSON.stringify(x)).join('\n')},(value,label,options)=>{assert.equal(options.migrationControl,true);return value},checkSix,checkColumns,columns,label=>rollbacks.push(label),'select fixed_fake_state;','-- fixed fake migration',{inventory_count:11},'old','live');
    control('fixed fake positive','-- fixed fake alias setup\n',options);return{commands,rollbacks};
  }
  const good=exercise([initial,completed]);assert.equal(good.commands.length,1);assert.ok(good.commands[0].startsWith('begin;'));assert.ok(good.commands[0].endsWith('\nrollback;'));assert.deepEqual(good.rollbacks,['fixed fake positive complete rollback']);
  const mutants=[
    states=>states.pop(),states=>{states[0].count=11},states=>{states[1].count++},states=>{states[1].identity_order_sha256='d'.repeat(64)},
    states=>{states[1].other_rows_sha256='d'.repeat(64)},states=>{states[1].other_rows_sha256='malformed'},states=>{states[1].immutable='D'},
    states=>{states[1].feedback_stored='old'},states=>{states[1].six.pop()},states=>{states[1].six[0].order++},states=>{states[1].six[1].same_oid=false},
    states=>{states[1].six[1].computed='0'.repeat(64)},states=>{states[1].six[1].stored=pins[1].prior},states=>{states[1].six[1].live='0'.repeat(64)},
    states=>{states[1].six[1].function_sha256='d'.repeat(64)},states=>{states[1].six[0].function_sha256='d'.repeat(64)},states=>{states[1].six[0]={...states[1].six[1]}},
    states=>{states[1].columns.range_occupants=7},states=>{states[1].columns.rows.pop()},states=>{states[1].columns.rows[0].order=202129},
    states=>{states[1].columns.rows[0].live='0'.repeat(64)},states=>{states[1].columns.rows[0].preserved_sha256='f'.repeat(64)},
    states=>{[states[1].columns.rows[0].order,states[1].columns.rows[1].order]=[states[1].columns.rows[1].order,states[1].columns.rows[0].order]}
  ];
  for(const mutate of mutants){const states=structuredClone([initial,completed]);mutate(states);assert.throws(()=>exercise(states));}
  const permuted=structuredClone(initial);for(const row of permuted.columns.rows)row.order=404265-row.order;
  assert.equal(exercise([permuted,completed],{permutedColumns:true}).rollbacks.length,1);
  assert.throws(()=>exercise([initial,completed],{permutedColumns:true}),/actually exercised column permutation/);
});
await boundary('new grant correction receipt cannot omit the live ACL rejection','predecessor',editJson(x=>{x.cases.find(c=>c.id==='live_serialized_private_grant_changed').expected_reason='ERROR: P0001'}),/predecessor_rollback/);
await boundary('new grant correction receipt cannot replace exact alias rejection with preimage rejection','predecessor',editJson(x=>{x.cases.find(c=>c.id==='second_equivalent_serialized_grant_alias_corrupted').expected_reason='Current grant serialization captured predecessor changed: static_weekly_v3_assert_draft_incumbency(uuid)'}),/predecessor_rollback/);
await boundary('new grant correction receipt cannot reorder exact cases','predecessor',editJson(x=>{[x.cases[7],x.cases[8]]=[x.cases[8],x.cases[7]]}),/predecessor_cases/);
await boundary('all-six later rollback must be true','predecessor',editJson(x=>{x.cases.find(c=>c.id==='later_surface_failure_rolls_back_all_six_grants').rollback_exact=false}),/predecessor_rollback/);
await test('fixed fixture primary diagnostic keeps only first bounded ERROR line',()=>{
  const text=readFileSync(join(root,PREDECESSOR_FIXTURE),'utf8');
  const begin=text.indexOf('function primaryMigrationError('),end=text.indexOf('\nfunction succeeded(',begin);
  assert.ok(begin>0&&end>begin);
  // Execute only the exact source's pure formatter, never fixture IO or SQL.
  const primary=Function(text.slice(begin,end)+'\nreturn primaryMigrationError;')();
  assert.equal(primary('NOTICE: ignore\nERROR:  exact synthetic rejection\nDETAIL: private detail\nHINT: private hint\nCONTEXT: private context\nERROR: later error'),'ERROR:  exact synthetic rejection');
  assert.equal(primary('ERROR:  rejection\r\nCONTEXT: omitted'),'ERROR:  rejection');
  assert.equal(primary('DETAIL: not an error\nCONTEXT: omitted'),'');assert.equal(primary(undefined),'');
  assert.equal(primary('ERROR:  '+'x'.repeat(2000)).length,512);
  assert.doesNotMatch(primary('ERROR:  x\u0000\u001b\u007fy'),/[\x00-\x1f\x7f]/);
});
await test('only positive hash-bound migration control can include primary diagnostic in its failure',()=>{
  const text=readFileSync(join(root,PREDECESSOR_FIXTURE),'utf8');
  const begin=text.indexOf('function primaryMigrationError('),end=text.indexOf('\nfunction inspect(',begin);
  assert.ok(begin>0&&end>begin);
  const succeeded=Function('assert',text.slice(begin,end)+'\nreturn succeeded;')(assert);
  const failure={error:undefined,status:3,stdout:'',stderr:'ERROR:  required grant drift\nDETAIL: hidden payload'};
  assert.throws(()=>succeeded(failure,'fixed phase',{migrationControl:true}),error=>error.message.includes('fixed phase: ERROR:  required grant drift')&&!error.message.includes('hidden payload'));
  assert.throws(()=>succeeded(failure,'query phase'),error=>error.message.includes('query phase')&&!error.message.includes('required grant drift'));
  assert.equal(succeeded({...failure,status:0,stdout:'ok'},'fixed phase',{migrationControl:true}),'ok');
  assert.equal([...text.matchAll(/migrationControl:true/g)].length,1);
  assert.ok(text.includes("'ON_ERROR_STOP=1','-v','VERBOSITY=terse'"));
  assert.ok(text.includes('assert.equal(digest(bytes),migration.sha256)'));
  assert.ok(text.includes("keys(input,['target','migration'])"));
});
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
  ['denied caller not checked',x=>x.caller_checks.wrong_health_proof_denied=false,/probe_caller_receipts/],
  ['replaced source requirements',x=>x.required_surface=[],/probe_original_requirements/],
  ['wrong source requirement hash',x=>x.required_surface_sha256='0'.repeat(64),/probe_requirement_digest/],
  ['missing before-authority resolution',x=>delete x.required_membership.before,/probe_required_membership/],
  ['invalid postrestore resolution',x=>x.required_membership.after[0].oid=null,/required_resolution_oid/]
])await test('probe receipt rejects '+label,async()=>{let active=false;const {m,f}=await prepared(ctx=>active&&ctx.phase==='probe'?editJson(change)(ctx.result):undefined);active=true;await assert.rejects(()=>runRecoveryReplay(verifyPlan(m,f),{root,io:f.io}),pattern);assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'))});
await test('probe loss is never rerun; pending original request stays in durable failure',async()=>{let loss=false;const {m,f}=await prepared(ctx=>loss&&ctx.phase==='probe'?{status:1,stdout:'',stderr:JSON.stringify({pending_control:{request_id:id(50),action:'restore_authority'}})}:undefined);loss=true;await assert.rejects(()=>runRecoveryReplay(verifyPlan(m,f),{root,io:f.io}),/probe_failed/);assert.equal(f.calls.filter(x=>x.phase==='probe').length,1);assert.ok([...f.outputs.values()].some(x=>x.includes(id(50))));assert.ok(f.calls.some(x=>x.phase==='cleanup_rm'))});
await test('cleanup uncertainty cannot return overall success',async()=>{const m=structuredClone(seed);m.lane='normal';m.official_fixture=null;const f=fake(m,ctx=>ctx.phase==='cleanup_absent'?ok(m.target.id):undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/cleanup_not_confirmed/);assert.ok([...f.outputs.keys()].some(x=>x.includes('cleanup-failure')))});
await test('unsafe output produces no fallback writes',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase==='output'?false:undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/private_output/);assert.equal(f.outputs.size,0)});
await test('output inside source candidate rejected before target or writes',async()=>{const m=structuredClone(seed);m.output_dir=join(root,'evidence');const f=fake(m);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/output_outside_candidate/);assert.equal(f.outputs.size,0);assert.ok(!f.calls.some(x=>x.call))});
await test('raw partial migration failure output remains durable fake evidence',async()=>{const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase==='migration_0000'?{status:-1,stdout:'partial synthetic output',stderr:'terminated'}:undefined);await assert.rejects(()=>runRecoveryReplay(m,{root,io:f.io}),/sql_migration/);assert.equal(f.outputs.get(join(m.output_dir,'no-auto-prepare-migration_0000.log')),'partial synthetic outputterminated')});
await test('seed readback keeps existing text completion operation type',async()=>{const {f}=await prepared();const sql=f.calls.find(x=>x.phase==='seed_readback').call.input;assert.ok(sql.includes("client_completion_id='"));assert.doesNotMatch(sql,/client_completion_id='[^']+'::uuid/)});
await test('actual source enforces private exclusive durable outputs without endpoint imports',()=>{const text=readFileSync(new URL('./current-release-recovery-replay.mjs',import.meta.url),'utf8');assert.match(text,/O_CREAT\|constants.O_EXCL\|constants.O_NOFOLLOW/);assert.match(text,/fsyncSync\(fd\)/);assert.match(text,/s.uid===process.getuid/);assert.doesNotMatch(text,/from ['"].*(?:native-target-source-database-tests|empty-database-rebuild-check|refresh-schema-fingerprint)/);assert.doesNotMatch(text,/DATABASE_URL|process\.env\.(?:PG|DOCKER)|docker.*pull/)});
console.log(JSON.stringify({schema:'custodial.current-recovery-replay-contract-receipt.v1',checks,engine_executed:false,database_connections:0,authority_configurations:0,containers_launched:0,output_files_created:0,subprocesses:'explicit in-memory fake only',release_admission:false}));
