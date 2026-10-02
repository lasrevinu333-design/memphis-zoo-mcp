import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {RECOVERY_KINDS,localRecoverySource,runCurrentReleaseRecoveryProbe,validateRecoveryManifest} from './current-release-recovery-probe.mjs';

// Every subprocess below is an explicit in-memory fake. This suite never invokes
// Docker, psql, git, a URL or an authority function. It is NOT engine evidence.
const root=fileURLToPath(new URL('../',import.meta.url));
const ok=stdout=>({status:0,stdout:String(stdout),stderr:''});
const asJson=value=>ok(JSON.stringify(value));
const sort=rows=>rows.sort((a,b)=>{const x=JSON.stringify([a.kind,a.identity]),y=JSON.stringify([b.kind,b.identity]);return x<y?-1:x>y?1:0;});
function gitFake(command,args) {
  assert.equal(command,'git');assert.equal(args[0],'-C');assert.equal(args[1],root);
  if(args[2]==='status')return ok('');
  assert.equal(args[2],'rev-parse');return ok((args[3]==='HEAD'?'a':'b').repeat(40));
}
const source=localRecoverySource(root,gitFake);
const seed={schema:'custodial.current-release-recovery-probe-manifest.v1',synthetic:true,production:false,
  target:{name:'mz_schema_rebuild_current_probe_unit',id:'c'.repeat(64),image:'sha256:'+'d'.repeat(64),database:'postgres',fixture_id:'10000000-0000-4000-8000-000000000001'},
  source,inventory:RECOVERY_KINDS.map((kind,i)=>({kind,identity:'public.probe_'+kind,sha256:String((i%9)+1).repeat(64),order:i+1})),
  surface:RECOVERY_KINDS.map(kind=>({kind,identity:'public.probe_'+kind})),
  required_surface:[{kind:'relation',identity:'public.probe_relation'}],
  health_checks:['canary_authority_surface_captured','canary_authority_surface_live','restore_inventory_exact','restore_inventory_present'],
  protected_rows:[{relation:'public.synthetic_protected',count:2,sha256:'e'.repeat(64)}],
  faults:RECOVERY_KINDS.map(kind=>({kind,identity:'public.probe_'+kind})),
  omitted_surface:{kind:'relation',identity:'public.probe_relation'},manager_id:'20000000-0000-4000-8000-000000000001'};
