import assert from 'node:assert/strict';
// Fixed Source152 metadata only. Never accepts an identity from a caller,
// applies a migration, changes a hash/ACL, or reads an operational table.
export const APPROVED_DATED_SOURCE_FILE="20261017225101_approved_static_dated_original_materialization.sql";
export const APPROVED_DATED_SOURCE_SHA256="2526dde3e55268da83ba43c8ce30c61c5f1a8c83df50aae85d557c517c383418";
export const APPROVED_DATED_FORWARD_SHA256="cee7ef97a7aef12f75de1d568e53ff0d987daa428b42f53fde25eb957d095f6f";
export const APPROVED_DATED_PREREQUISITES=Object.freeze([
  {
    "identity": "static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)",
    "public_identity": "public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)",
    "body_sha256": "37a13984afc1f4bb6ad00d1d9dcd5daa1909ab2c662a3a3dc288a45e2f7c8ae1",
    "definition_sha256": "b37945e14e5f804f4bbde542115bd017f8c7e64b909933658d8a23ec6979a9e9",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
    "public_identity": "public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
    "body_sha256": "c38d665aff22a47b0eee8158bc234973eba3bc098a188477c6467548a100c796",
    "definition_sha256": "9fe00673753e54ba9690d523e8229eb538402b640fd58df9e4a1e89e58443744",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "static_weekly_compiler_exception_set(uuid,date)",
    "public_identity": "public.static_weekly_compiler_exception_set(uuid,date)",
    "body_sha256": "53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529",
    "definition_sha256": "85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212",
    "function_only_registration": true,
    "fixed_grant_sha256": "5e045b2e87eeab69f63d6e165e816477b4d9b428dbf668ae381edbfbe8c995fb"
  },
  {
    "identity": "static_weekly_v8_assert_lunch_document(uuid,jsonb)",
    "public_identity": "public.static_weekly_v8_assert_lunch_document(uuid,jsonb)",
    "body_sha256": "4394b8c94dbfe298f673e0c593ebd0191d79ff01617b16e03d5fc0e4e361e1bf",
    "definition_sha256": "ccbd7327fbf7efef472379adddbd66d9270971a00af9309ede34d0258352226c",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "public.static_weekly_v9_assert_shift_end_derivation(jsonb)",
    "public_identity": "public.static_weekly_v9_assert_shift_end_derivation(jsonb)",
    "body_sha256": "4103a51da57475879011be2e7395b60fc805ba2a93f5576756e23915fc224b0d",
    "definition_sha256": "1bbd6764f54ffedbaf43a91ff9a40109f6e91ee98be33a18dc2558d62dfef758",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "public.static_weekly_v15_read_recurring_generation()",
    "public_identity": "public.static_weekly_v15_read_recurring_generation()",
    "body_sha256": "77ec0481e225b816f4bac470d4322f88a3e24a39476d9a41341f8ce696af0786",
    "definition_sha256": "4dd3deadb56d6ca78713b2b1a512c07dbde0500fcbc03bb3a8f4af07d9a1f39d",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "public.static_weekly_read_approved_template_basis(uuid, uuid, date, text, text, bigint)",
    "public_identity": "public.static_weekly_read_approved_template_basis(uuid, uuid, date, text, text, bigint)",
    "body_sha256": "4ab78a7a026e24b9bde6a3d107693c311d75176ebce8acfad6e775f67ec569ac",
    "definition_sha256": "6a49be1e7eff52461dceb8b466e515a58123eee94af65d84b09dc04c64e5bae0",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "public.static_weekly_v3_read_publication_source(uuid,date)",
    "public_identity": "public.static_weekly_v3_read_publication_source(uuid,date)",
    "body_sha256": "1396c1d79a712e91255503a570b6eb3d167ddf66ba6f8f2752c33bb5c2d5e617",
    "definition_sha256": "0dc40bf2dbc508c032d92a8c4b084e28f1aa30cdbcde0e27af2bf7b8659a1e55",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  },
  {
    "identity": "static_weekly_accepted_exception_set(uuid,date)",
    "public_identity": "public.static_weekly_accepted_exception_set(uuid,date)",
    "body_sha256": "9d05dcedabab2212f6abc73ccecf1a6ebd2f6f71fb56e482f2a03511e3c74290",
    "definition_sha256": "8ce1e49beaf770567bd3468be0b28aea370e5930ce2138e1597eb90668e348d7",
    "function_only_registration": true,
    "fixed_grant_sha256": "7e2fe1f75b7606def8d8b34dcf3fec480b7b07d8a5e5fde735198b7b454f24a0"
  },
  {
    "identity": "public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)",
    "public_identity": "public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)",
    "body_sha256": "47ff43db1f280d3c797b8c12d9a1a9f735c11c8354df431a061d9e636b040720",
    "definition_sha256": "9240febc892ece185741d7a441f372fc20801077ea45f3652b1cb13d26481855",
    "function_only_registration": false,
    "fixed_grant_sha256": null
  }
].map(row=>Object.freeze(row)));
export const APPROVED_DATED_NEW_TARGETS=Object.freeze([
  "public.static_weekly_approved_dated_assert_window(jsonb,text)",
  "public.static_weekly_approved_dated_effective_availability(jsonb,text,date,jsonb)",
  "public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)",
  "public.static_weekly_approved_dated_assert_closing(jsonb,jsonb,jsonb,jsonb,jsonb,date)",
  "public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)",
  "public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)",
  "public.static_weekly_approved_dated_materialize_projection(uuid,uuid,date,text,bigint,bigint,text,jsonb)",
  "public.static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)"
]);
const roles=Object.freeze(['postgres','anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']);
const MAX_DEFINITION_BYTES=1024*1024,MAX_TOTAL_BYTES=4*1024*1024;
export async function readApprovedDatedRefusal(db){
 const binding=(await db.query(`/* approved_dated152_binding */
  select w.identity,w.public_identity,p.oid::text public_oid,n.nspname schema_name,
   to_regprocedure(w.identity)::oid::text source_spelling_oid
  from jsonb_to_recordset($1::jsonb) as w(identity text,public_identity text)
  left join pg_proc p on p.oid=to_regprocedure(w.public_identity)
  left join pg_namespace n on n.oid=p.pronamespace
  order by w.identity collate pg_catalog."C"`,[JSON.stringify(APPROVED_DATED_PREREQUISITES)])).rows;
 if(binding.length!==10||new Set(binding.map(r=>r.public_oid)).size!==10||
  APPROVED_DATED_PREREQUISITES.some(w=>binding.filter(r=>r.identity===w.identity&&r.public_identity===w.public_identity&&r.schema_name==='public'&&/^[1-9][0-9]*$/.test(r.public_oid||'')&&r.source_spelling_oid===r.public_oid).length!==1))
  throw Object.assign(new Error('Fixed approved dated public dependency identities unavailable.'),{code:'FIXED_APPROVED_DATED_PUBLIC_BINDING_MISMATCH'});
 const bound=APPROVED_DATED_PREREQUISITES.map(w=>({...w,public_oid:binding.find(r=>r.identity===w.identity).public_oid}));
 const context=(await db.query(`/* approved_dated152_context */
  select current_user actor,session_user session_actor,
   (select pg_get_userbyid(relowner) from pg_class where oid='public.custodial_release_authority_restore_inventory'::regclass) inventory_owner,
   (select count(*)::text from unnest($1::text[]) identity where to_regprocedure(identity) is null) new_targets_absent,
   (select count(*)::text from public.custodial_release_authority_restore_inventory
    where definition_sha256 is distinct from public.static_weekly_digest_text(definition_sql)) inventory_selfhash_mismatches,
   (select count(*)::text from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A' and not tgisinternal) inventory_always_guard_count,
   (select md5(prosrc) from pg_proc where oid='public.custodial_release_authority_current_grant_definition(text)'::regprocedure) serializer_body_md5,
   (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.custodial_release_authority_current_grant_definition(text)'::regprocedure) serializer_definition_md5`,[APPROVED_DATED_NEW_TARGETS])).rows;
 assert.equal(context.length,1);
 const metadata=(await db.query(`/* approved_dated152_dependencies */
  with wanted as(select * from jsonb_to_recordset($1::jsonb) as w(identity text,public_identity text,public_oid oid,body_sha256 text,definition_sha256 text,function_only_registration boolean,fixed_grant_sha256 text)),
  inventory as(select object_kind,object_identity,definition_sql,definition_sha256 from public.custodial_release_authority_restore_inventory)
  select w.identity,w.public_identity,p.oid::text public_oid,p.oid::regprocedure::text signature,
   pg_get_userbyid(p.proowner)::text owner_name,p.proowner=current_user::regrole owner_matches_actor,
   p.prokind,p.prosecdef,p.provolatile,p.proconfig,p.proisstrict,p.proleakproof,p.proparallel,p.proretset,
   p.proargnames,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) return_type,l.lanname language,
   md5(p.prosrc) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,
   public.static_weekly_digest_text(p.prosrc) body_sha256,
   public.static_weekly_digest_text(pg_get_functiondef(p.oid)) definition_sha256,
   pg_get_functiondef(p.oid) definition_sql,p.proacl is null acl_is_null,
   (select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end,
     'grantor',pg_get_userbyid(a.grantor)::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
     order by (case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end) collate pg_catalog."C",
      pg_get_userbyid(a.grantor)::text collate pg_catalog."C",a.privilege_type collate pg_catalog."C",a.is_grantable),'[]'::jsonb)
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) named_acl,
   (select jsonb_agg(jsonb_build_object('role',r.name,'present',pr.oid is not null,'execute',case when pr.oid is not null then has_function_privilege(pr.oid,p.oid,'EXECUTE') end)
     order by r.name collate pg_catalog."C") from unnest($2::text[]) r(name) left join pg_roles pr on pr.rolname=r.name) effective_execute,
   public.custodial_release_authority_current_grant_definition(w.identity) current_grant_sql,
   public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(w.identity)) current_grant_sha256,
   (select count(*)::text from inventory i where i.object_kind='function' and i.object_identity like '%(%'
    and to_regprocedure(i.object_identity)=p.oid and i.definition_sql=pg_get_functiondef(p.oid)
    and i.definition_sha256=w.definition_sha256) exact_saved_function_count,
   (select count(*)::text from inventory i where i.object_kind='grant' and i.object_identity like '%(%'
    and to_regprocedure(i.object_identity)=p.oid) saved_grant_count,
   (select count(*)::text from inventory i where i.object_kind='grant' and i.object_identity like '%(%'
    and to_regprocedure(i.object_identity)=p.oid
    and i.definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity)) saved_grant_current_match_count,
   (select count(*)::text from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner and a.grantor<>p.proowner) unexpected_nonowner_grantor_count
  from wanted w join pg_proc p on p.oid=w.public_oid and p.pronamespace='public'::regnamespace
   join pg_language l on l.oid=p.prolang order by w.identity collate pg_catalog."C"`,[JSON.stringify(bound),roles])).rows;
 assert.equal(metadata.length,10);
 assert.ok(APPROVED_DATED_PREREQUISITES.every(w=>metadata.filter(r=>r.identity===w.identity&&r.public_identity===w.public_identity&&r.public_oid===binding.find(b=>b.identity===w.identity).public_oid).length===1));
 const aliases=(await db.query(`/* approved_dated152_inventory_aliases */
  select object_kind,object_identity,restore_order,definition_sql,definition_sha256,
   public.static_weekly_digest_text(definition_sql) actual_definition_sha256,
   to_regprocedure(object_identity)::oid::text public_oid
  from public.custodial_release_authority_restore_inventory
  where object_kind in('function','grant') and case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end=any($1::oid[])
  order by object_kind collate pg_catalog."C",object_identity collate pg_catalog."C",restore_order limit 41`,[bound.map(w=>w.public_oid)])).rows;
 assert.ok(aliases.length<=40,'Fixed approved dated aliases exceed metadata bound');
 assert.ok(aliases.every(row=>bound.some(w=>w.public_oid===row.public_oid)&&['function','grant'].includes(row.object_kind)));
 for(const row of [...metadata,...aliases])for(const key of ['definition_sql','current_grant_sql'])if(row[key]!=null)
  assert.ok(typeof row[key]==='string'&&Buffer.byteLength(row[key])<=MAX_DEFINITION_BYTES,'Fixed approved dated definition exceeds bound');
 assert.ok(Buffer.byteLength(JSON.stringify({binding,context,metadata,aliases}))<=MAX_TOTAL_BYTES,'Fixed approved dated metadata exceeds bound');
 const predicates=APPROVED_DATED_PREREQUISITES.map(w=>{
  const r=metadata.find(row=>row.identity===w.identity);
  const expected={owner_matches_actor:true,body_sha256:w.body_sha256,definition_sha256:w.definition_sha256,exact_saved_function_count:'1',
   ...(w.function_only_registration?{saved_grant_count:'0',current_grant_sha256:w.fixed_grant_sha256,unexpected_nonowner_grantor_count:'0'}:{saved_grant_current_match_count:'1'})};
  const observed=Object.fromEntries(Object.keys(expected).map(key=>[key,r[key]]));
  return {identity:w.identity,public_oid:r.public_oid,function_only_registration:w.function_only_registration,
   expected,observed,failed_boundary_predicates:Object.keys(expected).filter(key=>observed[key]!==expected[key])};
 });
 return {observed_state:'AFTER_FAILED_STEP_SAVEPOINT_ROLLBACK',actual_failing_predicate:'UNKNOWN',
  predicate_scope:'CANONICAL152_FIXED10_DEPENDENCY_REEVALUATION_AT_STEP_BOUNDARY_NOT_FAILED_DO_BLOCK_LOCALS',
  source_prerequisite_count:10,source_new_target_count:8,source_canonical_sha256:APPROVED_DATED_SOURCE_SHA256,
  source_executed_sha256:APPROVED_DATED_FORWARD_SHA256,binding,context:context[0],predicates,
  failed_boundary_predicates:predicates.flatMap(r=>r.failed_boundary_predicates.map(predicate=>({identity:r.identity,predicate}))),
  metadata,aliases,operational_rows_selected:false,unknown_identity_bodies_exported:false,
  production_authorized:false,candidate_migration_admission:false,runtime_admission:false,full_rehearsal_attestation:false};
}
