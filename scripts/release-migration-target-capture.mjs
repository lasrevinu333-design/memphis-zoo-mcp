import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {materializeVerifiedArchive,readVerifiedMigrationTargetCaptureSource} from './disaster-recovery-archive.mjs';
import {requireSigningKey,stableJson,stableJsonFileSha256} from './disaster-recovery-crypto.mjs';
import {bindBackupSchemaExtension,verifyArchivedSchemaExtension} from './backup-release-schema-binding.mjs';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
import {bindExistingPostgresForwardSources,releaseMigrationPlanIdentity} from './production-forward-source.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const counts=catalog=>Object.fromEntries(Object.entries(catalog).map(([key,rows])=>[key,rows.length]));
export function assertTargetCaptureBoundary({rehearsal,apply,databaseUrl,testFingerprint,testCounts,failAfterOrder}) {
 const url=new URL(databaseUrl);
 assert.equal(rehearsal,true);assert.equal(apply,true);
 assert.ok(['postgres:','postgresql:'].includes(url.protocol));
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&/^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(url.pathname));
 assert.equal(decodeURIComponent(url.username),'postgres','Exact existing production actor required');
 assert.ok(!testFingerprint&&!testCounts&&!failAfterOrder,'Capture does not accept fixture/source/plan overrides');
}
export function assertOwnedTargetMetadata({databaseUrl,runId,container,metadata,image}) {
 const url=new URL(databaseUrl);
 assert.match(String(runId),/^[1-9][0-9]*$/);
 assert.equal(container,'mz_schema_rebuild_'+runId);assert.equal(url.pathname,'/'+container);
 assert.match(metadata.id,/^[a-f0-9]{64}$/);assert.equal(metadata.running,true);
 const pin='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
 assert.equal(metadata.image_reference,pin);assert.match(image.id,/^sha256:[a-f0-9]{64}$/);
 assert.ok(Array.isArray(image.digests)&&image.digests.includes(pin));
 assert.equal(metadata.image,image.id,'Container must use the resolved pinned image, not a mutable tag');
 assert.equal(metadata.privileged,false);
 assert.deepEqual(metadata.ports,{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:url.port}]});
 assert.ok(Array.isArray(metadata.mounts)&&metadata.mounts.every(m=>m.Type==='tmpfs'),'No existing data volume may be loaned');
 return metadata;
}

export function assertTargetCapturePendingPlan(pending,declared) {
 if(pending.length===166){
  assert.ok(Array.isArray(declared)&&[160,163,164,165,166].includes(declared.length),'Exact predecessor or current compact confirmation declaration required');
  assertTargetCapturePendingPlan(pending.slice(0,165),declared.slice(0,165));
  assert.deepEqual(pending[165],{order:166,file:'20261030050235_compact_approved_initial_confirmation.sql',
   phase:'compact_approved_initial_confirmation',source_migration_version:'20261030050235',
   sha256:'fa9373adcf48f8d13db1b8e4876a5f134b02f8a897f20f887987cbd384393469'},
   'Only the exact compact confirmation and direct baseline delta may follow the intact165 plan');
  if(declared.length===166)assert.deepEqual(pending,declared,'Complete current declaration must match');
  return pending;
 }
 if(pending.length===165){
  assert.ok(Array.isArray(declared)&&[160,163,164,165].includes(declared.length),'Exact predecessor or current named-coverer declaration required');
  assertTargetCapturePendingPlan(pending.slice(0,164),declared.slice(0,164));
  assert.deepEqual(pending[164],{order:165,file:'20261030031200_approved_manual_full_hour_coverers.sql',
   phase:'approved_manual_full_hour_coverers',source_migration_version:'20261030031200',
   sha256:'de548422310c3369bac0560e14507e4022cc9d5b9effe898d4f24ae79156cf6a'},
   'Only the exact approved named-coverer delta may follow the intact164 plan');
  if(declared.length===165)assert.deepEqual(pending,declared,'Complete current declaration must match');
  return pending;
 }
 if(pending.length===164){
  assert.ok(Array.isArray(declared)&&[160,163,164].includes(declared.length),'Exact predecessor or current full-hour declaration required');
  assertTargetCapturePendingPlan(pending.slice(0,163),declared.slice(0,163));
  assert.deepEqual(pending[163],{order:164,file:'20261028224728_full_scheduled_lunch_source_policy.sql',
   phase:'full_scheduled_lunch_source_policy',source_migration_version:'20261028224728',
   sha256:'a47387ddf244a04df646c9bb2d60eef86a769b96baf9106759f1c2a703248514'},
   'Only the exact full-hour source delta may follow the intact163 plan');
  if(declared.length===164)assert.deepEqual(pending,declared,'Complete current declaration must match');
  return pending;
 }
 assert.equal(pending.length,163);
 assert.ok(Array.isArray(declared)&&[160,163].includes(declared.length),'Only exact historical160 or current163 declared plans are supported');
 assert.deepEqual(pending.slice(0,declared.length),declared,'Preserve the whole exact declared canonical/production-forward source plan');
 assert.deepEqual(pending.slice(160).map(({file,sha256,order})=>({file,sha256,order})),[
  {file:'20261027230000_accepted_actual_lunch_windows.sql',sha256:'55b2cd92ebe36c6920a3c27cc13031ef6ca263d8f10114182c3058fd0991c81b',order:161},
  {file:'20261027231000_canonical_coverall_capacity_links.sql',sha256:'c4be89a07f46717ddcc7ceebed639cdc10b589b8ff72e9cf20a3523bdec43903',order:162},
  {file:'20261027234814_mcp_oauth_durable_token_families.sql',sha256:'e74210f033e5c65d5e99a090ca201d1c010d6cb5c4159a015bb08e3719c44f6e',order:163},
 ],'Only the exact source-selected three additions can extend rollback-only target preparation');
 assert.equal(sha(stableJson(releaseMigrationPlanIdentity(pending))),
  'e022f25547c93d1e012dd500e0a02052d6eebf4aa14d227af8a2ac70f9056a7b',
  'Retain the complete established163 plan identity and executed owner-profile bytes');
 return pending;
}

