import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const OCTOBER_RECOVERY_PREDECESSORS=Object.freeze([
  {
    "kind": "function",
    "identity": "mz_location_reminder_candidates(date,timestamp with time zone)",
    "captured_digest": "a29e4bb9c68ed13121917894e895683227783f5c99123dd511b87ce3f91dd707",
    "live_digest": "ad5bf4abee1d732f8fc4503f12bfb2ad5924f46c8168e59c4c5557cc7ac1f949"
  },
  {
    "kind": "grant",
    "identity": "static_weekly_v8_read_lunch_segments(date)",
    "captured_digest": "ce39f0b479bb17c93f32a7651b23cb2ebbeb8ee2ce6a62e7d40325165071fb60",
    "live_digest": "9b70eb1011ac529432db1d7a1a9ba3e072fb5917eae318607b0545be6c1c9183"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_activations.custodial_disaster_restore_mutation_fence",
    "captured_digest": "5cf539d0f3a47f7757b19138ac5179cf278cc3fe8bbd2ac7b377f89ff7e51074",
    "live_digest": "a765b9f24859782c8f212aa5c78485d719c8e69f4d51a16e411a4e96c37e97cc"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_activations.dated_activation_immutable",
    "captured_digest": "cbf665bb065f8cd7b282a2184bafc64f866b1a53d87e2e7f3879ddd2d71161c5",
    "live_digest": "35bf9c666cd64675301e6ad18215ab7c00cff1a452a7b0e83f5a261a4ce11abb"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_occurrences.custodial_disaster_restore_mutation_fence",
    "captured_digest": "a9b52a9e2c22e24aeae6c9d4d409108504490a33795b845862ae0341d442194c",
    "live_digest": "4cfc505cc6201dca7b4b3c4e0d453c291bb64e81087f4f6a7a777d799c00bc73"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_occurrences.dated_occurrence_immutable",
    "captured_digest": "871be6baabd508549d87c0b3260fc87b84d7658fc6cc35f5a6b0fdfe959a923e",
    "live_digest": "c911df3330e52d28305c04f507d7ad78b091bffac72de54e36054a856704c258"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_publications.custodial_disaster_restore_mutation_fence",
    "captured_digest": "96abdd8b9f935ff31489f2d03d8efc618ee831bfaab5c2b500cfabc44123708b",
    "live_digest": "7b2fa63f0cc780bbaf4050091c6b2ca0da204896bcd3b35dfbc15f16885e9c00"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_publications.dated_publication_complete",
    "captured_digest": "e7a5a7b131e88a83fbaf0834c0097aaba2a4fb0100551a35160a2886978e5f1e",
    "live_digest": "77c80a3fc776cfdb71bc6af22e7e5636b7fcfae1bde5404c9cb8be01a36dc770"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_publications.dated_publication_immutable",
    "captured_digest": "f3720b7d517b1508f71d1925cbb676f9ca881dced493e20cbe994ce6bf0d64ca",
    "live_digest": "c8dd7f7afd5c519700e45a7fd088b71573a0b0ec1410cd296a81ac521418c7b6"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_receipts.custodial_disaster_restore_mutation_fence",
    "captured_digest": "ad66643883f74c32fc47235c692b9ce90bdef1f3fd91b979fe8a7f6bddc71929",
    "live_digest": "94aaa4d5b57d827f3f69b2a69c23b7fefa6ea4da5094d4f892c0af8babf7c34e"
  },
  {
    "kind": "trigger",
    "identity": "public.custodial_dated_receipts.dated_receipt_immutable",
    "captured_digest": "33e96c3a693dc110a782c8a1fed7261df796e98fdce8de84952117527de46a4d",
    "live_digest": "2729210b1d601b915b87f692516eac7b8845cb1a56fe5844c138f9d53b6d7436"
  },
  {
    "kind": "view",
    "identity": "public.v_location_dashboard_status",
    "captured_digest": "d4345afd64fc8b56a82fde1c3a1734fdb23323bb1ff3c9e4d62c71b565d663e3",
    "live_digest": "82dd00526da19bb7a8532da83a42d847a00f5c06c6d24ffe5a6342797c67b407"
  },
  {
    "kind": "view",
    "identity": "public.v_memphis_area_schedule",
    "captured_digest": "f4ee18dba4aa566fbaf0394b817ad2686a02dba95fe84f84e78e2587a2403563",
    "live_digest": "e13e853bf2653473553c62f20f286871393107509c11def746c9e371f2ddadd1"
  },
  {
    "kind": "view",
    "identity": "public.v_restroom_check_timers",
    "captured_digest": "0d302a478de60aed9dd7af8d8cccfe72987cc9104a7c46cf1ecbe094412339cc",
    "live_digest": "8dd302c13b6c138e49ebccb7fa548734d35d0d3bc64cf05c2ab3563b773b6fbd"
  }
].map(Object.freeze));
export const OCTOBER_RECOVERY_SOURCE_SHA256='3ba81c38118b4b56543d2f89135bbdb7a6652c700c78b5dedcf898b3e60f6000';
export const CURRENT_GRANT_SERIALIZATION_SOURCE_FILE="20261003220000_current_release_authority_completion.sql";
export const CURRENT_GRANT_SERIALIZATION_SOURCE_SHA256="8d8d60f1b10427f5c184488a9faa5e4f4bbb9ac2f11526ff921bb8c2eac70898";
export const CURRENT_GRANT_SERIALIZATION_FORWARD_SHA256='90e31443af8e2b2ba563c7a965d7a6afeba37f8cb67d2d4ff333034066c88a33';
export const CURRENT_GRANT_SERIALIZATION_PREDECESSORS=Object.freeze([
  {
    "kind": "grant",
    "identity": "custodial_release_canary_authority_surface()",
    "old_reset_identity": "public.custodial_release_canary_authority_surface()",
    "expected_order": 1000073,
    "captured_digest": "a843e6ab1177177e039163a3d520b95d6552de8105474a48e390b25302692f48",
    "live_digest": "b7d461eda320ec386b55ce3490063e09848a83723999acdd741e83cad0460498"
  },
  {
    "kind": "grant",
    "identity": "public.static_weekly_v3_assert_draft_incumbency(uuid)",
    "old_reset_identity": "static_weekly_v3_assert_draft_incumbency(uuid)",
    "expected_order": 1000199,
    "captured_digest": "d6f202a5c174036cf978cebd88e2274f5b54039dedf614f4808086701cb8305a",
    "live_digest": "8f5efab4cf9957046185fc19bf9bfb23be3c48900e414f9422be0e05baaba1ca"
  },
  {
    "kind": "grant",
    "identity": "public.static_weekly_v4_hydrate_compiler_source(jsonb,date)",
    "old_reset_identity": "static_weekly_v4_hydrate_compiler_source(jsonb,date)",
    "expected_order": 1000198,
    "captured_digest": "57b252cee39b5f763518cb957528a6fea8eabae017351f0a4c7483d62df9598a",
    "live_digest": "cd7d80e0f473c00254a875badd84ec701b370489bd1eb64dbe568b72784e08af"
  },
  {
    "kind": "grant",
    "identity": "public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
    "old_reset_identity": "static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
    "expected_order": 950028,
    "captured_digest": "cfea7c5bfcf61a00e64b56e38e1c98f93d7a973c373205b89bc3b708aad0902b",
    "live_digest": "419abb490483777437126a3593d601da11e9d3db32b777e21be802291a97ce6b"
  },
  {
    "kind": "grant",
    "identity": "public.static_weekly_v6_read_schedule_segments_dated_base(date)",
    "old_reset_identity": "static_weekly_v6_read_schedule_segments_dated_base(date)",
    "expected_order": 950168,
    "captured_digest": "4bbcbf22890a56bb56ff4d05a6ba7c95bbac648b755b22291267589d8261aabd",
    "live_digest": "6161a03a11c95bbe898fc4b27ae54d9ba3e66eade32fc5fc29e3b75da1f85201"
  },
  {
    "kind": "grant",
    "identity": "public.static_weekly_v8_read_lunch_segments_dated_base(date)",
    "old_reset_identity": "static_weekly_v8_read_lunch_segments_dated_base(date)",
    "expected_order": 950170,
    "captured_digest": "8eb43bf71ab7c0bcb60bbf818bd54d77d43a4163fcfa19a4f3962948a7ad3f80",
    "live_digest": "a38bf3e78db3a49335dd315a33ad98605deeea8638c8d6596a7bc82402795b41"
  }
].map(Object.freeze));
// Fixed metadata only. Recovery definitions are Source/catalog material, not
// operational table DATA or credentials. No caller-supplied SQL or identities.
async function readFixedRefusalPredecessors(db,predecessors,{aliases=false}={}) {
 const rows=[];
 for(const expected of predecessors){
  let publicIdentity=expected.identity;
  if(aliases){
   // Mirror canonical87's public_oid binding before resolving any current or
   // historical alias. The first tuple is deliberately unqualified as DATA.
   publicIdentity=expected.identity.startsWith('public.')?expected.identity:'public.'+expected.identity;
   const binding=(await db.query(`select to_regprocedure($1)::oid::text public_oid,
     to_regprocedure($2)::oid::text identity_oid,to_regprocedure($3)::oid::text old_reset_oid,
     p.pronamespace='public'::regnamespace public_schema
     from pg_proc p where p.oid=to_regprocedure($1)`,[publicIdentity,expected.identity,expected.old_reset_identity])).rows;
   if(binding.length!==1||binding[0].public_schema!==true||!binding[0].public_oid
    ||binding[0].identity_oid!==binding[0].public_oid||binding[0].old_reset_oid!==binding[0].public_oid)
    throw Object.assign(new Error('Fixed public grant identities do not resolve to the same public function.'),{code:'FIXED_PUBLIC_GRANT_IDENTITY_MISMATCH'});
  }
  const captured=(await db.query(`select restore_order,object_kind,object_identity,definition_sql,definition_sha256,
    public.static_weekly_digest_text(definition_sql) actual_definition_sha256
    from public.custodial_release_authority_restore_inventory where object_kind=$1 and object_identity=$2`,[expected.kind,expected.identity])).rows;
  let sql;
  if(expected.kind==='function')sql="select pg_get_functiondef(to_regprocedure($1)) definition_sql";
  else if(expected.kind==='view')sql="select public.custodial_release_authority_current_view_definition($1) definition_sql";
  else if(expected.kind==='grant')sql="select public.custodial_release_authority_current_grant_definition($1) definition_sql";
  else sql=`select 'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';' definition_sql
    from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
    where $1=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal`;
  const current=(await db.query('select q.definition_sql,public.static_weekly_digest_text(q.definition_sql) definition_sha256 from ('+sql+') q',[expected.identity])).rows;
  let metadata;
  if(expected.kind==='function'||expected.kind==='grant')metadata=(await db.query(`select p.oid::regprocedure::text signature,p.proowner::regrole::text owner_name,
    md5(p.prosrc) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,p.prosecdef,p.provolatile,p.proconfig,
    (select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee) acl
    from pg_proc p where p.oid=to_regprocedure($1)`,[publicIdentity])).rows;
  else if(expected.kind==='view')metadata=(await db.query(`select c.oid::regclass::text identity,c.relowner::regrole::text owner_name,c.reloptions
    from pg_class c where c.oid=to_regclass($1)`,[expected.identity])).rows;
  else metadata=(await db.query(`select n.nspname schema_name,r.relname table_name,r.relowner::regrole::text owner_name,t.tgname,t.tgenabled,
    p.oid::regprocedure::text function_signature,p.proowner::regrole::text function_owner,md5(p.prosrc) function_body_md5
    from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace join pg_proc p on p.oid=t.tgfoid
    where $1=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal`,[expected.identity])).rows;
  // Only aliases of these six independently fixed public function identities.
  // These are recovery definitions; no operational table DATA is selected.
  const capturedAliases=aliases?(await db.query(`select restore_order,object_kind,object_identity,definition_sql,definition_sha256,
    public.static_weekly_digest_text(definition_sql) actual_definition_sha256
    from public.custodial_release_authority_restore_inventory where object_kind='grant'
    and case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end=to_regprocedure($1)
    order by restore_order,object_identity`,[publicIdentity])).rows:null;
  rows.push({expected,captured,current,metadata,...(aliases?{captured_aliases:capturedAliases}:{})});
 }
 return rows;
}
export async function readTargetRefusalPredecessors(db) {
 return readFixedRefusalPredecessors(db,OCTOBER_RECOVERY_PREDECESSORS);
}
export async function readCurrentGrantRefusalPredecessors(db) {
 return readFixedRefusalPredecessors(db,CURRENT_GRANT_SERIALIZATION_PREDECESSORS,{aliases:true});
}
export const PRIVATE_CUSTODY_SOURCE252_FILE='20261010193211_native_private_custody_chunk_retention.sql';
export const PRIVATE_CUSTODY_SOURCE252_SHA256='28275c65a49b26a21ee0f37538a0f9c337a45c5fb41f0fa701d2ffdf555f863b';
export const PRIVATE_CUSTODY_SOURCE252_FORWARD_SHA256='4a961ebc7aefdfd99d04044fef0d7ceebc0f095783ff525491332244f329ce2a';
export const PRIVATE_CUSTODY_SOURCE252_RUNTIME_PROFILE_SHA256='a9fc28be337bc43d6feaf17e13be103400c5d5c0da85dd9ba0bca600d51c738f';
export const PRIVATE_CUSTODY_SOURCE252_REFERENCE_SHA256='2f0b2b84762a4786560c59880a076b1e869575af5b1f221830b7b4f0ca67c5b3';
const private252Key=row=>JSON.stringify([row.object_kind,row.object_identity]);
export function readPrivateCustodySource252Reference(){
 const bytes=readFileSync(new URL('../release/production-forward-source/private-custody-source252-reference.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),PRIVATE_CUSTODY_SOURCE252_REFERENCE_SHA256);
 const reference=JSON.parse(bytes);assert.equal(reference.count,6884);assert.equal(reference.rows.length,6884);
 assert.equal(reference.raw_capture_sha256,'37f0382ee69fb5b63096962b294c516233bb9df5d2884ae21bcb54eada6e7614');
 assert.equal(reference.inventory_sha256,'d9abaf120c47e789c6b3114717f14eb76d1ceacf9aea5600bccfb1005a176d27');
 return reference;
}
// Read only Source/recovery/catalog metadata after rollback to the failed
// migration's savepoint. The outer owner still always rethrows/whole-rolls back.
export async function readPrivateCustodySource252Refusal(db){
 const reference=readPrivateCustodySource252Reference();
 const summary=(await db.query(`select count(*)::text inventory_count,
  public.static_weekly_digest_text(string_agg(restore_order::text||E'\n'||object_kind||E'\n'||object_identity||E'\n'||definition_sha256,E'\n---\n'
   ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")) inventory_sha256,
  count(*) filter(where definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))::text selfhash_mismatches,
  (select count(*)::text from(select object_kind,object_identity from public.custodial_release_authority_restore_inventory group by object_kind,object_identity having count(*)<>1) q) duplicate_identity_groups,
  (select count(*)::text from(select restore_order from public.custodial_release_authority_restore_inventory group by restore_order having count(*)<>1) q) duplicate_order_groups
  from public.custodial_release_authority_restore_inventory`)).rows[0];
 const kindCounts=(await db.query(`select object_kind,count(*)::text rows from public.custodial_release_authority_restore_inventory group by object_kind order by object_kind collate "C"`)).rows;
 const canary=(await db.query(`select p.oid::text public_oid,p.pronamespace='public'::regnamespace public_schema,
  to_regprocedure('custodial_release_canary_authority_surface()')=p.oid unqualified_same_public_oid,
  pg_get_functiondef(p.oid) definition_sql,public.static_weekly_digest_text(pg_get_functiondef(p.oid)) definition_sha256,
  md5(p.prosrc) body_md5,p.proowner::regrole::text owner_name,p.prosecdef,p.provolatile,p.proconfig,
  (select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee) acl
  from pg_proc p where p.oid=to_regprocedure('public.custodial_release_canary_authority_surface()') and p.pronamespace='public'::regnamespace`)).rows;
 const boundary=(await db.query(`select c.relowner::regrole::text inventory_owner,t.tgname,t.tgenabled,t.tgfoid::regprocedure::text guard_function,
  to_regclass('public.custodial_native_private_custody_operations') is null operations_absent,
  to_regclass('public.custodial_native_private_custody_chunks') is null chunks_absent,
  not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in
   ('custodial_private_custody_v1_immutable','custodial_private_custody_v1_retain_chunk','custodial_private_custody_v1_read_chunk')) new_routine_names_absent
  from pg_class c left join pg_trigger t on t.tgrelid=c.oid and t.tgname='trg_custodial_release_authority_restore_inventory_immutable' and not t.tgisinternal
  where c.oid='public.custodial_release_authority_restore_inventory'::regclass`)).rows;
 const result={reference:{raw_capture_sha256:reference.raw_capture_sha256,reference_sha256:PRIVATE_CUSTODY_SOURCE252_REFERENCE_SHA256,
  inventory_count:'6884',inventory_sha256:reference.inventory_sha256,canary_sha256:reference.canary_sha256},summary,kind_counts:kindCounts,canary,boundary};
 // A genuine unexpected count remains visible, without an unbounded export.
 if(!/^(0|[1-9][0-9]*)$/.test(summary.inventory_count)||BigInt(summary.inventory_count)>8192n)
  return {...result,inventory_metadata_omitted:true,metadata_limit:8192};
 const observed=(await db.query(`select restore_order::text,object_kind,object_identity,definition_sha256,
  public.static_weekly_digest_text(definition_sql) actual_definition_sha256,octet_length(definition_sql)::text definition_bytes
  from public.custodial_release_authority_restore_inventory order by object_kind collate "C",object_identity collate "C",restore_order limit 8193`)).rows;
 assert.equal(observed.length,Number(summary.inventory_count));
 const expected=new Map(reference.rows.map(([object_kind,object_identity,restore_order,definition_sha256])=>{
  const row={object_kind,object_identity,restore_order,definition_sha256};return [private252Key(row),row];}));
 assert.equal(expected.size,6884);
 const actual=new Map();for(const row of observed){const key=private252Key(row);if(!actual.has(key))actual.set(key,[]);actual.get(key).push(row);}
 const missing=[],extra=[],changed=[];
 for(const[key,before]of expected){const rows=actual.get(key)||[];if(!rows.length)missing.push(before);
  else if(rows.length!==1||rows[0].restore_order!==before.restore_order||rows[0].definition_sha256!==before.definition_sha256
   ||rows[0].actual_definition_sha256!==rows[0].definition_sha256)changed.push({expected:before,observed:rows});}
 for(const[key,rows]of actual)if(!expected.has(key))extra.push(...rows);
 // Resolve only changed identities already present in the independently pinned
 // Source252 reference. Unknown extras never select their routine bodies.
 const wanted=changed.map(x=>x.expected).filter(x=>['function','grant','view','relation','relation_state','column_set','column','constraint','trigger','index','policy'].includes(x.object_kind));
 const current=wanted.length?(await db.query(`with wanted as(select * from jsonb_to_recordset($1::jsonb) as x(object_kind text,object_identity text)),
  identities as(select *,case when position('(' in object_identity)>0 and object_kind in('function','grant')
   then case when position('.' in split_part(object_identity,'(',1))>0 then object_identity else 'public.'||object_identity end end function_identity,
   case when position('(' in object_identity)=0 then case when object_kind in('column','constraint','policy') then split_part(object_identity,':',1)
    when object_kind='trigger' then regexp_replace(object_identity,'[.][^.]+$','') else object_identity end end relation_identity from wanted),
  resolved as(select *,to_regprocedure(function_identity) function_oid,to_regclass(relation_identity) relation_oid from identities)
  select w.object_kind,w.object_identity,p.oid::text function_oid,np.nspname function_schema,p.proowner::regrole::text function_owner,
   md5(p.prosrc) function_body_md5,md5(pg_get_functiondef(p.oid)) function_definition_md5,p.prosecdef,p.provolatile,p.proconfig,
   case when p.oid is not null then to_regprocedure(w.object_identity)=p.oid end original_spelling_same_function_oid,
   c.oid::text relation_oid,nc.nspname relation_schema,c.relowner::regrole::text relation_owner,c.relkind::text,c.reloptions,c.relrowsecurity,c.relforcerowsecurity,
   t.tgname,t.tgenabled,t.tgfoid::regprocedure::text trigger_function,md5(pg_get_triggerdef(t.oid,true)) trigger_definition_md5,
   case when p.oid is not null then(select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
    order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee)
    when c.oid is not null then(select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable)
    order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee) end acl,
   case when w.object_kind='grant' and((p.oid is not null and to_regprocedure(w.object_identity)=p.oid) or(c.oid is not null and to_regclass(w.object_identity)=c.oid))
    then public.custodial_release_authority_current_grant_definition(w.object_identity)
    when w.object_kind='view' and c.relkind='v' then public.custodial_release_authority_current_view_definition(w.object_identity) end current_catalog_definition_sql
  from resolved w left join pg_proc p on p.oid=w.function_oid left join pg_namespace np on np.oid=p.pronamespace
   left join pg_class c on c.oid=w.relation_oid left join pg_namespace nc on nc.oid=c.relnamespace
   left join pg_trigger t on w.object_kind='trigger' and t.tgrelid=c.oid and t.tgname=substring(w.object_identity from '[^.]+$') and not t.tgisinternal
  order by w.object_kind collate "C",w.object_identity collate "C"`,[JSON.stringify(wanted)])).rows:[];
 return {...result,difference_counts:{missing:missing.length,extra:extra.length,changed:changed.length},missing,extra,changed,current_catalog_metadata:current,
  operational_rows_selected:false,unknown_routine_bodies_exported:false};
}
// Compare the SAME bounded observed census with the sealed runtime profile.
// The failed step has already been rolled back: neither comparison identifies
// the actual failing pass, and pass1 is explicitly a counterfactual expectation.
export function comparePrivateCustodyRuntimePreimage(metadata){
 const bytes=readFileSync(new URL('../release/production-forward-source/private-custody-existing-postgres-profile.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),PRIVATE_CUSTODY_SOURCE252_RUNTIME_PROFILE_SHA256);
 const profile=JSON.parse(bytes);assert.equal(profile.schema,'custodial.source252-existing-original-postgres.v1');assert.equal(profile.scope,'DISTINCT_EXISTING_RUNTIME_PROFILE_NOT_NOAUTO_EQUIVALENCE');
 assert.equal(profile.original_rows.length,6884);assert.equal(profile.exceptions.length,793);assert.equal(profile.repairs.length,2);
 const boundary={observed_state:'AFTER_FAILED_STEP_SAVEPOINT_ROLLBACK',actual_failing_pass:'UNKNOWN',
  profile_sha256:PRIVATE_CUSTODY_SOURCE252_RUNTIME_PROFILE_SHA256,
  pass0_expected_aggregate_sha256:profile.preimage_aggregate_sha256,
  pass1_expected_aggregate_sha256:profile.post_repair_aggregate_sha256,
  pass1_is_counterfactual_after_rollback:true,operational_rows_selected:false,unknown_routine_bodies_exported:false};
 if(metadata.inventory_metadata_omitted)return {...boundary,comparison_omitted:true,metadata_limit:8192};
 const reference=readPrivateCustodySource252Reference();
 const observed=new Map(reference.rows.map(([object_kind,object_identity,restore_order,definition_sha256])=>{
  const row={object_kind,object_identity,restore_order,definition_sha256,actual_definition_sha256:definition_sha256};return[private252Key(row),[row]];
 }));
 for(const row of metadata.missing)observed.delete(private252Key(row));
 for(const row of metadata.changed)observed.set(private252Key(row.expected),row.observed);
 for(const row of metadata.extra){const key=private252Key(row);if(!observed.has(key))observed.set(key,[]);observed.get(key).push(row);}
 const actualRows=[...observed.values()].flat();assert.equal(actualRows.length,Number(metadata.summary.inventory_count));
 const aggregateRows=rows=>createHash('sha256').update(rows.sort((a,b)=>Buffer.compare(Buffer.from(a.object_kind),Buffer.from(b.object_kind))||Buffer.compare(Buffer.from(a.object_identity),Buffer.from(b.object_identity))).map(r=>r.restore_order+'\n'+r.object_kind+'\n'+r.object_identity+'\n'+r.definition_sha256).join('\n---\n')).digest('hex');
 // For unique identities the independently reconstructed complete observed tuple
 // digest must equal the one computed by PostgreSQL in the SAME metadata read.
 if([...observed.values()].every(rows=>rows.length===1))assert.equal(aggregateRows([...actualRows]),metadata.summary.inventory_sha256);
 const base=new Map(profile.original_rows.map(([object_kind,object_identity,restore_order,definition_sha256])=>{
  const row={object_kind,object_identity,restore_order,definition_sha256};return[private252Key(row),row];
 }));assert.equal(base.size,6884);
 for(const e of profile.exceptions){const key=private252Key(e);assert.ok(base.has(key));base.set(key,{...base.get(key),definition_sha256:e.saved_sha256});}
 const compare=(expected,pass)=>{
  assert.equal(aggregateRows([...expected.values()]),pass===0?profile.preimage_aggregate_sha256:profile.post_repair_aggregate_sha256);
  const counts={missing:'0',extra:'0',duplicate_identity_groups:'0',restore_order_mismatches:'0',stored_hash_mismatches:'0',selfhash_mismatches:'0'};
  const mismatches=[],kindCounts=Object.create(null);
  const bump=(name,kind)=>{counts[name]=String(BigInt(counts[name])+1n);kindCounts[kind]??={};kindCounts[kind][name]=String(BigInt(kindCounts[kind][name]||'0')+1n);};
  for(const[key,before]of expected){const rows=observed.get(key)||[];
   if(!rows.length){bump('missing',before.object_kind);mismatches.push({expected:before,observed:[]});continue;}
   let differs=false;if(rows.length!==1){bump('duplicate_identity_groups',before.object_kind);differs=true;}
   for(const row of rows){if(row.restore_order!==before.restore_order){bump('restore_order_mismatches',before.object_kind);differs=true;}
    if(row.definition_sha256!==before.definition_sha256){bump('stored_hash_mismatches',before.object_kind);differs=true;}
    if(row.actual_definition_sha256!==row.definition_sha256){bump('selfhash_mismatches',before.object_kind);differs=true;}}
   if(differs)mismatches.push({expected:before,observed:rows});
  }
  for(const[key,rows]of observed)if(!expected.has(key))for(const row of rows)bump('extra',row.object_kind);
  // Only known sealed Source keys appear here. Unknown extras retain the old
  // bounded tuple-only report and never cause routine/body/catalog selection.
  return {expected_pass:pass,counts,kind_counts:kindCounts,known_key_differences:mismatches};
 };
 const pass0=compare(base,0);const post=new Map([...base].map(([k,v])=>[k,{...v}]));
 for(const r of profile.repairs){const key=private252Key(r);assert.ok(post.has(key));post.set(key,{...post.get(key),definition_sha256:r.replacement_sha256});}
 return {...boundary,observed_rows:String(actualRows.length),observed_aggregate_sha256:metadata.summary.inventory_sha256,
  observed_selfhash_mismatches:metadata.summary.selfhash_mismatches,pass0:pass0,pass1:compare(post,1)};
}
async function readSelectedTargetRefusal(db,migration) {
 if(migration.file===PRIVATE_CUSTODY_SOURCE252_FILE){
  assert.equal(migration.order,119);assert.ok([PRIVATE_CUSTODY_SOURCE252_SHA256,PRIVATE_CUSTODY_SOURCE252_FORWARD_SHA256].includes(migration.sha256));
  const metadata=await readPrivateCustodySource252Refusal(db);
  return {metadata_source_file:PRIVATE_CUSTODY_SOURCE252_FILE,metadata_source_sha256:PRIVATE_CUSTODY_SOURCE252_SHA256,
   ...(migration.sha256===PRIVATE_CUSTODY_SOURCE252_FORWARD_SHA256?{metadata_executed_sha256:migration.sha256,existing_runtime_comparison:comparePrivateCustodyRuntimePreimage(metadata)}:{}),private_source252:metadata};
 }
 if(migration.file!==CURRENT_GRANT_SERIALIZATION_SOURCE_FILE)
  return {predecessors:await readTargetRefusalPredecessors(db)};
 assert.equal(migration.order,87);assert.ok([CURRENT_GRANT_SERIALIZATION_SOURCE_SHA256,CURRENT_GRANT_SERIALIZATION_FORWARD_SHA256].includes(migration.sha256));
 return {metadata_source_file:CURRENT_GRANT_SERIALIZATION_SOURCE_FILE,
  metadata_source_sha256:CURRENT_GRANT_SERIALIZATION_SOURCE_SHA256,
  predecessors:await readCurrentGrantRefusalPredecessors(db),
  grant_serializer:(await db.query(`select p.oid::regprocedure::text signature,p.proowner::regrole::text owner_name,
    md5(p.prosrc) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,p.prosecdef,p.provolatile,p.proconfig
    from pg_proc p where p.oid=to_regprocedure('public.custodial_release_authority_current_grant_definition(text)')`)).rows};
}
export async function runTargetCaptureStep({db,migration,run,targetCapture,onRefusal}) {
 if(!targetCapture)return run();
 await db.query('savepoint custodial_target_migration_step');
 try {const value=await run();await db.query('release savepoint custodial_target_migration_step');return value;}
 catch(error){
  await db.query('rollback to savepoint custodial_target_migration_step');
  let diagnostic;
  try {await db.query('set local search_path=pg_catalog,public,extensions');diagnostic=await readSelectedTargetRefusal(db,migration);}
  catch(readError){await db.query('rollback to savepoint custodial_target_migration_step');diagnostic={metadata_read_failed:true,code:String(readError.code||'METADATA_READ_FAILED')};}
  onRefusal({migration:{order:migration.order,file:migration.file,sha256:migration.sha256},
   sqlstate:String(error.code||'SQL_ERROR'),reason_code:'TARGET_MIGRATION_SQL_REFUSAL',...diagnostic});
  throw error;
 }
}
export function writeTargetCaptureRefusal(path,receipt) {
 assert.equal(receipt.scope,'target_preparation_failure');assert.equal(receipt.committed,false);assert.equal(receipt.rollback_verified,true);
 for(const key of ['production_authorized','candidate_migration_admission','runtime_admission','full_rehearsal_attestation'])assert.equal(receipt[key],false);
 writeFileSync(path,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
}
