// Newly affected SQL source contract only; NEVER actual PostgreSQL/restore PASS.
import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../supabase/migrations/20261010193211_native_private_custody_chunk_retention.sql',import.meta.url)),sql=fs.readFileSync(file,'utf8');
function guardContract(source) {
 for(const [relation,prefix]of [['custodial_native_private_custody_operations','operation'],['custodial_native_private_custody_chunks','chunk']]) {
  for(const [suffix,event,granularity]of [['immutable','UPDATE OR DELETE','ROW'],['no_truncate','TRUNCATE','STATEMENT']]){
   const name='trg_native_private_custody_'+prefix+'_'+suffix;
   assert.ok(source.includes(`CREATE TRIGGER ${name} BEFORE ${event} ON public.${relation}\n FOR EACH ${granularity} EXECUTE FUNCTION public.custodial_private_custody_v1_immutable();`));
   assert.ok(source.includes(`ALTER TABLE public.${relation} ENABLE ALWAYS TRIGGER ${name};`));}
  assert.ok(source.includes(`ALTER TABLE public.${relation} FORCE ROW LEVEL SECURITY;`));
  assert.doesNotMatch(source,new RegExp(`GRANT\\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)[\\s\\S]*?ON\\s+public\\.${relation}\\s+TO`,'i'));}
 assert.match(source,/DO \$mutation_boundary\$ BEGIN[\s\S]*custodial_native_private_custody_operations[\s\S]*custodial_native_private_custody_chunks[\s\S]*tgname='custodial_disaster_restore_mutation_fence'[\s\S]*tgfoid='custodial_dr\.guard_application_mutation\(\)'::regprocedure AND tgenabled='O' AND NOT tgisinternal\)<>2[\s\S]*RAISE EXCEPTION[\s\S]*END \$mutation_boundary\$;/);
 assert.ok(source.includes('Exact recovery/canary inventory extension is intentionally still a draft'));
 const controlled='ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;';
 assert.equal(source.split(controlled).length,2);
 const lockIndex=source.indexOf('LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;');
 assert.ok(lockIndex>=0&&lockIndex<source.indexOf(controlled));
 for(const pin of ["<>6884","'d87c2c10574dbcaf542245a83b8019e66017b819a0abcc54d313074f831afb84'","'d9abaf120c47e789c6b3114717f14eb76d1ceacf9aea5600bccfb1005a176d27'","<>6968"])
  assert.ok(source.includes(pin));
 assert.ok(source.includes('FOR obj IN SELECT * FROM private_custody_objects ORDER BY bucket,priority,identity LOOP'));
 assert.ok(source.indexOf('ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;')>source.indexOf(controlled));
 assert.doesNotMatch(source.replace(controlled,''),/\b(?:DISABLE\s+TRIGGER|session_replication_role\s*=|ALTER\s+ROLE)\b/i);
 return true;
}
test('NEW01 both opaque tables declare ALWAYS immutable row and truncate statement guards',()=>assert.equal(guardContract(sql),true));
test('NEW02 dropping either exact truncate guard fails the new source contract',()=>{for(const prefix of ['operation','chunk'])assert.throws(()=>guardContract(sql.replace('CREATE TRIGGER trg_native_private_custody_'+prefix+'_no_truncate','-- removed truncate guard')));});
test('NEW03 ordinary instead of ALWAYS immutable/truncate declarations are rejected',()=>{for(const name of ['operation_immutable','chunk_immutable','operation_no_truncate','chunk_no_truncate'])assert.throws(()=>guardContract(sql.replace('ENABLE ALWAYS TRIGGER trg_native_private_custody_'+name,'ENABLE TRIGGER trg_native_private_custody_'+name)));});
test('NEW04 missing/wrong normal disaster-restore fence is not silently accepted',()=>{for(const change of [sql.replace("tgfoid='custodial_dr.guard_application_mutation()'","tgfoid='public.custodial_private_custody_v1_immutable()'"),sql.replace("AND tgenabled='O' AND NOT tgisinternal)<>2","AND tgenabled='O' AND NOT tgisinternal)<>1")])assert.throws(()=>guardContract(change));});
test('NEW05 direct table exposure and trigger-disable shortcuts are rejected',()=>{assert.throws(()=>guardContract(sql+'\nGRANT SELECT ON public.custodial_native_private_custody_operations TO service_role;'));
 assert.throws(()=>guardContract(sql+'\nALTER TABLE public.custodial_native_private_custody_chunks DISABLE TRIGGER ALL;'));});
test('NEW06 source-only incomplete recovery status cannot become admission',()=>assert.throws(()=>guardContract(sql.replace('Exact recovery/canary inventory extension is intentionally still a draft','Recovery qualified ready to deploy'))));
test('AFFECTED07 only the locked exact-predecessor inventory extension can use its existing controlled guard boundary',()=>{
 assert.throws(()=>guardContract(sql.replace('LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;','-- lock omitted')));
 assert.throws(()=>guardContract(sql.replace('DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable','DISABLE TRIGGER ALL')));
 assert.throws(()=>guardContract(sql.replace('ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable','ENABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable')));
});
test('AFFECTED08 full finite predecessor/member pins and dependency order cannot silently widen',()=>{
 for(const [from,to]of [["<>6884","<>6885"],["<>6968","<>6969"],['ORDER BY bucket,priority,identity LOOP','ORDER BY bucket,identity LOOP'],
  ['d9abaf120c47e789c6b3114717f14eb76d1ceacf9aea5600bccfb1005a176d27','a'.repeat(64)]])assert.throws(()=>guardContract(sql.replace(from,to)));
});
