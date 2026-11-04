import assert from 'node:assert/strict';
import {runTargetCaptureStep} from './release-migration-target-refusal.mjs';
import {CURRENT308_FILE,CURRENT308_SHA256,CURRENT308_FORWARD_SHA256,CURRENT_TAIL_STAGES,CURRENT308_PREDECESSORS,CURRENT308_METADATA_SQL} from './release-migration-current308-refusal.mjs';
const migration={order:175,file:CURRENT308_FILE,sha256:CURRENT308_SHA256};
function fixture({denied=false}={}){
 let aborted=false;const calls=[];
 return {calls,abort(){aborted=true;},async query(sql,args){
  calls.push({sql,args});
  if(sql==='rollback to savepoint custodial_target_migration_step'){aborted=false;return {rows:[]};}
  assert.equal(aborted,false);
  if(sql.startsWith('savepoint ')||sql.startsWith('release savepoint ')||sql.startsWith('set local search_path'))return {rows:[]};
  assert.ok(Object.values(CURRENT308_METADATA_SQL).includes(sql));assert.ok(sql.startsWith('select '));
  if(denied)throw Object.assign(Error('private denial detail'),{code:'42501'});
  if(sql===CURRENT308_METADATA_SQL.relations)return {rows:Array.from({length:240},()=>({fixture:true}))};
  if(sql===CURRENT308_METADATA_SQL.predecessor){assert.ok(CURRENT308_PREDECESSORS.some(p=>p.kind===args[0]&&p.identity===args[1]));return {rows:[{fixture:true}]};}
  assert.equal(args,undefined);return {rows:[{fixture:true}]};
 }};
}
let checks=0;
for(const changed of [null,'order','sha256']){
 const db=fixture();let receipt;const error=Object.assign(Error('private original error'),{code:'P0001'});
 const selected=changed?{...migration,[changed]:changed==='order'?174:'0'.repeat(64)}:migration;
 await assert.rejects(runTargetCaptureStep({db,migration:selected,targetCapture:true,run:async()=>{db.abort();throw error;},onRefusal:r=>receipt=r}),e=>e===error);
 if(changed){assert.equal(receipt.metadata_read_failed,true);assert.equal(db.calls.filter(c=>c.sql.startsWith('select ')).length,0);}
 else {assert.equal(receipt.current308.predecessors.length,39);assert.equal(db.calls.filter(c=>c.sql.startsWith('select ')).length,43);assert.equal(JSON.stringify(receipt).includes(error.message),false);}
 assert.ok(!db.calls.some(c=>/commit|release savepoint/.test(c.sql)));checks++;
}
{
 const db=fixture({denied:true});let receipt;const error=Object.assign(Error('original'),{code:'P0001'});
 await assert.rejects(runTargetCaptureStep({db,migration,targetCapture:true,run:async()=>{db.abort();throw error;},onRefusal:r=>receipt=r}),e=>e===error);
 assert.equal(receipt.metadata_read_failed,true);assert.equal(receipt.code,'42501');checks++;
}
{
 const db=fixture();assert.equal(await runTargetCaptureStep({db,migration,targetCapture:false,run:async()=>42,onRefusal:()=>assert.fail()}),42);assert.equal(db.calls.length,0);checks++;
}
for(const selected of [
 {...migration,sha256:CURRENT308_FORWARD_SHA256,forward_source:{schema:'custodial.production-forward-source-binding.v1',profile:'existing-postgres-owner',canonical_sha256:CURRENT308_SHA256,file:'release/production-forward-source/'+CURRENT308_FILE,sha256:CURRENT308_FORWARD_SHA256}},
 ...CURRENT_TAIL_STAGES]){
 for(const changed of [false,true]){
  const db=fixture();let receipt;const error=Object.assign(Error('original'),{code:'P0001'});
  const candidate=structuredClone(selected);if(changed){if(candidate.forward_source)candidate.forward_source.canonical_sha256='0'.repeat(64);else candidate.sha256='0'.repeat(64);}
  await assert.rejects(runTargetCaptureStep({db,migration:candidate,targetCapture:true,run:async()=>{db.abort();throw error;},onRefusal:r=>receipt=r}),e=>e===error);
  if(changed){assert.equal(receipt.metadata_read_failed,true);assert.equal(db.calls.filter(c=>c.sql.startsWith('select ')).length,0);}
  else {assert.equal(receipt.metadata_read_failed,undefined);if(selected.stage)assert.equal(receipt[selected.stage].relations.length,240);else assert.equal(receipt.current308.predecessors.length,39);}
  checks++;
 }
}
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',checks,metadata_only:true,actual_database:false}));
