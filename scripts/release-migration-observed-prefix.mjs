import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
// Already installed, exact independently observed Source only. This statement
// is never appended to canonical replay or the unapplied migration plan.
export const OBSERVED_OPERATIONAL_DAY_SOURCE=Object.freeze({
 ledger_version:'20261021111917',ledger_name:'dashboard_application_reader_operational_day_repair',
 source_file:'release/target-capture-source/20261021111917_dashboard_application_reader_operational_day_repair.sql',
 sha256:'be68ea76fb70c183c63986307759c21ababa4b5f6aac53b01532abdb5efa267e',
});
export function assertObservedSourcePrefix(root,state,canonicalApplied) {
 const source=state.observed_production,binding=state.source_binding;
 const observed=source.ledger_head+'_'+source.source_migration_name+'.sql';
 if(canonicalApplied.at(-1)===observed){
  assert.equal(Object.hasOwn(binding,'observed_source_extensions'),false,'Unexpected installed extension on unchanged canonical source head');
  return;
 }
 // Finite one-grant exception. Actual catalog/ledger still require the normal
 // locked comparison and fresh signed backup; this is no mutation authority.
 assert.equal(state.project_ref,'rqquvtjdmugpigbndmne');
 assert.equal(canonicalApplied.length,134);assert.equal(source.source_authority_migration_count,134);
 assert.equal(canonicalApplied.at(-1),'20261006203931_custodial_delegated_coverall.sql');
 assert.equal(source.production_ledger_count,235);
 assert.equal(source.ledger_head,OBSERVED_OPERATIONAL_DAY_SOURCE.ledger_version);
 assert.equal(source.source_migration_name,OBSERVED_OPERATIONAL_DAY_SOURCE.ledger_name);
 assert.equal(source.catalog_privilege_fingerprint,'0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2');
 assert.deepEqual(binding.observed_source_extensions,[OBSERVED_OPERATIONAL_DAY_SOURCE]);
 const path=resolve(root,OBSERVED_OPERATIONAL_DAY_SOURCE.source_file),stat=lstatSync(path);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,4184);
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),OBSERVED_OPERATIONAL_DAY_SOURCE.sha256);
}
