// Read-only current source recovery diagnostic. Never a historical receipt,
// canonical adoption, restoration, release approval, or container owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {consumeCurrentCandidateSqlFixture} from './current-candidate-sql-ci-fixture.mjs';

const NEW_FUNCTIONS = [
 ['custodial_leadership_private','assert_scoped_cohort_actor_v1'],
 ['custodial_leadership_private','completion_evidence_v1'],
 ['custodial_leadership_private','custodial_place_bridge_confirm_cohort_v1'],
 ['custodial_leadership_private','custodial_place_bridge_preview_cohort_v1'],
 ['custodial_leadership_private','custodial_place_command_cohort_v1'],
 ['custodial_leadership_private','custodial_place_preview_cohort_v1'],
 ['custodial_leadership_private','custodial_place_source_confirm_cohort_v1'],
 ['custodial_leadership_private','custodial_place_source_preview_cohort_v1'],
 ['custodial_leadership_private','feedback_operation_v1'],
 ['custodial_leadership_private','feedback_request_collision_v1'],
 ['custodial_leadership_private','place_operation_v1'],
 ['custodial_leadership_private','place_source_apply_cohort_v1'],
 ['custodial_leadership_private','unfinished_evidence_immutable_v1'],
 ['custodial_leadership_private','unfinished_work_operation_v1'],
 ['custodial_leadership_private','valid_feedback_cohort_identity_v1'],
 ['public','custodial_record_local_enrollment_retention_v1'],
 ['public','custodial_unfinished_work_recipient_v1'],
];
const CHANGED_FUNCTIONS = [
 ['custodial_leadership_private','record_operation_v1'],
 ['public','capture_system_feedback_email_intent'],
 ['public','custodial_claim_offline_reconciliation_notification_recipients'],
 ['public','custodial_leadership_record_operation_v1'],
 ['public','custodial_manager_completion_evidence'],
 ['public','custodial_v12_guard_protected_device'],
 ['public','device_auth_consume_enrollment_operation'],
 ['public','expire_stale_open_sessions'],
];
const NEW_TABLES = [
 'custodial_leadership_private.feedback_triage_receipts_v1',
 'custodial_leadership_private.unfinished_notices_v1',
 'custodial_leadership_private.unfinished_clears_v1',
 'custodial_employment.local_retained_enrollments_v1',
];
const CHANGED_TABLES = ['public.system_feedback_triage_receipts','public.custodial_offline_reconciliation_outbox'];
const LIVE = `CASE i.object_kind
 WHEN 'function' THEN pg_get_functiondef(to_regprocedure(i.object_identity))
 WHEN 'relation' THEN public.custodial_release_authority_current_relation_definition(i.object_identity)
 WHEN 'column' THEN public.custodial_release_authority_current_column_definition(i.object_identity)
 WHEN 'column_set' THEN public.custodial_release_authority_current_column_set_definition(i.object_identity)
 WHEN 'constraint' THEN public.custodial_release_authority_current_constraint_definition(i.object_identity)
 WHEN 'index' THEN public.custodial_release_authority_current_index_definition(i.object_identity)
 WHEN 'policy' THEN public.custodial_release_authority_current_policy_definition(i.object_identity)
 WHEN 'relation_state' THEN public.custodial_release_authority_current_relation_state_definition(i.object_identity)
 WHEN 'grant' THEN public.custodial_release_authority_current_grant_definition(i.object_identity)
 WHEN 'view' THEN public.custodial_release_authority_current_view_definition(i.object_identity)
 WHEN 'trigger' THEN (SELECT 'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '||CASE t.tgenabled WHEN 'O' THEN 'enable' WHEN 'D' THEN 'disable' WHEN 'R' THEN 'enable replica' WHEN 'A' THEN 'enable always' END||' trigger '||quote_ident(t.tgname)||';'
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname) AND NOT t.tgisinternal)
 END`;
const INVENTORY = `WITH rendered AS MATERIALIZED (SELECT i.object_kind,i.object_identity,i.restore_order,i.definition_sha256,
 public.static_weekly_digest_text(i.definition_sql) stored_sha256,${LIVE} live_sql
 FROM public.custodial_release_authority_restore_inventory i), compared AS MATERIALIZED (
 SELECT object_kind,object_identity,restore_order,definition_sha256,stored_sha256,
 public.static_weekly_digest_text(live_sql) live_sha256 FROM rendered)
 SELECT jsonb_build_object('count',(SELECT count(*) FROM compared),
 'predecessor_sha256',(SELECT public.static_weekly_digest_text(string_agg(restore_order::text||E'\\n'||object_kind||E'\\n'||object_identity||E'\\n'||definition_sha256||E'\\n'||stored_sha256,E'\\n---\\n' ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")) FROM compared),
 'mismatches',coalesce((
 SELECT jsonb_agg(to_jsonb(x) ORDER BY object_kind COLLATE "C",object_identity COLLATE "C") FROM compared x
 WHERE definition_sha256 IS DISTINCT FROM stored_sha256 OR definition_sha256 IS DISTINCT FROM live_sha256),'[]'::jsonb)) report`;
