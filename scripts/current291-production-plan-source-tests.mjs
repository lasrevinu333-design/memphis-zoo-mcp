import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {assertCapturedTargetCatalog,assertReleaseWorkflowSource} from './release-migration-workflow-preflight.mjs';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
import {resolveReleaseMigrationSource} from './production-forward-source.mjs';
const root=resolve(new URL('..',import.meta.url).pathname);
const state=JSON.parse(readFileSync(resolve(root,'release/production-migration-state.json')));
const binding=JSON.parse(readFileSync(resolve(root,'release/current291-staged-source-binding.json')));
const plan=readMigrationReplayPlan(root);const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const sha=b=>createHash('sha256').update(b).digest('hex');
check('exact134 base and157 current pending members',()=>{
 assert.equal(plan.baseCount,134);assert.equal(plan.files.length,291);
 assert.equal(state.pending_migrations.length,157);
 assert.deepEqual(state.pending_migrations.map(x=>x.file),plan.files.slice(134));
});
check('every original applied-prefix byte remains exact',()=>{
 assert.equal(binding.preserved134.length,134);
 for(const x of binding.preserved134)assert.equal(sha(readFileSync(resolve(root,'supabase/migrations',x.file))),x.sha256);
});
check('all157 source versions/order/hash resolve, only27 explicit existing-owner variants',()=>{
 assert.equal(state.pending_migrations.filter(x=>x.forward_source).length,27);
 for(const [i,x]of state.pending_migrations.entries()){
  assert.equal(x.order,i+1);assert.equal(x.source_migration_version,x.file.slice(0,14));
  const actual=resolveReleaseMigrationSource(root,x);assert.equal(sha(actual.sql),x.sha256);
  if(x.forward_source)assert.equal(actual.forward_profile,'existing-postgres-owner');
 }
});
check('original118 canonical preimages retained',()=>{
 for(const [i,x]of binding.historical118.entries()){
  const n=state.pending_migrations[i];assert.equal(n.file,x.file);
  assert.equal(n.forward_source?.canonical_sha256||n.sha256,x.sha256);
 }
});
check('C10 fresh-only map is comparison context, no fresh SQL imported',()=>{
 assert.equal(state.source_binding.current291_preparation.fresh_SQL_overrides_copied_to_production,false);
 assert.ok(state.pending_migrations.every(x=>!x.forward_source||x.forward_source.profile==='existing-postgres-owner'));
});
check('current unresolved target refuses normal preflight before DB exists',()=>{
 assert.equal(state.target.canonical_source_schema_fingerprint,null);
 assert.equal(state.target.expected_catalog_counts,null);
 assert.equal(state.target.production_ledger_count,null);
 assert.throws(()=>assertReleaseWorkflowSource(root),/Current populated target catalog capture/);
});
// UNIT shape witnesses only: accepting a structural object is not a catalog,
// expected fingerprint, populated rehearsal, signed authorization or DB proof.
const unit={canonical_source_schema_fingerprint:'a'.repeat(64),expected_catalog_counts:{functions:1},production_ledger_count:1,public_function_count:1};
check('existing target structural prerequisite accepts fully typed UNIT only',()=>assert.doesNotThrow(()=>assertCapturedTargetCatalog(unit)));
for(const key of Object.keys(unit))check('missing target '+key+' refuses',()=>{const x={...unit};delete x[key];assert.throws(()=>assertCapturedTargetCatalog(x));});
check('original217-table proof stays mandatory at157, no155 bypass',()=>{
 const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
 assert.ok(source.includes('rehearsal&&plan.length===157'));
 assert.ok(!source.includes('rehearsal&&plan.length===155'));
 const m=JSON.parse(readFileSync(resolve(root,'release/production-data-preservation/original-235.json')));
 assert.equal(m.plan.length,157);assert.equal(m.tables.length,182);assert.equal(m.production_authorized,false);
 assert.deepEqual(m.plan.map(x=>x.file),state.pending_migrations.map(x=>x.file));
});
check('normal apply preflight is before any client/query; transaction rollback body retained',()=>{
 const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
 assert.ok(source.indexOf('if (!targetCapture) assertReleaseWorkflowSource(root);')<source.indexOf('new Client('));
 assert.ok(source.includes('await db.query("begin isolation level serializable")'));
 assert.ok(source.includes('await db.query("rollback")')||source.includes("await db.query('rollback')"));
});
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY_NO_DB',checks,SQL_execution:false,production_authorized:false,target_facts_adopted:false}));
