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
check('exact134 base and160 current pending members',()=>{
 assert.equal(plan.baseCount,134);assert.equal(plan.files.length,294);
 assert.equal(state.pending_migrations.length,160);
 assert.deepEqual(state.pending_migrations.map(x=>x.file),plan.files.slice(134));
});
check('every original applied-prefix byte remains exact',()=>{
 assert.equal(binding.preserved134.length,134);
 for(const x of binding.preserved134)assert.equal(sha(readFileSync(resolve(root,'supabase/migrations',x.file))),x.sha256);
});
check('all160 source versions/order/hash resolve, only29 explicit existing-owner variants',()=>{
 assert.equal(state.pending_migrations.filter(x=>x.forward_source).length,29);
 for(const [i,x]of state.pending_migrations.entries()){
  assert.equal(x.order,i+1);assert.equal(x.source_migration_version,x.file.slice(0,14));
  const actual=resolveReleaseMigrationSource(root,x);assert.equal(sha(actual.sql),x.sha256);
  if(x.forward_source)assert.equal(actual.forward_profile,'existing-postgres-owner');
 }
});

check('order156 exact existing qualified ALWAYS image preserves every other canonical byte',()=>{
 const item=state.pending_migrations[155];assert.equal(item.order,156);assert.equal(item.file,'20261022041249_original_schedule_delivery_outcome.sql');
 const canonical=readFileSync(resolve(root,'supabase/migrations',item.file),'utf8');
 assert.equal(sha(canonical),'4d201d542066718e58932199db06b358e19e947f60de72a0c1ca8097a79ff71a');
 const old='alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;';
 assert.equal(canonical.split(old).length,2);
 const selected=resolveReleaseMigrationSource(root,item);assert.equal(selected.canonical_sha256,sha(canonical));
 assert.equal(selected.sql,canonical.replace(old,old.replace('enable trigger','enable always trigger')));
 assert.equal(sha(selected.sql),'ee140104c1f3f9c523f345e1a9295fb0be490e2c15a221b815353f8a63c75ef1');
 assert.equal(selected.sql,readFileSync(resolve(root,'release/fresh-only-replay/images',item.file),'utf8'));
 assert.equal(item.forward_source.profile,'existing-postgres-owner');assert.equal(item.forward_source.file,'release/production-forward-source/'+item.file);
 assert.equal(item.sha256,sha(selected.sql));assert.notEqual(item.sha256,sha(canonical));
 for(const bad of [{...item,forward_source:undefined},{...item,sha256:'0'.repeat(64)},
  {...item,forward_source:{...item.forward_source,profile:'arbitrary-owner'}},
  {...item,forward_source:{...item.forward_source,canonical_sha256:'0'.repeat(64)}},
  {...item,forward_source:{...item.forward_source,sha256:'0'.repeat(64)}},
  {...item,forward_source:{...item.forward_source,file:'release/fresh-only-replay/images/'+item.file}}])assert.throws(()=>resolveReleaseMigrationSource(root,bad));
 const successor=readFileSync(resolve(root,'supabase/migrations/20261022071830_recurring_normal_notification_plan.sql'),'utf8');
 assert.ok(successor.includes("if (select tgenabled from v27_inventory_guard_before)='A' then"));
 assert.ok(successor.includes("is distinct from (select tgenabled from v27_inventory_guard_before)"));
 const guard=resolveReleaseMigrationSource(root,state.pending_migrations[157]).sql;
 assert.ok(guard.includes('custodial_release_authority_restore_inventory)<>7312'));
 assert.ok(guard.includes("tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A'"));
});

check('order158 exact original production actor counterpart preserves every other canonical byte',()=>{
 const item=state.pending_migrations[157];assert.equal(item.order,158);assert.equal(item.file,'20261025094420_authority_identity_renderer_counterparts.sql');
 const original=readFileSync(resolve(root,'supabase/migrations',item.file),'utf8');
 assert.equal(sha(original),'19e55cfdc9f1ddfd34c2912892ac23979ad5fc44a45da7e444a008b1da0a8c9b');
 const old="IF session_user<>'supabase_admin' OR current_user<>session_user OR current_setting('session_replication_role')<>'origin' THEN";
 assert.equal(original.split(old).length,2);
 const selected=resolveReleaseMigrationSource(root,item);assert.equal(selected.canonical_sha256,sha(original));
 assert.equal(selected.sql,original.replace(old,old.replace("'supabase_admin'","'postgres'")));
 assert.equal(item.forward_source.profile,'existing-postgres-owner');assert.equal(item.forward_source.file,'release/production-forward-source/'+item.file);
 assert.equal(item.sha256,sha(selected.sql));assert.notEqual(item.sha256,sha(original));
 for(const bad of [{...item,forward_source:undefined},{...item,sha256:'0'.repeat(64)},
  {...item,forward_source:{...item.forward_source,profile:'arbitrary-owner'}},
  {...item,forward_source:{...item.forward_source,canonical_sha256:'0'.repeat(64)}}])assert.throws(()=>resolveReleaseMigrationSource(root,bad));
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
check('original217-table proof stays mandatory at160, no155 bypass',()=>{
 const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
 assert.ok(source.includes('rehearsal&&plan.length===160'));
 assert.ok(!source.includes('rehearsal&&plan.length===155'));
 const m=JSON.parse(readFileSync(resolve(root,'release/production-data-preservation/original-235.json')));
 assert.equal(m.plan.length,160);assert.equal(m.tables.length,182);assert.equal(m.production_authorized,false);
 assert.deepEqual(m.plan.map(x=>x.file),state.pending_migrations.map(x=>x.file));
});
check('normal apply preflight is before any client/query; transaction rollback body retained',()=>{
 const source=readFileSync(resolve(root,'scripts/apply-release-migration-plan.mjs'),'utf8');
 assert.ok(source.indexOf('if (!targetCapture) assertReleaseWorkflowSource(root);')<source.indexOf('new Client('));
 assert.ok(source.includes('await db.query("begin isolation level serializable")'));
 assert.ok(source.includes('await db.query("rollback")')||source.includes("await db.query('rollback')"));
});
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY_NO_DB',checks,SQL_execution:false,production_authorized:false,target_facts_adopted:false}));
