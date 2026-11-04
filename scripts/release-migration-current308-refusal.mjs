import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const CURRENT308_FILE='20261102151842_current_source_recovery_binding.sql';
export const CURRENT308_SHA256='999b061a970c847d53572f837d55ac78cf83888115d4fb22f182d711bf17f67a';
export const CURRENT308_FORWARD_SHA256='adbbd03be64c1898ba4e10b193ec24450af3533122db4b58a5b08500eecc0e27';
export const CURRENT_TAIL_STAGES=Object.freeze([
 {file:'20261102161602_current_recovery_column_order.sql',order:176,sha256:'067e5fd187f68f2b9174c6317e08e283f026426ad39dd3bfd44cc8b498216665',stage:'current309'},
 {file:'20261103004520_authoritative_events_cancellation.sql',order:177,sha256:'21aae942d552b162e024061d34c0fe164adafaa58c6ceb735761f0a2c95a537b',stage:'current310'},
].map(Object.freeze));
for(const stage of CURRENT_TAIL_STAGES)assert.equal(createHash('sha256').update(readFileSync(new URL('../supabase/migrations/'+stage.file,import.meta.url))).digest('hex'),stage.sha256);
const source=readFileSync(new URL('../supabase/migrations/'+CURRENT308_FILE,import.meta.url),'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),CURRENT308_SHA256);
const section=source.split('INSERT INTO q309_expected_mismatches VALUES\n')[1]?.split('\nDO $actual_mismatches$')[0];
export const CURRENT308_PREDECESSORS=Object.freeze([...section.matchAll(/\('([^']+)','([^']+)','([a-f0-9]{64})','([a-f0-9]{64})'\)/g)]
 .map(m=>Object.freeze({kind:m[1],identity:m[2],stored_sha256:m[3],live_sha256:m[4]})));
assert.equal(CURRENT308_PREDECESSORS.length,39);
export const CURRENT308_METADATA_SQL=Object.freeze({
 renderer:`select public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_authority_current_relation_definition(text)'::regprocedure)) sha256`,
 relations:`select i.object_identity,i.restore_order,i.definition_sql,i.definition_sha256 stored_sha256,public.static_weekly_digest_text(i.definition_sql) stored_definition_sha256,public.static_weekly_digest_text(public.custodial_release_authority_current_relation_definition(i.object_identity)) live_sha256,(select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid=to_regclass(i.object_identity) and a.attnum>0) columns_in_order,(select array_agg(a.attnum::integer order by a.attnum) from pg_attribute a where a.attrelid=to_regclass(i.object_identity) and a.attnum>0) ordinals,(select bool_or(a.attisdropped) from pg_attribute a where a.attrelid=to_regclass(i.object_identity) and a.attnum>0) dropped from public.custodial_release_authority_restore_inventory i where i.object_kind='relation' order by i.object_identity collate "C"`,

 inventory:`select count(*)::text count,public.static_weekly_digest_text(string_agg(restore_order::text||E'\n'||object_kind||E'\n'||object_identity||E'\n'||definition_sha256||E'\n'||public.static_weekly_digest_text(definition_sql),E'\n---\n' order by object_kind collate "C",object_identity collate "C")) sha256 from public.custodial_release_authority_restore_inventory`,
 canary:`select public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) function_sha256,(select count(*)::text from public.custodial_release_canary_authority_surface()) surface_count,(select public.static_weekly_digest_text(string_agg(object_kind||E'\n'||object_identity||E'\n'||purpose,E'\n---\n' order by object_kind collate "C",object_identity collate "C",purpose collate "C")) from public.custodial_release_canary_authority_surface()) surface_sha256`,
 defaults:`select r.rolname owner_name,case when d.defaclnamespace=0 then '' else n.nspname end schema_name,d.defaclobjtype::text object_type,coalesce(g.rolname,'PUBLIC') grantee,grantor.rolname grantor,a.privilege_type,a.is_grantable from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) a left join pg_roles g on g.oid=a.grantee left join pg_roles grantor on grantor.oid=a.grantor order by r.rolname,schema_name,d.defaclobjtype,grantee,grantor.rolname,a.privilege_type,a.is_grantable`,
 predecessor:`select restore_order,object_kind,object_identity,definition_sha256 stored_sha256,public.static_weekly_digest_text(definition_sql) stored_definition_sha256,public.static_weekly_digest_text(case object_kind when 'function' then pg_get_functiondef(to_regprocedure(object_identity)) when 'relation' then public.custodial_release_authority_current_relation_definition(object_identity) when 'column' then public.custodial_release_authority_current_column_definition(object_identity) when 'column_set' then public.custodial_release_authority_current_column_set_definition(object_identity) when 'constraint' then public.custodial_release_authority_current_constraint_definition(object_identity) end) live_sha256 from public.custodial_release_authority_restore_inventory where object_kind=$1 and object_identity=$2`,
 inventory_metadata:`select restore_order,object_kind,object_identity,definition_sha256,public.static_weekly_digest_text(definition_sql) actual_definition_sha256 from public.custodial_release_authority_restore_inventory order by object_kind collate "C",object_identity collate "C"`,
});
// Called only after the existing isolated step has rolled back. No operational
// rows, credential values, source rewrites or permission changes are read/made.
export async function readCurrent308Refusal(db,{predecessors=true,relations=false}={}){
 const receipt={};
 for(const key of ['inventory','canary','defaults','inventory_metadata']){
  const rows=(await db.query(CURRENT308_METADATA_SQL[key])).rows;
  assert.ok(rows.length<12000);receipt[key]=rows;
 }
 assert.equal(receipt.inventory.length,1);assert.equal(receipt.canary.length,1);
 receipt.predecessors=[];
 for(const expected of predecessors?CURRENT308_PREDECESSORS:[]){
  const rows=(await db.query(CURRENT308_METADATA_SQL.predecessor,[expected.kind,expected.identity])).rows;
  assert.ok(rows.length<=1);receipt.predecessors.push({expected,actual:rows});
 }
 if(relations){
  receipt.relations=(await db.query(CURRENT308_METADATA_SQL.relations)).rows;assert.equal(receipt.relations.length,240);
  receipt.renderer=(await db.query(CURRENT308_METADATA_SQL.renderer)).rows;assert.equal(receipt.renderer.length,1);
 }
 return receipt;
}
