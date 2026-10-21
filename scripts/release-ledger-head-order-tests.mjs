import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {stableJson} from './disaster-recovery-crypto.mjs';
const state=JSON.parse(readFileSync('release/production-migration-state.json','utf8')),source=readFileSync('scripts/apply-release-migration-plan.mjs','utf8');
const start=source.indexOf('  const expectedVersions = new Set(['),end=source.indexOf('  const outlookAfter =',start);assert.ok(start>=0&&end>start);
const realGuard=source.slice(start,end),before=Array.from({length:233},(_,i)=>({version:'202601'+String(i+1).padStart(8,'0'),name:'synthetic',statements:[]}));
before.push({version:state.observed_production.ledger_head,name:state.observed_production.source_migration_name,statements:[]});
const plan=state.pending_migrations.map(x=>({...x,sql:readFileSync('supabase/migrations/'+x.file,'utf8')}));
const after=before.concat(plan.map(x=>({version:x.source_migration_version,name:x.phase,statements:[x.sql]}))).sort((a,b)=>a.version.localeCompare(b.version));
const expectedHead=after.at(-1).version,tail=plan.at(-1).source_migration_version;
function run(targetHead,mutate=()=>{},selectedPlan=plan){const selectedAfter=before.concat(selectedPlan.map(x=>({version:x.source_migration_version,name:x.phase,statements:[x.sql]}))).sort((a,b)=>a.version.localeCompare(b.version));const fixture={state:structuredClone(state),plan:selectedPlan,afterLedger:{rows:structuredClone(selectedAfter),rowCount:selectedAfter.length},beforeLedger:{rows:before,rowCount:before.length}};fixture.state.target.source_migration_version=targetHead;fixture.state.target.production_ledger_count=selectedAfter.length;mutate(fixture);
 const ctx=vm.createContext({stableJson});new vm.Script('const f=JSON.parse('+JSON.stringify(JSON.stringify(fixture))+');const state=f.state,plan=f.plan,afterLedger=f.afterLedger,beforeLedger=f.beforeLedger;').runInContext(ctx,{timeout:1000});new vm.Script(realGuard,{filename:'actual-apply-release-ledger-guard'}).runInContext(ctx,{timeout:1000});}
let checks=0;assert.equal(tail,'20261007104735');assert.equal(expectedHead,'20261007104735');checks+=2;
assert.throws(()=>run('20261006211215'),/ledger did not advance by the exact ordered plan/);checks++;
run(expectedHead);checks++;
assert.equal(state.target.source_migration_version,expectedHead,'source metadata must declare max ledger version, NOT execution tail');checks++;
for(const mutate of [f=>f.afterLedger.rowCount--,f=>f.afterLedger.rows.pop(),f=>f.afterLedger.rows[0].version='20991231235959',f=>f.afterLedger.rows.push(f.afterLedger.rows[0]),f=>f.afterLedger.rows.at(-1).statements=['changed SQL'],f=>f.afterLedger.rows.at(-1).name='different-phase']){assert.throws(()=>run(expectedHead,mutate));checks++;}
assert.deepEqual(state.target.execution_tail,{file:plan.at(-1).file,version:tail,role:'last_applied_member'});checks++;
// Preserve the original backdated-98 counterexample, rather than losing it
// when the new forward guard correction also happens to be the ledger maximum.
const historical=plan.slice(0,-1);assert.equal(historical.at(-1).source_migration_version,'20261005115223');checks++;
assert.throws(()=>run('20261005115223',()=>{},historical),/ledger did not advance by the exact ordered plan/);checks++;
run('20261006211215',()=>{},historical);checks++;
console.log(JSON.stringify({status:'LEDGER_HEAD_VS_EXECUTION_ORDER_PASS',checks,execution_tail:tail,expected_ledger_head:expectedHead,guard_source_unchanged:true,sql:false,synthetic:true,production:false}));
