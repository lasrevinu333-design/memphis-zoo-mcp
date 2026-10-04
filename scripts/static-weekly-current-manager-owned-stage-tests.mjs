import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {createCurrentManager219OwnedCheckpoint} from './static-weekly-current-manager-owned-checkpoint.mjs';
import {closeOwnedReadbackPool,managerClockForExistingAttempt,remainingOwnedAttempt,
 runCurrentManagerOwned219Stage} from './static-weekly-current-manager-owned-stage.mjs';

const packet=loadCurrentManagerPublicationFixture().packet;
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const days=Array.from({length:7},(_,i)=>{
 const date=new Date(Date.parse('2026-10-05T12:00:00Z')+i*86400000),dow=date.getUTCDay();
 const slots=packet.rosterSlots.filter(slot=>slot.days.includes(dow));
 return {date:date.toISOString().slice(0,10),projectionId:uuid(3),projectionStatus:'current',
  lunchIdentity:'a'.repeat(64),rosterCount:slots.length,loanCount:slots.filter(slot=>slot.personId).length};
});
const environment={containerName:'mz_schema_shift_end_12345',containerId:'c'.repeat(64),
 image:'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed',
 network:'none',socket:'/tmp/mz-shift-socket-abc123',socketMount:'/test-socket',database:'postgres'};
const publication={managerId:uuid(131),secondManagerId:uuid(273),week:'2026-10-05',
 currentSourceId:packet.sourceId,currentSourceDigest:packet.sourceDigest,
 originalSourceId:packet.original.sourceId,originalSourceDigest:packet.original.sourceDigest,
 versionId:uuid(1),publicationId:uuid(2),projectionId:uuid(3),authorityRevision:7,
 projectionStatus:'current',acceptedRows:494,relationalDigest:'b'.repeat(32),
 lunchIdentity:'a'.repeat(64),lunchLoans:30,dates:days,defaultApiGrants:0,
 confirmationStatus:'NOT_YET_ATTEMPTED'};
const checkpoint=createCurrentManager219OwnedCheckpoint({publication,environment});
let checks=0;
const pass=(label,fn)=>{fn();checks++;console.log('PASS',label);};
pass('one process origin subtracts setup and reserves cleanup',()=>{
 assert.equal(remainingOwnedAttempt(()=>0),50000);
 assert.equal(remainingOwnedAttempt(()=>45000),5000);
 assert.equal(remainingOwnedAttempt(()=>50000),0);
 assert.equal(remainingOwnedAttempt(()=>60000),0);
});
pass('manager request clock inherits original deadline without reset',()=>{
 let delay=null;
 const clock=managerClockForExistingAttempt(50000,{now:()=>20000,
  setTimer:(_fn,ms)=>{delay=ms;return 7;},clearTimer:()=>{}});
 assert.equal(clock.now(),-10000);
 assert.equal(clock.now()+60000,50000);
 assert.equal(clock.setTimer(()=>{},55000),7);
 assert.equal(delay,25000);
 assert.throws(()=>managerClockForExistingAttempt(60001));
});
await closeOwnedReadbackPool({async end(){}},{now:()=>50000});
checks++;console.log('PASS owned pool ends inside original cleanup reserve');
await assert.rejects(()=>closeOwnedReadbackPool({async end(){throw Error('exact pool failure');}},
 {now:()=>50000}),/exact pool failure/);
checks++;console.log('PASS owned pool failure is not converted to success');
await assert.rejects(()=>closeOwnedReadbackPool({end(){return new Promise(()=>{});}},
 {now:()=>50000,setTimer:callback=>{queueMicrotask(callback);return 7;},clearTimer:()=>{}}),
 /settlement unknown/);
checks++;console.log('PASS never-settling pool is unknown before container cleanup');
await assert.rejects(()=>closeOwnedReadbackPool({end(){throw Error('must not start');}},
 {now:()=>55000}),/no time before exact container cleanup/);
