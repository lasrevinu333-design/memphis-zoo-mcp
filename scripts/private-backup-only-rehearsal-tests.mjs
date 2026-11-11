import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,fsyncSync,closeSync,mkdtempSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PG_IMAGE,selectPrivateProfile,freshIntentEnvelope,assertOwnedPg,assertPrivateResult,safeSourcePreparationFailure,originalOwnerMetadataDiagnostics,targetCreationOperation,targetCreationMetadata,classifyPinnedPostgresPullFailure} from './run-private-backup-only-rehearsal.mjs';
import {storageWorkerActor,assertPrivatePgOwnerProfile,resourceProfile,assertPrivatePgNetwork,assertPrivateNetworkMembers,privateRestoreFailureDiagnostic,privateRestoreStreamDiagnostic,privateEvidenceFile,privateEvidenceReceipt,safeStartupFailure,stable,IMAGE} from './run-official-local-storage-rehearsal.mjs';
import {captureVerifiedOriginalRestoreIntent} from './disaster-recovery-crypto.mjs';
import {captureVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
const key='offline-fixture-independent-intent-key-32bytes',keyId='fixture';
const binding={archive_digest:'a'.repeat(64),source_identity_sha256:'b'.repeat(64),project_ref:'a'.repeat(20),
  source_identity:{migration_head:'20261111161430',release:{release_id:'original-release',backend_commit:'c'.repeat(40),
    frontend_commit:'d'.repeat(40),migration_head:'20260920010000',migration_manifest_sha256:'e'.repeat(64)}}};
const names=['employee_message_original_outcomes','group_original_creations'];
const source=()=>({selection:{privateTables:names.map(table_name=>({schema_name:'custodial_release_identity',table_name}))}});
test('private selection is exact; new namespace names never substitute',()=>{
  assert.equal(selectPrivateProfile(source()),'private');assert.equal(selectPrivateProfile({selection:{privateTables:[]}}),'native');
  for(const values of [[names[0]],[...names,'other'],[names[0],names[0]],['custodial_employment']])
    assert.throws(()=>selectPrivateProfile({selection:{privateTables:values.map(table_name=>({table_name}))}}));
});
test('fresh intent preserves separate runtime and schema identities; no retry or resume',()=>{
  const e=freshIntentEnvelope(binding,key,keyId);
  const verified=captureVerifiedOriginalRestoreIntent(e,key,keyId);
  assert.equal(verified.target_migration_head,'20261111161430');assert.equal(verified.target_release_identity.migration_head,'20260920010000');
  assert.equal(verified.authority_generation,1);assert.equal(verified.retry_of_restore_id,null);assert.equal(verified.resume_after_verification,false);
  assert.notEqual(freshIntentEnvelope(binding,key,keyId).intent.restore_id,e.intent.restore_id);
});
test('intent signature rejects tampering and wrong key',()=>{
  for(const field of ['archive_digest','target_project_ref','target_migration_head','authority_generation','resume_after_verification']){
    const e=freshIntentEnvelope(binding,key,keyId);e.intent[field]=field==='resume_after_verification'?true:'changed';
    assert.throws(()=>captureVerifiedOriginalRestoreIntent(e,key,keyId));
  }
  assert.throws(()=>captureVerifiedOriginalRestoreIntent(freshIntentEnvelope(binding,key,keyId),'different-key-'.repeat(4),keyId));
});
test('fresh branded capture cannot accept public forged archive',()=>{
  assert.throws(()=>captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:binding,
    originalIntentEnvelope:freshIntentEnvelope(binding,key,keyId),intentVerifyKey:key,intentVerifyKeyId:keyId}));
});
const identity={id:'1'.repeat(64),name:'mz_schema_rebuild_123',owner:'a'.repeat(32),ownerProfile:{id:'immutable-private-current-postgres',actor:'postgres'},networkId:'2'.repeat(64),networkName:'owned'};
const pg=()=>({Id:identity.id,Name:'/'+identity.name,Config:{Image:PG_IMAGE,Labels:{'custodial.private-backup-rehearsal':identity.owner,'custodial.private-owner-profile':identity.ownerProfile.id,'custodial.private-owner-actor':identity.ownerProfile.actor}},
  State:{Running:true},NetworkSettings:{Ports:{'5432/tcp':null},Networks:{owned:{NetworkID:identity.networkId,IPAddress:'172.20.0.2'}}}});
