import {assertTargetCapturePendingPlan} from './release-migration-target-capture.mjs';
import {resolveReleaseSchemaTarget} from './production-target-schema-profile.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {assertCapturedTargetCatalog,assertReleaseWorkflowSource} from './release-migration-workflow-preflight.mjs';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
import {resolveReleaseMigrationSource} from './production-forward-source.mjs';
const root=resolve(new URL('..',import.meta.url).pathname);
const state=JSON.parse(readFileSync(resolve(root,'release/production-migration-state.json')));
const binding=JSON.parse(readFileSync(resolve(root,'release/current291-staged-source-binding.json')));
const plan=readMigrationReplayPlan(root);const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const sha=b=>createHash('sha256').update(b).digest('hex');
if([298,299].includes(plan.files.length)){
 const successor=plan.files.length===299,pendingCount=successor?165:164,targetCount=235+pendingCount;
 const canonical=successor?'95ad1f4e76159d18c5ccdb7c84fb639918005f05155b152641f79c15919f082d':'432052a95830b4a8550cd6478d766bacc2bbbb4b2dd21d44544b238c70c5f001';
 const physical=successor?'09a3374c452a81cd0a8904273d9212444de3ba41be01bf4d07fd887a21f4d0c6':'b57982c0c739632fcbfc9ba30177fccab05a5847ce44121408b5ddab8d169d33';
 check('current source preserves exact134 source and complete predecessor before its exact tail',()=>{
  assert.equal(plan.baseCount,134);assert.equal(state.pending_migrations.length,pendingCount);
  assert.deepEqual(state.pending_migrations.map(x=>x.file),plan.files.slice(134));
  assert.equal(plan.manifestSha256,successor?'965300d634959010c017ac203d71fe915f65b4b42e69910b173b96d034c38001':'aca06e305ff4c5918e83045acf4d739fcb8746e41dcc89ceb59fcd0f98ab20ba');
  assert.equal(binding.preserved134.length,134);
  for(const row of binding.preserved134)assert.equal(sha(readFileSync(resolve(root,'supabase/migrations',row.file))),row.sha256);
  assertTargetCapturePendingPlan(state.pending_migrations,state.pending_migrations.slice(0,pendingCount-1));
 });
 check('all executed source hashes retain the exact existing29 owner-profile variants',()=>{
  assert.equal(state.pending_migrations.filter(x=>x.forward_source).length,29);
  for(const [index,item]of state.pending_migrations.entries()){
   assert.equal(item.order,index+1);assert.equal(item.source_migration_version,item.file.slice(0,14));
   assert.equal(sha(resolveReleaseMigrationSource(root,item).sql),item.sha256);
  }
 });
 check('physical target profile binds the actual rollback report without release admission',()=>{
  const target=resolveReleaseSchemaTarget(root),capture=state.target.normal_source_capture,proof=target.profile.capture;
  assert.equal(target.canonicalFingerprint,canonical);
  assert.equal(target.deploymentFingerprint,physical);
  assert.equal(proof.source_ledger_count,235);assert.equal(proof.pending_count,pendingCount);assert.equal(proof.target_ledger_count,targetCount);
  assert.equal(proof.report_sha256,successor?'7fded7c546d4c6d879df233f8059cbf4752433c2d9b403641730d6886452593a':'dafa8d869004fa047ec7a191b040d22503bef8001a4200a44123c860fba5ec94');
  assert.equal(proof.report_bytes,successor?18585920:18580457);
  assert.equal(capture.original_run_id,successor?41003969617:40965791466);
  assert.equal(capture.report.sha256,proof.report_sha256);assert.equal(capture.report.bytes,proof.report_bytes);
  for(const key of ['candidate_commit','candidate_tree','plan_sha256'])assert.equal(capture[key],proof[key]);
  assert.equal(capture.archive_digest,target.profile.archive_digest);
  assert.equal(capture.rollback_evidence.rollback_verified,true);assert.equal(capture.rollback_evidence.committed,false);
  for(const key of ['candidate_migration_admission','runtime_admission','production_authorized','full_rehearsal_attestation'])assert.equal(capture[key],false);
  assert.equal(state.target.production_ledger_version,null);
  const checked=assertReleaseWorkflowSource(root);
  assert.equal(checked.sourceCount,235);assert.equal(checked.pendingCount,pendingCount);assert.equal(checked.targetCount,targetCount);
  assert.equal(checked.targetHead,successor?'20261030031200':'20261028224728');assert.equal(checked.targetFingerprint,target.deploymentFingerprint);
 });
 check('normal apply still preflights before clients and retains serializable rollback',()=>{
  const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
  assert.ok(source.indexOf('if (!targetCapture) assertReleaseWorkflowSource(root);')<source.indexOf('new Client('));
  assert.ok(source.includes('await db.query("begin isolation level serializable")'));
  assert.ok(source.includes('await db.query("rollback")')||source.includes("await db.query('rollback')"));
 });
 console.log(JSON.stringify({status:'PASS_SOURCE_ONLY_NO_DB',checks,source_count:plan.files.length,pending_count:pendingCount,target_ledger_count:targetCount,SQL_execution:false,production_authorized:false,historical297_and294_corpora:'PRESERVED_NOT_REATTRIBUTED_TO_CURRENT298'}));
}else if(plan.files.length===297){
 // The historical294 corpus below remains literal. This branch qualifies the
 // actual three-tail successor without attributing its source checks to SQL.
 check('current297 retains exact134 prefix and original160 plus three tails',()=>{
  assert.equal(plan.baseCount,134);assert.equal(state.pending_migrations.length,163);
  assert.deepEqual(state.pending_migrations.map(x=>x.file),plan.files.slice(134));
  assert.deepEqual(state.pending_migrations.slice(0,160),state.historical_294_160_target_preparation.pending_migrations);
  assert.equal(binding.preserved134.length,134);
  for(const x of binding.preserved134)assert.equal(sha(readFileSync(resolve(root,'supabase/migrations',x.file))),x.sha256);
 });
 check('every selected source version order and hash resolves normally',()=>{
  assert.equal(state.pending_migrations.filter(x=>x.forward_source).length,29);
  for(const [i,x]of state.pending_migrations.entries()){
   assert.equal(x.order,i+1);assert.equal(x.source_migration_version,x.file.slice(0,14));
   assert.equal(sha(resolveReleaseMigrationSource(root,x).sql),x.sha256);
  }
  const tails=[
   ['20261027230000_accepted_actual_lunch_windows.sql','55b2cd92ebe36c6920a3c27cc13031ef6ca263d8f10114182c3058fd0991c81b'],
   ['20261027231000_canonical_coverall_capacity_links.sql','c4be89a07f46717ddcc7ceebed639cdc10b589b8ff72e9cf20a3523bdec43903'],
   ['20261027234814_mcp_oauth_durable_token_families.sql','e74210f033e5c65d5e99a090ca201d1c010d6cb5c4159a015bb08e3719c44f6e'],
  ];
  assert.deepEqual(plan.files.slice(-3),tails.map(x=>x[0]));
  for(const [name,digest]of tails)assert.equal(sha(readFileSync(resolve(root,'supabase/migrations',name))),digest);
 });
 check('current physical398 profile binds the genuine reviewed rollback capture',()=>{
  const target=resolveReleaseSchemaTarget(root),capture=state.target.normal_source_capture,proof=target.profile.capture;
  assert.equal(target.canonicalFingerprint,'a54f3660584b15a3129f7a448ba12cd43b572c3ede6ca64a23cbceb8b37f2187');
  assert.equal(target.deploymentFingerprint,'6ee1d9e694bef75bfdfd07e7426d864e3c3b7cb2e1603fdcb1bd6bebf7fc0d0a');
  assert.equal(proof.source_ledger_count,235);assert.equal(proof.pending_count,163);assert.equal(proof.target_ledger_count,398);
  assert.equal(proof.report_sha256,'8042bc5e3a1bd141442fddb2b52b532b9eb67bdec6d0588bc5b87d951920a37e');
  assert.equal(proof.report_bytes,18533770);
  assert.equal(capture.report.sha256,proof.report_sha256);assert.equal(capture.report.bytes,proof.report_bytes);
  for(const key of ['candidate_commit','candidate_tree','plan_sha256'])assert.equal(capture[key],proof[key]);
  assert.equal(capture.archive_digest,target.profile.archive_digest);
  assert.equal(capture.scope,'ROLLBACK_ONLY_TARGET_PREPARATION_DATA_NOT_PRODUCTION_OR_FULL_REHEARSAL');
  assert.equal(capture.rollback_evidence.rollback_verified,true);
  for(const key of ['candidate_migration_admission','runtime_admission','production_authorized'])assert.equal(capture[key],false);
  assert.equal(state.target.production_ledger_version,null,'rollback evidence is not production application');
  assert.equal(state.target.source_authority_migration_count,297);assert.equal(state.target.pending_migration_count,163);
  assert.equal(state.target.production_ledger_count,398);assert.equal(state.target.source_migration_version,'20261027234814');
  assert.equal(state.target.canonical_source_schema_fingerprint,target.deploymentFingerprint);
  assert.deepEqual(state.target.expected_catalog_counts,target.deploymentCounts);
  const checked=assertReleaseWorkflowSource(root);
  assert.equal(checked.sourceCount,235);assert.equal(checked.pendingCount,163);assert.equal(checked.targetCount,398);
  assert.equal(checked.targetFingerprint,target.deploymentFingerprint);
 });
 check('normal apply still preflights before clients and retains serializable rollback',()=>{
  const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
  assert.ok(source.indexOf('if (!targetCapture) assertReleaseWorkflowSource(root);')<source.indexOf('new Client('));
  assert.ok(source.includes('await db.query("begin isolation level serializable")'));
  assert.ok(source.includes('await db.query("rollback")')||source.includes("await db.query('rollback')"));
 });
 console.log(JSON.stringify({status:'PASS_SOURCE_ONLY_NO_DB',checks,source_count:297,pending_count:163,target_ledger_count:398,SQL_execution:false,production_authorized:false,historical294_corpus:'NOT_RUN_CURRENT297_BRANCH'}));
}else{
check('exact134 base and160 current pending members',()=>{
 assert.equal(plan.baseCount,134);assert.equal(plan.files.length,294);
 assert.equal(state.pending_migrations.length,160);
 assert.deepEqual(state.pending_migrations.map(x=>x.file),plan.files.slice(134));
});
check('every original applied-prefix byte remains exact',()=>{
 assert.equal(binding.preserved134.length,134);
 for(const x of binding.preserved134)assert.equal(sha(readFileSync(resolve(root,'supabase/migrations',x.file))),x.sha256);
});
check('all160 source versions/order/hash resolve, only29 explicit existing-owner variants',()=>{
 assert.equal(state.pending_migrations.filter(x=>x.forward_source).length,29);
 for(const [i,x]of state.pending_migrations.entries()){
  assert.equal(x.order,i+1);assert.equal(x.source_migration_version,x.file.slice(0,14));
  const actual=resolveReleaseMigrationSource(root,x);assert.equal(sha(actual.sql),x.sha256);
  if(x.forward_source)assert.equal(actual.forward_profile,'existing-postgres-owner');
 }
});

check('order156 exact existing qualified ALWAYS image preserves every other canonical byte',()=>{
 const item=state.pending_migrations[155];assert.equal(item.order,156);assert.equal(item.file,'20261022041249_original_schedule_delivery_outcome.sql');
 const canonical=readFileSync(resolve(root,'supabase/migrations',item.file),'utf8');
 assert.equal(sha(canonical),'4d201d542066718e58932199db06b358e19e947f60de72a0c1ca8097a79ff71a');
 const old='alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;';
 assert.equal(canonical.split(old).length,2);
 const selected=resolveReleaseMigrationSource(root,item);assert.equal(selected.canonical_sha256,sha(canonical));
 assert.equal(selected.sql,canonical.replace(old,old.replace('enable trigger','enable always trigger')));
 assert.equal(sha(selected.sql),'ee140104c1f3f9c523f345e1a9295fb0be490e2c15a221b815353f8a63c75ef1');
 assert.equal(selected.sql,readFileSync(resolve(root,'release/fresh-only-replay/images',item.file),'utf8'));
 assert.equal(item.forward_source.profile,'existing-postgres-owner');assert.equal(item.forward_source.file,'release/production-forward-source/'+item.file);
 assert.equal(item.sha256,sha(selected.sql));assert.notEqual(item.sha256,sha(canonical));
 for(const bad of [{...item,forward_source:undefined},{...item,sha256:'0'.repeat(64)},
  {...item,forward_source:{...item.forward_source,profile:'arbitrary-owner'}},
  {...item,forward_source:{...item.forward_source,canonical_sha256:'0'.repeat(64)}},
  {...item,forward_source:{...item.forward_source,sha256:'0'.repeat(64)}},
  {...item,forward_source:{...item.forward_source,file:'release/fresh-only-replay/images/'+item.file}}])assert.throws(()=>resolveReleaseMigrationSource(root,bad));
 const successor=readFileSync(resolve(root,'supabase/migrations/20261022071830_recurring_normal_notification_plan.sql'),'utf8');
 assert.ok(successor.includes("if (select tgenabled from v27_inventory_guard_before)='A' then"));
 assert.ok(successor.includes("is distinct from (select tgenabled from v27_inventory_guard_before)"));
 const guard=resolveReleaseMigrationSource(root,state.pending_migrations[157]).sql;
 assert.ok(guard.includes('custodial_release_authority_restore_inventory)<>7312'));
 assert.ok(guard.includes("tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A'"));
});

check('order158 authentic production before and strict canonical after derivation',()=>{
 const item=state.pending_migrations[157];assert.equal(item.order,158);assert.equal(item.file,'20261025094420_authority_identity_renderer_counterparts.sql');
 const original=readFileSync(resolve(root,'supabase/migrations',item.file),'utf8');assert.equal(sha(original),'19e55cfdc9f1ddfd34c2912892ac23979ad5fc44a45da7e444a008b1da0a8c9b');
 const marker='$EXACT_SOURCE291_CANARY_PREIMAGE$';const before=original.split(marker);assert.equal(before.length,3);assert.equal(sha(before[1]),'6df9122356e7efbfce635c423fdbca00f419ef4eafbedc8b4fb9e5a0550a39e7');
 const selected=resolveReleaseMigrationSource(root,item);assert.equal(selected.canonical_sha256,sha(original));assert.equal(sha(selected.sql),'0e7b14e1e6ec1b60cab5a4d00f97491a4ae0fd8386c68d9b3c49b84f50c5ddd0');
 const actualParts=selected.sql.split(marker);assert.equal(actualParts.length,3);const observed=actualParts[1];assert.equal(sha(observed),'9bf59d727808a52c67a3f9be5223b3f0996219af738ddc8421125e7391540027');
 const observedBlock="\n    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n\n    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n",canonicalBlock="    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n\n    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n\n",anchor="    ('function','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),\n";
 const normalize=s=>{assert.equal(sha(s),sha(observed));assert.equal(s.split(observedBlock).length,2);assert.equal(s.split(anchor).length,2);const out=s.replace(observedBlock,'').replace(anchor,canonicalBlock+anchor);assert.equal(sha(out),sha(before[1]));return out;};
 assert.equal(normalize(observed),before[1]);
 for(const bad of [before[1],observed.replace('custodial_authorize_coverage_operations_v2','tampered_coverage'),observed+observedBlock,observed.replace(anchor,''),observed.replace('RETURNS TABLE','RETURNS SETOF')])assert.throws(()=>normalize(bad));
 const normalizer="-- Exact production predecessor has only this reviewed 18-row/20-line VALUES permutation.\n -- Authenticate before_text above; canonicalize only the fixed block before the original 53 identity changes.\n IF (length(before_text)-length(replace(before_text,$OBSERVED_EXACT20_LINE_BLOCK$\n    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n\n    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n$OBSERVED_EXACT20_LINE_BLOCK$,'')))/length($OBSERVED_EXACT20_LINE_BLOCK$\n    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n\n    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n$OBSERVED_EXACT20_LINE_BLOCK$)<>1\n  OR (length(before_text)-length(replace(before_text,$EXACT_NATIVE_ALERT_ANCHOR$    ('function','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),\n$EXACT_NATIVE_ALERT_ANCHOR$,'')))/length($EXACT_NATIVE_ALERT_ANCHOR$    ('function','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),\n$EXACT_NATIVE_ALERT_ANCHOR$)<>1 THEN\n  RAISE EXCEPTION 'exact production canary block permutation differs'; END IF;\n after_text:=replace(before_text,$OBSERVED_EXACT20_LINE_BLOCK$\n    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n\n    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n$OBSERVED_EXACT20_LINE_BLOCK$,'');\n after_text:=replace(after_text,$EXACT_NATIVE_ALERT_ANCHOR$    ('function','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),\n$EXACT_NATIVE_ALERT_ANCHOR$,$CANONICAL_EXACT20_LINE_BLOCK$    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),\n\n    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),\n    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),\n\n$CANONICAL_EXACT20_LINE_BLOCK$||$EXACT_NATIVE_ALERT_ANCHOR$    ('function','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),\n$EXACT_NATIVE_ALERT_ANCHOR$);\n IF encode(extensions.digest(convert_to(after_text,'UTF8'),'sha256'),'hex')<>'6df9122356e7efbfce635c423fdbca00f419ef4eafbedc8b4fb9e5a0550a39e7' THEN\n  RAISE EXCEPTION 'exact canonical canary ordering derivation differs'; END IF;";const actor="IF session_user<>'supabase_admin' OR current_user<>session_user OR current_setting('session_replication_role')<>'origin' THEN";
 assert.equal(original.split(actor).length,2);assert.equal(original.split('after_text:=before_text;').length,2);
 assert.equal(selected.sql,original.replace(actor,actor.replace("'supabase_admin'","'postgres'")).replace(marker+before[1]+marker,marker+observed+marker).replace('after_text:=before_text;',normalizer));
 let post=normalize(observed);const relations=[...original.split('INSERT INTO identity_fix_relations VALUES\n')[1].split(';\n')[0].matchAll(/\('([a-z0-9_]+)'\)/g)].map(x=>x[1]);assert.equal(relations.length,53);
 for(const rel of relations.sort()){const old="('trigger','"+rel+".custodial_recurring_notification_plan_source_fence','",next="('trigger','public."+rel+".custodial_recurring_notification_plan_source_fence','";assert.equal(post.split(old).length,2);assert.ok(!post.includes(next));post=post.replace(old,next);}
 const catalog=JSON.parse(readFileSync(resolve(root,'supabase/canonical/schema-fingerprint-input.json')));assert.equal(post,catalog.functions.find(x=>x.function_name==='custodial_release_canary_authority_surface').definition);
 for(const file of ['20261025124437_manager_completion_evidence_opaque_session_domain.sql','20261026065000_location_scan_state_qualified_lookup.sql'])assert.ok(!readFileSync(resolve(root,'supabase/migrations',file),'utf8').includes('custodial_release_canary_authority_surface'));
 assert.equal(item.forward_source.profile,'existing-postgres-owner');assert.equal(item.forward_source.file,'release/production-forward-source/'+item.file);assert.equal(item.sha256,sha(selected.sql));
 for(const bad of [{...item,forward_source:undefined},{...item,sha256:'0'.repeat(64)},{...item,forward_source:{...item.forward_source,profile:'arbitrary-owner'}},{...item,forward_source:{...item.forward_source,canonical_sha256:'0'.repeat(64)}},{...item,forward_source:{...item.forward_source,sha256:'0'.repeat(64)}}])assert.throws(()=>resolveReleaseMigrationSource(root,bad));
});

check('original118 canonical preimages retained',()=>{
 for(const [i,x]of binding.historical118.entries()){
  const n=state.pending_migrations[i];assert.equal(n.file,x.file);
  assert.equal(n.forward_source?.canonical_sha256||n.sha256,x.sha256);
 }
});
check('C10 fresh-only map is comparison context, no fresh SQL imported',()=>{
 assert.equal(state.source_binding.current291_preparation.fresh_SQL_overrides_copied_to_production,false);
 assert.ok(state.pending_migrations.every(x=>!x.forward_source||x.forward_source.profile==='existing-postgres-owner'));
});
check('genuinely captured adopted160 target passes complete normal source preflight',()=>{
 const actualFacts={"report":{"path":"/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/manager-access/ACTUAL_NEXT_REVIEWED_TARGET_CAPTURE_40360756054_READONLY/snapshot-1793032895669079386/private-artifact-members/production-migration-target-capture.json","sha256":"946dd61971aba8f6976b5dd463909a7808b8fba697991c9513477f325e9b1dc0","bytes":18450496},"candidate_commit":"e93a29c738efb4fffd1c4caaf85f534a71a76993","candidate_tree":"b4612003372064c6640bbdb4d6cc3aa22943bd69","archive_digest":"5a72377ae70ff1a632c3d38df52a104f5f134332a87b41fc99473e42ff2a008d","plan_sha256":"c4b55a4a78abe5e7ed8d41e9e4dee9fc515bcf6a970794ea45dd0f12b71b7051","source_catalog_fingerprint":"0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2","target_catalog_fingerprint":"f67580f03992120abd4086a9b53af98b05c29469eb140013221384df57bdd160","source_ledger_count":235,"pending_count":160,"target_ledger_count":395,"target_ledger_head":"20261026065000","catalog_counts":{"extensions":8,"types":0,"sequences":0,"tables":274,"columns":2997,"constraints":1884,"indexes":917,"functions":963,"views":33,"triggers":608,"policies":50,"owned_scheduler_roles":3,"owned_scheduler_role_memberships":3,"privilege_bearing_roles":4,"role_memberships":25,"table_grants":1531,"column_grants":43,"sequence_grants":0,"routine_grants":587,"type_grants":0,"schema_grants":11,"default_privileges":12,"cron_jobs":9,"recovery_schema_owners":1},"public_function_count":963,"canonical_fingerprint":"91eb02974fd180586869fb3d4b905da7e9bded0ac518d83b6ee03a570cd1f944","profile_sha256":"a8e092cdff4528449f04e7f249f98f578aa313038cc99bc1b5a5a1645fc6f17a"};
 const schemaTarget=resolveReleaseSchemaTarget(root);
 const adoptedCapture={"scope":"ROLLBACK_ONLY_TARGET_PREPARATION_DATA_NOT_PRODUCTION_OR_FULL_REHEARSAL","report":{"path":"/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/manager-access/ACTUAL_NEXT_REVIEWED_TARGET_CAPTURE_40360756054_READONLY/snapshot-1793032895669079386/private-artifact-members/production-migration-target-capture.json","sha256":"946dd61971aba8f6976b5dd463909a7808b8fba697991c9513477f325e9b1dc0","bytes":18450496},"original_run":{"path":"/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/manager-access/ACTUAL_NEXT_REVIEWED_TARGET_CAPTURE_40360756054_READONLY/RESULT.json","sha256":"f867164e82110a2f82267d86c12a0b131363938ed029f16f9a03cae52cf3e6f9","bytes":14615},"Root_full_readback":{"path":"/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-first-test-renewed-hour-20261025T022330Z/ROOT_ACTUAL40360756054_160_UPGRADE_SUCCESS_CLOSED_PROFILE_ADOPTED_20261026.json","sha256":"9d15bb892b6fc8cd37d8096390749b552a95bb2f0fc1599a98cdb15671a97bb6","bytes":4292},"cleanup_disposition":"HOSTED_BEST_EFFORT_TRAP_ONLY","cleanup_receipt":null,"rollback_evidence":{"kind":"SOURCE_BOUND_PRODUCER_REPORT_ROLLBACK_VERIFIED_WITH_ORIGINAL_READBACK","report":{"path":"/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/manager-access/ACTUAL_NEXT_REVIEWED_TARGET_CAPTURE_40360756054_READONLY/snapshot-1793032895669079386/private-artifact-members/production-migration-target-capture.json","sha256":"946dd61971aba8f6976b5dd463909a7808b8fba697991c9513477f325e9b1dc0","bytes":18450496},"original_catalog_export":null,"original_ledger_export":null},"candidate_commit":"e93a29c738efb4fffd1c4caaf85f534a71a76993","candidate_tree":"b4612003372064c6640bbdb4d6cc3aa22943bd69","archive_digest":"5a72377ae70ff1a632c3d38df52a104f5f134332a87b41fc99473e42ff2a008d","plan_sha256":"c4b55a4a78abe5e7ed8d41e9e4dee9fc515bcf6a970794ea45dd0f12b71b7051"};
 assert.equal(schemaTarget.canonicalFingerprint,actualFacts.canonical_fingerprint);
 assert.equal(schemaTarget.deploymentFingerprint,actualFacts.target_catalog_fingerprint);
 assert.equal(schemaTarget.profileSha256,actualFacts.profile_sha256);
 assert.deepEqual(schemaTarget.deploymentCounts,actualFacts.catalog_counts);
 assert.equal(schemaTarget.profile.capture.report_sha256,actualFacts.report.sha256);
 assert.equal(schemaTarget.profile.capture.report_bytes,actualFacts.report.bytes);
 assert.equal(schemaTarget.profile.capture.candidate_commit,actualFacts.candidate_commit);
 assert.equal(schemaTarget.profile.capture.candidate_tree,actualFacts.candidate_tree);
 assert.equal(schemaTarget.profile.capture.plan_sha256,actualFacts.plan_sha256);
 assert.deepEqual(state.target.normal_source_capture,adoptedCapture);
 assert.deepEqual(state.target.normal_source_capture.report,actualFacts.report);
 assert.match(actualFacts.report.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(actualFacts.report.bytes)&&actualFacts.report.bytes>0);
 assert.equal(state.observed_production.production_ledger_count,235);assert.equal(state.pending_migrations.length,160);
 assert.equal(state.target.production_ledger_count,235+160);assert.equal(state.target.production_ledger_count,actualFacts.target_ledger_count);
 assert.equal(state.target.source_authority_migration_count,294);assert.equal(state.target.pending_migration_count,160);
 assert.equal(state.target.source_migration_version,actualFacts.target_ledger_head);
 assert.equal(state.target.canonical_source_schema_fingerprint,actualFacts.target_catalog_fingerprint);
 assert.deepEqual(state.target.expected_catalog_counts,actualFacts.catalog_counts);
 assert.equal(state.target.public_function_count,actualFacts.public_function_count);
 assert.equal(state.observed_production.catalog_privilege_fingerprint,actualFacts.source_catalog_fingerprint);
 const checked=assertReleaseWorkflowSource(root);
 assert.deepEqual(checked,{sourceCount:235,sourceHead:state.observed_production.ledger_head,targetCount:395,targetHead:actualFacts.target_ledger_head,pendingCount:160,targetFingerprint:actualFacts.target_catalog_fingerprint});
});

// UNIT shape witnesses only: accepting a structural object is not a catalog,
// expected fingerprint, populated rehearsal, signed authorization or DB proof.
const unit={canonical_source_schema_fingerprint:'a'.repeat(64),expected_catalog_counts:{functions:1},production_ledger_count:1,public_function_count:1};
check('existing target structural prerequisite accepts fully typed UNIT only',()=>assert.doesNotThrow(()=>assertCapturedTargetCatalog(unit)));
for(const key of Object.keys(unit))check('missing target '+key+' refuses',()=>{const x={...unit};delete x[key];assert.throws(()=>assertCapturedTargetCatalog(x));});
check('original217-table proof stays mandatory at160, no155 bypass',()=>{
 const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
 assert.ok(source.includes('rehearsal&&plan.length===160'));
 assert.ok(!source.includes('rehearsal&&plan.length===155'));
 const m=JSON.parse(readFileSync(resolve(root,'release/production-data-preservation/original-235.json')));
 assert.equal(m.plan.length,160);assert.equal(m.tables.length,182);assert.equal(m.production_authorized,false);
 assert.deepEqual(m.plan.map(x=>x.file),state.pending_migrations.map(x=>x.file));
});
check('normal apply preflight is before any client/query; transaction rollback body retained',()=>{
 const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
 assert.ok(source.indexOf('if (!targetCapture) assertReleaseWorkflowSource(root);')<source.indexOf('new Client('));
 assert.ok(source.includes('await db.query("begin isolation level serializable")'));
 assert.ok(source.includes('await db.query("rollback")')||source.includes("await db.query('rollback')"));
});
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY_NO_DB',checks,SQL_execution:false,production_authorized:false,target_facts_adopted:false}));
}
