import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
const manager={manager_id:'10000000-0000-4000-8000-000000000001',manager_display_name:'Named Manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
const employee='20000000-0000-4000-8000-000000000001',operation='30000000-0000-4000-8000-000000000001';
const priorOwner='20000000-0000-4000-8000-000000000002',lunchOnly='20000000-0000-4000-8000-000000000003';
const command={operation_id:operation,state:'PREPARING',semantic_body:{commandKind:'absence',absenceKind:'daily_absence',employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:null},semantic_digest:'a'.repeat(64),expected_revision:19,prepared_by_manager_id:manager.manager_id,current_service_date:'2026-09-25'};
const calls=[];let staged=null;
const client={async query(statement,values=[]){calls.push({statement,values});
  if(statement.includes('static_weekly_v10_read_staffing_command'))return{rows:[{result:command}]};
  if(statement.includes('static_weekly_v11_read_current_refresh_targets'))return{rows:[{result:[{serviceDate:'2026-09-30',employeeId:priorOwner}]}]};
  if(statement.includes('static_weekly_v3_read_manager_snapshot'))return{rows:[{result:{authority_revision:19,current_publication:{publication_id:'70000000-0000-4000-8000-000000000001'}}}]};
  if(statement.includes('static_weekly_v3_read_publication_source'))return{rows:[{result:{authority_revision:19,publication_id:'70000000-0000-4000-8000-000000000001',version_id:'60000000-0000-4000-8000-000000000001',exceptions:[],compiler_input:{timezone:'America/Chicago',proximity:[],slots:[{id:'slot-a',incumbencies:[{personId:employee,effectiveStart:'2020-01-01',effectiveEnd:null}]}],version:{id:'version-a',slotAvailability:[]}}}}]};
  if(statement.includes('static_weekly_v10_stage_staffing_command')){staged=values;return{rows:[{result:{operation_id:operation,state:'PREPARED'}}]};}
  return{rows:[]};},release(){},on(){},removeListener(){}};
const deadlineValues=[];
const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},compiler:async()=>{throw Error('ordinary compiler not expected');},
  compilerPreparer:async(input,preparation,options)=>{deadlineValues.push(options.deadlineMilliseconds);assert.equal(preparation.kind,'projection');
    const assignments=input.exceptions.map((exception,index)=>({service_date:exception.serviceDate,status:'assigned',owner_person_id:employee,work_id:`work-${index}`}));
    return{publicationId:preparation.publicationId,serviceDate:input.serviceDate,exceptionSetDigest:'b'.repeat(64),compilerVersion:'synthetic',objective:{},metrics:{},replayDigest:'c'.repeat(64),
      envelope:{database_projection_identity:'d'.repeat(64),assignments},expectedRevision:preparation.expectedRevision,actorManagerId:manager.manager_id,actorManagerName:manager.manager_display_name,idempotencyKey:preparation.actor.idempotencyKey,
      lunchDocument:{document_identity:'e'.repeat(64),responsibilities:[{service_date:'2026-09-30',normal_owner_person_id:employee,coverer_person_id:lunchOnly}]}};},initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
const result=await plane.prepareStaffingCommand({manager,operationId:operation});assert.equal(result.state,'PREPARED');
assert.ok(staged,'complete candidate set must cross only the typed staging RPC');assert.equal(staged[0],operation);assert.equal(staged[1].length,7);
assert.deepEqual(staged[1].map(row=>[row.candidateKind,row.candidateKey,row.serviceDate]),[
  ['lunch','week:2026-09-28','2026-09-28'],['projection','week:2026-09-28','2026-09-28'],
  ['schedule_refresh',`date:2026-09-30:employee:${employee}`,'2026-09-30'],
  ['schedule_refresh',`date:2026-09-30:employee:${priorOwner}`,'2026-09-30'],
  ['schedule_refresh',`date:2026-09-30:employee:${lunchOnly}`,'2026-09-30'],
  ['schedule_refresh',`date:2026-10-01:employee:${employee}`,'2026-10-01'],
  ['schedule_refresh',`date:2026-10-02:employee:${employee}`,'2026-10-02'],
]);
assert.match(staged[2],/^[0-9a-f]{64}$/);assert.match(staged[3],/^[0-9a-f]{64}$/);assert.equal(staged[4].weeks.length,1);assert.equal(staged[5],manager.manager_id);
assert.equal(deadlineValues.length,1);assert.ok(deadlineValues[0]>0&&deadlineValues[0]<=30000,'preparation passes the remaining total budget into the isolated compiler');
await plane.close();
console.log(JSON.stringify({status:'PASS',checks:10,scope:'server-owned compile to complete private staging with bounded deadline; synthetic compiler and no authoritative commit'}));