test('owned target validates exact ID/image/label/network, never published ports',()=>{
  assert.equal(assertOwnedPg(pg(),identity),'172.20.0.2');
  for(const change of [p=>p.Id='3'.repeat(64),p=>p.Config.Image='postgres:latest',p=>p.Config.Labels={},p=>p.State.Running=false,
    p=>p.NetworkSettings.Ports['5432/tcp']=[{HostIp:'127.0.0.1',HostPort:'1234'}],
    p=>p.NetworkSettings.Ports['5432/tcp']=[{HostIp:'0.0.0.0',HostPort:'5432'}],
    p=>p.NetworkSettings.Networks.owned.NetworkID='wrong',p=>p.NetworkSettings.Networks.owned.IPAddress='localhost']){
    const p=pg();change(p);assert.throws(()=>assertOwnedPg(p,identity));
  }
});
function resultFixture(){
  const e=freshIntentEnvelope(binding,key,keyId);
  const s={...source(),sourceBinding:{...binding,summary:{table_count:365,database_row_count:1234,storage_object_count:1}}};
  const r={ok:true,restore_id:e.intent.restore_id,authority_generation:1,database_only:true,mutations_paused:true,
    state:'PAUSED_RECONCILIATION',database_tables:365,database_rows:1234,complete_restore:false,resume_allowed:false,
    retry_allowed:false,rerun_import_allowed:false,archive_digest:binding.archive_digest,
    original_data_readback:{private_data:{state:'MATCH',tables:names.map(table_name=>({table_name,state:'MATCH'}))},ordinary_data:{state:'MATCH'},storage_data:{status:'MATCH'}},
    authority_observation:{outcome:'AUTHORITY_COMPLETION_OBSERVED'},
    authority_data_readback:{schema:'custodial.immutable-private-post-authority-data-readback.v1',state:'MATCH',
      private_data:{state:'MATCH'},ordinary_data:{state:'SOURCE_TRANSFORMATION_VERIFIED'},storage_data:{status:'MATCH'},
      comparison_only:true,metadata_only:true,complete_restore:false,resume_allowed:false,retry_allowed:false,
      rerun_import_allowed:false,inventory_acknowledged:false,effects:false},storage:{provider_verified:true,object_bytes_verified:true,
      metadata_and_ownership_verified:true,scope:'OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL',production_provider_verified:false,
      owner_access_probes:[{status:'VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY'}]}};
  return {e,s,r};
}
test('success requires private/ordinary/storage readback plus provider and held state',()=>{
  let {e,s,r}=resultFixture();assert.equal(assertPrivateResult(r,s,e.intent),true);
  for(const mutate of [r=>r.original_data_readback.private_data.state='DIFFERENT',r=>r.original_data_readback.private_data.tables.pop(),
    r=>r.original_data_readback.ordinary_data.state='UNSUPPORTED',r=>r.original_data_readback.storage_data.status='DIFFERENT',
    r=>r.storage.provider_verified=false,r=>r.storage.object_bytes_verified=false,r=>r.storage.owner_access_probes=[],
    r=>r.storage.production_provider_verified=true,r=>r.authority_observation.outcome='UNKNOWN',r=>r.database_tables--,
    r=>r.resume_allowed=true,r=>r.state='READY',r=>r.authority_data_readback.private_data.state='DIFFERENT',r=>r.authority_data_readback.ordinary_data.state='CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK']){
    const {e,s,r}=resultFixture();mutate(r);assert.throws(()=>assertPrivateResult(r,s,e.intent));
  }
});
test('workflow dispatches authenticated private selection before native target and bypasses legacy cleanup',()=>{
  const w=readFileSync(new URL('../.github/workflows/production-backup-migration-rehearsal.yml',import.meta.url),'utf8');
  const start=w.indexOf('node scripts/run-private-backup-only-rehearsal.mjs --dispatch'),native=w.indexOf('          docker pull "$image"');
  assert.ok(start>0&&native>start);const branch=w.slice(start,native);
  assert.match(branch,/--dispatch \| tee -a "\$receipt"; then exit 0; else status=\$\?; fi/);
  assert.match(branch,/test "\$status" = 3/);
  assert.ok(w.indexOf('source-binding')<start);assert.ok(w.indexOf('restore:prepare-isolated')>native);
  assert.match(w,/if test "\$\{private_route_active:-false\}" = true; then return "\$status"; fi/);
  assert.ok(w.indexOf('private_route_active=true')<w.indexOf('trap cleanup EXIT'));
  assert.match(w,/python3 scripts\/extract-rehearsal-archive.py/);
  assert.doesNotMatch(w,/tar -C \"\$backup_dir\" -xzf/);
  assert.ok(branch.indexOf('test "$status" = 3')<branch.indexOf('private_route_active=false'));
});
test('new runner has no hydration, legacy intent producer or migration invocation',()=>{
  const s=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(s,/['"](?:--publish|-p|restore:prepare-isolated|restore:intent|release:migrations:apply)['"]/);
  assert.match(s,/captureVerifiedImmutableFreshRestoreIntent\(\{verifiedArchive:archive/);
  assert.ok(s.indexOf('await prepareVerifiedImmutableBootstrapSource(archive)')<s.indexOf("phase='create_owned_target'"));
  assert.match(s,/closeOwnedRelay\(relay,sockets/);assert.match(s,/await Promise.allSettled\(\[\.\.\.pendingConnections\]\)/);
  assert.match(s,/database_restore_outcome|disposable_database_restore_outcome/);
});

test('source preparation failure exposes only exact closed code and phase, never operands',()=>{
  const error={code:'IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE',source_phase:'ORIGINAL_REGISTRY',message:'private fixture',actual:'private fixture'};
  assert.deepEqual(safeSourcePreparationFailure(error),{code:error.code,source_phase:'ORIGINAL_REGISTRY'});
  assert.equal(safeSourcePreparationFailure({...error,source_phase:'private fixture'}),null);
  assert.equal(safeSourcePreparationFailure({...error,code:'other'}),null);
  assert.equal(safeSourcePreparationFailure({get code(){throw Error('must not invoke')}}),null);
});

test('signed owner diagnostic emits only fixed identities, bounded owner enums and hashes',()=>{
  const marker='private SQL must not escape';
  const inventory={'inventory/original-guards.json':JSON.stringify([{owner:'postgres',definition:marker,prosrc:marker},
    {owner:marker,definition:marker,prosrc:marker}]),'inventory/original-relations.json':JSON.stringify([
    {schema_name:'custodial_release_identity',table_name:'group_original_creations',owner_name:'postgres'}]),
    'inventory/original-acls.json':JSON.stringify({routines:[{kind:'FUNCTION',identity:'custodial_release_identity.guard_group_original_creation()',owner_name:'postgres',prosecdef:true,grants:marker}],namespaces_columns:[{kind:'SCHEMA',schema_name:'custodial_release_identity',owner_name:'postgres',grants:marker}]})};
  const result=originalOwnerMetadataDiagnostics(inventory);
  assert.equal(result.guards[0].owner,'postgres');assert.equal(result.guards[1].owner,'OTHER_OR_MISSING');
  assert.match(result.guards[0].definition_sha256,/^[a-f0-9]{64}$/);assert.equal(result.admission_changed,false);
  assert.equal(result.release_identity_namespace_owner,'postgres');
  assert.equal(result.recipe_function_count,25);assert.equal(new Set(result.recipe_functions.map(r=>r.identity)).size,25);
  assert.equal(result.recipe_functions[0].owner,'postgres');
  assert.equal(result.recipe_functions[0].owner_evidence,'EXACT_ACL_MATCH');
  assert.equal(result.recipe_functions[1].owner_evidence,'MISSING');
  assert.equal(result.recipe_functions[1].owner,'OTHER_OR_MISSING');
  assert.ok(result.recipe_functions.every(r=>r.security_definer==='NOT_REPRESENTED_IN_ACL_INVENTORY'));
  assert.equal(result.restore_control.role,'TARGET_CREATED_RESTORE_CONTROL');
  assert.equal(result.restore_control.source_inventory_match_count,0);
  assert.equal(JSON.stringify(result).includes(marker),false);
  const acls=JSON.parse(inventory['inventory/original-acls.json']);
  acls.routines.push({...acls.routines[0],owner_name:marker});
  inventory['inventory/original-acls.json']=JSON.stringify(acls);
  const duplicate=originalOwnerMetadataDiagnostics(inventory).recipe_functions[0];
  assert.equal(duplicate.owner_evidence,'AMBIGUOUS');assert.equal(duplicate.owner,'OTHER_OR_MISSING');
  assert.equal(duplicate.acl_match_count,2);
  acls.routines.shift();inventory['inventory/original-acls.json']=JSON.stringify(acls);
  assert.equal(originalOwnerMetadataDiagnostics(inventory).recipe_functions[0].owner,'OTHER_OR_MISSING');
  acls.routines=result.recipe_functions.map(({identity},i)=>({kind:'FUNCTION',identity,owner_name:i%2?'supabase_admin':'postgres'}));
  inventory['inventory/original-acls.json']=JSON.stringify(acls);
  const complete=originalOwnerMetadataDiagnostics(inventory);
  assert.ok(complete.recipe_functions.every((r,i)=>r.acl_match_count===1&&r.owner_evidence==='EXACT_ACL_MATCH'&&r.owner===(i%2?'supabase_admin':'postgres')));
  assert.deepEqual(complete.recipe_functions.map(r=>r.identity),result.recipe_functions.map(r=>r.identity));
});


test('Storage worker exact owner contracts reject relabeling and arbitrary role inputs',()=>{
  const legacy={id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'};
  const current={id:'immutable-private-current-postgres',actor:'postgres'};
  assert.equal(storageWorkerActor('native-text-v4-fresh-supabase-admin'),'supabase_admin');
  assert.equal(storageWorkerActor('immutable-private-fresh-supabase-admin',legacy),'supabase_admin');
  assert.equal(storageWorkerActor('immutable-private-fresh-postgres',current),'postgres');
  assert.equal(resourceProfile('immutable-private-fresh-postgres').work_ms,1800000);
  for(const [profile,owner] of [
    ['native-text-v4-fresh-supabase-admin',current],['immutable-private-fresh-supabase-admin',current],
    ['immutable-private-fresh-postgres',legacy],['immutable-private-fresh-postgres',{...current,actor:'supabase_admin'}],
    ['immutable-private-fresh-postgres',{...current,extra:true}],['caller-profile',current],['immutable-private-fresh-postgres',undefined],
  ])assert.throws(()=>storageWorkerActor(profile,owner));
});
test('private Docker ownership is tied to source profile and rejects missing or mixed labels',()=>{
  assert.equal(assertPrivatePgOwnerProfile(pg(),identity.ownerProfile),true);
  for(const mutate of [
    p=>delete p.Config.Labels['custodial.private-owner-profile'],p=>p.Config.Labels['custodial.private-owner-actor']='supabase_admin',
    p=>p.Config.Labels['custodial.private-owner-profile']='immutable-private-legacy-supabase-admin',
    p=>p.Config.Labels['custodial.private-backup-rehearsal']='unowned',p=>delete p.NetworkSettings.Ports,
    p=>p.NetworkSettings.Ports['5432/tcp']=[{HostIp:'127.0.0.1',HostPort:'5432'}],
  ]){const value=pg();mutate(value);assert.throws(()=>assertPrivatePgOwnerProfile(value,identity.ownerProfile));}
  assert.throws(()=>assertOwnedPg(pg(),{...identity,ownerProfile:undefined}));
});
test('only authenticated owner selects DATA actor; administrator schema replay stays separate',()=>{
  const runner=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  assert.match(runner,/ownerProfile=readVerifiedImmutableBootstrapOwnerProfile\(bootstrapSource,archive\)/);
  assert.match(runner,/secretEnv.SUPABASE_DB_URL='postgresql:\/\/'\+requireOwnerProfile\(\).actor/);
  assert.match(runner,/env:\{\.\.\.secretEnv,SUPABASE_DB_URL:schemaDatabaseUrl\}/);
  assert.match(runner,/assertPrivatePgOwnerProfile\(value,ownerProfile\)/);
  const worker=readFileSync(new URL('./run-official-local-storage-rehearsal.mjs',import.meta.url),'utf8');
  assert.match(worker,/context.rows\[0\].session_user===expectedActor && context.rows\[0\].current_user===expectedActor/);
  assert.match(worker,/assertPrivatePgOwnerProfile\(pg,a.owner_profile\)/);
  assert.match(worker,/assertPrivatePgOwnerProfile\(boundedPg,a.owner_profile\)/);
  assert.match(worker,/DB_MIGRATIONS_FREEZE_AT:a.source_profile==='native-text-v4-fresh-supabase-admin'\?supportedOfficialStartupMigration/);
});


test('private parent admits exactly one internal owned network and provider borrows it',()=>{
  const netIdentity={networkId:identity.networkId,networkName:identity.name+'_private_'+identity.owner,owner:identity.owner,
    pgid:identity.id,pgName:identity.name,address:'172.20.0.2'};
  const network={Id:netIdentity.networkId,Name:netIdentity.networkName,Internal:true,
    Labels:{'custodial.private-backup-rehearsal':identity.owner},Containers:{[identity.id]:{Name:identity.name,IPv4Address:'172.20.0.2/16'}}};
  assert.equal(assertPrivatePgNetwork(network,netIdentity),true);
  assert.equal(assertPrivateNetworkMembers(network,netIdentity),true);
  const provider='f'.repeat(64),attached=structuredClone(network);attached.Containers[provider]={Name:'owned_provider',IPv4Address:'172.20.0.3/16'};
  assert.equal(assertPrivateNetworkMembers(attached,netIdentity,provider),true);
  assert.throws(()=>assertPrivateNetworkMembers(attached,netIdentity));
  delete attached.Containers[provider];assert.equal(assertPrivateNetworkMembers(attached,netIdentity),true);
  for(const mutate of [n=>n.Internal=false,n=>n.Id='b'.repeat(64),n=>n.Name+='other',n=>n.Labels={},
    n=>n.Containers[identity.id].Name='other',n=>n.Containers[identity.id].IPv4Address='172.20.0.9/16',
    n=>delete n.Containers[identity.id],n=>n.Containers['e'.repeat(64)]={Name:'foreign'}]){
    const value=structuredClone(network);mutate(value);assert.throws(()=>assertPrivateNetworkMembers(value,netIdentity));
  }
  const value=pg();value.NetworkSettings.Networks.foreign={NetworkID:'e'.repeat(64),IPAddress:'172.21.0.2'};
  assert.throws(()=>assertOwnedPg(value,identity));
  const runner=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  assert.match(runner,/assertPrivatePgNetwork\(JSON.parse\(await docker\(\['network','inspect',networkId\],options\)\)\[0\],networkIdentity\)/);
});

test('private cleanup only removes provider, including uncertain birth; borrowed network remains',async()=>{
  const worker=readFileSync(new URL('./run-official-local-storage-rehearsal.mjs',import.meta.url),'utf8');
  const start=worker.indexOf("      if(!cid){const candidates="),end=worker.indexOf('    }catch(e){cleanupFailure=e;failure??=e;}',start);
  assert.ok(start>0&&end>start);const body=worker.slice(start,end);
  const provider='d'.repeat(64),pgid=identity.id,namespace='mz_schema_rebuild_storage_fixture';
  const privateNetwork={networkId:identity.networkId,networkName:identity.name+'_private_'+identity.owner,owner:identity.owner,
    pgid,pgName:identity.name,address:'172.20.0.2'};
  const network={Id:privateNetwork.networkId,Name:privateNetwork.networkName,Internal:true,
    Labels:{'custodial.private-backup-rehearsal':identity.owner},Containers:{[pgid]:{Name:identity.name,IPv4Address:'172.20.0.2/16'}}};
  const inspect={Id:provider,ImageId:'sha256:'+'e'.repeat(64),Config:{Labels:{'custodial.owner':namespace},Image:IMAGE}};
  for(const initialCid of [null,provider]){
    const calls=[];const run=async args=>{calls.push(args);
      if(args[1]==='inspect')return JSON.stringify(inspect);
      if(args[1]==='network'&&args[2]==='inspect')return JSON.stringify([network]);
      if(args[1]==='ps'&&args.includes('--no-trunc'))return provider;
      return '';
    };
    const invoke=new Function('ports',`const {run,namespace,verifiedImageId,inspectFormat,IMAGE,privateNetwork,networkId,network,pgid,assertPrivateNetworkMembers,insist}=ports;
      let cid=ports.cid,serviceAbsent=false,borrowedNetworkRetained=false,networkAbsent=false;const failure=null;
      return (async()=>{${body};return {serviceAbsent,borrowedNetworkRetained,networkAbsent};})();`);
    const result=await invoke({run,namespace,verifiedImageId:inspect.ImageId,inspectFormat:'fixed',IMAGE,privateNetwork,
      networkId:privateNetwork.networkId,network:privateNetwork.networkName,pgid,assertPrivateNetworkMembers,
      insist:(condition,message)=>assert.ok(condition,message),cid:initialCid});
    assert.deepEqual(result,{serviceAbsent:true,borrowedNetworkRetained:true,networkAbsent:false});
    assert.ok(calls.some(args=>args[1]==='rm'&&args[3]===provider));
    assert.ok(calls.filter(args=>args[1]==='network').every(args=>args[2]==='inspect'));
  }
  const privateCreation=worker.slice(worker.indexOf('    if(!privateNetwork){'),worker.indexOf("    await run(['docker','pull',MIRROR_IMAGE]"));
  assert.match(privateCreation,/if\(!privateNetwork\).*network','create/s);
  assert.match(privateCreation,/else assertPrivateNetworkMembers/);
  assert.match(worker,/insist\(!relayClosing,'Relay inspection refused after cleanup starts.'\)/);
  assert.match(worker,/seconds:10,abortSignal:relayInspectionController.signal/);
  assert.ok(worker.indexOf('relayClosing=true;relayInspectionController.abort()')<worker.indexOf('await Promise.allSettled([...relayPending])'));
  assert.ok(worker.indexOf('await Promise.allSettled([...relayPending])')<worker.indexOf("await run(['docker','rm','-f',cid]"));
});

const privateSentinels=['PII_Ada_Fixture_731','SELECT private_note FROM private_table','fixture-password-DO-NOT-EXPORT',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.syntheticToken123','postgresql://fixture-user:fixture-password@private.invalid/db'];
const assertNoPrivate=value=>{const text=typeof value==='string'?value:JSON.stringify(value);
  for(const sentinel of privateSentinels)assert.equal(text.includes(sentinel),false);};
test('private errors and catalog receipts never export PII, SQL, tokens, configs or stack operands',()=>{
  const payload=privateSentinels.join('\n'),raw=Buffer.from(payload);
  const digest=createHash('sha256').update(raw).digest('hex');
  assert.deepEqual(privateRestoreStreamDiagnostic(raw),{classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',bytes:raw.length,sha256:digest,private_payload_exported:false});
  const error=Object.assign(new Error(payload),{code:'42501',detail:payload,query:payload,name:payload,syscall:payload,stack:payload});
  assert.deepEqual(safeStartupFailure(error,'connect_gate',true),{phase:'connect_gate',classification:'PRIVATE_RESTORE_FAILURE',sql_state:'42501',private_payload_exported:false});
  assertNoPrivate(privateRestoreFailureDiagnostic(error,payload));
  for(const code of ['JOHN1','PII_Ada_Fixture_731',undefined])assert.equal(Object.hasOwn(privateRestoreFailureDiagnostic({...error,code},'connect_gate'),'sql_state'),false);
  let reads=0;const accessor=Object.defineProperty({},'code',{get(){reads++;throw Error(payload);}});
  privateRestoreFailureDiagnostic(accessor,'connect_gate');privateRestoreFailureDiagnostic(new Proxy({},{getOwnPropertyDescriptor(){throw Error(payload);}}),'connect_gate');
  assert.equal(reads,0);
  const snapshot={sha256:'c'.repeat(64),catalog:{routines:[{definition:payload}],role_settings:[{settings:payload}],policies:[{expression:payload}]},arbitrary:payload};
  for(const name of ['STORAGE_CATALOG_BEFORE_PROVIDER.json','STORAGE_CATALOG_AFTER_PROVIDER.json']){
    const receipt=privateEvidenceReceipt(name,Buffer.from(JSON.stringify(snapshot)));assertNoPrivate(receipt);
    assert.equal(receipt.catalog_counts.routines,1);assert.equal(receipt.sha256,snapshot.sha256);assert.equal(Object.hasOwn(receipt,'catalog'),false);
  }
  const credential=privateEvidenceReceipt('STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json',Buffer.from(JSON.stringify({
    before:{rolconfig:payload,settings:payload},after:{rolconfig:payload,settings:payload},role:payload,only_ephemeral_password_initialized:true})));
  assertNoPrivate(credential);assert.equal(credential.catalog_invariance_verified,true);assert.equal(Object.hasOwn(credential,'sha256'),false);
  for(const incomplete of [{},{before:null,after:null},{before:[],after:[]},{before:{a:1},after:{a:2}}])
    assert.equal(privateEvidenceReceipt('STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json',Buffer.from(JSON.stringify(incomplete))).catalog_invariance_verified,false);
  const rows=privateEvidenceReceipt('ARCHIVED_STORAGE_MIGRATIONS_FULL_TUPLES.json',Buffer.from(JSON.stringify({rows:[{sql:payload}],count:1,sha256:'b'.repeat(64)})));
  assertNoPrivate(rows);assert.equal(Object.hasOwn(rows,'rows'),false);
  const pinned=privateEvidenceReceipt('PINNED_OFFICIAL_IMAGE_METADATA.json',Buffer.from(JSON.stringify({config_image_id:'sha256:'+'a'.repeat(64),default_root:true,repo_digests:[payload]})));
  assertNoPrivate(pinned);assert.equal(pinned.config_image_id,'sha256:'+'a'.repeat(64));assert.equal(Object.hasOwn(pinned,'repo_digests'),false);
  const relay=privateEvidenceReceipt('OWNED_LOOPBACK_RELAY_CLOSED.json',Buffer.from(JSON.stringify({listener_closed:true,owned_sockets_remaining:0,before_container_removal:true,unexpected:payload})));
  assertNoPrivate(relay);assert.equal(relay.listener_closed,true);assert.equal(relay.owned_sockets_remaining,0);
  for(const name of ['provider.env','input.json','PRIVATE_ROWS.sql','unexpected.json','../FINAL.json','provider-audit/raw.log']){
    assert.equal(privateEvidenceFile(name),false);assert.equal(privateEvidenceReceipt(name,raw),null);
  }
});

test('private subprocess persistence hashes arbitrary stdout/stderr without exporting payloads',async()=>{
  const worker=readFileSync(new URL('./run-official-local-storage-rehearsal.mjs',import.meta.url),'utf8');
  const start=worker.indexOf('function runner('),end=worker.indexOf('export function redactProviderLogs(',start);
  const root=mkdtempSync(resolve(tmpdir(),'private-output-contract-'));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const durable=(path,value)=>{const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}};
  const factory=new Function('ports',`const {insist,Date,stopping,memoryFloor,resolve,durable,hash,stable,spawn,liveGroups,ticks,CAP,pause,existsSync,Buffer,writeFileSync,privateRestoreStreamDiagnostic,redactProviderLogs}=ports;
    ${worker.slice(start,end)}return runner;`);
  try{
    const runner=factory({insist:(condition,message)=>assert.ok(condition,message),Date,stopping:false,memoryFloor:()=>{},resolve,durable,hash,stable,spawn,
      liveGroups:new Set(),ticks:pid=>readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].split(' ')[19],CAP:1048576,
      pause:ms=>new Promise(r=>setTimeout(r,ms)),existsSync,Buffer,writeFileSync,privateRestoreStreamDiagnostic,redactProviderLogs:()=>assert.fail('Private output cannot use credential-only redaction')});
    const run=runner(root,()=>Date.now()+10000,{deadline:null},{privateData:true});
    const payload=privateSentinels.join('\n');
    const source=`process.stdout.write(${JSON.stringify(payload)});process.stderr.write(${JSON.stringify(payload)});`;
    assert.equal(await run([process.execPath,'-e',source]),payload);
    await assert.rejects(run([process.execPath,'-e',source+'process.exitCode=1;']));
    const controller=new AbortController(),started=Date.now();
    const pending=run([process.execPath,'-e','setInterval(()=>{},1000);'],{seconds:60,abortSignal:controller.signal});
    const refused=assert.rejects(pending,/Owned inspector cancelled for relay cleanup/);
    await new Promise(resolve=>setTimeout(resolve,50));controller.abort();await refused;
    assert.ok(Date.now()-started<5000,'Cancellation must not consume the45s cleanup window');
    await assert.rejects(run([process.execPath,'-e',source],{abortSignal:controller.signal}),/cancelled before child birth/);
    const wait=JSON.parse(readFileSync(resolve(root,'003.ACTUAL_WAIT.json'),'utf8'));
    assert.equal(wait.signal,'SIGKILL');assert.equal(existsSync('/proc/'+wait.pid),false);
    for(const file of readdirSync(root))assertNoPrivate(readFileSync(resolve(root,file),'utf8'));
    assert.ok(readdirSync(root).filter(name=>/\.(stdout|stderr)$/.test(name)).length===6);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('private terminal and connection failures are metadata-only and retain nonzero refusal',()=>{
  const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  assert.match(source,/if\(freshPrivateDatabase\)console.error\(JSON.stringify\(\{ok:false,restore_phase:restorePhase,restore_table:null,/);
  const begin=source.lastIndexOf('if(archiveContainsPrivateData && (archiveLifecycleFailed || archiveCleanupFailed))'),end=source.indexOf('}else{',begin);
  assert.ok(begin>0&&end>begin);const branch=source.slice(begin,end+1);
  const invoke=new Function('ports',`const {archiveContainsPrivateData,archiveLifecycleFailed,archiveCleanupFailed,archiveLifecycleFailure,archiveCleanupFailure,archiveFreshFailureOutput,console,process,privateRestoreFailureDiagnostic}=ports;${branch}`);
  const output=[],process={exitCode:0};const error=Object.assign(new Error(privateSentinels.join('\n')),{code:'42501'});
  invoke({archiveContainsPrivateData:true,archiveLifecycleFailed:true,archiveCleanupFailed:true,archiveLifecycleFailure:error,archiveCleanupFailure:error,
    archiveFreshFailureOutput:{ok:false,metadata_only:true},console:{error:value=>output.push(value)},process,privateRestoreFailureDiagnostic});
  assert.equal(process.exitCode,1);output.forEach(assertNoPrivate);
});


test('private parent cancels only owned pending inspectors before target cleanup',async()=>{
  const source=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const run=(command,args,'),end=source.indexOf('  const docker=',start);
  assert.ok(start>0&&end>start);const children=new Set();
  const factory=new Function('ports',`const {stopping,root,baseEnv,spawn,children,phase}=ports;${source.slice(start,end)}return run;`);
  const run=factory({stopping:false,root:tmpdir(),baseEnv:{},spawn,children,phase:'OFFLINE_INSPECTOR_CANCEL'});
  const controller=new AbortController(),started=Date.now();
  const pending=run(process.execPath,['-e','setInterval(()=>{},1000);'],{timeout:60000,abortSignal:controller.signal});
  const rejected=assert.rejects(pending,/Owned subprocess refused/);
  await new Promise(resolve=>setTimeout(resolve,50));const [pid]=children;assert.ok(pid>0);controller.abort();await rejected;
  assert.equal(children.size,0);assert.equal(existsSync('/proc/'+pid),false);assert.ok(Date.now()-started<5000);
  await assert.rejects(run(process.execPath,['-e','throw new Error("must not run")'],{abortSignal:controller.signal}),/Cancelled/);
  assert.ok(source.indexOf('closing=true;inspectionController.abort()')<source.indexOf('await Promise.allSettled([...pendingConnections])'));
  assert.match(source,/timeout:10000,abortSignal:inspectionController.signal/);
  assert.equal((source.match(/assert.equal\(closing,false,'Target inspection refused during cleanup'\)/g)||[]).length,2);
});


test('creation diagnostics distinguish startup assertions using only bounded booleans and closed labels',()=>{
  const good=pg();good.State={Running:true,Status:'running',OOMKilled:false,ExitCode:0,Error:''};
  const current=targetCreationMetadata('POSTGRES',good,identity);
  assert.equal(current.running,true);assert.equal(current.postgres_port_key_present,true);assert.equal(current.all_ports_unpublished,true);
  assert.equal(current.network_count,1);assert.equal(current.container_id_matches,true);
  const missing=pg();missing.NetworkSettings.Ports={};const absent=targetCreationMetadata('POSTGRES',missing,identity);
  assert.equal(absent.ports_object_present,true);assert.equal(absent.postgres_port_key_present,false);assert.equal(absent.port_key_count,0);
  assert.throws(()=>assertOwnedPg(missing,identity),'Diagnostics must not relax the failed assertion');
  const stopped=pg();stopped.State={Running:false,Status:'exited',OOMKilled:true,ExitCode:137,Error:privateSentinels.join('\n')};
  const failed=targetCreationMetadata('POSTGRES',stopped,identity);assert.equal(failed.running,false);assert.equal(failed.oom_killed,true);assert.equal(failed.exit_code,137);assert.equal(failed.state_error_present,true);assertNoPrivate(failed);
  const bad=pg();bad.Config.Env=privateSentinels;bad.Config.Labels['custodial.private-owner-profile']=privateSentinels[0];
  bad.NetworkSettings.Ports['5432/tcp']=[{HostIp:privateSentinels[0],HostPort:'5432'}];bad.NetworkSettings.Networks[privateSentinels[0]]={};
  const denied=targetCreationMetadata('POSTGRES',bad,identity);assert.equal(denied.owner_profile_matches,false);assert.equal(denied.all_ports_unpublished,false);assert.equal(denied.sole_expected_network,false);assertNoPrivate(denied);
  const net=targetCreationMetadata('NETWORK',{Id:identity.networkId,Internal:true,Labels:{'custodial.private-backup-rehearsal':identity.owner},Containers:{[identity.id]:{private:privateSentinels}}},identity);
  assert.equal(net.internal,true);assert.equal(net.sole_expected_postgres,true);assertNoPrivate(net);
  let reads=0;const getter=Object.defineProperty({},'Config',{get(){reads++;throw Error(privateSentinels[0]);}});
  assertNoPrivate(targetCreationMetadata('POSTGRES',getter,identity));assert.equal(reads,0);
  assertNoPrivate(targetCreationMetadata('POSTGRES',new Proxy({},{ownKeys(){throw Error(privateSentinels[0]);}}),identity));
  assert.equal(targetCreationOperation('START_OWNED_POSTGRES'),'START_OWNED_POSTGRES');assert.equal(targetCreationOperation(privateSentinels[0]),null);
  assert.equal(targetCreationMetadata(privateSentinels[0],good,identity),null);
  const nested=pg();nested.NetworkSettings.Ports['5432/tcp']=new Proxy([],{get(){reads++;throw Error(privateSentinels[0]);}});
  nested.NetworkSettings.Networks[identity.networkName].IPAddress={toString(){reads++;throw Error(privateSentinels[0]);}};
  const bounded=targetCreationMetadata('POSTGRES',nested,identity);assert.equal(bounded.all_ports_unpublished,false);assert.equal(bounded.network_ipv4_present,false);assert.equal(reads,0);
});

test('creation subprocess diagnostic survives refusal and cleanup without leaking raw output',async()=>{
  const source=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const run=(command,args,'),end=source.indexOf('  const docker=',start);
  const factory=new Function('ports',`const {root,spawn,targetCreationOperation}=ports;const stopping=false,baseEnv={},children=new Set(),phase='create_owned_target';
    let creationOperation='START_OWNED_POSTGRES',creationProcess=null;${source.slice(start,end)}return {run,receipt:()=>creationProcess};`);
  const {run,receipt}=factory({root:tmpdir(),spawn,targetCreationOperation});
  const payload=privateSentinels.join('\n'),program=`process.stdout.write(${JSON.stringify(payload)});process.stderr.write(${JSON.stringify(payload)});process.exitCode=17;`;
  await assert.rejects(run(process.execPath,['-e',program]),/Owned subprocess refused/);
  const captured=receipt();assert.equal(captured.operation,'START_OWNED_POSTGRES');assert.equal(captured.exit_code,17);
  assert.equal(captured.stdout_bytes,Buffer.byteLength(payload));assert.equal(captured.stderr_bytes,Buffer.byteLength(payload));assert.equal(captured.spawn_error,false);assert.equal(captured.timed_out,false);assertNoPrivate(captured);
  await run(process.execPath,['-e',''],{cleanup:true});assert.deepEqual(receipt(),captured,'Cleanup cannot overwrite the original creation observation');
  await assert.rejects(run(process.execPath,['-e','setInterval(()=>{},1000);'],{timeout:80}));assert.equal(receipt().timed_out,true);assertNoPrivate(receipt());
});


test('exact pinned pull diagnostic uses only closed transport labels and never authorizes retries',()=>{
  for(const [text,expected] of [
    ['toomanyrequests: You have reached your unauthenticated pull rate limit','REGISTRY_RATE_LIMIT'],
    ['unauthorized: authentication required','REGISTRY_ACCESS_DENIED'],
    ['net/http: TLS handshake timeout','TRANSPORT_TIMEOUT'],['dial tcp: lookup registry.invalid: no such host','DNS_FAILURE'],
    ['x509: certificate signed by unknown authority','TLS_CERTIFICATE_ERROR'],
    ['Cannot connect to the Docker daemon','DOCKER_DAEMON_UNAVAILABLE'],['manifest unknown','PINNED_IMAGE_MANIFEST_UNAVAILABLE'],
    [privateSentinels.join('\n'),'UNKNOWN'],['x'.repeat(65537)+'toomanyrequests:','UNKNOWN'],[{},'UNKNOWN'],
  ]){const result=classifyPinnedPostgresPullFailure(text);assert.equal(result,expected);assertNoPrivate(result);}
  const source=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  assert.match(source,/operationAtStart==='PULL_PINNED_POSTGRES_IMAGE'&&command==='docker'&&args.length===2&&args\[0\]==='pull'&&args\[1\]===PG_IMAGE/);
  assert.match(source,/pinnedPull&&\(code!==0\|\|failed\)\?\{docker_pull_failure:pullErrorTruncated\?'UNKNOWN'/);
});
