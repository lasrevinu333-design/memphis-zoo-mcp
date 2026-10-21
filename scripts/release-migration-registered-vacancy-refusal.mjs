import assert from 'node:assert/strict';
// Fixed153 catalog metadata only; no caller identities or operational rows.
export const REGISTERED_VACANCY_SOURCE_FILE="20261018151858_registered_never_filled_vacancy_source_recovery.sql";
export const REGISTERED_VACANCY_SOURCE_SHA256="4127e4a9aa2cb0a5fab6f230040002af04fa3352ee54f231402e3ca05b7fe9ed";
export const REGISTERED_VACANCY_FORWARD_SHA256="77d98f51f2ddcd0c38f2674bd11ce43c63bfd409592d6e9e8c2386e65bb226fe";
export const REGISTERED_VACANCY_DEPENDENCIES=Object.freeze([
  {
    "identity": "custodial_reject_release_authority_inventory_mutation()",
    "explicit_identity": "public.custodial_reject_release_authority_inventory_mutation()",
    "schema_name": "public",
    "definition_sha256": "7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6",
    "body_sha256": "398375253665aa45da0a0d73329ae907605d83ac32b00702f34ce2b730dda80b"
  },
  {
    "identity": "custodial_release_canary_authority_surface()",
    "explicit_identity": "public.custodial_release_canary_authority_surface()",
    "schema_name": "public",
    "definition_sha256": "2c56bb3c751b6f1124dc8cd13117470dc16dd02d3b84939e88dab0a94bde93c5",
    "body_sha256": null
  },
  {
    "identity": "custodial_dr.guard_application_mutation()",
    "explicit_identity": "custodial_dr.guard_application_mutation()",
    "schema_name": "custodial_dr",
    "definition_sha256": null,
    "body_sha256": "aba484a103212b76c82f119ece6279c917fce4b0806e07381ef4fce527a9bc95"
  }
].map(Object.freeze));
const roles=Object.freeze(["postgres", "anon", "authenticated", "service_role", "custodial_application_reader", "static_weekly_control_plane", "static_weekly_release_operator", "static_weekly_runtime_20260823"]);
const MAX_DEFINITION_BYTES=1024*1024,MAX_TOTAL_BYTES=4*1024*1024;
export async function readRegisteredVacancyRefusal(db){
 const binding=(await db.query(`/* registered_vacancy153_binding */
  select w.identity,w.explicit_identity,p.oid::text fixed_oid,n.nspname schema_name,
   to_regprocedure(w.identity)::oid::text source_spelling_oid
  from jsonb_to_recordset($1::jsonb) as w(identity text,explicit_identity text,schema_name text)
  left join pg_proc p on p.oid=to_regprocedure(w.explicit_identity)
  left join pg_namespace n on n.oid=p.pronamespace
  order by w.identity collate pg_catalog."C"`,[JSON.stringify(REGISTERED_VACANCY_DEPENDENCIES)])).rows;
 if(binding.length!==3||new Set(binding.map(r=>r.fixed_oid)).size!==3||
  REGISTERED_VACANCY_DEPENDENCIES.some(w=>binding.filter(r=>r.identity===w.identity&&r.explicit_identity===w.explicit_identity&&r.schema_name===w.schema_name&&/^[1-9][0-9]*$/.test(r.fixed_oid||'')&&r.source_spelling_oid===r.fixed_oid).length!==1))
  throw Object.assign(new Error('Fixed registered vacancy schema identities unavailable.'),{code:'FIXED_REGISTERED_VACANCY_SCHEMA_BINDING_MISMATCH'});
 const bound=REGISTERED_VACANCY_DEPENDENCIES.map(w=>({...w,fixed_oid:binding.find(r=>r.identity===w.identity).fixed_oid}));
 const context=(await db.query(`/* registered_vacancy153_context */
  select current_user actor,session_user session_actor,current_setting('session_replication_role') replication,
   (select rolsuper from pg_roles where rolname=current_user) superuser,(select rolbypassrls from pg_roles where rolname=current_user) bypassrls,
   (select pg_get_userbyid(relowner) from pg_class where oid='public.custodial_release_authority_restore_inventory'::regclass) inventory_owner,
   (select count(*)::text from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and not tgisinternal) inventory_trigger_count,
   (select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,'internal',t.tgisinternal,'function_oid',t.tgfoid::text,
    'function_identity',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) order by t.tgname collate pg_catalog."C")
    from pg_trigger t where t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
     and t.tgname in('trg_custodial_release_authority_restore_inventory_immutable','custodial_disaster_restore_mutation_fence')) inventory_triggers,
   (select md5(prosrc) from pg_proc where oid='public.custodial_release_authority_current_grant_definition(text)'::regprocedure) serializer_body_md5,
   (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.custodial_release_authority_current_grant_definition(text)'::regprocedure) serializer_definition_md5`)).rows;
 assert.equal(context.length,1);
 const metadata=(await db.query(`/* registered_vacancy153_dependencies */
  with wanted as(select * from jsonb_to_recordset($1::jsonb) as w(identity text,explicit_identity text,schema_name text,fixed_oid oid,body_sha256 text,definition_sha256 text)),
  inventory as(select object_kind,object_identity,definition_sql,definition_sha256 from public.custodial_release_authority_restore_inventory)
  select w.identity,w.explicit_identity,p.oid::text fixed_oid,p.oid::regprocedure::text signature,
   pg_get_userbyid(p.proowner)::text owner_name,p.proowner=current_user::regrole owner_matches_actor,
   p.prokind,p.prosecdef,p.provolatile,p.proconfig,p.proisstrict,p.proleakproof,p.proparallel,p.proretset,
   p.proargnames,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) return_type,l.lanname language,
   md5(p.prosrc) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,
   public.static_weekly_digest_text(p.prosrc) body_sha256,
   public.static_weekly_digest_text(pg_get_functiondef(p.oid)) definition_sha256,
   pg_get_functiondef(p.oid) definition_sql,p.proacl is null acl_is_null,
   (select count(*)::text from aclexplode(p.proacl)) raw_acl_rows,
   (select count(distinct grantee)::text from aclexplode(p.proacl)) raw_acl_distinct_grantees,
   (select count(*)::text from aclexplode(p.proacl) a where a.grantee not in('postgres'::regrole,p.proowner)
     or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable) source153_disallowed_acl_rows,
   p.proowner='postgres'::regrole owner_oid_equals_postgres,

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
  from wanted w join pg_proc p on p.oid=w.fixed_oid and p.pronamespace=(select oid from pg_namespace where nspname=w.schema_name)
   join pg_language l on l.oid=p.prolang order by w.identity collate pg_catalog."C"`,[JSON.stringify(bound),roles])).rows;
 assert.equal(metadata.length,3);
 assert.ok(REGISTERED_VACANCY_DEPENDENCIES.every(w=>metadata.filter(r=>r.identity===w.identity&&r.explicit_identity===w.explicit_identity&&r.fixed_oid===binding.find(b=>b.identity===w.identity).fixed_oid).length===1));
 const aliases=(await db.query(`/* registered_vacancy153_inventory_aliases */
  select object_kind,object_identity,restore_order,definition_sql,definition_sha256,
   public.static_weekly_digest_text(definition_sql) actual_definition_sha256,
   to_regprocedure(object_identity)::oid::text fixed_oid
  from public.custodial_release_authority_restore_inventory
  where object_kind in('function','grant') and case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end=any($1::oid[])
  order by object_kind collate pg_catalog."C",object_identity collate pg_catalog."C",restore_order limit 17`,[bound.map(w=>w.fixed_oid)])).rows;
 assert.ok(aliases.length<=16,'Fixed registered vacancy aliases exceed metadata bound');
 assert.ok(aliases.every(row=>bound.some(w=>w.fixed_oid===row.fixed_oid)&&['function','grant'].includes(row.object_kind)));
 for(const row of [...metadata,...aliases])for(const key of ['definition_sql','current_grant_sql'])if(row[key]!=null)
  assert.ok(typeof row[key]==='string'&&Buffer.byteLength(row[key])<=MAX_DEFINITION_BYTES,'Fixed registered vacancy definition exceeds bound');
 assert.ok(Buffer.byteLength(JSON.stringify({binding,context,metadata,aliases}))<=MAX_TOTAL_BYTES,'Fixed registered vacancy metadata exceeds bound');
 const predicates=REGISTERED_VACANCY_DEPENDENCIES.map(w=>{
  const r=metadata.find(row=>row.identity===w.identity);
  const expected={owner_matches_actor:true,...(w.definition_sha256?{definition_sha256:w.definition_sha256}:{}),...(w.body_sha256?{body_sha256:w.body_sha256}:{})};
  if(w.identity==='custodial_reject_release_authority_inventory_mutation()')Object.assign(expected,{acl_is_null:false,raw_acl_rows:'2',raw_acl_distinct_grantees:'2',source153_disallowed_acl_rows:'0'});
  const observed=Object.fromEntries(Object.keys(expected).map(key=>[key,r[key]]));
  return {identity:w.identity,fixed_oid:r.fixed_oid,expected,observed,failed_boundary_predicates:Object.keys(expected).filter(key=>observed[key]!==expected[key])};
 });
 return {observed_state:'AFTER_FAILED_STEP_SAVEPOINT_ROLLBACK',actual_failing_predicate:'UNKNOWN',
  predicate_scope:'CANONICAL153_FIXED3_REEVALUATION_NOT_FAILED_DO_BLOCK_LOCALS',
  source_prerequisite_count:3,source_new_target_count:0,source_canonical_sha256:REGISTERED_VACANCY_SOURCE_SHA256,
  source_executed_sha256:REGISTERED_VACANCY_FORWARD_SHA256,binding,context:context[0],predicates,
  failed_boundary_predicates:predicates.flatMap(r=>r.failed_boundary_predicates.map(predicate=>({identity:r.identity,predicate}))),
  metadata,aliases,operational_rows_selected:false,unknown_identity_bodies_exported:false,
  production_authorized:false,candidate_migration_admission:false,runtime_admission:false,full_rehearsal_attestation:false};
}