checks++;console.log('PASS exhausted reserve refuses new pool settlement');
const events=[];
const fakePool={async end(){events.push('pool_end');}};
let now=0;
const options={container:environment.containerName,socket:environment.socket,containerId:environment.containerId,
 now:()=>now,emit:(...args)=>events.push(args[0]),
 produceCheckpoint:async({output,deadlineAt,sourceDigest})=>{
  assert.equal(deadlineAt,50000);assert.match(sourceDigest,/^[a-f0-9]{64}$/);
  writeFileSync(output,JSON.stringify(checkpoint)+'\n',{flag:'wx'});
  events.push('persisted');return {groupAbsent:true,receipt:{checkpointDigest:checkpoint.digest}};
 },
 sql:()=>{events.push('no_source_sessions');return '0';},
 docker:args=>{events.push('clone');assert.deepEqual(args.slice(0,2),['exec','-i']);
  assert.ok(args.includes('template1'));return '';},
 loadPg:async()=>({Pool:class{constructor(config){assert.match(config.connectionString,/mz_schema_rebuild_operation_/);
  assert.equal(config.ssl,false);return fakePool;}}}),
 cloneReadback:async({checkpoint:actual,plan})=>{events.push('clone_readback');
  assert.equal(actual.digest,checkpoint.digest);assert.equal(plan.network,'none');
  return {classification:'CALLER_READBACK_MATCHED_NOT_SQL_EXECUTION_PROOF',
   STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL:plan.rehearsalUrl};},
 httpStage:async({pool,managerOperationClock,attemptRemainingMilliseconds})=>{
  events.push('http');assert.equal(pool,fakePool);
  assert.equal(managerOperationClock.now()+60000,50000);
  assert.equal(attemptRemainingMilliseconds(),50000);
  now=40000;return {receipt:{phoneDeliveryState:'PENDING'}};
 }
};
const result=await runCurrentManagerOwned219Stage(options);
pass('invoked closed checkpoint precedes exact zero-session clone/readback/HTTP and ends pool',()=>{
 assert.equal(result.status,'PASS');assert.equal(result.phoneDeliveryState,'PENDING');
 assert.deepEqual(events.filter(value=>typeof value==='string'&&
  ['persisted','no_source_sessions','clone','clone_readback','http','pool_end'].includes(value)),
  ['persisted','no_source_sessions','clone','clone_readback','http','pool_end']);
});
pass('no checkpoint file or source secret remains in fake result',()=>{
 assert.equal(JSON.stringify(result).includes('postgres:postgres'),false);
 assert.match(result.checkpointDigest,/^[a-f0-9]{64}$/);
});
await assert.rejects(()=>runCurrentManagerOwned219Stage({...options,now:()=>50000,
 produceCheckpoint:async()=>{throw Error('late launch must not happen');}}),/no work budget/);
checks++;console.log('PASS elapsed original work clock refuses child launch');
await assert.rejects(()=>runCurrentManagerOwned219Stage({...options,now:()=>0,
 sql:()=> '1',docker:()=>{throw Error('clone was not permitted');}}),/source sessions/);
checks++;console.log('PASS active source session refuses clone without invoking it');
let late=0;
await assert.rejects(()=>runCurrentManagerOwned219Stage({...options,now:()=>late,
 httpStage:async()=>{late=50000;return {receipt:{phoneDeliveryState:'PENDING'}};}}),/exceeded the original work deadline/);
checks++;console.log('PASS late receipt cannot become accepted status after deadline');
const runner=readFileSync(new URL('./run-isolated-shift-end-tests.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./static-weekly-current-roster-publication-tests.mjs',import.meta.url),'utf8');
const child=readFileSync(new URL('./static-weekly-current-manager-owned-checkpoint-child.mjs',import.meta.url),'utf8');
pass('new explicit stage retains historical stages and one source-origin cap',()=>{
 assert.match(runner,/current-manager-owned-219/);
 assert.match(runner,/const ownedManager219Stage=stage==='current-manager-owned-219'/);
 assert.match(runner,/50_000-performance\.now\(\)/);
 assert.match(runner,/performance\.now\(\)<60_000/);
 assert.match(runner,/NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS/);
 assert.match(runner,/work deadline elapsed during readiness/);
 assert.match(runner,/if\(ownedManager219Stage&&50_000-performance\.now\(\)<1\)throw error/);
 assert.match(runner,/Math\.min\(500,Math\.max\(0,50_000-performance\.now\(\)\)\)/);
 assert.match(runner,/const publishedStage=\[[^\]]+\]\.includes\(stage\)/);
 assert.doesNotMatch(runner.match(/const publishedStage=([^\n]+)/)?.[1]||'',/current-manager-owned-219/);
});
pass('publication child inherits owned compiler group and persists checkpoint before confirmation',()=>{
 assert.match(fixture,/workerDetached:false/);
 assert.match(fixture,/createCurrentManager219OwnedCheckpoint/);
 assert.match(fixture,/confirmationStatus:'NOT_YET_ATTEMPTED'/);
 assert.match(child,/message\.remainingMilliseconds/);
 assert.match(child,/STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_FAILURE_OUTPUT/);
 assert.match(fixture,/if\(!currentManagerStage\)assert\.ok\(process\.env\.STATIC_WEEKLY_CONTINUITY_TEMPLATE/);
 assert.match(fixture,/currentManagerStage\?loadCurrentManagerPublicationFixture\(\)\.bytes/);
});
console.log('PASS current219 owned stage fake/source',checks,'NO_SQL_NO_COMPILER_NO_BROWSER');
