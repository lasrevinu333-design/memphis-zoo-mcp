// Closed disposable qualification for signed archives containing the two immutable
// originals. No alternate importer, production target, migration or resume path.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,createConnection,isIP} from 'node:net';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materializeVerifiedArchive,readVerifiedPrivateImportSource,readVerifiedArchiveSourceBinding} from './disaster-recovery-archive.mjs';
import {requireSigningKey,signBinding,restoreIntentBinding} from './disaster-recovery-crypto.mjs';
import {captureVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {prepareVerifiedImmutableBootstrapSource} from './immutable-private-source-bootstrap.mjs';
import {closeOwnedRelay,storageResult} from './run-official-local-storage-rehearsal.mjs';

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
export function assertOwnedPg(value,{id,name,owner,networkId,networkName}){
  assert.equal(value.Id,id);assert.equal(value.Name,'/'+name);assert.equal(value.Config.Image,PG_IMAGE);
  assert.equal(value.Config.Labels[label],owner);assert.equal(value.State.Running,true);
  assert.ok(Object.values(value.NetworkSettings.Ports||{}).every(p=>p===null||Array.isArray(p)&&p.length===0),
    'Private PostgreSQL must have no published ports');
  // Provider may later attach its separately verified internal network. Before
  // our forward is born, exactly this owned network is permitted.
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
  const sockets=new Set(),children=new Set(),pendingConnections=new Set();let stopping=false,closing=false,failure,phase='authenticate',result,source;
  let cancelTimer;
  const stop=()=>{stopping=true;for(const pid of children)try{process.kill(-pid,'SIGTERM');}catch{}
    cancelTimer??=setTimeout(()=>{for(const pid of children)try{process.kill(-pid,'SIGKILL');}catch{}},60000);};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const baseEnv=Object.fromEntries(['PATH','HOME','RUNNER_TEMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const run=(command,args,{input,env=baseEnv,timeout=60000,cleanup=false}={})=>new Promise((yes,no)=>{
    if(stopping&&!cleanup)return no(new Error('Cancelled'));
    const child=spawn(command,args,{cwd:root,env,detached:true,stdio:['pipe','pipe','pipe']});
    let stdout='',bytes=0,failed=false,hardTimer;children.add(child.pid);
    const kill=()=>{failed=true;try{process.kill(-child.pid,'SIGTERM');}catch{}
      hardTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},60000);};
    const timer=setTimeout(kill,timeout);
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>16*1024*1024)kill();else stdout+=b;});
    // Private SQL/rows/errors never enter CI logs or receipt artifacts.
    child.stderr.on('data',b=>{bytes+=b.length;if(bytes>16*1024*1024)kill();});
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.once('error',()=>{failed=true;});
    child.once('close',code=>{clearTimeout(timer);clearTimeout(hardTimer);children.delete(child.pid);
      if(code!==0||failed)no(new Error('Owned subprocess refused during '+phase));else yes(stdout.trim());});
  });
  const docker=(args,options)=>run('docker',args,options);
  const inspect=async(cleanup=false)=>JSON.parse(await docker(['inspect',cid],{cleanup}))[0];
  const receiptPath=resolve(tmp,'private-backup-only-rehearsal.json');
  try{
    archive=authenticate();source=readVerifiedPrivateImportSource(archive);assert.equal(selectPrivateProfile(source),'private');
    // Fail on absent source/ACL/guard recipes before resources are created.
    await prepareVerifiedImmutableBootstrapSource(archive);
    const key=randomBytes(32).toString('hex'),keyId='private-rehearsal-'+process.env.GITHUB_RUN_ID;
    const envelope=freshIntentEnvelope(source.sourceBinding,key,keyId);
    captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:archive,originalIntentEnvelope:envelope,intentVerifyKey:key,intentVerifyKeyId:keyId});
    const secretEnv={...baseEnv,REHEARSAL_SCOPE:'backup_only',OFFICIAL_LOCAL_STORAGE_PROVIDER:'true',
      GITHUB_RUN_ID:process.env.GITHUB_RUN_ID,RESTORE_SOURCE_DIR:archive.directory,
      RESTORE_ARCHIVE_VERIFY_KEY:process.env.RESTORE_ARCHIVE_VERIFY_KEY,RESTORE_ARCHIVE_VERIFY_KEY_ID:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,
      RESTORE_INTENT_VERIFY_KEY:key,RESTORE_INTENT_VERIFY_KEY_ID:keyId,RESTORE_INTENT_JSON:JSON.stringify(envelope),
      RESTORE_APPLY:'true',RESTORE_DATABASE_ONLY:'true',SUPABASE_PROJECT_REF:source.sourceBinding.project_ref,
      RESTORE_CONFIRM_PROJECT_REF:source.sourceBinding.project_ref};
    phase='create_owned_target';
    assert.equal(await docker(['ps','-aq','--filter','name=^/'+name+'$']),'','Never reuse an existing target');
    await docker(['pull',PG_IMAGE],{timeout:180000});
    networkId=await docker(['network','create','--internal','--label',label+'='+owner,networkName]);
    assert.match(networkId,/^[0-9a-f]{64}$/);
    cid=await docker(['run','-d','--name',name,'--label',label+'='+owner,'--network',networkName,
      '--memory','1g','--memory-swap','1g','--cpus','1','--pids-limit','256','--tmpfs','/var/lib/postgresql/data:rw,size=1g',
      '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',PG_IMAGE,'postgres','-D','/etc/postgresql',
      '-c',"listen_addresses=*",'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
      '-c','cron.database_name='+database,'-c','cron.launch_active_jobs=off']);
    assert.match(cid,/^[0-9a-f]{64}$/);
    const identity={id:cid,name,owner,networkId,networkName};
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
    const verifyTarget=async()=>assert.equal(assertOwnedPg(await inspect(),identity),address);
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
    secretEnv.SUPABASE_DB_URL='postgresql://supabase_admin:postgres@127.0.0.1:'+listener.port+'/'+database;
    // Existing adapter replays authenticated schema unchanged. No hydration,
    // legacy restore-intent producer, forward migrations or reconciliation.
    await run(process.execPath,['scripts/restore-isolated-event-owner-schema.mjs'],{env:secretEnv,timeout:300000});
    phase='private_original_restore_and_storage';await verifyTarget();
    result=JSON.parse(await run(process.execPath,['scripts/run-official-local-storage-rehearsal.mjs'],{env:secretEnv,timeout:1900000}));
    assertPrivateResult(result,source,envelope.intent);await verifyTarget();
    phase='verified_waiting_cleanup';
  }catch(e){failure=e;}
  finally{
    phase=failure?phase:'cleanup';closing=true;
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
      source_preparation:safeSourcePreparationFailure(failure)};
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
      let archive;
      try{archive=authenticate();assert.equal(selectPrivateProfile(readVerifiedPrivateImportSource(archive)),'private');
        await prepareVerifiedImmutableBootstrapSource(archive);
        console.log(JSON.stringify({ok:true,scope:'PRIVATE_SOURCE_PREPARATION_ONLY',target_created:false,restore_performed:false}));
      }catch(error){console.log(JSON.stringify({ok:false,scope:'PRIVATE_SOURCE_PREPARATION_ONLY',target_created:false,restore_performed:false,
        source_preparation:safeSourcePreparationFailure(error)}));process.exitCode=1;
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
