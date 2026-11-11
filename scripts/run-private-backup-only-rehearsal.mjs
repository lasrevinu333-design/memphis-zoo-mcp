// Closed disposable qualification for signed archives containing the two immutable
// originals. No alternate importer, production target, migration or resume path.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,createConnection,isIP} from 'node:net';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materializeVerifiedArchive,readVerifiedPrivateImportSource,readVerifiedArchiveSourceBinding,readVerifiedImmutableBootstrapInventory} from './disaster-recovery-archive.mjs';
import {requireSigningKey,signBinding,restoreIntentBinding} from './disaster-recovery-crypto.mjs';
import {captureVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {loadImmutableDomainSourceRecipes} from './immutable-private-domain-source.mjs';
import {loadImmutableMessageSourceRecipes} from './immutable-private-message-source.mjs';
import {prepareVerifiedImmutableBootstrapSource,readVerifiedImmutableBootstrapOwnerProfile} from './immutable-private-source-bootstrap.mjs';
import {closeOwnedRelay,storageResult,assertPrivatePgOwnerProfile,assertPrivatePgNetwork} from './run-official-local-storage-rehearsal.mjs';

export const PG_IMAGE='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const privateNames=['employee_message_original_outcomes','group_original_creations'];
const required=['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json'];
const label='custodial.private-backup-rehearsal';
const sourcePhases=new Set(['ARCHIVE_ADMISSION','ORIGINAL_INVENTORY','PROGRAM_SOURCE','ORIGINAL_ROWS',
  'ORIGINAL_RELEASE','SOURCE_RECIPES','ORIGINAL_REGISTRY','SOURCE_STATEMENTS','FINAL_CURRENTNESS',
  'SOURCE_HANDLE','ARCHIVE_CURRENTNESS','PROGRAM_CURRENTNESS','INVENTORY_CURRENTNESS']);
export function safeSourcePreparationFailure(error){
  if(!error||typeof error!=='object')return null;
  const code=Object.getOwnPropertyDescriptor(error,'code'),phase=Object.getOwnPropertyDescriptor(error,'source_phase');
  if(code?.value!=='IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE'||!sourcePhases.has(phase?.value))return null;
  return {code:code.value,source_phase:phase.value};
}

export function originalRowsMetadataDiagnostics({source,inventory}){
  const catalog=JSON.parse(inventory['inventory/table-catalog.json']);
  const ledger=JSON.parse(inventory['inventory/migration-ledger.json']);
  const count=name=>{
    const tables=source.selection.databaseTables.filter(t=>t.schema_name==='public'&&t.table_name===name);
    if(tables.length!==1||! /^(0|[1-9][0-9]*)$/.test(tables[0].row_count))return null;
    return tables[0].row_count;
  };
  return {release_manifest_rows:count('release_deployment_manifest'),restore_registry_rows:count('custodial_release_authority_restore_inventory'),
    catalog_matches_original_selection:isDeepStrictEqual(catalog,source.selection.databaseTables),
    ledger_count_matches:Array.isArray(ledger)&&ledger.length===source.sourceBinding.source_identity.migration_ledger_count,
    ledger_head_matches:Array.isArray(ledger)&&ledger.at(-1)?.version===source.sourceBinding.source_identity.migration_head};
}
// Diagnostic metadata only, never an owner-admission profile or role override.
// Original SQL, grant lists and row payloads are deliberately not emitted.
export function originalOwnerMetadataDiagnostics(inventory){
  const guards=JSON.parse(inventory['inventory/original-guards.json']);
  const relations=JSON.parse(inventory['inventory/original-relations.json']);
  const acls=JSON.parse(inventory['inventory/original-acls.json']);
  assert.ok(Array.isArray(guards)&&guards.length===2&&Array.isArray(relations)&&Array.isArray(acls.namespaces_columns));
  const owner=value=>value==='postgres'?'postgres':value==='supabase_admin'?'supabase_admin':'OTHER_OR_MISSING';
  const hash=value=>typeof value==='string'?createHash('sha256').update(value).digest('hex'):null;
  const ids=['custodial_release_identity.guard_group_original_creation()','custodial_dr.guard_application_mutation()'];
  const domain=loadImmutableDomainSourceRecipes(),messages=loadImmutableMessageSourceRecipes();
  const recipeIds=[...ids,...domain.recipes.map(r=>r.identity),...messages.recipes.map(r=>r.identity)];
  assert.equal(recipeIds.length,25);assert.equal(new Set(recipeIds).size,25);
  domain.assertCurrent();messages.assertCurrent();
  const routines=Array.isArray(acls.routines)?acls.routines:[];
  const recipeFunctions=recipeIds.map(identity=>{
    const rows=routines.filter(r=>r.kind==='FUNCTION'&&r.identity===identity);
    return {identity,acl_match_count:rows.length,
      owner:rows.length===1?owner(rows[0].owner_name):'OTHER_OR_MISSING',
      owner_evidence:rows.length===1?'EXACT_ACL_MATCH':rows.length===0?'MISSING':'AMBIGUOUS',
      security_definer:'NOT_REPRESENTED_IN_ACL_INVENTORY'};
  });
  const fixedTables=[['custodial_release_identity','group_original_creations'],['custodial_release_identity','employee_message_original_outcomes'],
    ['public','release_deployment_manifest'],['public','custodial_release_authority_restore_inventory']];
  const namespace=acls.namespaces_columns.filter(r=>r.kind==='SCHEMA'&&r.schema_name==='custodial_release_identity');
  return {guards:ids.map((identity,i)=>({identity,owner:owner(guards[i]?.owner),
      body_sha256:hash(guards[i]?.prosrc),definition_sha256:hash(guards[i]?.definition)})),
    recipe_functions:recipeFunctions,recipe_function_count:recipeFunctions.length,
    release_identity_namespace_owner:namespace.length===1?owner(namespace[0].owner_name):'OTHER_OR_MISSING',
    original_relations:fixedTables.map(([schema_name,table_name])=>{
      const rows=relations.filter(r=>r.schema_name===schema_name&&r.table_name===table_name);
      return {schema_name,table_name,owner:rows.length===1?owner(rows[0].owner_name):'OTHER_OR_MISSING'};
    }),control_table_owners:'NOT_IN_ORIGINAL_RELATIONS_INVENTORY',
    restore_control:{identity:'custodial_dr.restore_control',role:'TARGET_CREATED_RESTORE_CONTROL',
      source_inventory_match_count:relations.filter(r=>r.schema_name==='custodial_dr'&&r.table_name==='restore_control').length,
      owner:'NOT_ESTABLISHED_BY_SOURCE_INVENTORY'},admission_changed:false};
}
export function selectPrivateProfile(source){
  const names=source.selection.privateTables.map(t=>t.table_name).sort();
  if(!names.length)return 'native';
  assert.deepEqual(names,privateNames,'Unsupported immutable original table set');
  return 'private';
}
// Signed DATA construction only. Caller must authenticate the archive and invoke
// captureVerifiedImmutableFreshRestoreIntent before any target is created.
export function freshIntentEnvelope(binding,key,keyId,now=new Date()){
  requireSigningKey(key,'Independent rehearsal intent key');
  assert.match(keyId,/^[a-zA-Z0-9._:-]{1,120}$/);
  const release=Object.fromEntries(['release_id','backend_commit','frontend_commit','migration_head','migration_manifest_sha256']
    .map(k=>[k,binding.source_identity.release[k]]));
  const intent={restore_id:randomUUID(),authority_generation:1,retry_of_restore_id:null,
    archive_digest:binding.archive_digest,source_project_ref:binding.project_ref,target_project_ref:binding.project_ref,
    source_identity_sha256:binding.source_identity_sha256,target_migration_head:binding.source_identity.migration_head,
    target_release_identity:release,actor:'GitHub private backup-only disposable rehearsal',
    approved_at:now.toISOString(),expires_at:new Date(now.getTime()+60*60*1000).toISOString(),resume_after_verification:false};
  return {format:'memphis-zoo-production-restore-intent.v1',algorithm:'hmac-sha256',key_id:keyId,
    intent,signature:signBinding(restoreIntentBinding(intent),key)};
}
export function assertOwnedPg(value,{id,name,owner,networkId,networkName,ownerProfile}){
  assert.equal(value.Id,id);assert.equal(value.Name,'/'+name);assert.equal(value.Config.Image,PG_IMAGE);
  assert.equal(value.Config.Labels[label],owner);assert.equal(value.State.Running,true);
  assertPrivatePgOwnerProfile(value,ownerProfile);
  assert.ok(Object.values(value.NetworkSettings.Ports||{}).every(p=>p===null||Array.isArray(p)&&p.length===0),
    'Private PostgreSQL must have no published ports');
  // The private provider borrows this sole network. Extra attachments are
  // never admitted, including after provider start or during cleanup.
  assert.deepEqual(Object.keys(value.NetworkSettings.Networks),[networkName]);
  const endpoint=value.NetworkSettings.Networks[networkName];
  assert.equal(endpoint?.NetworkID,networkId);assert.equal(isIP(endpoint?.IPAddress),4);
  return endpoint.IPAddress;
}
export function assertPrivateResult(result,source,intent){
  storageResult(result,source.sourceBinding,intent);
  assert.equal(result.complete_restore,false);assert.equal(result.resume_allowed,false);
  assert.equal(result.retry_allowed,false);assert.equal(result.rerun_import_allowed,false);
  assert.equal(result.archive_digest,source.sourceBinding.archive_digest);
  assert.equal(result.original_data_readback?.private_data?.state,'MATCH');
  assert.ok(['MATCH','CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK','SOURCE_TRANSFORMATION_VERIFIED'].includes(result.original_data_readback?.ordinary_data?.state));
  assert.equal(result.original_data_readback?.storage_data?.status,'MATCH');
  const privateReadback=result.original_data_readback.private_data.tables;
  assert.deepEqual(privateReadback.map(t=>t.table_name).sort(),privateNames);
  assert.ok(privateReadback.every(t=>t.state==='MATCH'));
  // The owning factory checks every original DATA member before it can return.
  // Never replace its authority/readback checks with table totals here.
  assert.equal(result.authority_observation?.outcome,'AUTHORITY_COMPLETION_OBSERVED');
  const after=result.authority_data_readback;
  assert.equal(after?.schema,'custodial.immutable-private-post-authority-data-readback.v1');
  assert.ok(['MATCH','SOURCE_TRANSFORMATION_VERIFIED'].includes(after.state));
  assert.equal(after.private_data?.state,'MATCH');
  assert.ok(['MATCH','SOURCE_TRANSFORMATION_VERIFIED'].includes(after.ordinary_data?.state));
  assert.equal(after.storage_data?.status,'MATCH');
  assert.equal(after.comparison_only,true);assert.equal(after.metadata_only,true);
  for(const key of ['complete_restore','resume_allowed','retry_allowed','rerun_import_allowed','inventory_acknowledged','effects'])assert.equal(after[key],false);

  return true;
}
function authenticate(){
  return materializeVerifiedArchive({sourceDir:process.env.RESTORE_SOURCE_DIR,
    archiveVerifyKey:requireSigningKey(process.env.RESTORE_ARCHIVE_VERIFY_KEY,'RESTORE_ARCHIVE_VERIFY_KEY'),
    archiveVerifyKeyId:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:required});
}

export async function runPrivate(){
  assert.equal(process.env.REHEARSAL_SCOPE,'backup_only');assert.equal(process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER,'true');
  assert.match(process.env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
  assert.match(process.env.BACKUP_RUN_ID||'',/^[1-9][0-9]*$/);
  const tmp=realpathSync(process.env.RUNNER_TEMP),owned=mkdtempSync(resolve(tmp,'private-backup-rehearsal-'));
  const owner=randomBytes(16).toString('hex'),name='mz_schema_rebuild_'+process.env.GITHUB_RUN_ID;
  const networkName=name+'_private_'+owner, database=name;
  let archive,cid,networkId,relay,relayClosed=true,pgAbsent=false,networkAbsent=false;
  const sockets=new Set(),children=new Set(),pendingConnections=new Set(),inspectionController=new AbortController();let stopping=false,closing=false,failure,phase='authenticate',result,source,sourceMetadata,ownerMetadata,ownerProfile;
  let cancelTimer;
  const stop=()=>{stopping=true;for(const pid of children)try{process.kill(-pid,'SIGTERM');}catch{}
    cancelTimer??=setTimeout(()=>{for(const pid of children)try{process.kill(-pid,'SIGKILL');}catch{}},60000);};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const baseEnv=Object.fromEntries(['PATH','HOME','RUNNER_TEMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const run=(command,args,{input,env=baseEnv,timeout=60000,cleanup=false,abortSignal=null}={})=>new Promise((yes,no)=>{
    if(stopping&&!cleanup || abortSignal?.aborted)return no(new Error('Cancelled'));
    const child=spawn(command,args,{cwd:root,env,detached:true,stdio:['pipe','pipe','pipe']});
    let stdout='',bytes=0,failed=false,hardTimer;children.add(child.pid);
    const kill=()=>{failed=true;try{process.kill(-child.pid,'SIGTERM');}catch{}
      hardTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},60000);};
    const cancelInspector=()=>{failed=true;if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}};
    if(abortSignal){abortSignal.addEventListener('abort',cancelInspector,{once:true});if(abortSignal.aborted)cancelInspector();}
    const timer=setTimeout(kill,timeout);
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>16*1024*1024)kill();else stdout+=b;});
    // Private SQL/rows/errors never enter CI logs or receipt artifacts.
    child.stderr.on('data',b=>{bytes+=b.length;if(bytes>16*1024*1024)kill();});
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.once('error',()=>{failed=true;});
    child.once('close',code=>{clearTimeout(timer);clearTimeout(hardTimer);abortSignal?.removeEventListener('abort',cancelInspector);children.delete(child.pid);
      if(code!==0||failed)no(new Error('Owned subprocess refused during '+phase));else yes(stdout.trim());});
  });
  const docker=(args,options)=>run('docker',args,options);
  const inspect=async(cleanup=false,options={})=>JSON.parse(await docker(['inspect',cid],{cleanup,...options}))[0];
  const receiptPath=resolve(tmp,'private-backup-only-rehearsal.json');
  try{
    archive=authenticate();source=readVerifiedPrivateImportSource(archive);assert.equal(selectPrivateProfile(source),'private');
    sourceMetadata=originalRowsMetadataDiagnostics({source,inventory:readVerifiedImmutableBootstrapInventory(archive).inventory});
    ownerMetadata=originalOwnerMetadataDiagnostics(readVerifiedImmutableBootstrapInventory(archive).inventory);
    // Fail on absent source/ACL/guard recipes before resources are created.
    const bootstrapSource=await prepareVerifiedImmutableBootstrapSource(archive);
    ownerProfile=readVerifiedImmutableBootstrapOwnerProfile(bootstrapSource,archive);
    const requireOwnerProfile=()=>{const current=readVerifiedImmutableBootstrapOwnerProfile(bootstrapSource,archive);
      assert.deepEqual(current,ownerProfile);return current;};
    const key=randomBytes(32).toString('hex'),keyId='private-rehearsal-'+process.env.GITHUB_RUN_ID;
    const envelope=freshIntentEnvelope(source.sourceBinding,key,keyId);
    captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:archive,originalIntentEnvelope:envelope,intentVerifyKey:key,intentVerifyKeyId:keyId});
    const secretEnv={...baseEnv,REHEARSAL_SCOPE:'backup_only',OFFICIAL_LOCAL_STORAGE_PROVIDER:'true',
      GITHUB_RUN_ID:process.env.GITHUB_RUN_ID,RESTORE_SOURCE_DIR:archive.directory,
      RESTORE_ARCHIVE_VERIFY_KEY:process.env.RESTORE_ARCHIVE_VERIFY_KEY,RESTORE_ARCHIVE_VERIFY_KEY_ID:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,
      RESTORE_INTENT_VERIFY_KEY:key,RESTORE_INTENT_VERIFY_KEY_ID:keyId,RESTORE_INTENT_JSON:JSON.stringify(envelope),
      RESTORE_APPLY:'true',RESTORE_DATABASE_ONLY:'true',SUPABASE_PROJECT_REF:source.sourceBinding.project_ref,
      RESTORE_CONFIRM_PROJECT_REF:source.sourceBinding.project_ref};
    requireOwnerProfile();phase='create_owned_target';
    assert.equal(await docker(['ps','-aq','--filter','name=^/'+name+'$']),'','Never reuse an existing target');
    await docker(['pull',PG_IMAGE],{timeout:180000});
    networkId=await docker(['network','create','--internal','--label',label+'='+owner,networkName]);
    assert.match(networkId,/^[0-9a-f]{64}$/);
    cid=await docker(['run','-d','--name',name,'--label',label+'='+owner,'--label','custodial.private-owner-profile='+ownerProfile.id,
      '--label','custodial.private-owner-actor='+ownerProfile.actor,'--network',networkName,
      '--memory','1g','--memory-swap','1g','--cpus','1','--pids-limit','256','--tmpfs','/var/lib/postgresql/data:rw,size=1g',
      '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',PG_IMAGE,'postgres','-D','/etc/postgresql',
      '-c',"listen_addresses=*",'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
      '-c','cron.database_name='+database,'-c','cron.launch_active_jobs=off']);
    assert.match(cid,/^[0-9a-f]{64}$/);
    const identity={id:cid,name,owner,networkId,networkName,ownerProfile};
    const initial=await inspect(),address=assertOwnedPg(initial,identity);
    assert.deepEqual(Object.keys(initial.NetworkSettings.Networks),[networkName]);
    const net=JSON.parse(await docker(['network','inspect',networkId]))[0];
    assert.equal(net.Id,networkId);assert.equal(net.Internal,true);assert.equal(net.Labels[label],owner);
    assert.deepEqual(Object.keys(net.Containers),[cid]);
    phase='wait_owned_postgres';let ready=false;
    for(let i=0;i<120&&!stopping;i++){
      try{ready=(await docker(['exec',cid,'psql','-X','-At','-U','supabase_admin','-d','postgres','-c','select 1']))==='1';}catch{}
      if(ready)break;await new Promise(r=>setTimeout(r,1000));
    }
    assert.equal(ready,true);
    phase='wait_owned_health';let healthy=false;
    for(let i=0;i<120&&!stopping;i++){
      const state=(await inspect()).State;
      healthy=state.Running===true&&(!state.Health||state.Health.Status==='healthy');
      if(healthy)break;await new Promise(r=>setTimeout(r,1000));
    }
    assert.equal(healthy,true);await new Promise(r=>setTimeout(r,10000));
    phase='prepare_schema_only';
    await docker(['exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
      {input:readFileSync(resolve(root,'supabase/canonical/production-source-role-catalog.sql'),'utf8')});
    await docker(['exec',cid,'createdb','-U','supabase_admin','-O','postgres','-T','template0',database]);
    const networkIdentity={networkId,networkName,owner,pgid:cid,pgName:name,address};
    const verifyTarget=async()=>{assert.equal(closing,false,'Target inspection refused during cleanup');requireOwnerProfile();
      const options={timeout:10000,abortSignal:inspectionController.signal};
      assert.equal(assertOwnedPg(await inspect(false,options),identity),address);
      assert.equal(closing,false,'Target inspection refused during cleanup');
      assertPrivatePgNetwork(JSON.parse(await docker(['network','inspect',networkId],options))[0],networkIdentity);};
    await verifyTarget();relayClosed=false;
    relay=createServer(client=>{
      if(stopping||closing||sockets.size>=64){client.destroy();return;}
      sockets.add(client);client.on('error',()=>client.destroy());client.on('close',()=>sockets.delete(client));
      // Authenticate the actual owned target again before each new connection.
      client.pause();const pending=verifyTarget().then(()=>{
        if(stopping||closing||client.destroyed){client.destroy();return;}
        const upstream=createConnection({host:address,port:5432});
        for(const socket of [client,upstream]){sockets.add(socket);socket.setTimeout(30000);
          socket.on('timeout',()=>socket.destroy());socket.on('error',()=>{client.destroy();upstream.destroy();});
          socket.on('close',()=>{sockets.delete(socket);if(socket===client)upstream.destroy();else client.destroy();});}
        client.pipe(upstream);upstream.pipe(client);client.resume();
      }).catch(()=>client.destroy()).finally(()=>pendingConnections.delete(pending));
      pendingConnections.add(pending);
    });
    await new Promise((yes,no)=>{relay.once('error',no);relay.listen({host:'127.0.0.1',port:0,exclusive:true},yes);});
    relay.on('error',stop);
    const listener=relay.address();assert.equal(listener.address,'127.0.0.1');
    // Fixed administrator is used only by the existing schema/ACL replay adapter.
    const schemaDatabaseUrl='postgresql://supabase_admin:postgres@127.0.0.1:'+listener.port+'/'+database;
    secretEnv.SUPABASE_DB_URL='postgresql://'+requireOwnerProfile().actor+':postgres@127.0.0.1:'+listener.port+'/'+database;
    // Existing adapter replays authenticated schema unchanged. No hydration,
    // legacy restore-intent producer, forward migrations or reconciliation.
    await run(process.execPath,['scripts/restore-isolated-event-owner-schema.mjs'],{env:{...secretEnv,SUPABASE_DB_URL:schemaDatabaseUrl},timeout:300000});
    phase='private_original_restore_and_storage';await verifyTarget();
    result=JSON.parse(await run(process.execPath,['scripts/run-official-local-storage-rehearsal.mjs'],{env:secretEnv,timeout:1900000}));
    assertPrivateResult(result,source,envelope.intent);await verifyTarget();
    phase='verified_waiting_cleanup';
  }catch(e){failure=e;}
  finally{
    phase=failure?phase:'cleanup';closing=true;inspectionController.abort();
    try{if(relay){await closeOwnedRelay(relay,sockets,Date.now()+15000);relayClosed=true;}
      await Promise.allSettled([...pendingConnections]);}catch(e){failure??=e;}
    try{
      // Reconcile uncertain births using exact name + unpredictable ownership label.
      if(!cid){const ids=(await docker(['ps','-aq','--no-trunc','--filter','name=^/'+name+'$','--filter','label='+label+'='+owner],{cleanup:true})).split('\n').filter(Boolean);assert.ok(ids.length<=1);cid=ids[0];}
      if(cid){const value=await inspect(true);assert.equal(value.Id,cid);assert.equal(value.Name,'/'+name);assert.equal(value.Config.Labels[label],owner);assert.equal(value.Config.Image,PG_IMAGE);
        await docker(['rm','-f',cid],{cleanup:true});assert.equal(await docker(['ps','-aq','--filter','id='+cid],{cleanup:true}),'');}
      pgAbsent=true;
      const networks=(await docker(['network','ls','--no-trunc','-q','--filter','label='+label+'='+owner],{cleanup:true})).split('\n').filter(Boolean);assert.ok(networks.length<=1);
      if(networks.length){const n=JSON.parse(await docker(['network','inspect',networks[0]],{cleanup:true}))[0];
        assert.equal(n.Name,networkName);assert.equal(n.Labels[label],owner);assert.deepEqual(Object.keys(n.Containers),[]);
        await docker(['network','rm',n.Id],{cleanup:true});}
      assert.equal(await docker(['network','ls','-q','--filter','name=^'+networkName+'$'],{cleanup:true}),'');networkAbsent=true;
    }catch(e){failure??=e;}
    try{archive?.cleanup();rmSync(owned,{recursive:true,force:true});}catch(e){failure??=e;}
    clearTimeout(cancelTimer);process.off('SIGTERM',stop);process.off('SIGINT',stop);
    const receipt={schema:'custodial.private-backup-only-rehearsal.v1',ok:!failure&&!stopping,
      scope:'backup_only',backup_run_id:process.env.BACKUP_RUN_ID,qualification_run_id:process.env.GITHUB_RUN_ID,
      archive_digest:source?.sourceBinding.archive_digest??null,
      disposable_database_restore_outcome:result?'RESULT_RETURNED':'NOT_ESTABLISHED',production_restore_performed:false,
      production_provider_verified:false,forward_migrations_applied:false,runtime_admission:false,
      mutations_resumed:false,cleanup_checked:relayClosed&&pgAbsent&&networkAbsent,
      database_tables:!failure?result?.database_tables:null,database_rows:!failure?result?.database_rows:null,
      provider_verified:!failure&&result?.storage?.provider_verified===true,
      phase,blocker:failure?'PRIVATE_REHEARSAL_REFUSED':stopping?'CANCELLED':null,
      source_preparation:safeSourcePreparationFailure(failure),original_rows_metadata:sourceMetadata??null,original_owner_metadata:ownerMetadata??null,authenticated_owner_profile:ownerProfile??null};
    writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
    if(!failure&&!stopping)process.stdout.write(JSON.stringify(receipt)+'\n');
  }
  if(failure||stopping)throw new Error('Private backup-only rehearsal refused at '+phase+'; no production action performed.');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];
  try{
    assert.equal(process.argv.length,3);
    if(mode==='--preflight'){
      let archive,sourceMetadata,ownerMetadata;
      try{archive=authenticate();const source=readVerifiedPrivateImportSource(archive);assert.equal(selectPrivateProfile(source),'private');
        sourceMetadata=originalRowsMetadataDiagnostics({source,inventory:readVerifiedImmutableBootstrapInventory(archive).inventory});
        ownerMetadata=originalOwnerMetadataDiagnostics(readVerifiedImmutableBootstrapInventory(archive).inventory);
        await prepareVerifiedImmutableBootstrapSource(archive);
        console.log(JSON.stringify({ok:true,scope:'PRIVATE_SOURCE_PREPARATION_ONLY',target_created:false,restore_performed:false,original_rows_metadata:sourceMetadata,original_owner_metadata:ownerMetadata}));
      }catch(error){console.log(JSON.stringify({ok:false,scope:'PRIVATE_SOURCE_PREPARATION_ONLY',target_created:false,restore_performed:false,
        source_preparation:safeSourcePreparationFailure(error),original_rows_metadata:sourceMetadata??null,original_owner_metadata:ownerMetadata??null}));process.exitCode=1;
      }finally{archive?.cleanup();}
    }else if(mode==='--profile'||mode==='--dispatch'){
      assert.equal(process.env.REHEARSAL_SCOPE,'backup_only');
      const archive=authenticate();let profile;
      try{profile=selectPrivateProfile(readVerifiedPrivateImportSource(archive));}finally{archive.cleanup();}
      if(mode==='--profile')console.log(profile);
      else if(profile==='native')process.exitCode=3; // The only legacy-path continuation status.
      else await runPrivate();
    }else{assert.equal(mode,'--run');await runPrivate();}
  }catch{process.stderr.write('Private backup-only qualification refused. See bounded stage receipt; no private payload logged.\n');process.exitCode=1;}
}
