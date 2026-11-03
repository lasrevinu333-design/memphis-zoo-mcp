import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createSyntheticRegisteredCurrentCorrectionReductionFixture} from './fixtures/registered-current-correction-reduction.mjs';
import {RECURRING_CORRECTION_BINDING_SCHEMA} from '../src/static-weekly-recurring-correction-binding.js';

const fixture=createSyntheticRegisteredCurrentCorrectionReductionFixture(6),
 binding={schema:RECURRING_CORRECTION_BINDING_SCHEMA,sourceId:fixture.correctionSource.source_id,
  canonicalDigest:fixture.correctionWitness.canonicalDigest},
 manager={manager_id:'81000000-0000-4000-8000-000000000099',manager_display_name:'Synthetic named manager',
  auth_mode:'trusted_device',read_only:false};
let checks=0;
async function run({snapshot=fixture.managerSnapshot,source=fixture.correctionSource,bindingInput=binding}={}){
 const queries=[],preparations=[];
 const client={async query(sql,args=[]){queries.push({sql,args});
  const result=value=>({rows:[{result:value}]});
  if(sql.includes('static_weekly_v15_read_recurring_generation'))return result(1);
  if(sql.includes('static_weekly_v3_read_manager_snapshot'))return result(snapshot);
  if(sql.includes('static_weekly_v20_read_recurring_preview_basis'))return result(fixture.publishedSource);
  if(sql.includes('static_weekly_v3_read_authority_source')){
   if(args[0]===fixture.fullNineSource.source_id)return result(fixture.fullNineSource);
   if(args[0]===binding.sourceId)return result(source);
   throw new Error('unexpected registry source selector');
  }
  return {rows:[]};
 },release(){}};
 const cp=createStaticWeeklyControlPlane({database:{async connect(){return client;}},
  recurringCorrectionSourceBinding:bindingInput,
  recurringCandidatePreparer:async input=>{preparations.push(input);throw new Error('STOP_AT_BOUND_COMPILER_INPUT');},
  initializeSolver:async()=>({available:true}),getSolverReadiness:()=>({available:true}),
  shutdownCompiler:async()=>{}});
 try{
  await assert.rejects(()=>cp.previewRecurringStaffing({manager,effectiveStart:fixture.effectiveDate,
   expectedRevision:fixture.expectedRevision}),/STOP_AT_BOUND_COMPILER_INPUT|correction_/);
 }finally{await cp.close?.();}
 return {queries,preparations};
}
const good=await run();
assert.equal(good.preparations.length,1,'only exact locked basis reaches private compiler');checks++;
assert.equal(good.preparations[0].correctionSource.source_id,binding.sourceId);checks++;
assert.equal(good.preparations[0].correctionWitness.digest,fixture.correctionWitness.digest);checks++;
assert.equal(good.preparations[0].fullNineSource.source_id,fixture.fullNineSource.source_id);checks++;
const names=good.queries.map(q=>q.sql),lock=names.findIndex(x=>x.includes('pg_advisory_xact_lock')),
 roster=names.findIndex(x=>x.includes('static_weekly_v3_read_manager_snapshot')),
 correction=good.queries.findIndex(q=>q.sql.includes('static_weekly_v3_read_authority_source')&&q.args[0]===binding.sourceId);
assert.ok(lock>=0&&lock<roster&&roster<correction,'common scheduler lock precedes roster and exact correction source read');checks++;
assert.ok(names.includes('commit')&&names.indexOf('set local role static_weekly_control_plane')<lock,
 'locked source-read transaction commits before isolated compiler receives immutable input');checks++;
const retired=structuredClone(fixture.managerSnapshot);
retired.sources=retired.sources.filter(row=>row.source_id!==binding.sourceId);
assert.equal((await run({snapshot:retired})).preparations.length,0,'retired registry correction never reaches compiler');checks++;
const changed=structuredClone(fixture.managerSnapshot);
changed.sources.find(row=>row.source_id===binding.sourceId).source_digest='f'.repeat(64);
assert.equal((await run({snapshot:changed})).preparations.length,0,'changed canonical source digest never reaches compiler');checks++;
const rebound=structuredClone(fixture.correctionSource);rebound.source_id='81000000-0000-4000-8000-000000000098';
assert.equal((await run({source:rebound})).preparations.length,0,'registry reader cannot rebound to competing source ID');checks++;
console.log(JSON.stringify({status:'PASS',checks,scope:'transaction-mocked exact source lookup/lock/role and private compiler input; no SQL, solver, preview acceptance or publication'}));
