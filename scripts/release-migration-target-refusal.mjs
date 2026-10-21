import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
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
// Fixed metadata only. Recovery definitions are Source/catalog material, not
// operational table DATA or credentials. No caller-supplied SQL or identities.
export async function readTargetRefusalPredecessors(db) {
 const rows=[];
 for(const expected of OCTOBER_RECOVERY_PREDECESSORS){
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
    from pg_proc p where p.oid=to_regprocedure($1)`,[expected.identity])).rows;
  else if(expected.kind==='view')metadata=(await db.query(`select c.oid::regclass::text identity,c.relowner::regrole::text owner_name,c.reloptions
    from pg_class c where c.oid=to_regclass($1)`,[expected.identity])).rows;
  else metadata=(await db.query(`select n.nspname schema_name,r.relname table_name,r.relowner::regrole::text owner_name,t.tgname,t.tgenabled,
    p.oid::regprocedure::text function_signature,p.proowner::regrole::text function_owner,md5(p.prosrc) function_body_md5
    from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace join pg_proc p on p.oid=t.tgfoid
    where $1=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal`,[expected.identity])).rows;
  rows.push({expected,captured,current,metadata});
 }
 return rows;
}
export async function runTargetCaptureStep({db,migration,run,targetCapture,onRefusal}) {
 if(!targetCapture)return run();
 await db.query('savepoint custodial_target_migration_step');
 try {const value=await run();await db.query('release savepoint custodial_target_migration_step');return value;}
 catch(error){
  await db.query('rollback to savepoint custodial_target_migration_step');
  let diagnostic;
  try {await db.query('set local search_path=pg_catalog,public,extensions');diagnostic={predecessors:await readTargetRefusalPredecessors(db)};}
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
