// Actual supported production JS preview/confirm and migrated SQL. No private
// publication binding INSERT or supplied RPC/candidate/solver/authority result.
// Explicit named-manager DATA is synthetic in this disposable database only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStaticWeeklyControlPlane} from '../../src/static-weekly-control-plane.js';
import {testNotificationPlanHttp} from '../recurring-notification-plan-http-tests.mjs';
export async function testRealRecurringPlanRead({client,fixture:f,check,deadlineAt}){
 assert.ok(Number.isFinite(deadlineAt));
 console.log('NORMAL_PLAN_REAL_RECURRING_PHASE '+JSON.stringify({remainingMilliseconds:Math.max(0,Math.floor(deadlineAt-performance.now())),sameOriginalSqlPhaseDeadline:true}));
 assert.ok(performance.now()+5000<deadlineAt,'real recurring phase requires remaining original SQL phase budget; no renewal');
 const registry=(await client.query('select display_name from public.ops_manager_managers where manager_id=$1 and active and not is_system_principal',[f.manager])).rows;
 assert.equal(registry.length,1,'same actual newly owned named-manager registry row required');
 const manager={manager_id:f.manager,manager_display_name:registry[0].display_name,auth_mode:'trusted_device',trusted_device:true,read_only:false};
 // Borrow the ONE already-owned client sequentially; the outer harness retains
 // release/end ownership. There are no concurrent operations in this late phase.
 let leased=false,maximumLeased=0;
 const database={async connect(){assert.equal(leased,false,'no nested or concurrent borrowed client');leased=true;maximumLeased=1;
  return {query:client.query.bind(client),on:client.on.bind(client),removeListener:client.removeListener.bind(client),
   release(){assert.equal(leased,true);leased=false;}};},async end(){assert.equal(leased,false);}};
 const plane=createStaticWeeklyControlPlane({database});
 let accepted;
 try{
  const expectedRevision=Number((await client.query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
  const day=new Date(f.serviceDate+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7));const effectiveStart=day.toISOString().slice(0,10);
  const preview=await plane.previewRecurringStaffing({manager,effectiveStart,expectedRevision,deadlineAt});
  check([preview.admitted,preview.published,preview.affectedPhonesUpdated],[false,false,false],'genuine public preview is not acceptance or phone proof');
  accepted=await plane.confirmRecurringStaffing({manager,confirmationKey:randomUUID(),effectiveStart,expectedRevision,previewDigest:preview.previewDigest,deadlineAt});
  check(accepted.state,'ACCEPTED','actual supported recurring confirmation accepted');
  const receipt=accepted.receipt;
  check([receipt.accepted,receipt.managerId,receipt.previewDigest,receipt.phoneDeliveryState,receipt.affectedPhonesUpdated],
   [true,f.manager,preview.previewDigest,'PENDING',false],'actual original confirmation tuple; no phone update inference');
  const binding=(await client.query('select operation_id,publication_id from public.static_weekly_recurring_publication_bindings where publication_id=$1',[receipt.publicationId])).rows;
  check(binding,[{operation_id:receipt.operationId,publication_id:receipt.publicationId}],'actual production confirmation owns recurring binding');
 }finally{await plane.close();assert.equal(leased,false,'borrowed client settled before returning');}
 check(maximumLeased,1,'actual public phase used one sequential owned SQL client');
 await client.query('begin');
 try{
  await client.query('set local role service_role');
  const delivery=(await client.query('select public.static_weekly_v24_read_device_schedule_delivery($1,$2,$3,$4,$5) value',[f.serviceDate,f.device,f.credential,f.employee,f.epoch])).rows[0].value;
  check(delivery.mode,'RECURRING_SCHEDULE','actual v24 now selects the genuine recurring publication');
  check([delivery.delivery.target.publicationId,delivery.delivery.target.projectionId],[accepted.receipt.publicationId,accepted.receipt.projectionId],'actual current phone target comes from accepted production projection');
  const actual=delivery.delivery;
  const envelope=(await client.query('select public.static_weekly_v27_issue_recurring_notification_plan($1,$2,$3,$4,$5,$6,$7) value',
   [f.serviceDate,f.device,f.credential,f.employee,f.epoch,actual.intentId,actual.targetDigest])).rows[0].value;
  await client.query('reset role');
  const applied=(await client.query("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value")).rows[0].value;
  const proof=await testNotificationPlanHttp({client,fixture:{...f,intent:actual.intentId,delivery:actual,normalDeliveryMode:'RECURRING_SCHEDULE'},envelope,applied,check});
  return {...proof,actualProductionRecurringPreviewConfirm:true,actualProductionRecurringBinding:true,actualNormalRecurringGet:true,nativeOrPhysicalEvidence:false};
 }finally{await client.query('rollback');}
}
