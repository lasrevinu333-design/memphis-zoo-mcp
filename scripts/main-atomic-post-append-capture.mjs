// Main-owned read-only closure capture for the one frozen atomic batch.
// Caller must execute that batch exactly once and observe its COMMIT first.
// No constructor, alternate DB connection, cleanup, provider or admission here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureSchemaCatalog,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
export const EXPECTED_ATOMIC_BATCH=Object.freeze({name:'20261031225210_custodial_sealed_repairs_current_eight.sql',sha256:'f4e3dc5be9a465e2099bd9b23488f99b3f9e4c1d9d969844b2fa06b1fbdc7a73',bytes:211245});
const BASE_SUCCESSOR_SHA='d51728e9973dcfba729164bce441d45efff8cf10b59f3382ade56efbae515e27';
const TARGETS=[
  {
    "schema_name": "public",
    "function_name": "static_weekly_v10_stage_staffing_command"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_finish_manual_recurring_normal"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_materialize_manual_repeat"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_manual_repeat_components"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_manual_repeat_materialize_projection"
  },
  {
    "schema_name": "public",
    "function_name": "mz_event_reminder_schedule_candidate"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "bind_registration_generation"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "coverall_link_issuer"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "ensure_messaging_account"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "execute"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "messaging_account_active"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "notification_credential"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "record_operation_v1"
  },
  {
    "schema_name": "custodial_leadership_private",
    "function_name": "session_view"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_leadership_messaging_operation_v1"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_leadership_record_operation_v1"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_named_record_operation_v1"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_native_alert_finalize_at"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_native_alert_prepare_at"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_native_alert_utf8_prefix"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_ops_manager_message_push_is_current"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_ops_manager_notification_binding_is_current"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_ops_manager_notification_recipient_is_current"
  },
  {
    "schema_name": "public",
    "function_name": "custodial_release_canary_authority_surface"
  },
  {
    "schema_name": "public",
    "function_name": "evaluate_location_proximity_v2"
  },
  {
    "schema_name": "public",
    "function_name": "events_app_validate_scope_venue"
  },
  {
    "schema_name": "public",
    "function_name": "msg_broadcast_operation_v1"
  },
  {
    "schema_name": "public",
    "function_name": "msg_custodial_cohort_message_actor_v1"
  },
  {
    "schema_name": "public",
    "function_name": "msg_is_runtime_user"
  },
  {
    "schema_name": "public",
    "function_name": "mz_employee_event_push_current_projection"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_enqueue_lunch_delivery_failure"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_enqueue_message_push"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_enqueue_scheduled_notifications"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_finish_notification_job"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_notification_bind_credential"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_notification_job_is_current"
  },
  {
    "schema_name": "public",
    "function_name": "ops_manager_notification_validate_owner"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_assert_coverall_link_basis"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_issue_coverall_link"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_read_coverall_link"
  },
  {
    "schema_name": "public",
    "function_name": "static_weekly_revoke_coverall_link"
  }
];
const EXACT_POSTIMAGES={
  "static_weekly_finish_manual_recurring_normal": "57174a2b1ea56528099e3eae2aa8832f6f0c3cc3c32d4888bfb41363877c5165",
  "static_weekly_materialize_manual_repeat": "eaa30f710b32b9daf94b5f1150d7ce418a36d2b64d785c11221b1047eff00bb0",
  "static_weekly_manual_repeat_components": "6cf42446e79ace87729a88338109b82342a9f09c206cc079c0b18791ce579778",
  "static_weekly_manual_repeat_materialize_projection": "16db921f27ff1627ef42172f5290878500c6c4cc6c9b4f40fd74829e9fc7ac24",
  "static_weekly_v10_stage_staffing_command": "889455a6388f4365d87d04e238fef2169beb0417985916b42626eee976ac9b1c"
};
const sha=x=>createHash('sha256').update(x).digest('hex');
const SCOPE='SOURCE303_CONSTRUCTION_PLUS_SINGLE_ATOMIC_APPEND_AFTER_INITIAL_ACTIVATION_NOT_FRESH304';
const PROFILE_SQL=`select current_database() as database,session_user,current_user,
 pg_backend_pid() as backend_pid,current_setting('transaction_read_only') as transaction_read_only,
 current_setting('transaction_isolation') as transaction_isolation,
 (select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable') as immutable_mode`;
