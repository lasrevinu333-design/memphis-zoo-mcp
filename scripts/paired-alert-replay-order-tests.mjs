import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readMigrationReplayPlan} from './migration-replay-order.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const names=['00000000000000_baseline.sql','20261006120000_current_forward.sql','20261004120000_paired_alert.sql'];
function fixture(paired=true){
 const root=mkdtempSync(join(tmpdir(),'paired-alert-order-'));
 mkdirSync(join(root,'supabase/migrations'),{recursive:true});mkdirSync(join(root,'supabase/canonical'));
 const rows=names.slice(0,paired?3:2).map((name,i)=>{const bytes=`select ${i};\n`;writeFileSync(join(root,'supabase/migrations',name),bytes);return{name,sha256:sha(bytes)};});
 const doc={schema:'custodial.migration-replay-order.'+(paired?'v2':'v1'),base_source_commit:'a'.repeat(40),production_execution_authorized:false,
  phases:[{kind:'verified_main_source_prefix',files:[rows[0]]},{kind:'forward_source_after_prefix',files:[rows[1]]}]};
 if(paired){doc.integration_base_source_commit='b'.repeat(40);doc.phases.push({kind:'paired_native_alert_source_after_current_forward',files:[rows[2]]});}
 const file=join(root,'supabase/canonical/migration-replay-order.json');const save=()=>writeFileSync(file,JSON.stringify(doc));save();
 return{root,doc,save,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('historical two-phase contract stays supported and unchanged',()=>{const f=fixture(false);try{const p=readMigrationReplayPlan(f.root);assert.deepEqual(p.files,names.slice(0,2));assert.equal(p.forwardCount,1);assert.equal(p.pairedAlertCount,0);}finally{f.close();}});
test('paired source follows its current predecessor despite creation date',()=>{const f=fixture();try{const p=readMigrationReplayPlan(f.root);assert.deepEqual(p.files,names);assert.equal(p.forwardCount,2);assert.equal(p.pairedAlertCount,1);assert.equal(p.integrationBaseSourceCommit,'b'.repeat(40));}finally{f.close();}});
for(const [name,change] of [
 ['missing integration commit',f=>delete f.doc.integration_base_source_commit],
 ['invalid integration commit',f=>f.doc.integration_base_source_commit='latest'],
 ['wrong third phase',f=>f.doc.phases[2].kind='arbitrary_skip'],
 ['unversioned third phase',f=>f.doc.schema='custodial.migration-replay-order.v1'],
 ['missing third phase',f=>f.doc.phases.pop()],
 ['extra phase',f=>f.doc.phases.push(f.doc.phases[2])],
 ['duplicate identity across phases',f=>f.doc.phases[2].files.push(f.doc.phases[1].files[0])],
 ['omitted source',f=>f.doc.phases[2].files=[]],
 ['false source hash',f=>f.doc.phases[2].files[0].sha256='c'.repeat(64)],
 ['unauthorized production claim',f=>f.doc.production_execution_authorized=true],
 ['interchanged predecessor phases',f=>f.doc.phases.reverse()],
]) test('paired manifest rejects '+name,()=>{const f=fixture();try{change(f);f.save();assert.throws(()=>readMigrationReplayPlan(f.root),e=>e.code==='migration_replay_order_invalid');}finally{f.close();}});
test('actual chain retains every old SQL byte and exact manager predecessor',()=>{
 const p=readMigrationReplayPlan(),doc=JSON.parse(readFileSync('supabase/canonical/migration-replay-order.json'));
 assert.equal(p.baseCount,134);assert.equal(doc.phases[1].files.length,93);assert.equal(p.pairedAlertCount,5);assert.equal(p.forwardCount,98);assert.equal(p.files.length,232);
 assert.equal(p.integrationBaseSourceCommit,'6b6caecff2f8a6b182f570e84d96e6876c6fdbc9');
 assert.equal(p.files[226],'20261006211215_preserved_coverall_validator_recovery.sql');
 assert.equal(p.files[227],'20261004150151_native_alert_two_stage_preparation.sql');
 assert.equal(p.files[231],'20261005115223_overdue_popup_stops_at_scan_start.sql');
 assert.equal(new Set(p.files).size,232);
 // The old production declaration deliberately cannot authorize this new pair.
 // It needs new actual schema evidence, exact release inputs and normal admission.
 const state=JSON.parse(readFileSync('release/production-migration-state.json'));
 assert.notEqual(state.source_binding.source_replay_manifest_sha256,p.manifestSha256);
 assert.notDeepEqual(state.pending_migrations.map(x=>x.file),p.files.slice(p.baseCount));
});