sort(seed.inventory);sort(seed.surface);sort(seed.faults);
function health(m,kind='healthy',identity) {
  const checks=Object.fromEntries(m.health_checks.map(x=>[x,true]));
  if(kind==='digest')checks.restore_inventory_exact=false;
  if(kind==='omission')checks.canary_authority_surface_captured=false;
  return {ok:kind==='healthy',authority:'offline-authority.v5',canonical_objects_expected:m.inventory.length-(kind==='omission'?1:0),
    canary_surface_objects_expected:m.surface.length,missing_objects:[],mismatched_objects:kind==='digest'?[identity]:[],
    surface_missing_objects:[],surface_uncovered_objects:kind==='omission'?[identity]:[],checks};
}
function fake(m,mutate=()=>undefined) {
  const calls=[],controls=new Map();let inspections=0;
  function run(command,args,options={}) {
    const call={command,args,input:options.input};calls.push(call);
    let phase,result;
    if(command==='git') {phase='git_'+args.slice(2).join('_');result=gitFake(command,args);}
    else {
      assert.equal(command,'docker');assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);
      if(args[2]==='inspect') {
        inspections++;phase='inspect_'+inspections;assert.deepEqual(args.slice(2),['inspect','--type','container',m.target.name]);
        result=asJson([{Id:m.target.id,Name:'/'+m.target.name,Image:m.target.image,State:{Running:true},
          HostConfig:{NetworkMode:'none',PortBindings:{}},NetworkSettings:{Ports:{'5432/tcp':null},Networks:{none:{}}},
          Config:{Labels:{'org.memphiszoo.custodial.fixture':'synthetic','org.memphiszoo.custodial.owner':'/root','org.memphiszoo.custodial.fixture-id':m.target.fixture_id}}}]);
      } else {
        assert.deepEqual(args.slice(2),['exec','-i',m.target.id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','supabase_admin','-d',m.target.database]);
        phase=options.input.match(/^\/\* current-recovery:([a-z0-9_]+) \*\//)?.[1];assert.ok(phase,'named phase required');
        if(phase.startsWith('defaults'))result=ok('0');
        else if(phase==='manager')result=ok('1');
        else if(phase==='paused_after')result=ok('t');
        else if(phase==='configure')result=ok('');
        else if(phase.startsWith('inventory')||phase.startsWith('rollback'))result=asJson(m.inventory.map(x=>({...x,stored_sha256:x.sha256,live_sha256:x.sha256})));
        else if(phase.startsWith('surface_'))result=asJson(m.surface);
        else if(phase.startsWith('protected_'))result=asJson(m.protected_rows[0]);
        else if(phase.startsWith('digest_'))result=asJson(health(m,'digest',m.faults.find(x=>x.kind===phase.slice(7)).identity));
        else if(phase==='omission')result=asJson(health(m,'omission',m.omitted_surface.identity));
        else if(phase.includes('_denied_')||phase.endsWith('_wrong_secret'))result={status:3,stdout:'',stderr:'ERROR: 42501'};
        else if(phase.startsWith('health_')||phase.endsWith('_service'))result=asJson(health(m));
        else if(phase.endsWith('_readback'))result=asJson(controls.get(phase.replace('_readback','')));
        else if(phase==='pause_canary'||phase==='restore_authority') {
          const ids=[...options.input.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map(x=>x[1]);assert.equal(ids.length,2);
          const audit_id=phase==='pause_canary'?'30000000-0000-4000-8000-000000000001':'30000000-0000-4000-8000-000000000002';
          const value={device_identifier:'KIOSK_08',canary_paused:true,restored_objects:phase==='pause_canary'?0:m.inventory.length};
          controls.set(phase,{manager_id:ids[0],request_id:ids[1],device_identifier:'KIOSK_08',action:phase,
            reason:'synthetic current-source recovery probe',authoritative_health:{ok:false,scope:'current-source-synthetic'},audit_id,result:value});
          result=asJson({...value,audit_id,replayed:false});
        } else assert.fail('Unexpected fake phase '+phase);
      }
    }
    return mutate({phase,result,call,calls,controls})||result;
  }
  return {run,calls};
}
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name);}
function rejected(name,change,pattern=/./) {
  test(name,()=>{const m=structuredClone(seed);change(m);const f=fake(m);assert.throws(()=>runCurrentReleaseRecoveryProbe(m,{root,run:f.run}),pattern);assert.equal(f.calls.length,0,'bad manifest fails before any subprocess');});
}
function boundary(name,phase,change,pattern,{beforeConfigure=false}={}) {
  test(name,()=>{const m=structuredClone(seed),f=fake(m,ctx=>ctx.phase===phase?change(ctx.result,ctx):undefined);
    assert.throws(()=>runCurrentReleaseRecoveryProbe(m,{root,run:f.run}),pattern);
    if(beforeConfigure)assert.ok(!f.calls.some(x=>x.input?.includes('current-recovery:configure')),'no synthetic key configuration before target/source checks');});
}
const editJson=fn=>r=>{const x=JSON.parse(r.stdout);fn(x);return asJson(x);};

test('complete fake extension traverses eleven digest faults, omission, actual-controller contract and exact readbacks',()=>{
  const f=fake(seed),r=runCurrentReleaseRecoveryProbe(seed,{root,run:f.run});
  assert.equal(r.engine_executed,false);assert.equal(r.execution,'FAKE_SUBPROCESS_UNIT_ONLY');assert.equal(r.production,false);assert.equal(r.release_admission,false);
  assert.equal(r.rollback_faults.length,12);assert.deepEqual(r.rollback_faults.slice(0,11).map(x=>x.kind),RECOVERY_KINDS);
  assert.equal(r.controls.length,2);assert.equal(r.controls[1].action,'restore_authority');assert.equal(r.canary_left_paused,true);
  assert.equal(f.calls.filter(x=>x.input?.includes('current-recovery:restore_authority */')).length,1);
  assert.equal(f.calls.filter(x=>x.command==='docker'&&x.args[2]==='inspect').length,2);
  assert.equal(JSON.stringify(r).includes('synthetic-current-recovery-'),false,'receipt contains no synthetic proof');
  assert.ok(f.calls.every(x=>!x.args.includes('run')&&!x.args.includes('rm')),'probe never launches or destroys container');
});
test('manifest key order does not change structural meaning',()=>{const m=JSON.parse(JSON.stringify(seed,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).reverse()):x));validateRecoveryManifest(m);const f=fake(m);assert.equal(runCurrentReleaseRecoveryProbe(m,{root,run:f.run}).engine_executed,false);});
rejected('proposal is not executable',m=>{m.executable=false},/manifest_shape/);
rejected('production designation denied',m=>{m.production=true},/synthetic/);
rejected('URL target denied',m=>{m.target.name='https://db.example'},/local_owned/);
rejected('arbitrary Docker target denied',m=>{m.target.name='postgres'},/local_owned/);
rejected('unbound short container ID denied',m=>{m.target.id='abc'},/local_owned/);
rejected('remote database name denied',m=>{m.target.database='postgres://host/db'},/local_owned/);
rejected('unknown target field denied',m=>{m.target.url='ignored'},/target_shape/);
rejected('missing kind is not skipped',m=>{m.inventory=m.inventory.filter(x=>x.kind!=='policy')},/eleven/);
rejected('unknown kind is not skipped',m=>{m.inventory[0].kind='unsupported'},/inventory/);
rejected('duplicate inventory identity denied',m=>{m.inventory.push(m.inventory[0])},/inventory/);
test('database-permitted restore-order ties remain exact manifest data',()=>{const m=structuredClone(seed);m.inventory[1].order=m.inventory[0].order;const f=fake(m);assert.equal(runCurrentReleaseRecoveryProbe(m,{root,run:f.run}).engine_executed,false);});
rejected('missing fault kind denied',m=>{m.faults.pop()},/eleven_faults/);
rejected('fault target must be explicit inventory',m=>{m.faults[0].identity='public.foreign'},/fault_inventory/);
rejected('surface omission must target required membership',m=>{m.omitted_surface.identity='public.foreign'},/omission/);
rejected('required membership cannot be absent',m=>{m.required_surface[0].identity='public.foreign'},/required_surface/);
rejected('surface must map to inventory',m=>{m.surface[0].identity='public.foreign'},/surface_inventory/);
rejected('SQL-bearing protected relation denied',m=>{m.protected_rows[0].relation='public.x;select 1'},/protected_row_identity/);
rejected('probe-mutated configuration cannot masquerade as protected business rows',m=>{m.protected_rows[0].relation='public.custodial_backend_execution_config'},/protected_row_identity/);
rejected('empty synthetic dataset is not preservation evidence',m=>{m.protected_rows[0].count=0},/populated/);
rejected('migration traversal denied',m=>{m.source.migrations[0].file='../private'},/migration_identity/);
rejected('migration duplicates denied',m=>{m.source.migrations.push(m.source.migrations[0])},/migration_order/);
rejected('helper and owning test pins required',m=>{m.source.probe_files.pop()},/probe_files/);
rejected('health check set required',m=>{m.health_checks=[]},/health_checks/);
rejected('caller cannot inject arbitrary SQL',m=>{m.sql='select 1'},/manifest_shape/);
test('changed migration hash fails against current source before Docker',()=>{const m=structuredClone(seed);m.source.migrations[0].sha256='0'.repeat(64);const f=fake(m);assert.throws(()=>runCurrentReleaseRecoveryProbe(m,{root,run:f.run}),/source_manifest_mismatch/);assert.ok(f.calls.every(x=>x.command==='git'));});
boundary('dirty source denied','git_status_--porcelain_--untracked-files=normal',()=>ok(' M scripts/current-release-recovery-probe.mjs'),/clean_source/,{beforeConfigure:true});
boundary('malformed inspect denied','inspect_1',()=>ok('{bad'),/inspect_json/,{beforeConfigure:true});
boundary('two inspect objects denied','inspect_1',editJson(x=>x.push(x[0])),/one_container/,{beforeConfigure:true});
boundary('different container denied','inspect_1',editJson(x=>{x[0].Id='f'.repeat(64)}),/container_identity/,{beforeConfigure:true});
boundary('different immutable image denied','inspect_1',editJson(x=>{x[0].Image='sha256:'+'f'.repeat(64)}),/container_identity/,{beforeConfigure:true});
boundary('stopped container denied','inspect_1',editJson(x=>{x[0].State.Running=false}),/container_identity/,{beforeConfigure:true});
boundary('bridge network denied','inspect_1',editJson(x=>{x[0].HostConfig.NetworkMode='bridge'}),/network_none/,{beforeConfigure:true});
boundary('published port denied','inspect_1',editJson(x=>{x[0].HostConfig.PortBindings={'5432/tcp':[{HostPort:'5432'}]}}),/network_none/,{beforeConfigure:true});
boundary('missing network evidence denied','inspect_1',editJson(x=>{delete x[0].NetworkSettings}),/network_none/,{beforeConfigure:true});
boundary('missing synthetic ownership label denied','inspect_1',editJson(x=>{delete x[0].Config.Labels['org.memphiszoo.custodial.fixture']}),/owned_synthetic/,{beforeConfigure:true});
boundary('foreign fixture nonce denied','inspect_1',editJson(x=>{x[0].Config.Labels['org.memphiszoo.custodial.fixture-id']='foreign'}),/owned_synthetic/,{beforeConfigure:true});
boundary('automatic grants denied','defaults_before',()=>ok('1'),/automatic_grants/,{beforeConfigure:true});
boundary('missing live definition denied before configuration','inventory_before',editJson(x=>{x[0].live_sha256=null}),/live_inventory/,{beforeConfigure:true});
boundary('stored SQL hash mismatch denied','inventory_before',editJson(x=>{x[0].stored_sha256='f'.repeat(64)}),/live_inventory/,{beforeConfigure:true});
boundary('missing whole inventory row denied','inventory_before',editJson(x=>x.pop()),/inventory_manifest/,{beforeConfigure:true});
boundary('required surface not credited from manifest alone','surface_before',editJson(x=>x.pop()),/surface_manifest/,{beforeConfigure:true});
boundary('initial protected preimage must match root manifest','protected_before_synthetic_protected',editJson(x=>{x.sha256='f'.repeat(64)}),/protected_rows_changed/,{beforeConfigure:true});
boundary('existing named synthetic manager required','manager',()=>ok('0'),/synthetic_manager/,{beforeConfigure:true});
boundary('SQL failure cannot become health pass','health_before',()=>({status:3,stdout:'',stderr:'ERROR: XX000'}),/sql_health_before/);
boundary('missing health check denied','health_before',editJson(x=>{delete x.checks.restore_inventory_exact}),/health_check_set/);
boundary('truthy nonboolean health check denied','health_before',editJson(x=>{x.checks.restore_inventory_exact='true'}),/health_check_/);
boundary('unhealthy clean candidate denied','health_before',editJson(x=>{x.ok=false}),/health_result/);
boundary('configuration acceptance by service role denied','callers_before_denied_service_role',()=>ok(''),/configuration_caller_not_denied/);
boundary('wrong SQLSTATE is not caller denial','callers_before_denied_anon',()=>({status:3,stdout:'',stderr:'ERROR: XX000'}),/configuration_caller_not_denied/);
boundary('anon health acceptance with known synthetic proof denied','callers_before_health_denied_anon',()=>ok('{}'),/health_caller_not_denied/);
boundary('wrong health proof cannot be accepted','callers_before_wrong_secret',()=>ok('{}'),/wrong_proof_not_denied/);
boundary('wrong-device control receipt denied','pause_canary',editJson(x=>{x.device_identifier='KIOSK_09'}),/control_receipt_identity/);
boundary('pause receipt cannot claim restored objects','pause_canary',(r,ctx)=>{const value=JSON.parse(r.stdout);value.restored_objects=1;ctx.controls.get('pause_canary').result.restored_objects=1;return asJson(value);},/pause_not_confirmed/);
boundary('control readback must bind original request','pause_canary_readback',editJson(x=>{x.request_id='40000000-0000-4000-8000-000000000001'}),/control_original_readback/);
boundary('control readback must bind exact original reason','pause_canary_readback',editJson(x=>{x.reason='different operation'}),/control_original_readback/);
boundary('control readback must bind exact held health evidence','pause_canary_readback',editJson(x=>{x.authoritative_health.ok=true}),/control_original_readback/);
test('lost control response retains original request identity and never resends',()=>{const f=fake(seed,ctx=>ctx.phase==='pause_canary'?{status:3,stdout:'',stderr:'ERROR: 08006'}:undefined);let error;try{runCurrentReleaseRecoveryProbe(seed,{root,run:f.run})}catch(e){error=e}assert.match(error.message,/sql_pause_canary/);assert.equal(error.pending_control.action,'pause_canary');assert.match(error.pending_control.request_id,/^[0-9a-f-]{36}$/);assert.equal(f.calls.filter(x=>x.input?.includes('current-recovery:pause_canary */')).length,1);});
boundary('digest fault must produce exact mismatch','digest_policy',editJson(x=>{x.mismatched_objects=[]}),/health_mismatched_objects/);
boundary('omitted required entry must produce uncovered identity','omission',editJson(x=>{x.surface_uncovered_objects=[]}),/health_surface_uncovered/);
boundary('rollback must restore stored bytes','rollback_digest_column',editJson(x=>{x[0].sha256='f'.repeat(64)}),/live_inventory/);
boundary('rollback must preserve business data','protected_digest_column_synthetic_protected',editJson(x=>{x.count++}),/protected_rows_changed/);
boundary('restore count must be exact, not greater than forty','restore_authority',(r,ctx)=>{
  const value=JSON.parse(r.stdout);value.restored_objects++;
  ctx.controls.get('restore_authority').result.restored_objects++;
  return asJson(value);
},/restore_receipt_mismatch/);
boundary('post-restore protected rows must agree','protected_after_synthetic_protected',editJson(x=>{x.sha256='f'.repeat(64)}),/protected_rows_changed/);
boundary('post-restore grant policy cannot widen','defaults_after',()=>ok('1'),/automatic_grants/);
boundary('canary must remain paused','paused_after',()=>ok('f'),/canary_not_left_paused/);
boundary('target cannot rotate during proof','inspect_2',editJson(x=>{x[0].Id='f'.repeat(64)}),/container_identity/);
test('source cannot change during proof',()=>{let heads=0;const f=fake(seed,ctx=>ctx.phase==='git_rev-parse_HEAD'&&++heads===2?ok('f'.repeat(40)):undefined);assert.throws(()=>runCurrentReleaseRecoveryProbe(seed,{root,run:f.run}),/source_changed_during_probe/);});
test('manifest identity cannot terminate the SQL anonymous-body string',()=>{
  const m=structuredClone(seed),identity="public.probe_column$fault$';select forbidden;--";
  for(const rows of [m.inventory,m.surface,m.faults]){rows.find(x=>x.kind==='column').identity=identity;sort(rows);}
  const f=fake(m);runCurrentReleaseRecoveryProbe(m,{root,run:f.run});
  const sql=f.calls.find(x=>x.input?.startsWith('/* current-recovery:digest_column */')).input;
  const body=sql.match(/\bdo '((?:[^']|'')*)';\n/);assert.ok(body,'entire body is a single SQL literal');
  assert.ok(body[1].includes("public.probe_column$fault$'''';select forbidden;--"),'nested identity quotes stay doubled twice');
  assert.doesNotMatch(sql,/\bdo \$fault\$/);
  assert.ok(sql.includes('set standard_conforming_strings=on;'),'SQL literal parsing is explicit');
});
test('portable source has no unpublished Git object or remote target path',()=>{const s=readFileSync(new URL('./current-release-recovery-probe.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/git show|DATABASE_URL|process\.env\.(?:PG|DOCKER)|dockerContainer|SCHEMA_FINGERPRINT_MCP_URL/);assert.match(s,/pending_control/);assert.match(s,/Unknown outcome: never resend/);assert.match(s,/FAKE_SUBPROCESS_UNIT_ONLY/);});
console.log(JSON.stringify({schema:'custodial.current-release-recovery-probe-contract-receipt.v1',checks,engine_executed:false,subprocesses:'explicit in-memory fake only',database_connections:0,authority_configurations:0,release_admission:false}));
