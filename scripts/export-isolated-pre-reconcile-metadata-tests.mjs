import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDiagnostic,CATEGORY_TABLES,READONLY_SQL} from './export-isolated-pre-reconcile-metadata.mjs';
const checks=[];const check=(name,fn)=>{fn();checks.push(name)};const clone=x=>JSON.parse(JSON.stringify(x));const hash='a'.repeat(64);const rid='11111111-1111-4111-8111-111111111111';
function fixture(){
 const native={state:'MATCH',tables:217,original_text_multiset:true},storage={status:'MATCH',tables:8,original_text_multiset:true,scope:'POST_AUTHORITY_SAME_ORIGINAL_NATIVE_SQL',object_provider_verified:false};
 const invalidated={employee_credentials:1,employee_enrollment:4,manager_credentials:12,manager_enrollment:0,manager_push:0,auth_sessions:0};
 const restore={ok:true,database_only:true,restore_id:rid,authority_generation:1,database_tables:217,database_rows:80324,state:'PAUSED_RECONCILIATION',mutations_paused:true,resume_eligible:false,final_manifest_sha256:hash,unresolved_discrepancies:9,database_evidence:{native_text_readback:native},storage:{database_only_metadata_verified:true,exact_table_data:storage},authority_invalidated:invalidated};
 const summary={format:'memphis-zoo-disaster-recovery.v4',project_ref:'rqquvtjdmugpigbndmne',table_count:217,database_row_count:80324,storage_bucket_count:3,storage_object_count:1,source_identity:{migration_ledger_count:235,migration_head:'20261021111917',migration_ledger_sha256:hash}};
 const profile={database_name:'mz_schema_rebuild_12345',actor:'supabase_admin',session_actor:'supabase_admin',read_only:'on',cron_active:'off'};
 const control={restore_id:rid,authority_generation:'1',archive_digest:hash,source_project_ref:summary.project_ref,target_project_ref:summary.project_ref,state:'PAUSED_RECONCILIATION',mutations_paused:true};
 const manifest={restore_id:rid,authority_generation:'1',database_verified:true,storage_verified:true,authority_invalidated:true,post_restore_verified:true,final_manifest_sha256:hash,native_text_import:native,database_tables:'217',database_rows:'80324',storage_sql:storage,storage_metadata_verified:'true',authority_invalidations:invalidated};
 const snapshots=Object.keys(CATEGORY_TABLES).sort().map(category=>({category,row_count:'0',snapshot_sha256:hash,missing:'false',fields:['id'],data_encoding:'SYNTHETIC_METADATA_ONLY'}));
 const discrepancies=Object.keys(CATEGORY_TABLES).sort().slice(0,9).map(category=>({category,status:'OPEN',before_count:'0',restored_count:'1',before_sha256:hash,restored_sha256:'b'.repeat(64),pre_restore_missing:'false',restored_missing:'false',pre_restore_fields:['id'],restored_fields:['id'],data_encoding:'SYNTHETIC_METADATA_ONLY',evidence_truncated:'false'}));
 return {summary,archiveDigest:hash,restore,profile,control,manifest,discrepancyCount:'9',discrepancies,snapshots,leases:{total:'0',active:'0',expired:'0'},runId:'12345'};
}
check('positive metadata export remains HOLD, with no resolve/unpause/capture credit',()=>{const d=validateDiagnostic(fixture());assert.equal(d.state,'HOLD_ROOT_DISPOSITION_BEFORE_ANY_RESOLVE_OR_UNPAUSE');assert.equal(d.resolve_performed,false);assert.equal(d.unpause_performed,false);assert.equal(d.target_capture_performed,false);assert.equal(d.Root_disposition,null);assert.equal(d.proof_scope.all217_post_authority_byte_equality,false)});
for(const [name,edit]of [
 ['historical restore selection',f=>{f.restore.restore_id='04ab307a-b7c3-4325-8732-16097743cff4'}],
 ['production database path',f=>{f.profile.database_name='postgres'}],
 ['wrong original actor',f=>{f.profile.session_actor='postgres'}],
 ['writable transaction',f=>{f.profile.read_only='off'}],
 ['active cron',f=>{f.profile.cron_active='on'}],
 ['different archive digest',f=>{f.control.archive_digest='c'.repeat(64)}],
 ['different generation',f=>{f.control.authority_generation='2'}],
 ['already unpaused control',f=>{f.control.mutations_paused=false}],
 ['wrong final manifest',f=>{f.manifest.final_manifest_sha256='c'.repeat(64)}],
 ['missing native TEXT proof',f=>{f.restore.database_evidence.native_text_readback.state='MISMATCH'}],
 ['private nested storage payload',f=>{f.restore.storage.exact_table_data.raw_private_rows=['NOT_REAL']}],
 ['private nested authority payload',f=>{f.restore.authority_invalidated.raw_private_rows=['NOT_REAL']}],
 ['partial217 census',f=>{f.summary.table_count=216}],
 ['storage SQL mismatch',f=>{f.restore.storage.exact_table_data.status='MISMATCH'}],
 ['incomplete restore verification',f=>{f.manifest.post_restore_verified=false}],
 ['discrepancy truncation',f=>{f.discrepancies.pop()}],
 ['missing snapshot category',f=>{f.snapshots.pop()}],
 ['private payload field',f=>{f.discrepancies[0].raw_private_rows=['NOT_REAL']}],
 ['duplicate category',f=>{f.discrepancies[1].category=f.discrepancies[0].category}],
 ['invalid hash',f=>{f.discrepancies[0].before_sha256='not-hash'}],
 ['active lease',f=>{f.leases.active='1'}],
 ['expired lease',f=>{f.leases.expired='1'}]
])check(name+' refuses',()=>{const f=fixture();edit(f);assert.throws(()=>validateDiagnostic(f))});
check('unexpected category is exported honestly and never authorized',()=>{const f=fixture();f.discrepancies[0].category='unexpected_storage_state';const d=validateDiagnostic(f);assert.deepEqual(d.unknown_categories,['unexpected_storage_state']);assert.equal(d.Root_disposition,null);assert.equal(d.resolve_performed,false)});
check('all fixed DB payload queries are read-only SELECT metadata',()=>{for(const q of Object.values(READONLY_SQL)){assert.match(q,/^select /);assert.doesNotMatch(q,/\b(?:update|insert|delete|alter|drop|call)\b/i);assert.doesNotMatch(q,/pre_restore_identities|restored_identities|state_json\s*->\s*'rows'/i)}});
check('workflow diagnostic occurs before original reconcile, with defensive HOLD',()=>{const s=readFileSync(new URL('../.github/workflows/production-backup-migration-rehearsal.yml',import.meta.url),'utf8');assert.ok(s.indexOf('node scripts/export-isolated-pre-reconcile-metadata.mjs')<s.indexOf('npm run --silent restore:reconcile-isolated'));assert.match(s,/exit 78 # Defensive/);assert.ok(s.includes('${{ runner.temp }}/target-capture-pre-reconcile-discrepancies.json'))});
console.log(JSON.stringify({status:'PASS_SYNTHETIC_PURE_METADATA_POLICY_ONLY',count:checks.length,checks,actual9categories_inferred:false,SQL_executed:false,archive_opened:false,resolve_or_unpause:false}));
