// Imported only by the root's inspected, owned, network-none SQL fixture.
// Every hostile change is transaction-local and rolled back. No runtime gate,
// external endpoint, signer, source migration or user record is altered here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const identity='public.custodial_release_authority_restore_inventory.trg_custodial_release_authority_restore_inventory_immutable';
const sha=text=>createHash('sha256').update(text).digest('hex');
const q=text=>"'"+text.replaceAll("'","''")+"'";
const table='public.custodial_release_authority_restore_inventory';
const trigger='trg_custodial_release_authority_restore_inventory_immutable';
const where=`object_kind='trigger' and object_identity=${q(identity)}`;
const digestSql=`select encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\\n' order by inventory_id),''),'UTF8'),'sha256'),'hex') digest from ${table} i`;
export async function verifyNativeInventoryGuardRecovery({client,migrationSql,fixtureId,containerId}) {
 assert.match(fixtureId,/^[a-f0-9]{32}$/);assert.match(containerId,/^[a-f0-9]{64}$/);
 const body=migrationSql.replace(/\nBEGIN;\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n');
 assert.notEqual(body,migrationSql);assert.ok(!/^\s*(BEGIN|COMMIT);/m.test(body),'exact inner migration has no transaction escape');
 const before=(await client.query(digestSql)).rows[0].digest;
 const mode=async()=> (await client.query(`select tgenabled from pg_trigger where tgrelid=${q(table)}::regclass and tgname=${q(trigger)}`)).rows[0].tgenabled;
 assert.equal(await mode(),'A');
 const failures=[
  ['saved_digest_changed',`update ${table} set definition_sha256=repeat('0',64) where ${where}`],
  ['saved_definition_rehashed',`update ${table} set definition_sql='select 1;',definition_sha256=public.static_weekly_digest_text('select 1;') where ${where}`],
  ['saved_order_changed',`update ${table} set restore_order=700028 where ${where}`],
  ['saved_identity_changed',`update ${table} set object_identity=object_identity||'_unexpected' where ${where}`],
  ['saved_row_missing',`delete from ${table} where ${where}`],
  ['live_ordinary_mode',`alter table ${table} enable trigger ${trigger}`],
  ['live_replica_only',`alter table ${table} enable replica trigger ${trigger}`],
  ['live_disabled',`alter table ${table} disable trigger ${trigger}`],
  ['live_wrong_function',"create or replace function public.custodial_reject_release_authority_inventory_mutation() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin return null;end$$"],
  ['live_trigger_missing',`drop trigger ${trigger} on ${table}`],
 ];
 const results=[];
 for(const [name,attack] of failures) {
  await client.query('begin');let caught=null;
  try {
   await client.query(`alter table ${table} disable trigger ${trigger}`);
   await client.query(attack);
   if(!name.startsWith('live_')||name==='live_wrong_function')await client.query(`alter table ${table} enable always trigger ${trigger}`);
   await client.query(body);
  } catch(error) {caught=error;}
  finally {await client.query('rollback');}
  assert.ok(caught,'changed source predecessor must refuse '+name);
  assert.ok(['P0001','P0002'].includes(caught.code),'source preflight owns refusal '+name+': '+caught.code);
  assert.equal((await client.query(digestSql)).rows[0].digest,before,'whole original inventory rollback '+name);
  assert.equal(await mode(),'A','original ALWAYS state rollback '+name);
  results.push({name,sqlstate:caught.code,refused:true,inventory_rollback:true,guard_rollback:true});
 }
 await client.query(migrationSql);
 const row=(await client.query(`select inventory_id,restore_order,definition_sql,definition_sha256 from ${table} where ${where}`)).rows;
 assert.equal(row.length,1);assert.equal(row[0].restore_order,700027);
 assert.equal(row[0].definition_sha256,'b3ab6991571f3d233ec13116b59229d4c06f8a5a0205cb097949a5335d3172b8');
 assert.equal(sha(row[0].definition_sql),row[0].definition_sha256);assert.equal(await mode(),'A');
 for(const replication of ['origin','replica']) {
  await client.query('begin');let error=null;
  try {await client.query(`set local session_replication_role=${replication}`);await client.query(`update ${table} set captured_at=captured_at where ${where}`);}catch(caught){error=caught;}finally{await client.query('rollback');}
  assert.equal(error?.code,'55000','ALWAYS rejects original/replica DML '+replication);
  assert.equal(error?.message,'release authority restore inventory is immutable');
  results.push({name:'immutable_'+replication,refused:true,sqlstate:error.code});
 }
 // Execute the corrected captured DDL in a rollback-only fixture transaction.
 // This is a one-trigger restoration proof, not the full authority restore.
 await client.query('begin');
 try {await client.query(`drop trigger ${trigger} on ${table}`);await client.query(row[0].definition_sql);assert.equal(await mode(),'A');}
 finally {await client.query('rollback');}
 assert.equal(await mode(),'A');
 results.push({name:'captured_trigger_restores_ALWAYS',passed:true,rolled_back:true});
 return {schema:'custodial.native-inventory-guard-recovery-database-tests.v1',checks:13,cases:results,migration_sha256:sha(migrationSql),guard_hash:row[0].definition_sha256,full_authority_restore:false,production:false};
}
