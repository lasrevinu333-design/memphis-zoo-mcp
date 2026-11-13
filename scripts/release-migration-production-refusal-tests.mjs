import assert from 'node:assert/strict';
import {runTargetCaptureStep,PRIVATE_CUSTODY_SOURCE252_FILE,PRIVATE_CUSTODY_SOURCE252_FORWARD_SHA256} from './release-migration-target-refusal.mjs';

const migration={order:119,file:PRIVATE_CUSTODY_SOURCE252_FILE,sha256:PRIVATE_CUSTODY_SOURCE252_FORWARD_SHA256};
let checks=0;
for(const changed of [{order:118},{file:'unrelated.sql'},{sha256:'0'.repeat(64)}]) {
 const calls=[];
 const result=await runTargetCaptureStep({db:{async query(sql){calls.push(sql);}},migration:{...migration,...changed},
  targetCapture:false,productionRefusal:true,run:async()=>42,onRefusal:()=>assert.fail()});
 assert.equal(result,42);assert.deepEqual(calls,[]);checks++;
}
{
 const calls=[];
 const result=await runTargetCaptureStep({db:{async query(sql){calls.push(sql);return{rows:[]};}},migration,
  targetCapture:false,productionRefusal:true,run:async()=>42,onRefusal:()=>assert.fail()});
 assert.equal(result,42);assert.deepEqual(calls,['savepoint custodial_target_migration_step','release savepoint custodial_target_migration_step']);checks++;
}
{
 const calls=[];let diagnostic,runCalls=0;
 const original=Object.assign(Error('private original failure'),{code:'P0001'});
 const db={async query(sql){calls.push(sql);
  if(sql.startsWith('select '))throw Object.assign(Error('private metadata failure'),{code:'42501'});
  return{rows:[]};}};
 await assert.rejects(runTargetCaptureStep({db,migration,targetCapture:false,productionRefusal:true,
  run:async()=>{runCalls++;throw original;},onRefusal:value=>diagnostic=value}),error=>error===original);
 assert.equal(runCalls,1);assert.equal(diagnostic.metadata_read_failed,true);assert.equal(diagnostic.code,'42501');
 assert.equal(calls.filter(sql=>sql==='rollback to savepoint custodial_target_migration_step').length,2);
 assert.ok(!calls.some(sql=>/commit|release savepoint/i.test(sql)));
 assert.ok(!JSON.stringify(diagnostic).includes('private original failure'));
 assert.ok(!JSON.stringify(diagnostic).includes('private metadata failure'));checks++;
}
console.log(JSON.stringify({ok:true,checks,scope:'recording-client diagnostics; no database mutation'}));
