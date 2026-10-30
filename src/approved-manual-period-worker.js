import {captureStaticWeeklyPreparationData} from './static-weekly-staffing-preview.js';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {readApprovedManualWeek} from './approved-manual-week.js';
import {solveApprovedManualAbsencePeriod} from './approved-manual-absence.js';
import {prepareApprovedManualPeriodProjection} from './approved-manual-period-projection.js';

const fail=()=>{throw Object.assign(Error('The original manual period preparation DATA changed or is invalid'),{code:'approved_manual_period_protocol_invalid'});},
 exact=(o,keys)=>{if(!o||Array.isArray(o)||Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail();},
 hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x),
 identity=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);

export function captureApprovedManualPeriodWorkerInput(input){
 const v=captureStaticWeeklyPreparationData(input);
 exact(v,['schema','source','ownerConfig','frameStart','changes','priorDays','acceptedExceptions','actor','expectedRevision','idempotencyKey']);
 exact(v.actor,['managerId','managerName']);
 if(v.schema!=='custodial.approved-manual-period-worker-input.v1'||!identity(v.actor.managerId)
  ||typeof v.actor.managerName!=='string'||!v.actor.managerName.trim()||v.actor.managerName.length>256
  ||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0
  ||typeof v.idempotencyKey!=='string'||!v.idempotencyKey.trim()||v.idempotencyKey.length>200
  ||!/^\d{4}-\d{2}-\d{2}$/.test(v.frameStart)||v.source?.serviceDate!==v.frameStart
  ||!Array.isArray(v.source?.exceptions)||v.source.exceptions.length
  ||!Array.isArray(v.changes)||v.changes.length>7||!Array.isArray(v.priorDays)||v.priorDays.length>7
  ||!Array.isArray(v.acceptedExceptions)||v.acceptedExceptions.length>512)fail();
 const version=v.source.version||v.source.versions?.[0];
 if(!identity(version?.id)||!identity(version?.publicationId)
  ||version.manualGroupRatingAuthority?.manifestSha256!=='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f')fail();
 return v;
}

export function captureApprovedManualPeriodWorkerResult(result,input){
 const r=captureStaticWeeklyPreparationData(result);
 exact(r,['schema','requestDigest','period','nativeProjection','publicationEligible','productionWritten','contractorBooked']);
 if(r.schema!=='custodial.approved-manual-period-worker-result.v1'||r.requestDigest!==digest(input)
  ||r.publicationEligible!==false||r.productionWritten!==false||r.contractorBooked!==false
  ||r.period?.sourceDigest!==digest(input.source)||r.period.frameStart!==input.frameStart
  ||!hash(r.period.periodDraftDigest))fail();
 const {periodDraftDigest,...periodBody}=r.period;if(digest(periodBody)!==periodDraftDigest)fail();
 if(r.period.status==='COMPLETE_VALIDATED_DATED_DRAFTS'){
  const n=r.nativeProjection;if(!n||!hash(n.projectionDataDigest)||n.authority?.periodDraftDigest!==periodDraftDigest
   ||n.authority.sourceDigest!==r.period.sourceDigest||n.frameStart!==input.frameStart
   ||n.publicationEligible!==false||n.productionWritten!==false||n.normalWeekChanged!==false||n.contractorBooked!==false
   ||!Array.isArray(n.projectionAssignments)||n.projectionAssignments.length<1||n.projectionAssignments.length>4096)fail();
  const {projectionDataDigest,...nativeBody}=n;if(digest(nativeBody)!==projectionDataDigest)fail();
 }else if(r.period.status!=='COVERAGE_CONSTRAINTS_UNRESOLVED'||r.nativeProjection!==null)fail();
 return r;
}

// Called only inside the already owned compiler child. The installed fused
// HiGHS runtime and original absolute deadline cover the entire operation.
export async function prepareApprovedManualPeriodWorkerData(input,deadline){
 const captured=captureApprovedManualPeriodWorkerInput(input),week=readApprovedManualWeek(),
  period=await solveApprovedManualAbsencePeriod({week,source:captured.source,ownerConfig:captured.ownerConfig,
   frameStart:captured.frameStart,changes:captured.changes,priorDays:captured.priorDays},{deadline}),
  nativeProjection=period.status==='COMPLETE_VALIDATED_DATED_DRAFTS'
   ?prepareApprovedManualPeriodProjection({week,source:captured.source,ownerConfig:captured.ownerConfig,period,
    acceptedExceptions:captured.acceptedExceptions},{deadline}):null;
 return captureApprovedManualPeriodWorkerResult({schema:'custodial.approved-manual-period-worker-result.v1',
  requestDigest:digest(captured),period,nativeProjection,publicationEligible:false,productionWritten:false,contractorBooked:false},captured);
}
