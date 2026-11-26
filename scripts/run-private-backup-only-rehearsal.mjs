// Closed disposable qualification for signed archives containing the two immutable
// originals. No alternate importer, production target, migration or resume path.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {isProxy} from 'node:util/types';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,createConnection,isIP} from 'node:net';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {materializeVerifiedArchive,readVerifiedPrivateImportSource,readVerifiedArchiveSourceBinding,readVerifiedImmutableBootstrapInventory} from './disaster-recovery-archive.mjs';
import {requireSigningKey,signBinding,restoreIntentBinding} from './disaster-recovery-crypto.mjs';
import {captureVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {loadImmutableDomainSourceRecipes} from './immutable-private-domain-source.mjs';
import {loadImmutableMessageSourceRecipes} from './immutable-private-message-source.mjs';
import {prepareVerifiedImmutableBootstrapSource,readVerifiedImmutableBootstrapOwnerProfile} from './immutable-private-source-bootstrap.mjs';
import {closeOwnedRelay,storageResult,pinnedPgMemory,privateScratchVolumeName,assertPrivateScratchMount,assertPrivatePgOwnerProfile,assertPrivatePgNetwork,privatePgPortIsolation,resourceProfile} from './run-official-local-storage-rehearsal.mjs';
import {projectCronSetupFailure} from './seed-isolated-current-postgres-cron.mjs';
import {withIsolatedCurrentVendorPrivileges,projectIsolatedVendorPrivilegeStatus} from './isolated-current-vendor-privileges.mjs';
import {withIsolatedCurrentCatalogPrivileges,projectIsolatedCatalogPrivilegeStatus} from './isolated-current-catalog-privileges.mjs';
import {privateFunctionStatsArguments,PRIVATE_FUNCTION_STATS_SQL,readPrivateFunctionStats} from './private-restore-function-diagnostic.mjs';
import {selectPrivateContextCostMode,projectPrivateContextCost,projectPrivateContextCostFailure} from './private-context-cost-observer.mjs';
import {CURRENT428_ARCHIVE_DIGEST} from './current428-forward-qualification-source.mjs';
import {current429,readVerifiedCurrent429ForwardQualificationSource} from './current429-forward-qualification-source.mjs';
import {readCurrent428PreservedRows,readCurrent428RestoredBaseline} from './current428-forward-readback.mjs';
import {NATIVE_TEXT_PRESERVATION_SETTINGS} from './isolated-release-data-preservation.mjs';
import {captureCurrent428RollbackTarget,current428CaptureRefusal} from './current428-rollback-target.mjs';

const privateRestoreWorkTimeoutMs=1900000; // Same existing child-process ceiling; no shorter quiet-socket cutoff.
export const PG_IMAGE='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const privateNames=['employee_message_original_outcomes','group_original_creations'];
const required=['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json'];
const label='custodial.private-backup-rehearsal';
const sourcePhases=new Set(['ARCHIVE_ADMISSION','ORIGINAL_INVENTORY','PROGRAM_SOURCE','ORIGINAL_ROWS',
  'ORIGINAL_RELEASE','SOURCE_RECIPES','ORIGINAL_REGISTRY','SOURCE_STATEMENTS','FINAL_CURRENTNESS',
  'SOURCE_HANDLE','ARCHIVE_CURRENTNESS','PROGRAM_CURRENTNESS','INVENTORY_CURRENTNESS']);
function current428CaptureRequested(){
  const flag=process.env.PRIVATE_CURRENT428_FORWARD_CAPTURE;
  assert.ok(flag===undefined||flag==='false'||flag==='true');
  if(flag==='true'){
    assert.equal(process.env.REHEARSAL_SCOPE,'backup_only');
    assert.equal(process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER,'true');
    assert.notEqual(process.env.PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY,'true');
  }
  return flag==='true';
}
function current429CaptureRequested(){
  const flag=process.env.PRIVATE_CURRENT429_FORWARD_CAPTURE;
  assert.ok(flag===undefined||flag===''||flag==='false'||flag==='true');
  if(flag==='true'){
    assert.equal(process.env.BACKUP_RUN_ID,current429.runId);
    assert.equal(process.env.REHEARSAL_SCOPE,'backup_only');
    assert.equal(process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER,'true');
    assert.notEqual(process.env.PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY,'true');
    assert.notEqual(process.env.PRIVATE_CURRENT428_FORWARD_CAPTURE,'true');
  }
  return flag==='true';
}
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
// Failure observation only. Never exports PostgreSQL log payloads or admits work.
export function privatePostgresProcessDiagnostic(state,memoryEvents,logs){
 const safe=state&&typeof state==='object'&&!isProxy(state)?state:{};
 const own=name=>{const d=Object.getOwnPropertyDescriptor(safe,name);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
 const events={};
 if(typeof memoryEvents==='string'&&Buffer.byteLength(memoryEvents)<=4096)
  for(const line of memoryEvents.trim().split('\n')){const m=/^(low|high|max|oom|oom_kill|oom_group_kill) ([0-9]{1,15})$/.exec(line);if(m&&!Object.hasOwn(events,m[1]))events[m[1]]=m[2];}
 const text=typeof logs==='string'&&Buffer.byteLength(logs)<=1024*1024?logs:'';
 return {running:typeof own('Running')==='boolean'?own('Running'):null,
  oom_killed:typeof own('OOMKilled')==='boolean'?own('OOMKilled'):null,
  exit_code:Number.isSafeInteger(own('ExitCode'))?own('ExitCode'):null,
  cgroup_oom:events.oom??null,cgroup_oom_kill:events.oom_kill??null,
  backend_sigkill_observed:/^[^\r\n]*LOG:  server process \(PID [0-9]+\) was terminated by signal 9: Killed\s*$/m.test(text),
  backend_sigsegv_observed:/^[^\r\n]*LOG:  server process \(PID [0-9]+\) was terminated by signal 11: Segmentation fault\s*$/m.test(text),
  metadata_only:true,private_payload_exported:false};
}
export function selectPrivateProfile(source){
  const names=source.selection.privateTables.map(t=>t.table_name).sort();
  if(!names.length)return 'native';
  assert.deepEqual(names,privateNames,'Unsupported immutable original table set');
  return 'private';
}
// Signed DATA construction only. Caller must authenticate the archive and invoke
// captureVerifiedImmutableFreshRestoreIntent before any target is created.
export function freshIntentEnvelope(binding,key,keyId,now=new Date(),lifetimeMs=60*60*1000){
  assert.ok(lifetimeMs===60*60*1000 || lifetimeMs===6*60*60*1000,'Closed disposable rehearsal intent lifetime required');
  requireSigningKey(key,'Independent rehearsal intent key');
  assert.match(keyId,/^[a-zA-Z0-9._:-]{1,120}$/);
  const release=Object.fromEntries(['release_id','backend_commit','frontend_commit','migration_head','migration_manifest_sha256']
    .map(k=>[k,binding.source_identity.release[k]]));
  const intent={restore_id:randomUUID(),authority_generation:1,retry_of_restore_id:null,
    archive_digest:binding.archive_digest,source_project_ref:binding.project_ref,target_project_ref:binding.project_ref,
    source_identity_sha256:binding.source_identity_sha256,target_migration_head:binding.source_identity.migration_head,
    target_release_identity:release,actor:'GitHub private backup-only disposable rehearsal',
    approved_at:now.toISOString(),expires_at:new Date(now.getTime()+lifetimeMs).toISOString(),resume_after_verification:false};
  return {format:'memphis-zoo-production-restore-intent.v1',algorithm:'hmac-sha256',key_id:keyId,
    intent,signature:signBinding(restoreIntentBinding(intent),key)};
}
const targetCreationOperations=new Set(['CHECK_TARGET_ABSENCE','PULL_PINNED_POSTGRES_IMAGE','CREATE_OWNED_NETWORK',
  'CHECK_NETWORK_ID_SHAPE','CREATE_OWNED_PGDATA','START_OWNED_POSTGRES','CHECK_CONTAINER_ID_SHAPE','INSPECT_OWNED_POSTGRES','VERIFY_OWNED_POSTGRES',
  'INSPECT_OWNED_NETWORK','VERIFY_OWNED_NETWORK']);
export function targetCreationOperation(value){return targetCreationOperations.has(value)?value:null;}
const privateSubprocessOperations=new Set(['REPLAY_FIXED_ROLE_CATALOG','CREATE_EMPTY_DATABASE',
  'RESTORE_AUTHENTICATED_SCHEMA','RESTORE_VERIFIED_CRON_METADATA','RESTORE_PRIVATE_DATA_AND_STORAGE']);
export function privateSubprocessOperation(value){return privateSubprocessOperations.has(value)?value:null;}
// Used only for the exact pinned Docker pull failure. Labels describe observed
// transport text, never authorize a retry, credential change or alternate image.
export function classifyPinnedPostgresPullFailure(stderr){
  if(typeof stderr!=='string'||Buffer.byteLength(stderr)>65536)return 'UNKNOWN';
  if(/toomanyrequests:|429 Too Many Requests|You have reached your unauthenticated pull rate limit/i.test(stderr))return 'REGISTRY_RATE_LIMIT';
  if(/unauthorized: authentication required|pull access denied/i.test(stderr))return 'REGISTRY_ACCESS_DENIED';
  if(/net\/http: TLS handshake timeout|i\/o timeout|context deadline exceeded/i.test(stderr))return 'TRANSPORT_TIMEOUT';
  if(/lookup [^\r\n]{1,512}: no such host|temporary failure in name resolution/i.test(stderr))return 'DNS_FAILURE';
  if(/x509: certificate signed by unknown authority|x509: certificate has expired/i.test(stderr))return 'TLS_CERTIFICATE_ERROR';
  if(/Cannot connect to the Docker daemon|permission denied while trying to connect to the Docker daemon socket/i.test(stderr))return 'DOCKER_DAEMON_UNAVAILABLE';
  if(/manifest unknown|no matching manifest for/i.test(stderr))return 'PINNED_IMAGE_MANIFEST_UNAVAILABLE';
  return 'UNKNOWN';
}
// Observational DATA only. Never serialize a Docker object, error, environment,
// address or label value. Missing/invalid observations do not satisfy guards.
export function targetCreationMetadata(kind,value,expected){
  const own=(object,key)=>{if(!object||typeof object!=='object'||isProxy(object))return undefined;
    const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const object=value=>value && typeof value==='object'&&!isProxy(value)&&!Array.isArray(value)?value:null;
  const keys=value=>object(value)?Object.keys(value):null;
  const boundedCount=value=>Array.isArray(value)&&value.length<=65536?value.length:null;
  if(kind==='POSTGRES'){
    const config=own(value,'Config'),labels=own(config,'Labels'),state=own(value,'State'),settings=own(value,'NetworkSettings');
    const ports=own(settings,'Ports'),portKeys=keys(ports),networks=own(settings,'Networks'),networkKeys=keys(networks),endpoint=own(networks,expected.networkName);
    const bindings=portKeys?.map(key=>own(ports,key)),address=own(endpoint,'IPAddress');
    return Object.freeze({...privatePgPortIsolation(value,expected.networkName),container_id_matches:own(value,'Id')===expected.id,container_name_matches:own(value,'Name')==='/'+expected.name,
      pinned_image_matches:own(config,'Image')===PG_IMAGE,owner_label_matches:own(labels,label)===expected.owner,
      owner_profile_matches:own(labels,'custodial.private-owner-profile')===expected.ownerProfile.id,
      owner_actor_matches:own(labels,'custodial.private-owner-actor')===expected.ownerProfile.actor,
      running:own(state,'Running')===true,status:['created','running','paused','restarting','removing','exited','dead'].includes(own(state,'Status'))?own(state,'Status'):'UNAVAILABLE',
      oom_killed:typeof own(state,'OOMKilled')==='boolean'?own(state,'OOMKilled'):null,
      exit_code:Number.isInteger(own(state,'ExitCode'))&&own(state,'ExitCode')>=0&&own(state,'ExitCode')<=255?own(state,'ExitCode'):null,
      state_error_present:typeof own(state,'Error')==='string'&&own(state,'Error').length>0,
      ports_object_present:portKeys!==null,postgres_port_key_present:portKeys?.includes('5432/tcp')??false,
      port_key_count:boundedCount(portKeys),all_ports_unpublished:bindings?.every(p=>p===null||!isProxy(p)&&Array.isArray(p)&&p.length===0)??false,
      network_count:boundedCount(networkKeys),sole_expected_network:networkKeys?.length===1&&networkKeys[0]===expected.networkName,
      network_id_matches:own(endpoint,'NetworkID')===expected.networkId,network_ipv4_present:typeof address==='string'&&isIP(address)===4});
  }
  if(kind==='NETWORK'){
    const members=own(value,'Containers'),memberKeys=keys(members);
    return Object.freeze({network_id_matches:own(value,'Id')===expected.networkId,internal:own(value,'Internal')===true,
      owner_label_matches:own(own(value,'Labels'),label)===expected.owner,member_count:boundedCount(memberKeys),
      sole_expected_postgres:memberKeys?.length===1&&memberKeys[0]===expected.id});
  }
  return null;
}
export function assertOwnedPg(value,{id,name,owner,networkId,networkName,ownerProfile,diskScratch=false}){
  assert.equal(value.Id,id);assert.equal(value.Name,'/'+name);assert.equal(value.Config.Image,PG_IMAGE);
  assert.equal(value.Config.Labels[label],owner);assert.equal(value.State.Running,true);
  assertPrivatePgOwnerProfile(value,ownerProfile);
  if(diskScratch)assertPrivateScratchMount(value,name,owner);
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

const scratchPaths=['/var/lib/postgresql/data','/var/lib/postgresql/data/pg_wal','/tmp'];
const scratchKinds=['pgdata','wal','process_tmp'];
const minimumScratchBytes=12*1024**3;
const minimumScratchInodes=64*1024;
export function parseRehearsalScratchCapacity(space,inodes,filesystems){
  const rows=raw=>{
    const lines=raw.trim().split('\n').slice(1);
    assert.equal(lines.length,scratchPaths.length);
    return lines.map(line=>{
      const match=/^\S+\s+(\d+)\s+\d+\s+(\d+)\s+\d+%\s+.+$/.exec(line.trim());
      assert.ok(match,'Unrecognized owned volume stat');
      return match.slice(1).map(Number);
    });
  };
  const blocks=rows(space),counts=rows(inodes),types=filesystems.trim().split('\n');
  assert.equal(types.length,scratchPaths.length);
  return Object.fromEntries(scratchKinds.map((kind,i)=>{
    const [total,free]=blocks[i].map(blocks=>blocks*1024),[totalInodes,freeInodes]=counts[i],type=types[i];
    assert.ok([total,free,totalInodes,freeInodes].every(n=>Number.isSafeInteger(n)&&n>=0)
      &&free<=total&&freeInodes<=totalInodes&&/^[A-Za-z0-9_/-]{1,24}$/.test(type));
    return [kind,{filesystem_type:type,total_bytes:total,free_bytes:free,total_inodes:totalInodes,free_inodes:freeInodes}];
  }));
}

export async function runPrivate(){
  assert.equal(process.env.REHEARSAL_SCOPE,'backup_only');assert.equal(process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER,'true');
  const contextDiagnosticOnly=selectPrivateContextCostMode(process.env.PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY,process.env.REHEARSAL_SCOPE,process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER);
  const current428Capture=current428CaptureRequested();
  const current429Capture=current429CaptureRequested();
  assert.match(process.env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
  assert.match(process.env.BACKUP_RUN_ID||'',/^[1-9][0-9]*$/);
  const tmp=realpathSync(process.env.RUNNER_TEMP),owned=mkdtempSync(resolve(tmp,'private-backup-rehearsal-'));
  const owner=randomBytes(16).toString('hex'),name='mz_schema_rebuild_'+process.env.GITHUB_RUN_ID;
  const networkName=name+'_private_'+owner, database=name;
  const scratchName=process.env.BACKUP_RUN_ID===current429.runId?privateScratchVolumeName(name,owner):null;
  let scratchAttempted=false,scratchAbsent=!scratchName,scratchTimer,scratchSample;
  const scratch=scratchName?{layout:'owned_local_volume',minimum_bytes:minimumScratchBytes,
    minimum_inodes:minimumScratchInodes,samples:0,sampling_failures:0,admission:null,final:null,minimum:null}:null;
  let archive,cid,networkId,relay,relayClosed=true,pgAbsent=false,networkAbsent=false;
  const sockets=new Set(),children=new Set(),pendingConnections=new Set(),inspectionController=new AbortController();let stopping=false,closing=false,failure,phase='authenticate',result,source,sourceMetadata,ownerMetadata,ownerProfile;
  let relaySocketTimeouts=0,finalPostgresProcess=null,finalFunctionStats=null,current428Baseline=null;
  let isolatedReconciliation=null,current428Target=null;
  let cancelTimer,creationOperation=null,creationProcess=null,creationPostgres=null,creationNetwork=null,subprocessFailure=null,cronSetup=null,vendorPrivileges=null,catalogPrivileges=null,contextCost=null,contextCostFailure=null;
  const stop=()=>{stopping=true;for(const pid of children)try{process.kill(-pid,'SIGTERM');}catch{}
    cancelTimer??=setTimeout(()=>{for(const pid of children)try{process.kill(-pid,'SIGKILL');}catch{}},60000);};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const baseEnv=Object.fromEntries(['PATH','HOME','RUNNER_TEMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const run=(command,args,{input,env=baseEnv,timeout=60000,cleanup=false,abortSignal=null,diagnosticOperation=null}={})=>new Promise((yes,no)=>{
    if(stopping&&!cleanup || abortSignal?.aborted)return no(new Error('Cancelled'));
    const child=spawn(command,args,{cwd:root,env,detached:true,stdio:['pipe','pipe','pipe']});
    let stdout='',bytes=0,stdoutBytes=0,stderrBytes=0,failed=false,hardTimer,timedOut=false,outputLimit=false,cancelled=false,spawnError=false;children.add(child.pid);
    const operationAtStart=phase==='create_owned_target'&&!cleanup?targetCreationOperation(creationOperation):null;
    const privateOperation=!cleanup&&diagnosticOperation!==null?privateSubprocessOperation(diagnosticOperation):null;
    const privateProcessLogs=cleanup&&command==='docker'&&args.length===4&&args[0]==='logs'&&args[1]==='--tail'&&args[2]==='100'&&args[3]===cid;
    const pinnedPull=operationAtStart==='PULL_PINNED_POSTGRES_IMAGE'&&command==='docker'&&args.length===2&&args[0]==='pull'&&args[1]===PG_IMAGE;
    const pullErrorChunks=[];let pullErrorBytes=0,pullErrorTruncated=false;
    const kill=(reason='TIMEOUT')=>{failed=true;timedOut ||= reason==='TIMEOUT';outputLimit ||= reason==='OUTPUT_LIMIT';try{process.kill(-child.pid,'SIGTERM');}catch{}
      hardTimer??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},60000);};
    const cancelInspector=()=>{failed=true;cancelled=true;if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}};
    if(abortSignal){abortSignal.addEventListener('abort',cancelInspector,{once:true});if(abortSignal.aborted)cancelInspector();}
    const timer=setTimeout(kill,timeout);
    child.stdout.on('data',b=>{bytes+=b.length;stdoutBytes+=b.length;if(bytes>16*1024*1024)kill('OUTPUT_LIMIT');else stdout+=b;});
    // Private SQL/rows/errors never enter CI logs or receipt artifacts.
    child.stderr.on('data',b=>{bytes+=b.length;stderrBytes+=b.length;
      if(privateProcessLogs&&stderrBytes<=1024*1024)stdout+=b; // Classified in memory only; never returned to CI output.
      if(pinnedPull){pullErrorBytes+=b.length;if(pullErrorBytes<=65536)pullErrorChunks.push(b);else pullErrorTruncated=true;}
      if(bytes>16*1024*1024)kill('OUTPUT_LIMIT');});
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.once('error',()=>{failed=true;spawnError=true;});
    child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(hardTimer);abortSignal?.removeEventListener('abort',cancelInspector);children.delete(child.pid);
      if(operationAtStart||privateOperation){
        const diagnostic={exit_code:Number.isInteger(code)&&code>=0&&code<=255?code:null,
          signal:['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBUS'].includes(signal)?signal:null,
          stdout_bytes:stdoutBytes,stderr_bytes:stderrBytes,timed_out:timedOut,output_limit_exceeded:outputLimit,cancelled,spawn_error:spawnError};
        if(operationAtStart)creationProcess=Object.freeze({operation:operationAtStart,...diagnostic,
          ...(pinnedPull&&(code!==0||failed)?{docker_pull_failure:pullErrorTruncated?'UNKNOWN':classifyPinnedPostgresPullFailure(Buffer.concat(pullErrorChunks).toString('utf8'))}:{} )});
        if(privateOperation&&(code!==0||failed)){
          let cronFailure=null;
          if(privateOperation==='RESTORE_VERIFIED_CRON_METADATA'&&stdoutBytes<=2048)try{cronFailure=projectCronSetupFailure(JSON.parse(stdout.trim()));}catch{}
          subprocessFailure??=Object.freeze({operation:privateOperation,...diagnostic,...(cronFailure?{cron_setup_failure:cronFailure}:{})});
        }
      }
      if(contextDiagnosticOnly&&command===process.execPath&&args.length===1&&args[0]==='scripts/private-context-cost-diagnostic.mjs'&&(code!==0||failed)&&stdoutBytes<=2048){
        try{contextCostFailure=projectPrivateContextCostFailure(JSON.parse(stdout.trim()));}catch{}
        subprocessFailure??=Object.freeze({operation:'OBSERVE_PRIVATE_CONTEXT_COST',exit_code:Number.isInteger(code)?code:null,
          signal:['SIGTERM','SIGKILL','SIGINT'].includes(signal)?signal:null,stdout_bytes:stdoutBytes,stderr_bytes:stderrBytes,timed_out:timedOut,output_limit_exceeded:outputLimit,cancelled,spawn_error:spawnError});
      }
      if(code!==0||failed)no(new Error('Owned subprocess refused during '+phase));else yes(stdout.trim());});
  });
  const docker=(args,options)=>run('docker',args,options);
  const inspect=async(cleanup=false,options={})=>JSON.parse(await docker(['inspect',cid],{cleanup,...options}))[0];
  const receiptPath=resolve(tmp,'private-backup-only-rehearsal.json');
  const requireScratchVolume=async (cleanup=false)=>{
    const volumes=JSON.parse(await docker(['volume','inspect',scratchName],{cleanup,timeout:10000}));
    assert.equal(volumes.length,1);
    const volume=volumes[0];
    assert.equal(volume.Name,scratchName);
    assert.equal(volume.Driver,'local');
    assert.equal(volume.Scope,'local');
    assert.equal(volume.Labels?.[label],owner);
    assert.equal(Object.keys(volume.Options??{}).length,0);
  };
  const sampleScratch=async (milestone,cleanup=false)=>{
    const options={cleanup,timeout:10000};
    const args=(...command)=>docker(['exec',cid,...command,...scratchPaths],options);
    const capacity=parseRehearsalScratchCapacity(await args('df','-kP'),await args('df','-Pi'),await args('stat','-f','-c','%T'));
    scratch.samples++;
    if(milestone)scratch[milestone]=capacity;
    scratch.minimum??=structuredClone(capacity);
    for(const kind of scratchKinds){
      const lowest=scratch.minimum[kind],point=capacity[kind];
      assert.equal(point.filesystem_type,lowest.filesystem_type);
      lowest.free_bytes=Math.min(lowest.free_bytes,point.free_bytes);
      lowest.free_inodes=Math.min(lowest.free_inodes,point.free_inodes);
    }
    return capacity;
  };
  let restoreTimeoutMs=privateRestoreWorkTimeoutMs;
  try{
    archive=authenticate();source=readVerifiedPrivateImportSource(archive);assert.equal(selectPrivateProfile(source),'private');
    if(current428Capture)assert.equal(source.sourceBinding.archive_digest,CURRENT428_ARCHIVE_DIGEST);
    if(scratchName)assert.equal(source.sourceBinding.archive_digest,current429.archiveDigest);
    if(current429Capture)readVerifiedCurrent429ForwardQualificationSource(archive);
    sourceMetadata=originalRowsMetadataDiagnostics({source,inventory:readVerifiedImmutableBootstrapInventory(archive).inventory});
    ownerMetadata=originalOwnerMetadataDiagnostics(readVerifiedImmutableBootstrapInventory(archive).inventory);
    // Fail on absent source/ACL/guard recipes before resources are created.
    const bootstrapSource=await prepareVerifiedImmutableBootstrapSource(archive);
    ownerProfile=readVerifiedImmutableBootstrapOwnerProfile(bootstrapSource,archive);
    if(contextDiagnosticOnly)assert.deepEqual(ownerProfile,{id:'immutable-private-current-postgres',actor:'postgres'});
    // Same pinned 2GiB allowance already used by the populated native-text rehearsal.
    const pgMemory=pinnedPgMemory(ownerProfile.id==='immutable-private-current-postgres'?'immutable-private-fresh-postgres':'immutable-private-fresh-supabase-admin');
    const pgDataMount=scratchName?['--mount','type=volume,source='+scratchName+',target='+scratchPaths[0]]
      :['--tmpfs',scratchPaths[0]+':rw,size='+pgMemory];
    const requireOwnerProfile=()=>{const current=readVerifiedImmutableBootstrapOwnerProfile(bootstrapSource,archive);
      assert.deepEqual(current,ownerProfile);return current;};
    const key=randomBytes(32).toString('hex'),keyId='private-rehearsal-'+process.env.GITHUB_RUN_ID;
    const currentFullRestore=!contextDiagnosticOnly&&ownerProfile.id==='immutable-private-current-postgres';
    if(currentFullRestore)restoreTimeoutMs=resourceProfile('immutable-private-fresh-postgres').work_ms+100000;
    const envelope=freshIntentEnvelope(source.sourceBinding,key,keyId,new Date(),currentFullRestore?6*60*60*1000:60*60*1000);
    captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:archive,originalIntentEnvelope:envelope,intentVerifyKey:key,intentVerifyKeyId:keyId});
    const secretEnv={...baseEnv,REHEARSAL_SCOPE:'backup_only',OFFICIAL_LOCAL_STORAGE_PROVIDER:'true',
      GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,GITHUB_RUN_ID:process.env.GITHUB_RUN_ID,RESTORE_SOURCE_DIR:archive.directory,
      RESTORE_ARCHIVE_VERIFY_KEY:process.env.RESTORE_ARCHIVE_VERIFY_KEY,RESTORE_ARCHIVE_VERIFY_KEY_ID:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,
      RESTORE_INTENT_VERIFY_KEY:key,RESTORE_INTENT_VERIFY_KEY_ID:keyId,RESTORE_INTENT_JSON:JSON.stringify(envelope),
      RESTORE_APPLY:'true',RESTORE_DATABASE_ONLY:'true',SUPABASE_PROJECT_REF:source.sourceBinding.project_ref,
      RESTORE_CONFIRM_PROJECT_REF:source.sourceBinding.project_ref,...(contextDiagnosticOnly?{PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY:'true'}:{})};
    requireOwnerProfile();phase='create_owned_target';
    creationOperation='CHECK_TARGET_ABSENCE';
    assert.equal(await docker(['ps','-aq','--filter','name=^/'+name+'$']),'','Never reuse an existing target');
    creationOperation='PULL_PINNED_POSTGRES_IMAGE';
    await docker(['pull',PG_IMAGE],{timeout:180000});
    creationOperation='CREATE_OWNED_NETWORK';
    networkId=await docker(['network','create','--internal','--label',label+'='+owner,networkName]);
    creationOperation='CHECK_NETWORK_ID_SHAPE';
    assert.match(networkId,/^[0-9a-f]{64}$/);
    if(scratchName){
      creationOperation='CREATE_OWNED_PGDATA';
      scratchAttempted=true;
      assert.equal(await docker(['volume','create','--driver','local','--label',label+'='+owner,scratchName]),scratchName);
      await requireScratchVolume();
    }
    creationOperation='START_OWNED_POSTGRES';
    cid=await docker(['run','-d','--name',name,'--label',label+'='+owner,'--label','custodial.private-owner-profile='+ownerProfile.id,
      '--label','custodial.private-owner-actor='+ownerProfile.actor,'--network',networkName,
      '--memory',pgMemory,'--memory-swap',pgMemory,'--cpus','1','--pids-limit','256',...pgDataMount,
      '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',PG_IMAGE,'postgres','-D','/etc/postgresql',
      '-c',"listen_addresses=*",'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
      '-c','cron.database_name='+database,'-c','cron.launch_active_jobs=off',...privateFunctionStatsArguments(requireOwnerProfile())]);
    creationOperation='CHECK_CONTAINER_ID_SHAPE';
    assert.match(cid,/^[0-9a-f]{64}$/);
    const identity={id:cid,name,owner,networkId,networkName,ownerProfile,diskScratch:Boolean(scratchName)};
    creationOperation='INSPECT_OWNED_POSTGRES';
    const initial=await inspect();creationPostgres=targetCreationMetadata('POSTGRES',initial,identity);
    creationOperation='VERIFY_OWNED_POSTGRES';
    const address=assertOwnedPg(initial,identity);
    assert.deepEqual(Object.keys(initial.NetworkSettings.Networks),[networkName]);
    creationOperation='INSPECT_OWNED_NETWORK';
    const net=JSON.parse(await docker(['network','inspect',networkId]))[0];creationNetwork=targetCreationMetadata('NETWORK',net,identity);
    creationOperation='VERIFY_OWNED_NETWORK';
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
    if(scratchName){
      phase='verify_restore_scratch';
      const capacity=await sampleScratch('admission');
      for(const kind of ['pgdata','wal']){
        assert.ok(!['tmpfs','ramfs'].includes(capacity[kind].filesystem_type));
        assert.ok(capacity[kind].free_bytes>=minimumScratchBytes&&capacity[kind].free_inodes>=minimumScratchInodes,
          'The private PostgreSQL volume lacks initial restore capacity');
      }
      assert.equal(await docker(['exec',cid,'psql','-X','-At','-U','supabase_admin','-d','postgres','-c',
        "select current_setting('data_directory'), current_setting('temp_tablespaces'), (select count(*) from pg_tablespace where spcname not in ('pg_default','pg_global'))"]),
        scratchPaths[0]+'||0','Unexpected PostgreSQL scratch routing');
      scratchTimer=setInterval(()=>{
        if(!scratchSample&&!closing&&!stopping)scratchSample=sampleScratch().catch(()=>{scratch.sampling_failures++}).finally(()=>{scratchSample=null;});
      },60000);
      scratchTimer.unref();
    }
    phase='prepare_schema_only';
    await docker(['exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
      {input:readFileSync(resolve(root,'supabase/canonical/production-source-role-catalog.sql'),'utf8'),diagnosticOperation:'REPLAY_FIXED_ROLE_CATALOG'});
    await docker(['exec',cid,'createdb','-U','supabase_admin','-O','postgres','-T','template0',database],{diagnosticOperation:'CREATE_EMPTY_DATABASE'});
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
        for(const socket of [client,upstream]){sockets.add(socket);socket.setTimeout(restoreTimeoutMs);
          socket.on('timeout',()=>{relaySocketTimeouts=Math.min(64,relaySocketTimeouts+1);socket.destroy();});socket.on('error',()=>{client.destroy();upstream.destroy();});
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
    await run(process.execPath,['scripts/restore-isolated-event-owner-schema.mjs'],{env:{...secretEnv,SUPABASE_DB_URL:schemaDatabaseUrl},timeout:300000,diagnosticOperation:'RESTORE_AUTHENTICATED_SCHEMA'});
    if(requireOwnerProfile().id==='immutable-private-current-postgres'){
      phase='seed_verified_isolated_cron_metadata';await verifyTarget();
      cronSetup=JSON.parse(await run(process.execPath,['scripts/seed-isolated-current-postgres-cron.mjs'],
        {env:{...secretEnv,SUPABASE_DB_URL:schemaDatabaseUrl},timeout:300000,diagnosticOperation:'RESTORE_VERIFIED_CRON_METADATA'}));
      assert.deepEqual(cronSetup,{schema:'custodial.isolated-current-postgres-cron-setup.v1',ok:true,
        jobs:JSON.parse(bootstrapSource.inventory['inventory/cron-jobs.json']).length,rows_and_counter_verified:true,committed:true,
        application_data_written:false,owners_or_grants_changed:false,cron_execution_enabled:false,production_written:false,restore_admission:false});
      requireOwnerProfile();await verifyTarget();
    }
    phase='private_original_restore_and_storage';await verifyTarget();
    const restoreOriginal=async()=>{
      if(contextDiagnosticOnly){
        phase='private_current_context_cost_only';await verifyTarget();
        contextCost=projectPrivateContextCost(JSON.parse(await run(process.execPath,['scripts/private-context-cost-diagnostic.mjs'],{env:secretEnv,timeout:300000})));
        assert.ok(contextCost);assert.equal(contextCost.archive_digest,source.sourceBinding.archive_digest);await verifyTarget();return null;
      }
      const restored=JSON.parse(await run(process.execPath,['scripts/run-official-local-storage-rehearsal.mjs'],{env:secretEnv,timeout:restoreTimeoutMs,diagnosticOperation:'RESTORE_PRIVATE_DATA_AND_STORAGE'}));
      assertPrivateResult(restored,source,envelope.intent);await verifyTarget();return restored;
    };
    if(requireOwnerProfile().id==='immutable-private-current-postgres'){
      const restoreWithCatalogLease=async()=>{
        try{
          const catalog=await withIsolatedCurrentCatalogPrivileges({verifiedArchive:archive,source:bootstrapSource,connectionString:schemaDatabaseUrl,runId:process.env.GITHUB_RUN_ID,verifyTarget},restoreOriginal);
          catalogPrivileges=catalog.receipt;assert.equal(catalogPrivileges.retirement_verified,true);return catalog.value;
        }catch(error){
          if(error&&typeof error==='object'&&!isProxy(error))catalogPrivileges=projectIsolatedCatalogPrivilegeStatus(Object.getOwnPropertyDescriptor(error,'catalog_privileges')?.value)??catalogPrivileges;
          throw error;
        }
      };
      const qualified=await withIsolatedCurrentVendorPrivileges({verifiedArchive:archive,source:bootstrapSource,connectionString:schemaDatabaseUrl,runId:process.env.GITHUB_RUN_ID,verifyTarget},restoreWithCatalogLease);
      vendorPrivileges=qualified.receipt;assert.equal(vendorPrivileges.retirement_verified,true);result=qualified.value;
    }else result=await restoreOriginal();
    if(result&&(source.sourceBinding.archive_digest===CURRENT428_ARCHIVE_DIGEST||current429Capture)){
      phase='current428_post_restore_readback';
      assert.equal(vendorPrivileges?.retirement_verified,true);
      assert.equal(catalogPrivileges?.retirement_verified,true);
      await verifyTarget();
      const reader=new pg.Client({connectionString:secretEnv.SUPABASE_DB_URL,
        connectionTimeoutMillis:10000,statement_timeout:60000,application_name:'custodial-current428-readback'});
      try{
        await reader.connect();
        await reader.query('begin isolation level serializable read only');
        await reader.query('set local search_path=pg_catalog');
        for(const [setting,value] of NATIVE_TEXT_PRESERVATION_SETTINGS)
          await reader.query('select set_config($1,$2,true)',[setting,value]);
        const baseline=await readCurrent428RestoredBaseline({client:reader,archive,bootstrapSource,restore:result});
        const originalRows=await readCurrent428PreservedRows({client:reader,archive});
        assert.equal((await reader.query('rollback')).command,'ROLLBACK');
        current428Baseline={...baseline,application_data_tables:originalRows.tables,application_data_sha256:originalRows.rows_sha256};
      }finally{await reader.end();}
      await verifyTarget();
    }
    if(current428Capture||current429Capture){
      phase=current429Capture?'current429_signed_isolated_reconciliation':'current428_signed_isolated_reconciliation';
      assert.ok(current428Baseline);
      assert.equal(result.resume_eligible,true);
      assert.deepEqual(current428Baseline.open_discrepancies,[]);
      const candidateCommit=await run('git',['rev-parse','HEAD']);
      const candidateTree=await run('git',['rev-parse','HEAD^{tree}']);
      assert.match(candidateCommit,/^[a-f0-9]{40}$/);
      assert.equal(candidateCommit,process.env.GITHUB_SHA);
      assert.match(candidateTree,/^[a-f0-9]{40}$/);
      await verifyTarget();
      const reconciliationKey=randomBytes(32).toString('hex');
      const reconciliationKeyId='private-qualification-'+process.env.GITHUB_RUN_ID;
      const reconcileEnv={...baseEnv,SUPABASE_DB_URL:secretEnv.SUPABASE_DB_URL,
        SUPABASE_PROJECT_REF:source.sourceBinding.project_ref};
      const signed=JSON.parse(await run(process.execPath,['scripts/create-production-restore-reconciliation.mjs'],{
        env:{...reconcileEnv,RESTORE_RECONCILIATION_NAMED_ACTOR:'Root isolated current428 qualification',
          RESTORE_RECONCILIATION_RESOLUTIONS_JSON:'[]',RESTORE_RECONCILIATION_SIGNING_KEY:reconciliationKey,
          RESTORE_RECONCILIATION_SIGNING_KEY_ID:reconciliationKeyId},
      }));
      assert.equal(signed.intent.restore_id,current428Baseline.restore_id);
      assert.equal(signed.intent.authority_generation,current428Baseline.authority_generation);
      assert.equal(signed.intent.archive_digest,current428Baseline.archive_digest);
      assert.equal(signed.intent.final_manifest_sha256,current428Baseline.final_manifest_sha256);
      assert.equal(signed.intent.discrepancy_snapshot_sha256,current428Baseline.discrepancy_snapshot_sha256);
      assert.deepEqual(signed.intent.resolutions,[]);
      await verifyTarget();
      isolatedReconciliation=JSON.parse(await run(process.execPath,['scripts/apply-production-restore-reconciliation.mjs'],{
        env:{...reconcileEnv,RESTORE_RECONCILIATION_APPLY:'true',
          RESTORE_RECONCILIATION_CONFIRM_PROJECT_REF:source.sourceBinding.project_ref,
          RESTORE_RECONCILIATION_VERIFY_KEY:reconciliationKey,RESTORE_RECONCILIATION_VERIFY_KEY_ID:reconciliationKeyId,
          RESTORE_RECONCILIATION_JSON:JSON.stringify(signed)},
      }));
      phase=current429Capture?'current429_rollback_target':'current428_rollback_target';
      await verifyTarget();
      const ownerClient=new pg.Client({connectionString:secretEnv.SUPABASE_DB_URL,
        connectionTimeoutMillis:10000,application_name:'custodial-current428-rollback-qualification'});
      try{
        await ownerClient.connect();
        const captured=await captureCurrent428RollbackTarget({client:ownerClient,archive,bootstrapSource,
          paused:current428Baseline,reconciliation:isolatedReconciliation,verifyTarget});
        current428Target={...captured,candidate_commit:candidateCommit,candidate_tree:candidateTree};
      }finally{await ownerClient.end();}
    }
    phase='verified_waiting_cleanup';
  }catch(e){failure=e;
    if(e&&typeof e==='object'&&!isProxy(e))vendorPrivileges=projectIsolatedVendorPrivilegeStatus(Object.getOwnPropertyDescriptor(e,'vendor_privileges')?.value)??vendorPrivileges;
  }
  finally{
    phase=failure?phase:'cleanup';closing=true;inspectionController.abort();
    clearInterval(scratchTimer);
    await scratchSample;
    try{if(relay){await closeOwnedRelay(relay,sockets,Date.now()+15000);relayClosed=true;}
      await Promise.allSettled([...pendingConnections]);}catch(e){failure??=e;}
    try{
      // Reconcile uncertain births using exact name + unpredictable ownership label.
      if(!cid){const ids=(await docker(['ps','-aq','--no-trunc','--filter','name=^/'+name+'$','--filter','label='+label+'='+owner],{cleanup:true})).split('\n').filter(Boolean);assert.ok(ids.length<=1);cid=ids[0];}
      if(cid){const value=await inspect(true);assert.equal(value.Id,cid);assert.equal(value.Name,'/'+name);assert.equal(value.Config.Labels[label],owner);assert.equal(value.Config.Image,PG_IMAGE);
        let memoryEvents='',logs='';
        try{memoryEvents=await docker(['exec',cid,'cat','/sys/fs/cgroup/memory.events'],{cleanup:true,timeout:5000});}catch{}
        try{logs=await docker(['logs','--tail','100',cid],{cleanup:true,timeout:5000});}catch{}
        finalPostgresProcess=privatePostgresProcessDiagnostic(value.State,memoryEvents,logs);
        if(scratchName&&value.State.Running===true){
          try{await sampleScratch('final',true);}catch{scratch.sampling_failures++;}
        }
        if(privateFunctionStatsArguments(ownerProfile).length&&value.State?.Running===true){
          try{finalFunctionStats=readPrivateFunctionStats(await docker(['exec',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
            '-U','supabase_admin','-d',database,'-c',PRIVATE_FUNCTION_STATS_SQL],{cleanup:true,timeout:5000}));}catch{}
        }
        await docker(['rm','-f',cid],{cleanup:true});assert.equal(await docker(['ps','-aq','--filter','id='+cid],{cleanup:true}),'');}
      pgAbsent=true;
      if(scratchAttempted){
        const matching=()=>docker(['volume','ls','-q','--filter','name=^'+scratchName+'$'],{cleanup:true,timeout:10000});
        if(await matching()){
          await requireScratchVolume(true);
          await docker(['volume','rm',scratchName],{cleanup:true,timeout:10000});
        }
        assert.equal(await matching(),'');
        scratchAbsent=true;
      }else scratchAbsent=true;
      const networks=(await docker(['network','ls','--no-trunc','-q','--filter','label='+label+'='+owner],{cleanup:true})).split('\n').filter(Boolean);assert.ok(networks.length<=1);
      if(networks.length){const n=JSON.parse(await docker(['network','inspect',networks[0]],{cleanup:true}))[0];
        assert.equal(n.Name,networkName);assert.equal(n.Labels[label],owner);assert.deepEqual(Object.keys(n.Containers),[]);
        await docker(['network','rm',n.Id],{cleanup:true});}
      assert.equal(await docker(['network','ls','-q','--filter','name=^'+networkName+'$'],{cleanup:true}),'');networkAbsent=true;
    }catch(e){failure??=e;}
    try{archive?.cleanup();rmSync(owned,{recursive:true,force:true});}catch(e){failure??=e;}
    clearTimeout(cancelTimer);process.off('SIGTERM',stop);process.off('SIGINT',stop);
    const receipt={schema:'custodial.private-backup-only-rehearsal.v1',ok:!failure&&!stopping,
      scope:contextDiagnosticOnly?'context_cost_only':'backup_only',context_cost_diagnostic_only:contextDiagnosticOnly,context_cost:contextCost,context_cost_failure:contextCostFailure,backup_run_id:process.env.BACKUP_RUN_ID,qualification_run_id:process.env.GITHUB_RUN_ID,
      archive_digest:source?.sourceBinding.archive_digest??null,
      disposable_database_restore_outcome:contextDiagnosticOnly?'NOT_ATTEMPTED':result?'RESULT_RETURNED':'NOT_ESTABLISHED',production_restore_performed:false,
      production_provider_verified:false,forward_migrations_applied:false,runtime_admission:false,
      mutations_resumed:false,cleanup_checked:relayClosed&&pgAbsent&&networkAbsent&&scratchAbsent,
      ...(scratch?{scratch:{...scratch,volume_removed:scratchAbsent}}:{}),
      database_tables:!failure?result?.database_tables:null,database_rows:!failure?result?.database_rows:null,
      provider_verified:!failure&&result?.storage?.provider_verified===true,
      current428_baseline:current428Baseline,
      current428_target_capture:!current429Capture&&!failure&&!stopping?current428Target:null,
      ...(current429Capture?{
        current429_target_capture:!failure&&!stopping?current428Target:null,
        source_commit:current428Target?.candidate_commit??null,
        source_tree:current428Target?.candidate_tree??null,
        completed_at:new Date().toISOString(),
      }:{}),
      current428_target_refusal:current428CaptureRefusal(failure),
      isolated_reconciliation_observed:isolatedReconciliation?.ok===true&&isolatedReconciliation.resumed===true,
      phase,blocker:failure?'PRIVATE_REHEARSAL_REFUSED':stopping?'CANCELLED':null,
      target_creation:{operation:targetCreationOperation(creationOperation),process:creationProcess,postgres:creationPostgres,network:creationNetwork},
      postgres_process:finalPostgresProcess,
      function_cost:finalFunctionStats,
      relay_transport:{socket_timeout_count:relaySocketTimeouts,socket_timeout_ms:restoreTimeoutMs},
      subprocess_failure:subprocessFailure,cron_schema_setup:cronSetup,vendor_privileges:vendorPrivileges,catalog_privileges:catalogPrivileges,source_preparation:safeSourcePreparationFailure(failure),original_rows_metadata:sourceMetadata??null,original_owner_metadata:ownerMetadata??null,authenticated_owner_profile:ownerProfile??null};
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
      try{
        const source=readVerifiedPrivateImportSource(archive);
        profile=selectPrivateProfile(source);
        if(current429CaptureRequested()){
          assert.equal(profile,'private');
          readVerifiedCurrent429ForwardQualificationSource(archive);
        }
        if(current428CaptureRequested()){
          assert.equal(profile,'private');
          assert.equal(source.sourceBinding.archive_digest,CURRENT428_ARCHIVE_DIGEST);
        }
      }finally{archive.cleanup();}
      if(selectPrivateContextCostMode(process.env.PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY,process.env.REHEARSAL_SCOPE,process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER))assert.equal(profile,'private');
      if(mode==='--profile')console.log(profile);
      else if(profile==='native')process.exitCode=3; // The only legacy-path continuation status.
      else await runPrivate();
    }else{assert.equal(mode,'--run');await runPrivate();}
  }catch{process.stderr.write('Private backup-only qualification refused. See bounded stage receipt; no private payload logged.\n');process.exitCode=1;}
}
