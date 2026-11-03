// Exact canonical304 constructor + fresh capture + full retained workflow suite.
// No production URL, provider, review approval, app build or release admission.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {createCiFreshOnlyFixture} from './ci-fresh-only-replay.mjs';
import {runApprovedManualActivationDatabaseTest} from './approved-manual-activation-database-tests.mjs';
import {createCustodialLeadershipControlPlane} from '../src/auth/custodial-leadership-runtime.js';
import {createCustodialLeadershipOpsSession} from '../src/auth/shared-access-auth.js';
const B=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const args=process.argv.slice(2);assert.deepEqual(args.slice(0,1),['--out']);assert.equal(args.length,2);
for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGPASSWORD','SCHEMA_REBUILD_ADMIN_URL','SCHEMA_REBUILD_DOCKER_CONTAINER'])assert.ok(!process.env[key],'Ambient target refused: '+key);
const manifestPath=resolve(B,'scripts/fixtures/sealed-repair/CANONICAL304_PLAN.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
assert.equal(manifest.schema,'custodial.sealed-repair.canonical304-plan.v1');
assert.equal(manifest.executionMode,'CANONICAL304_REPLAY_THEN_POSTFIX_WORKFLOWS');
assert.equal(manifest.constructor_migrations,304);assert.equal(manifest.proposals.length,12);
assert.equal(manifest.atomicBatch.id,'main_atomic_twelve');assert.equal(manifest.postAtomicCapture.id,'main_post_atomic_capture');
const refs=[manifest.freshCapture,manifest.atomicBatch,manifest.postAtomicCapture,...manifest.originals,...manifest.proposals,...manifest.regressions,...manifest.afterSignedSql,...manifest.modules,...manifest.protectedSources];
const frozen=new Map();
for(const r of refs){const p=resolve(B,r.path);assert.ok(p.startsWith(B+'/'));assert.equal(fs.realpathSync(p),p);assert.ok(fs.lstatSync(p).isFile());const bytes=fs.readFileSync(p);assert.equal(bytes.length,r.bytes);assert.equal(sha(bytes),r.sha256);frozen.set(p,bytes);}
for(const r of manifest.frontendSources||[]){const p=resolve(B,'release/sealed-repair-frontend-source',r.path);assert.ok(p.startsWith(resolve(B,'release/sealed-repair-frontend-source')+'/'));assert.equal(fs.realpathSync(p),p);const bytes=fs.readFileSync(p);assert.equal(sha(bytes),r.sha256);frozen.set(p,bytes);}
const unchanged=()=>{for(const [p,bytes]of frozen)assert.deepEqual(fs.readFileSync(p),bytes,'Frozen repair source changed: '+p);};
const loaded=[];for(const r of manifest.modules)loaded.push({ref:r,module:await import(pathToFileURL(resolve(B,r.path)))});
const freshCapture=await import(pathToFileURL(resolve(B,manifest.freshCapture.path)));
assert.equal(typeof freshCapture.run,'function');
assert.deepEqual(freshCapture.EXPECTED_CANONICAL_MIGRATION,{name:manifest.atomicBatch.migrationName,
 sha256:manifest.atomicBatch.sha256,bytes:manifest.atomicBatch.bytes});
const clean=bytes=>bytes.toString('utf8').replace(/^\\set ON_ERROR_STOP on\r?\n/,'');
// Explicit local disk storage; memory and swap remain the target 512 MiB.
// The default fixture profile remains historical tmpfs for all other callers.
assert.deepEqual(manifest.fixtureProfile,{dataStorage:'owned-disk',memoryBytes:536870912,memorySwapBytes:536870912});
let observedFixture=null;let resourceSequence=0;
const observeResources=async(stage,{requireNoOom=false}={})=>{
 const fixture=observedFixture;assert.ok(fixture);await fixture.assertOwned();
 const command=(args)=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:15000,maxBuffer:131072});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const observed=JSON.parse(command(['inspect','--format','{{json .}}',fixture.container]));
 assert.equal(observed.Id,fixture.container);assert.equal(observed.Config.Labels['custodial.owner'],fixture.receipt.owner);
 assert.equal(observed.HostConfig.Memory,536870912);assert.equal(observed.HostConfig.MemorySwap,536870912);
 const read=name=>command(['exec',fixture.container,'cat','/sys/fs/cgroup/'+name]);
 const keyValues=raw=>Object.fromEntries(raw.split('\n').map(line=>{const [key,value]=line.trim().split(/\s+/);assert.match(value,/^\d+$/);return [key,Number(value)];}));
 const snapshot={stage,at:new Date().toISOString(),container:fixture.container,
  memoryCurrent:Number(read('memory.current')),memoryPeak:Number(read('memory.peak')),memoryMax:Number(read('memory.max')),
  memoryStat:keyValues(read('memory.stat')),memoryEvents:keyValues(read('memory.events')),
  dataKiB:Number(command(['exec',fixture.container,'du','-sk','/var/lib/postgresql/data']).split(/\s+/)[0]),
  mounts:observed.Mounts,tmpfs:observed.HostConfig.Tmpfs,memorySwap:observed.HostConfig.MemorySwap,
  interpretation:'Whole fixture cgroup peak includes PostgreSQL, shared memory, and charged file cache; local isolated evidence, not hosted equivalence'};
 assert.equal(snapshot.memoryMax,536870912);assert.ok(Number.isFinite(snapshot.memoryPeak)&&snapshot.memoryPeak<=536870912);
 fs.writeFileSync(resolve(args[1],'RESOURCE_'+String(++resourceSequence).padStart(2,'0')+'_'+stage+'.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
 assert.ok(snapshot.dataKiB<=1048576,'Owned test data exceeds its 1 GiB monitored budget');
 if(requireNoOom){assert.equal(snapshot.memoryEvents.oom_kill,0,'A local backend was OOM-killed');assert.equal(snapshot.memoryEvents.oom,0,'Memory cgroup reported OOM');}
 return snapshot;
};
let freshConstructionCapture=null;
const saveConstruction=(name,value)=>{
 assert.match(name,/^[A-Za-z0-9_.-]+$/);
 const fd=fs.openSync(resolve(args[1],name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
};
const constructFixture=async options=>{
 const fixture=await createCiFreshOnlyFixture({...options,dataStorage:'owned-disk'});observedFixture=fixture;
 const originalCleanup=fixture.cleanup;let capturePool=null,poolEndAttempted=false,poolEndReturned=false;
 try{
  assert.equal(fixture.receipt.selected_replay.migrations,304);
  assert.equal(fixture.receipt.selected_replay.source_successor.appended_migration,manifest.atomicBatch.migrationName);
  saveConstruction('CANONICAL304_ORIGINAL_CONSTRUCTION_RECEIPT.json',fixture.receipt);
  await observeResources('constructed');
  capturePool=new pg.Pool({host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',max:1,connectionTimeoutMillis:5000});
  capturePool.on('error',()=>{});
  freshConstructionCapture=await freshCapture.run({fixture,pool:capturePool,save:saveConstruction,sourceCurrent:unchanged,assertFrozen:unchanged});
  assert.equal(freshConstructionCapture.status,'PASS');assert.equal(freshConstructionCapture.actualFresh304,true);
  saveConstruction('CANONICAL304_FRESH_CAPTURE_RETURNED.json',freshConstructionCapture);
  poolEndAttempted=true;await capturePool.end();poolEndReturned=true;capturePool=null;
 }catch(error){
  let closeError=null,cleanupError=null;
  if(capturePool){if(poolEndAttempted&&!poolEndReturned)closeError=error;else try{poolEndAttempted=true;await capturePool.end();poolEndReturned=true;capturePool=null;}catch(e){closeError=e;}}
  // Constructor has already returned with its exact closed child and committed
  // source fingerprint. Only read-only capture ran; no manager operation began.
  if(!closeError)try{await originalCleanup();}catch(e){cleanupError=e;}
  saveConstruction('CANONICAL304_PRE_INITIAL_FAILURE_CLEANUP.json',{message:error.message,readOnlyCaptureOnly:true,closeError:closeError?.message??null,cleanupError:cleanupError?.message??null,originalOwnedCleanupReturned:!closeError&&!cleanupError});
  if(closeError||cleanupError)throw new AggregateError([error,closeError,cleanupError].filter(Boolean),'Canonical constructor capture/custody unresolved; no retry');
  throw error;
 }
 return {...fixture,cleanup:async()=>{await observeResources('before_cleanup',{requireNoOom:true});return originalCleanup();}};
};
const afterInitial=async context=>{
 await observeResources('initial_activation');
 const {fixture,pool,save,sourceCurrent}=context;const results=[];
 const profileSql=`select jsonb_build_object('server_version',current_setting('server_version'),'server_version_num',current_setting('server_version_num'),'session_user',session_user,'current_user',current_user,'settings',(select jsonb_object_agg(n,current_setting(n,true)) from unnest(array['jit','work_mem','maintenance_work_mem','shared_buffers','max_connections','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','temp_file_limit','search_path']) n),'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),'relevant_roles',(select jsonb_agg(jsonb_build_object('name',rolname,'can_login',rolcanlogin,'bypass_rls',rolbypassrls,'superuser',rolsuper) order by rolname) from pg_roles where rolname in ('anon','authenticated','service_role','postgres','supabase_admin','static_weekly_control_plane','static_weekly_release_operator'))) as profile`;
 const localProfiles={};for(const role of ['supabase_admin','static_weekly_control_plane'])localProfiles[role]=await context.tx(role,async c=>(await c.query(profileSql)).rows[0].profile);
 save('LOCAL_DATABASE_TARGET_COMPARISON_INPUT.json',{hostedOwnerReceiptSha256:'a42bde5d3934d628fe43be6deb881ba44ae3670c8996b250dea70b8cc37b696e',profiles:localProfiles,scope:'Synthetic fixture and SET LOCAL role; hosted Render login settings and exact hosted equivalence remain unverified'});
 for(const profile of Object.values(localProfiles)){assert.equal(profile.server_version_num,'170006');assert.equal(profile.settings.jit,'off');assert.equal(profile.settings.shared_buffers,'224MB');assert.equal(profile.settings.work_mem,'2184kB');}

 const runSql=async(ref,stage)=>{
  unchanged();sourceCurrent();await fixture.assertOwned();
  const sql=clean(frozen.get(resolve(B,ref.path)));const c=await pool.connect();
  const tag='REPAIR_'+stage+'_'+ref.id;save(tag+'_BEFORE.json',{ref,stage});
  try{const out=await c.query(sql);const rows=(Array.isArray(out)?out:[out]).map(r=>({command:r.command,rowCount:r.rowCount,rows:r.rows}));save(tag+'_RETURNED.json',rows);results.push({id:ref.id,stage,status:'RETURNED',sha256:ref.sha256});return rows;}
  catch(e){
   // Independent rollback fixtures may be checked together only after an actual
   // ROLLBACK acknowledgement. A lost connection or uncertain rollback stops.
   let rollbackError=null;e.rollbackConfirmed=false;
   try{e.rollbackConfirmed=(await c.query('rollback')).command==='ROLLBACK';}catch(r){rollbackError={code:r.code,message:r.message};}
   save(tag+'_ERROR.json',{code:e.code,message:e.message,where:e.where,rollbackConfirmed:e.rollbackConfirmed,rollbackError});throw e;
  }
  finally{c.release();}
 };
 assert.equal(freshConstructionCapture?.status,'PASS');assert.equal(freshConstructionCapture.actualFresh304,true);
 save('CANONICAL304_SQL_REPLAY_OWNERSHIP.json',{constructorMigrations:304,exactAppend:freshCapture.EXPECTED_CANONICAL_MIGRATION,proposalReinstallCount:0,atomicReplayByRunner:0,historicalPrefixedDemonstrationsSkipped:manifest.originals.map(r=>r.id),frozenComponentCount:manifest.proposals.length,allPostfixRegressionsAndSignedModulesRetained:true});
 results.push({id:manifest.freshCapture.id,stage:'ACTUAL_FRESH304_READ_ONLY_CAPTURE',...freshConstructionCapture});
 const regressionFailures=[];
 for(const ref of manifest.regressions){
  try{await runSql(ref,'REGRESSION');}
  catch(error){if(error.rollbackConfirmed!==true)throw error;regressionFailures.push({ref,error});}
 }
 save('REPAIR_REGRESSION_SUMMARY.json',{status:regressionFailures.length?'FAIL':'PASS',
  failures:regressionFailures.map(({ref,error})=>({id:ref.id,sha256:ref.sha256,code:error.code,message:error.message,rollbackConfirmed:true}))});
 // Never enter the dependent signed/module flow after any failed regression.
 if(regressionFailures.length)throw regressionFailures[0].error;
 // One explicit committed synthetic cohort/scan fixture for real signed routes
 // and concurrency. The entire original owned container is destroyed afterward.
 const setup=manifest.protectedSources.find(x=>x.id==='signed_setup');assert.ok(setup);await runSql(setup,'SIGNED_SETUP');
 for(const ref of manifest.afterSignedSql)await runSql(ref,'SIGNED_REGRESSION');
 const registration='c7200000-0000-4000-8000-000000000002';
 const raw=(await pool.query('select custodial_leadership_private.session_view($1::uuid) as session',[registration])).rows[0].session;assert.ok(raw);
 const env={NODE_ENV:'test',OPS_MANAGER_SESSION_SECRET:randomBytes(32).toString('hex'),CUSTODIAL_LEADERSHIP_PIN_PEPPER:randomBytes(32).toString('hex'),CUSTODIAL_LEADERSHIP_PIN_ENABLED:'true',CUSTODIAL_LEADERSHIP_ALLOWED_ORIGINS:'https://repair.example.invalid',STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL:'https://companion.example.invalid'};
 const expected={role:'ops_manager',access_level:'full_access',roles:['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],claimed_manager_id:raw.claimedAccount.accountId,claimed_manager_display_name:raw.claimedAccount.displayName,identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,manager_id:raw.cohort.principalId,credential_id:raw.registrationId,device_id:raw.browserId,manager_display_name:'Custodial leadership cohort',permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:raw.cohort.policyVersion},auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',read_only:false,owner:false,custodial_management_admin:true};
 const manager=createCustodialLeadershipOpsSession({expectedClaims:expected,credentialExpiresAt:raw.credentialExpiresAt,registrationLifetime:raw.registrationLifetime,env});
 const cp=createCustodialLeadershipControlPlane({env,database:pool});
 const cohort={manager,verifyTransaction:cp.verifyTransaction,service:cp.service,env,router:cp.router,csrf:createHmac('sha256',env.CUSTODIAL_LEADERSHIP_PIN_PEPPER).update('leadership-csrf-v1\0'+raw.csrfBinding).digest('hex')};
 save('REPAIR_SYNTHETIC_COHORT_IDENTITY.json',{manager_id:manager.manager_id,credential_id:manager.credential_id,device_id:manager.device_id,claimed_manager_id:manager.claimed_manager_id,identity_assurance:manager.identity_assurance,registrationLifetime:raw.registrationLifetime,syntheticOnly:true,secretsRetained:false});
 for(const {ref,module}of loaded){unchanged();sourceCurrent();await fixture.assertOwned();
  const name=ref.export||'run';assert.ok(['run','runSchedulingRepairDatabaseExtension'].includes(name));assert.equal(typeof module[name],'function',ref.path);
  const externalSourceRefs=(manifest.frontendSources||[]).map(r=>({path:resolve(B,'release/sealed-repair-frontend-source',r.path),sha256:r.sha256,bytes:r.bytes}));
  const answer=await module[name]({...context,cohort,assertFrozen:unchanged,externalSourceRefs});save('REPAIR_MODULE_'+ref.id+'_RESULT.json',answer);await observeResources('module_'+ref.id);assert.equal(answer.status,'PASS');results.push({id:ref.id,stage:'MODULE',...answer});}
 await observeResources('all_extensions',{requireNoOom:true});unchanged();sourceCurrent();return {status:'PASS',scope:'OWNED_CANONICAL304_FRESH_SOURCE_ACTIVATION_AND_FULL_WORKFLOWS_NOT_RELEASE_ACCEPTANCE',results,phoneAcceptance:false,production:false};
};
const extensionSources=[manifestPath,fileURLToPath(import.meta.url),...new Set(refs.map(r=>resolve(B,r.path)))];
const result=await runApprovedManualActivationDatabaseTest({out:resolve(args[1]),constructFixture,constructorMigrationCount:304,afterInitial,extensionSources});
if(result.status!=='PASS'||result.repairExtension?.status!=='PASS'){if(observedFixture)try{await observeResources('failed_original');}catch(error){fs.writeFileSync(resolve(args[1],'RESOURCE_OBSERVATION_ERROR.json'),JSON.stringify({message:error.message})+'\n');}process.exitCode=1;}