const FUNCTIONS_SQL=`select t.schema_name,t.function_name,p.oid::text as oid,
 p.oid::regprocedure::text as identity,pg_get_userbyid(p.proowner) as owner,
 coalesce(p.proacl::text,'<owner-default>') as acl,
 public.static_weekly_digest_text(pg_get_functiondef(p.oid)) as definition_sha256,
 (select coalesce(jsonb_agg(jsonb_build_object('identity',i.object_identity,
   'definition_matches',i.definition_sql is not distinct from pg_get_functiondef(p.oid),
   'recorded_digest_matches',i.definition_sha256 is not distinct from public.static_weekly_digest_text(pg_get_functiondef(p.oid)),
   'recorded_digest_valid',i.definition_sha256 is not distinct from public.static_weekly_digest_text(i.definition_sql),
   'root_count',(select count(*)::int from public.custodial_release_canary_authority_surface() s
    where s.object_kind='function' and s.object_identity=i.object_identity)) order by i.object_identity),'[]'::jsonb)
  from public.custodial_release_authority_restore_inventory i
  where case when i.object_kind='function' then to_regprocedure(i.object_identity)=p.oid else false end) as function_inventory,
 (select coalesce(jsonb_agg(jsonb_build_object('identity',i.object_identity,
   'definition_matches',i.definition_sql is not distinct from public.custodial_release_authority_current_grant_definition(i.object_identity),
   'recorded_digest_matches',i.definition_sha256 is not distinct from public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(i.object_identity)),
   'recorded_digest_valid',i.definition_sha256 is not distinct from public.static_weekly_digest_text(i.definition_sql),
   'root_count',(select count(*)::int from public.custodial_release_canary_authority_surface() s
    where s.object_kind='grant' and s.object_identity=i.object_identity)) order by i.object_identity),'[]'::jsonb)
  from public.custodial_release_authority_restore_inventory i
  where case when i.object_kind='grant' and position('(' in i.object_identity)>0 then to_regprocedure(i.object_identity)=p.oid else false end) as grant_inventory
 from jsonb_to_recordset($1::jsonb) t(schema_name text,function_name text)
 left join pg_namespace n on n.nspname=t.schema_name
 left join pg_proc p on p.pronamespace=n.oid and p.proname=t.function_name
 order by t.schema_name,t.function_name,p.oid`;
const RELATIONS_SQL=`select t.name,n.nspname as schema,c.relname,c.relrowsecurity,c.relforcerowsecurity,
 pg_get_userbyid(c.relowner) as owner,
 (select jsonb_agg(jsonb_build_object('role',r,
  'direct_table_access',has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'direct_column_access',has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) order by r)
  from unnest(array['anon','authenticated','service_role']) r) as api_privileges
 from unnest(array['msg_broadcast_request_receipts','ops_manager_notification_credentials']) t(name)
 left join pg_namespace n on n.nspname='public'
 left join pg_class c on c.relnamespace=n.oid and c.relname=t.name
 order by t.name`;
