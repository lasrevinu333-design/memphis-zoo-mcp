import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
import {source252FreshOrderSql} from './source252-fresh-replay-order.mjs';
import {source291FreshCanarySql} from './source291-fresh-canary-order.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const SOURCE304='abba683ec10c75fb3ab585e8a12351a410438bd24822569d3f3671c9ae6fa751';
const GUARD_NAME='20261022041249_original_schedule_delivery_outcome.sql';
const GUARD_ORIGINAL='4d201d542066718e58932199db06b358e19e947f60de72a0c1ca8097a79ff71a';
const GUARD_SELECTED='ee140104c1f3f9c523f345e1a9295fb0be490e2c15a221b815353f8a63c75ef1';
const REPAIRS=Object.freeze([
 {name:'20261101034931_custodial_completion_evidence_cohort_read.sql',sha256:'99f982986326bcca994f9a38c5d00090ac2aa0ce88f1d81973c863387ec79630'},
 {name:'20261101044239_custodial_cohort_places_feedback.sql',sha256:'d87fe5d221c4441e7c865c19e37f2e6e26cbc56b510816de10fef649a69cde78'},
 {name:'20261102000000_unfinished_work_owner_attention.sql',sha256:'e8fb1bb569b653a53b05f52944a14ab232e5e0542eaeec30173a9194fd6ca835'},
 {name:'20261102010000_local_retained_enrollment_partition.sql',sha256:'83f817a25ffe468c715323cf71f62a0c65cbe5a2fe68fde9d75903b55678a4d1'},
]);
/** Explicit fresh reconstruction profile, never a production/recovery grant.
 * All304 original SQL bytes/order are retained. Source252's exact sealed
 * predecessor is reproduced, and the already supplied source289 counterpart
 * preserves ALWAYS rather than downgrading the inventory guard to ordinary.
 * The original expected predecessor hashes and release evidence remain exact.
 */
export function readCurrentCandidateReplayProfile(root=fileURLToPath(new URL('..',import.meta.url))){
 root=resolve(root);const plan=readMigrationReplayPlan(root);
 const bytes=readFileSync(resolve(root,'scripts/fixtures/solo-repair-source304-replay.json'));
 if(sha(bytes)!==SOURCE304)throw Error('Original Source304 replay preimage differs');
 const original=JSON.parse(bytes),previous=original.phases.flatMap(p=>p.files);
 const current=JSON.parse(readFileSync(resolve(root,'supabase/canonical/migration-replay-order.json')));
 const entries=current.phases.flatMap(p=>p.files);
 if(previous.length!==304||entries.length!==308||JSON.stringify(entries.slice(0,304))!==JSON.stringify(previous)
  ||JSON.stringify(entries.slice(304))!==JSON.stringify(REPAIRS)
  ||current.production_execution_authorized!==false)
  throw Error('Only the exact declared four repairs may follow original Source304');
 const before=readFileSync(resolve(root,'supabase/migrations',GUARD_NAME));
 const selected=readFileSync(resolve(root,'release/fresh-only-replay/images',GUARD_NAME));
 if(sha(before)!==GUARD_ORIGINAL||sha(selected)!==GUARD_SELECTED
  ||before.toString().replace('alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;',
   'alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;')!==selected.toString())
  throw Error('Exact original source289 ALWAYS-preserving counterpart required');
 const orderSql=source252FreshOrderSql(readFileSync(resolve(root,'release/production-forward-source/private-custody-source252-reference.json')));
 const index=new Map(entries.map(e=>[e.name,e]));
 const migrationSql=name=>{
  const row=index.get(name);if(!row)throw Error('Undeclared migration');
  const bytes=readFileSync(resolve(root,'supabase/migrations',name));if(sha(bytes)!==row.sha256)throw Error('Source migration changed after profile capture');
  return name===GUARD_NAME?selected.toString():bytes.toString();
 };
 const description=Object.freeze({schema:'custodial.current-candidate-fresh-replay.v2',
  scope:'ISOLATED_FULL_VENDOR_NO_AUTO_CURRENT308_RECONSTRUCTION',production_execution_authorized:false,
  release_admission:false,recovery_admission:false,original304_manifest_sha256:SOURCE304,
  current_manifest_sha256:plan.manifestSha256,migration_count:entries.length,
  memory_bytes:536870912,combined_memory_swap_bytes:536870912,data_storage:'owned secondary disk',
  source252_sealed_order_repair_sha256:sha(orderSql),
  fresh_only_hooks:[{before:'20261010193211_native_private_custody_chunk_retention.sql',scope:'Exact sealed Source252 recorded eleven- or seventeen-order permutation only; unchanged definitions and original expected predecessor'},
   {before:'20261025094420_authority_identity_renderer_counterparts.sql',scope:'Exact same complete canary tuple multiset and outside SQL; original source292 literal order only',
    observed_preimage_sha256:'9bf59d727808a52c67a3f9be5223b3f0996219af738ddc8421125e7391540027',
    original_expected_sha256:'6df9122356e7efbfce635c423fdbca00f419ef4eafbedc8b4fb9e5a0550a39e7'}],
  effective_sql:entries.map(row=>({...row,effective_sha256:sha(migrationSql(row.name))})),
  source289_preserves_original_ALWAYS_guard:true});
 return Object.freeze({description,migrationSql,beforeMigration:(name,observed)=>{
  if(name==='20261010193211_native_private_custody_chunk_retention.sql')return orderSql;
  if(name==='20261025094420_authority_identity_renderer_counterparts.sql')return source291FreshCanarySql(readFileSync(resolve(root,'supabase/migrations',name)),observed);
  return null;
 }});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const profile=readCurrentCandidateReplayProfile();
 if(process.argv[2]==='--describe')process.stdout.write(JSON.stringify(profile.description,null,2)+'\n');
 else if(process.argv[2]==='--migration-sql')process.stdout.write(profile.migrationSql(process.argv[3]));
 else if(process.argv[2]==='--before-sql')process.stdout.write(profile.beforeMigration(process.argv[3],process.argv[4]?readFileSync(process.argv[4],'utf8'):undefined)||'');
 else throw Error('Select --describe, --migration-sql NAME or --before-sql NAME');
}