const FUNCTIONS = `WITH wanted AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(schema_name text,function_name text,origin text)),
 surface AS MATERIALIZED (SELECT * FROM public.custodial_release_canary_authority_surface())
 SELECT w.*,p.oid::text oid,p.oid::regprocedure::text identity,
 public.static_weekly_digest_text(pg_get_functiondef(p.oid)) live_sha256,
 (SELECT count(*)::int FROM public.custodial_release_authority_restore_inventory i WHERE CASE WHEN i.object_kind='function' THEN to_regprocedure(i.object_identity)=p.oid ELSE false END) function_inventory_count,
 (SELECT count(*)::int FROM public.custodial_release_authority_restore_inventory i WHERE CASE WHEN i.object_kind='grant' AND position('(' IN i.object_identity)>0 THEN to_regprocedure(i.object_identity)=p.oid ELSE false END) grant_inventory_count,
 (SELECT count(*)::int FROM surface s WHERE CASE WHEN s.object_kind='function' THEN to_regprocedure(s.object_identity)=p.oid ELSE false END) function_canary_count,
 (SELECT count(*)::int FROM surface s WHERE CASE WHEN s.object_kind='grant' AND position('(' IN s.object_identity)>0 THEN to_regprocedure(s.object_identity)=p.oid ELSE false END) grant_canary_count
 FROM wanted w LEFT JOIN pg_namespace n ON n.nspname=w.schema_name LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=w.function_name
 ORDER BY w.origin,w.schema_name,w.function_name,p.oid`;
const RELATIONS = `WITH wanted AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(identity text,origin text)),
 surface AS MATERIALIZED (SELECT * FROM public.custodial_release_canary_authority_surface())
 SELECT w.*,to_regclass(w.identity)::oid::text oid,
 (SELECT jsonb_object_agg(k.kind,jsonb_build_object(
  'inventory_count',(SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind=k.kind AND i.object_identity=w.identity),
  'canary_count',(SELECT count(*) FROM surface s WHERE s.object_kind=k.kind AND s.object_identity=w.identity)))
 FROM unnest(ARRAY['relation','column_set','relation_state','grant']) k(kind)) required_bindings,
 (SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=to_regclass(w.identity) AND NOT t.tgisinternal) triggers
 FROM wanted w ORDER BY w.origin,w.identity`;
const CANARY = `WITH surface AS MATERIALIZED (SELECT * FROM public.custodial_release_canary_authority_surface())
 SELECT jsonb_build_object('count',(SELECT count(*) FROM surface),'definition_sha256',public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),
 'uncovered',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',s.object_kind,'identity',s.object_identity) ORDER BY s.object_kind,s.object_identity) FROM surface s WHERE NOT EXISTS (
 SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind=s.object_kind AND CASE
 WHEN s.object_kind='function' THEN to_regprocedure(i.object_identity)=to_regprocedure(s.object_identity)
 WHEN s.object_kind='grant' AND position('(' IN s.object_identity)>0 THEN CASE WHEN position('(' IN i.object_identity)>0 THEN to_regprocedure(i.object_identity)=to_regprocedure(s.object_identity) ELSE false END
 ELSE i.object_identity=s.object_identity END)),'[]'::jsonb)) report`;