export async function run({fixture,pool,save,sourceCurrent,assertFrozen}){
 assert.equal(typeof save,'function');assert.equal(typeof sourceCurrent,'function');assert.equal(typeof assertFrozen,'function');
 sourceCurrent();assertFrozen();await fixture.assertOwned();
 assert.match(fixture.container,/^[a-f0-9]{64}$/);assert.match(fixture.name,/^mz_schema_rebuild_[A-Za-z0-9_]+$/);
 assert.equal(fixture.receipt.name,fixture.name);assert.equal(fixture.receipt.full_suite_PASS,false);
 assert.equal(fixture.receipt.selected_replay.migrations,303);assert.equal(fixture.receipt.no_auto_table_grants,false);
 assert.equal(fixture.receipt.selected_replay.source_successor.sha256,BASE_SUCCESSOR_SHA);
 assert.equal(fixture.receipt.data_storage,'owned-disk');
 assert.equal(pool.options.host,fixture.socketDirectory);assert.equal(pool.options.database,'postgres');assert.equal(pool.options.user,'supabase_admin');
 let client=null,open=false,rolledBack=false;const connectionErrors=[];
 const onError=e=>connectionErrors.push({code:e?.code??null,message:String(e?.message??'Connection lost').slice(0,300)});
 const beforeQuery=async()=>{sourceCurrent();assertFrozen();await fixture.assertOwned();assert.deepEqual(connectionErrors,[]);};
 try{
  client=await pool.connect();client.on('error',onError);
  await beforeQuery();assert.equal((await client.query('begin isolation level repeatable read read only')).command,'BEGIN');open=true;
  const profile=(await client.query(PROFILE_SQL)).rows[0];
  assert.equal(profile.database,'postgres');assert.equal(profile.session_user,'supabase_admin');assert.equal(profile.current_user,'supabase_admin');
  assert.equal(profile.transaction_read_only,'on');assert.equal(profile.transaction_isolation,'repeatable read');assert.equal(profile.immutable_mode,'A');
  save('MAIN_ATOMIC_POST_APPEND_READ_ONLY_PROFILE.json',{scope:SCOPE,expectedAtomicBatch:EXPECTED_ATOMIC_BATCH,profile});
  await beforeQuery();const functions=(await client.query(FUNCTIONS_SQL,[JSON.stringify(TARGETS)])).rows;
  assert.equal(functions.length,41);assert.equal(new Set(functions.map(f=>f.schema_name+'.'+f.function_name)).size,41);
  for(const f of functions){
   assert.ok(f.oid&&f.identity&&['postgres','supabase_admin'].includes(f.owner));assert.match(f.definition_sha256,/^[a-f0-9]{64}$/);
   if(EXACT_POSTIMAGES[f.function_name])assert.equal(f.definition_sha256,EXACT_POSTIMAGES[f.function_name]);
   for(const key of ['function_inventory','grant_inventory']){
    assert.ok(Array.isArray(f[key])&&f[key].length>0,'Every closed function/grant must be enrolled: '+f.identity);
    for(const i of f[key]){assert.equal(i.definition_matches,true);assert.equal(i.recorded_digest_matches,true);assert.equal(i.recorded_digest_valid,true);assert.ok(Number.isInteger(i.root_count)&&i.root_count>=1);}
   }
  }
  await beforeQuery();const relations=(await client.query(RELATIONS_SQL)).rows;assert.equal(relations.length,2);
  for(const r of relations){assert.equal(r.schema,'public');assert.equal(r.relname,r.name);assert.equal(r.relrowsecurity,true);if(r.name==='ops_manager_notification_credentials')assert.equal(r.relforcerowsecurity,true);assert.equal(r.api_privileges.length,3);for(const p of r.api_privileges){assert.equal(p.direct_table_access,false);assert.equal(p.direct_column_access,false);}}
  const raw=await captureSchemaCatalog({query:async(...args)=>{await beforeQuery();return client.query(...args);}});
  const captured=fingerprintSchemaCatalog(raw);assert.match(captured.fingerprint,/^[a-f0-9]{64}$/);assert.notEqual(captured.fingerprint,'8f9c8059f07dcebbba60f3ef143b8e7a58fe063a960d08b05dae0b4ef2e03d80');
  for(const f of functions){const rows=captured.normalized.functions.filter(r=>r.schema_name===f.schema_name&&r.function_name===f.function_name);assert.equal(rows.length,1);assert.equal(sha(rows[0].definition),f.definition_sha256);}
  await beforeQuery();const finalProfile=(await client.query(PROFILE_SQL)).rows[0];assert.deepEqual(finalProfile,profile);
  save('MAIN_ATOMIC_POST_APPEND_RAW_CATALOG.json',raw);save('MAIN_ATOMIC_POST_APPEND_NORMALIZED_CATALOG.json',captured.normalized);
  save('MAIN_ATOMIC_POST_APPEND_RECOVERY_BINDINGS.json',{scope:SCOPE,functions,relations});
  assert.equal((await client.query('rollback')).command,'ROLLBACK');open=false;rolledBack=true;
  sourceCurrent();assertFrozen();await fixture.assertOwned();assert.deepEqual(connectionErrors,[]);
  const result={status:'PASS',scope:SCOPE,expectedAtomicBatch:EXPECTED_ATOMIC_BATCH,baseConstructionMigrations:303,appliedAtomicAppendCount:1,
   fingerprint:captured.fingerprint,counts:Object.fromEntries(Object.entries(captured.normalized).map(([k,v])=>[k,v.length])),
   closedFunctionNames:41,allFunctionGrantInventoryDigestsAndRootsCurrent:true,newRpcOnlyPublicTablesDirectApiDenied:true,
   readOnlyRepeatableRead:true,readOnlyTransactionRolledBack:rolledBack,samePhysicalBackendPid:profile.backend_pid,
   artifacts:{raw:'MAIN_ATOMIC_POST_APPEND_RAW_CATALOG.json',normalized:'MAIN_ATOMIC_POST_APPEND_NORMALIZED_CATALOG.json',bindings:'MAIN_ATOMIC_POST_APPEND_RECOVERY_BINDINGS.json'},
   actualFresh304:false,fullVendorNormal:false,productionWritten:false,hostedEquivalence:false,wholeProgramAcceptance:false,providerCalls:0};
  save('MAIN_ATOMIC_POST_APPEND_CAPTURE_RESULT.json',result);return result;
 }catch(error){
  let rollbackError=null;if(client&&open)try{rolledBack=(await client.query('rollback')).command==='ROLLBACK';open=false;}catch(e){rollbackError={code:e?.code??null,message:String(e?.message??'Rollback unresolved').slice(0,300)};}
  save('MAIN_ATOMIC_POST_APPEND_CAPTURE_FAILURE.json',{scope:SCOPE,code:error?.code??null,message:String(error?.message??'Capture failed').slice(0,600),readOnlyTransactionRolledBack:rolledBack,rollbackError,connectionErrors,automaticReplay:false});throw error;
 }finally{if(client){client.removeListener('error',onError);client.release();}}
}