export function targetCaptureState({backendRoot,state,source}) {
 const {summary}=source.sourceBinding;
 assert.equal(summary.format,'memphis-zoo-disaster-recovery.v4');
 assert.equal(summary.project_ref,state.project_ref);assert.ok(summary.database_row_count>0);
 verifyArchivedSchemaExtension({summary,...source});
 const declaration=JSON.parse(readFileSync(resolve(backendRoot,'release/target-capture-source/declaration.json')));
 const expected=bindBackupSchemaExtension({projectRef:summary.project_ref,releaseIdentity:summary.source_identity.release,
  migrationLedger:source.ledger,catalog:source.catalog,declaration,
  readSource:name=>readFileSync(resolve(backendRoot,name===declaration.extensions.at(-1).source_file
   ?'release/target-capture-source/'+name:'supabase/migrations/'+name))});
 const normalize=binding=>({...binding,extensions:binding.extensions.map(({source_location,...item})=>item)});
 assert.deepEqual(normalize(source.binding),expected,'Signed archive must match the finite observed235 source declaration');
 assert.equal(stableJsonFileSha256(source.ledger),summary.source_identity.migration_ledger_sha256);
 const replay=readMigrationReplayPlan(backendRoot);
 if(replay.files.length===300){
  assert.equal(replay.manifestSha256,'be9f1ce99e037690b3095c8b8e963fc30efd8c83adaa1e415856a79808dc31b1');
  const current=JSON.parse(readFileSync(resolve(backendRoot,'supabase/canonical/migration-replay-order.json')));
  assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,73]);
  assert.deepEqual(current.phases.at(-1).files.pop(),{name:'20261030050235_compact_approved_initial_confirmation.sql',
   sha256:'fa9373adcf48f8d13db1b8e4876a5f134b02f8a897f20f887987cbd384393469'});
  assert.equal(sha(JSON.stringify(current,null,2)+'\n'),'965300d634959010c017ac203d71fe915f65b4b42e69910b173b96d034c38001',
   'The complete exact299 predecessor must remain unchanged');
 }else if(replay.files.length===299){
  assert.equal(replay.manifestSha256,'965300d634959010c017ac203d71fe915f65b4b42e69910b173b96d034c38001');
  const current=JSON.parse(readFileSync(resolve(backendRoot,'supabase/canonical/migration-replay-order.json')));
  assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,72]);
  assert.deepEqual(current.phases.at(-1).files.pop(),{name:'20261030031200_approved_manual_full_hour_coverers.sql',
   sha256:'de548422310c3369bac0560e14507e4022cc9d5b9effe898d4f24ae79156cf6a'});
  assert.equal(sha(JSON.stringify(current,null,2)+'\n'),'aca06e305ff4c5918e83045acf4d739fcb8746e41dcc89ceb59fcd0f98ab20ba',
   'The complete exact298 predecessor must remain unchanged');
 }else if(replay.files.length===298){
  assert.equal(replay.manifestSha256,'aca06e305ff4c5918e83045acf4d739fcb8746e41dcc89ceb59fcd0f98ab20ba');
  const current=JSON.parse(readFileSync(resolve(backendRoot,'supabase/canonical/migration-replay-order.json')));
  assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,71]);
  assert.deepEqual(current.phases.at(-1).files.pop(),{name:'20261028224728_full_scheduled_lunch_source_policy.sql',
   sha256:'a47387ddf244a04df646c9bb2d60eef86a769b96baf9106759f1c2a703248514'});
  assert.equal(sha(JSON.stringify(current,null,2)+'\n'),'e37cf98ffde8165797069595b45d84fdaf89871a719c31a839905e9e6317d54c',
   'The complete exact297 predecessor must remain unchanged');
 }else{
  assert.equal(replay.files.length,297);
  assert.equal(replay.manifestSha256,'e37cf98ffde8165797069595b45d84fdaf89871a719c31a839905e9e6317d54c');
 }
 assert.equal(state.observed_production.source_authority_migration_count,134);
 const canonical=replay.files.slice(134).map((file,index)=>({order:index+1,file,phase:file.slice(15,-4),
  source_migration_version:file.slice(0,14),sha256:sha(readFileSync(resolve(backendRoot,'supabase/migrations',file)))}));
 assert.equal(canonical.length,replay.files.length-134);
 const pending=assertTargetCapturePendingPlan(bindExistingPostgresForwardSources(backendRoot,canonical),state.pending_migrations);
 assert.ok(pending.every(item=>!source.ledger.some(row=>row.version===item.source_migration_version)));
 return {...state,mode:'isolated_target_preparation_rollback_only',
  observed_production:{...state.observed_production,production_ledger_count:source.ledger.length,
   ledger_head:source.ledger.at(-1).version,source_migration_name:source.ledger.at(-1).name,
   catalog_privilege_fingerprint:source.binding.catalog_fingerprint,catalog_counts:counts(source.catalog)},
  target:{source_migration_version:pending.at(-1).source_migration_version,
   production_ledger_count:source.ledger.length+pending.length,pending_migration_count:pending.length},pending_migrations:pending};
}
export function prepareTargetCapture({backendRoot,state,databaseUrl,rehearsal,apply,candidateCommit,candidateTree,env}) {
 assertTargetCaptureBoundary({rehearsal,apply,databaseUrl,testFingerprint:env.RELEASE_MIGRATION_TEST_SOURCE_CATALOG_FINGERPRINT,
  testCounts:env.RELEASE_MIGRATION_TEST_SOURCE_CATALOG_COUNTS_JSON,failAfterOrder:env.RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER});
 assert.equal(env.GITHUB_ACTIONS,'true');
 const container=env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER;
 assert.equal(container,'mz_schema_rebuild_'+env.GITHUB_RUN_ID);
 const pin='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
 const image=JSON.parse(execFileSync('docker',['image','inspect','--format','{"id":{{json .Id}},"digests":{{json .RepoDigests}}}',pin],{encoding:'utf8'}));
 const raw=execFileSync('docker',['inspect','--format',
  '{"id":{{json .Id}},"image":{{json .Image}},"image_reference":{{json .Config.Image}},"running":{{json .State.Running}},"privileged":{{json .HostConfig.Privileged}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}',container],{encoding:'utf8'});
 const target=assertOwnedTargetMetadata({databaseUrl,runId:env.GITHUB_RUN_ID,container,metadata:JSON.parse(raw),image});
 const git=args=>execFileSync('git',args,{cwd:backendRoot,encoding:'utf8'}).trim();
 assert.equal(git(['rev-parse','HEAD']),candidateCommit);assert.equal(git(['rev-parse','HEAD^{tree}']),candidateTree);
 assert.equal(git(['status','--porcelain']),'');
 const archive=materializeVerifiedArchive({sourceDir:env.RESTORE_SOURCE_DIR,
  archiveVerifyKey:requireSigningKey(env.RESTORE_ARCHIVE_VERIFY_KEY,'RESTORE_ARCHIVE_VERIFY_KEY'),
  archiveVerifyKeyId:env.RESTORE_ARCHIVE_VERIFY_KEY_ID,supportedFormats:['memphis-zoo-disaster-recovery.v4'],
  requiredEntries:['inventory/source-schema-binding.json','inventory/source-catalog.json','inventory/migration-ledger.json']});
 try {
  const source=readVerifiedMigrationTargetCaptureSource(archive),binding=source.sourceBinding;
  git(['merge-base','--is-ancestor',binding.source_identity.backup_tool_commit,candidateCommit]);
  assert.equal(git(['rev-parse',binding.source_identity.backup_tool_commit+'^{tree}']),binding.source_identity.backup_tool_tree);
  const prepared=targetCaptureState({backendRoot,state,source});
  const output=resolve(env.RELEASE_MIGRATION_TARGET_CAPTURE_OUTPUT||'');
  assert.ok(env.RELEASE_MIGRATION_TARGET_CAPTURE_OUTPUT&&env.RUNNER_TEMP);
  assert.equal(output,resolve(env.RUNNER_TEMP,'production-migration-target-capture.json'));
  return {state:prepared,archive,source,output,target,assertSourceCurrent:()=>readVerifiedMigrationTargetCaptureSource(archive),
   plan_sha256:sha(stableJson(releaseMigrationPlanIdentity(prepared.pending_migrations))),
   archive_digest:binding.archive_digest,source_ledger_sha256:binding.source_identity.migration_ledger_sha256};
 }catch(error){archive.cleanup();throw error;}
}
export function writeTargetCapture(path,value) {
 assert.equal(value.scope,'target_preparation');assert.equal(value.committed,false);assert.equal(value.rollback_verified,true);
 writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
}