let fixture,pool,reportPath;
const report={schema:'custodial.current-source-recovery-baseline.v1',scope:'READ_ONLY_OWNED_CURRENT308_RECOVERY_BINDING_DIAGNOSTIC',status:'NOT_EXECUTED',production:false,release_admission:false,canonical_adoption:false,restoration_executed:false};
try {
 assert.deepEqual(process.argv.slice(2),[]);
 fixture=await consumeCurrentCandidateSqlFixture({name:'mz_schema_rebuild_current_recovery_'+process.pid});
 assert.equal(fixture.receipt.source_profile.migration_count,308);
 const descriptor=JSON.parse(fs.readFileSync(process.env.CUSTODIAL_CURRENT308_OWNED_CI_DESCRIPTOR,'utf8'));
 const output=path.join(descriptor.runtime,'ci-output');
 if(!fs.existsSync(output))fs.mkdirSync(output,{mode:0o700});
 const st=fs.lstatSync(output);assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid());assert.equal(fs.realpathSync(output),output);
 reportPath=path.join(output,'baseline-current308-recovery.json');assert.equal(fs.existsSync(reportPath),false,'Original baseline evidence must not be overwritten');
 report.source_profile=fixture.receipt.source_profile;report.descriptor_sha256=fixture.receipt.descriptor_sha256;
 pool=new pg.Pool({...fixture.pgClientConfig,database:'postgres',user:'supabase_admin',max:1,connectionTimeoutMillis:5000});pool.on('error',()=>{});
 await fixture.assertOwned();
 const client=await pool.connect();
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query('SET LOCAL search_path=pg_catalog,public');
  report.inventory=(await client.query(INVENTORY)).rows[0].report;
  report.canary=(await client.query(CANARY)).rows[0].report;
  const wanted=[...NEW_FUNCTIONS.map(([schema_name,function_name])=>({schema_name,function_name,origin:'new'})),...CHANGED_FUNCTIONS.map(([schema_name,function_name])=>({schema_name,function_name,origin:'changed'}))];
  report.functions=(await client.query(FUNCTIONS,[JSON.stringify(wanted)])).rows;
  report.relations=(await client.query(RELATIONS,[JSON.stringify([...NEW_TABLES.map(identity=>({identity,origin:'new'})),...CHANGED_TABLES.map(identity=>({identity,origin:'changed'}))])])).rows;
  report.guard=(await client.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass AND tgname='trg_custodial_release_authority_restore_inventory_immutable'")).rows;
  report.api_table_sequence_defaults=Number((await client.query("SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace IN(0,'public'::regnamespace) AND d.defaclobjtype IN('r','S') AND a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)")).rows[0].count);
  await client.query('ROLLBACK');report.read_only_snapshot_returned=true;
 } catch(error) {try{await client.query('ROLLBACK');report.rollback_confirmed=true;}catch{report.rollback_confirmed=false;}throw error;}
 finally {client.release();}
 assert.equal(report.functions.filter(x=>x.origin==='new').length,17);assert.equal(report.functions.filter(x=>x.origin==='changed').length,8);
 assert.ok(report.functions.every(x=>x.oid));assert.equal(report.relations.filter(x=>x.origin==='new').length,4);assert.ok(report.relations.every(x=>x.oid));
 assert.deepEqual(report.guard,[{tgenabled:'A'}]);assert.equal(report.api_table_sequence_defaults,0);
 report.function_binding_gaps=report.functions.filter(x=>!x.function_inventory_count||!x.grant_inventory_count||!x.function_canary_count||!x.grant_canary_count);
 report.relation_binding_gaps=report.relations.filter(x=>Object.values(x.required_bindings).some(v=>!v.inventory_count||!v.canary_count));
 report.status=report.inventory.mismatches.length||report.canary.uncovered.length||report.function_binding_gaps.length||report.relation_binding_gaps.length?'FAIL_CURRENT_RECOVERY_BINDINGS':'PASS_READ_ONLY_RECOVERY_BINDINGS_ONLY';
} catch(error) {report.status='ERROR_DIAGNOSTIC_INCOMPLETE';report.error={name:error.name,code:error.code||null,message:error.message};}
finally {
 if(pool)try{await pool.end();report.pool_closed=true;}catch{report.pool_closed=false;report.status='ERROR_POOL_CLOSE';}
 if(fixture)try{await fixture.cleanup();report.borrow_released=true;}catch{report.borrow_released=false;report.status='ERROR_BORROW_RELEASE';}
 report.parent_final_cleanup_required=true;
 if(reportPath)try{fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.status='ERROR_EVIDENCE_WRITE';}
 console.log(JSON.stringify({schema:report.schema,status:report.status,inventory_count:report.inventory?.count,mismatches:report.inventory?.mismatches.length,new_functions:report.functions?.filter(x=>x.origin==='new').length,new_tables:report.relations?.filter(x=>x.origin==='new').length,function_binding_gaps:report.function_binding_gaps?.length,relation_binding_gaps:report.relation_binding_gaps?.length,report:reportPath||null,borrow_released:report.borrow_released===true,production:false,release_admission:false}));
 if(report.status!=='PASS_READ_ONLY_RECOVERY_BINDINGS_ONLY')process.exitCode=1;
}
