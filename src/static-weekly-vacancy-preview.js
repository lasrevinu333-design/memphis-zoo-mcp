import {createHash} from 'node:crypto';
import {canonicalJson,isIsoServiceDate,serviceDateWeekday} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from './static-weekly-schedule-compiler.js';

// Pure manager page-domain projection, NOT an authenticator, solver, signer,
// transaction, publication, receipt verifier or installed-device claim.
const SCHEMA='custodial.stable-vacancy-preview.v1';
const LIMITS=Object.freeze({assignments:1024,availability:1792,loans:1792,
  responsibilities:100000,windows:256,segments:1024,privateBytes:16*1024*1024,publicBytes:4*1024*1024});
const CANDIDATE_KEYS=['publicationId','serviceDate','exceptionSetDigest','compilerVersion','objective','metrics',
  'replayDigest','envelope','expectedRevision','actorManagerId','idempotencyKey','lunchDocument'];
const INPUT_KEYS=['managerId','sourceId','slotId','employeeId','effectiveStart','weekStart','expectedRevision',
  'idempotencyKey','reasonDigest','registeredSourceDigest','currentSourceDigest','publicationId','projection'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=()=>{throw Object.assign(new Error('vacancy_manager_preview_invalid'),{code:'vacancy_manager_preview_invalid'});};
const own=(o,k)=>Object.hasOwn(o,k);
const object=v=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v;};
const text=(v,max=300)=>{if(typeof v!=='string'||!v||v!==v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail();return v;};
const uuid=v=>{if(typeof v!=='string'||!UUID.test(v))fail();return v;};
const hash=v=>{if(typeof v!=='string'||!HASH.test(v))fail();return v;};
const number=v=>{if(typeof v!=='number'||!Number.isFinite(v))fail();return v;};
const date=v=>{if(typeof v!=='string'||v.startsWith('0000-')||!isIsoServiceDate(v))fail();return v;};
const digest=v=>createHash('sha256').update(canonicalJson(v),'utf8').digest('hex');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const rows=(v,max)=>{if(!Array.isArray(v)||v.length>max)fail();return v;};
const nullableUuid=v=>v===null?null:uuid(v);
const time=v=>{if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))fail();return v;};
const window=v=>{object(v);const out={start:time(v.start),end:time(v.end)};if(out.start>=out.end)fail();return out;};

// Capture JSON once without getters/coercion, cycles, sparse arrays or clock
// defaults. Complete private candidate is hashed, never returned to the UI.
function capture(value){
  let nodes=0;const active=new Set();
  function copy(v,depth){
    if(++nodes>1000000||depth>64)fail();
    if(v===null||typeof v==='boolean'||typeof v==='string')return v;
    if(typeof v==='number')return number(v);
    if(!v||typeof v!=='object'||active.has(v))fail();
    if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
    active.add(v);let out;
    if(Array.isArray(v)){
      if(v.length>100000)fail();out=[];
      for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!own(d,'value'))fail();out.push(copy(d.value,depth+1));}
      if(Object.keys(v).length!==v.length)fail();
    }else{
      const keys=Object.keys(v);if(keys.length>4096)fail();out=Object.create(null);
      for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!own(d,'value'))fail();out[k]=copy(d.value,depth+1);}
    }
    active.delete(v);return out;
  }
  const result=copy(value,0);
  if(Buffer.byteLength(canonicalJson(result),'utf8')>LIMITS.privateBytes)fail();
  return result;
}
function candidate(value){
  const p=object(capture(value));
  const permitted=new Set([...CANDIDATE_KEYS,'actorManagerName','openingCoverageReport']);
  if(Object.keys(p).some(k=>!permitted.has(k))||CANDIDATE_KEYS.some(k=>!own(p,k)))fail();
  object(p.envelope);object(p.lunchDocument);
  // Never erase a submitted signature to make it look like normal worker data.
  if(own(p.envelope,'attestation'))fail();
  return p;
}

// Exact twelve-field SQL-comparable WORKER subset. The original SQL reader
// separately verifies its server attestation and reconstructs ONLY this known
// pre-materialization boundary; full persisted digest is a different value.
export function workerCandidateDigest(projection){
  const p=candidate(projection);
  return postgresJsonbContentDigest(Object.fromEntries(CANDIDATE_KEYS.map(k=>[k,p[k]])));
}

function optionalFields(source,fields,read){
  const out={};for(const k of fields)if(own(source,k))out[k]=source[k]===null?null:read(source[k]);return out;
}
const strings=(s,fields)=>optionalFields(s,fields,v=>text(v));
const numbers=(s,fields)=>optionalFields(s,fields,number);
function locations(value){return rows(value,256).map(v=>{object(v);return {locationId:text(v.locationId),
  ...strings(v,['locationCodeSnapshot','locationNameSnapshot'])};});}
function dated(day,serviceDate,weekStart,weekEnd){
  if(!Number.isInteger(day)||day<0||day>6||date(serviceDate)<weekStart||serviceDate>weekEnd||serviceDateWeekday(serviceDate)!==day)fail();
}
function unique(array,key){const seen=new Set();for(const row of array){const k=key(row);if(seen.has(k))fail();seen.add(k);}}
function assignments(value,weekStart,weekEnd){
  const out=rows(value,LIMITS.assignments).map(a=>{
    object(a);dated(a.day_of_week,a.service_date,weekStart,weekEnd);
    if(!['assigned','open','review'].includes(a.status))fail();
    const w=object(a.work_snapshot);if(w.workId!==a.work_id||w.dayOfWeek!==a.day_of_week)fail();
    if(!['scan_tracked','reminder_only','response_only_no_clean'].includes(w.serviceMode))fail();
    const result={planWorkId:text(a.plan_work_id),workId:text(a.work_id),dayOfWeek:a.day_of_week,serviceDate:a.service_date,
      status:a.status,ownerSlotId:nullableUuid(a.owner_slot_id),ownerPersonId:nullableUuid(a.owner_person_id),
      workSnapshot:{workId:w.workId,dayOfWeek:w.dayOfWeek,locationId:text(w.locationId),window:window(w.window),
        serviceMode:w.serviceMode,includedLocations:locations(w.includedLocations),serviceEffortMinutes:number(w.serviceEffortMinutes),
        ...strings(w,['originSlotId','locationCodeSnapshot','locationNameSnapshot','manualLockSlotId']),...numbers(w,['priority'])}};
    for(const k of ['required','bestEffortCoverage','manualLock','overlayWork'])if(own(w,k)){
      if(typeof w[k]!=='boolean')fail();result.workSnapshot[k]=w[k];
    }
    for(const [from,to] of [['baseline_owner_slot_id','baselineOwnerSlotId'],['baseline_owner_person_id','baselineOwnerPersonId'],
      ['original_actor_person_id','originalActorPersonId'],['optimized_owner_slot_id','optimizedOwnerSlotId'],['optimized_owner_person_id','optimizedOwnerPersonId']]){
      if(own(a,from))result[to]=nullableUuid(a[from]);
    }
    if(own(a,'baseline_owner_name'))result.baselineOwnerName=a.baseline_owner_name===null?null:text(a.baseline_owner_name);
    if(own(a,'owner_kind')){if(a.owner_kind!=='CONTRACTOR_CAPACITY'||a.owner_person_id!==null)fail();result.ownerKind=a.owner_kind;result.capacityId=text(a.capacity_id);}
    if(a.status==='assigned'&&(a.owner_slot_id===null||(a.owner_person_id===null&&a.owner_kind!=='CONTRACTOR_CAPACITY')))fail();
    if(a.status!=='assigned'&&(a.owner_slot_id!==null||a.owner_person_id!==null))fail();
    return result;
  });unique(out,a=>a.planWorkId);return out;
}
function availability(value,weekStart,weekEnd){
  const out=rows(value,LIMITS.availability).map(a=>{
    object(a);dated(a.dayOfWeek,a.serviceDate,weekStart,weekEnd);
    if(!['working','departed_named_absent','absent','unavailable','vacant_unfilled'].includes(a.status))fail();
    const result={slotId:uuid(a.slotId),dayOfWeek:a.dayOfWeek,serviceDate:a.serviceDate,status:a.status,
      incumbentPersonId:nullableUuid(a.incumbentPersonId),incumbentSlotId:nullableUuid(a.incumbentSlotId),
      ...strings(a,['incumbentSlotLabel','incumbentName','ownerKind','capacityId']),
      ...numbers(a,['productiveCapacityMinutes','maxServiceEffortMinutes','maxLoadPoints','maxDutyMinutes'])};
    for(const k of ['shift','lunch'])if(own(a,k))result[k]=a[k]===null?null:window(a[k]);
    for(const k of ['blockedWindows','productiveWindows'])if(own(a,k))result[k]=rows(a[k],LIMITS.windows).map(window);
    if(a.status==='working'&&(!result.shift||!own(a,'lunch')))fail();
    if(own(a,'ownerKind')&&(a.ownerKind!=='CONTRACTOR_CAPACITY'||a.incumbentPersonId!==null||!own(a,'capacityId')))fail();
    return result;
  });if(!out.length)fail();unique(out,a=>`${a.dayOfWeek}:${a.slotId}`);return out;
}

const LOAD_NUMBERS=['effort','capacity','utilization','normalizedLoad','serviceDutyMinutes','serviceEffortMinutes',
  'normalizedServiceLoad','maxServiceEffortMinutes','fixedServiceEffortMinutes','flexibleWorkloadPoints',
  'fixedRouteTravelMinutes','flexibleCoverageTravelMinutes','travelDutyMinutes','waitingMinutes','fixedWindowWaitingMinutes',
  'transitWaitingMinutes','protectedBreakUnavailableMinutes','routeSpanMinutes','routeNodeCount','fixedRouteDutyMinutes',
  'totalDutyMinutes','dutyCapacityMinutes','productiveCapacityMinutes','acceptedRouteTravelMinutes'];
function metrics(value){
  const m=object(value),weekly=object(m.weekly),semantics=object(m.dutySemantics);
  const daily=rows(m.daily,7).map(d=>({dayOfWeek:d.dayOfWeek,...numbers(d,['normalizedInequity','exactNormalizedInequity']),
    loads:rows(d.loads,256).map(l=>({slotId:uuid(l.slotId),...numbers(l,LOAD_NUMBERS)}))}));
  if(daily.length!==7||daily.some(d=>!Number.isInteger(d.dayOfWeek)||d.dayOfWeek<0||d.dayOfWeek>6))fail();
  unique(daily,d=>d.dayOfWeek);for(const d of daily)unique(d.loads,l=>l.slotId);
  const safeWeekly={...numbers(weekly,['normalizedInequity','incrementalDirectedRouteCost','disruption']),...strings(weekly,['resource'])};
  for(const key of ['normalizedLoads','provenancedWorkloadUnits','productiveCapacityMinutes','uncoveredByPriority'])if(own(weekly,key)){
    const map=object(weekly[key]);if(Object.keys(map).length>256)fail();
    safeWeekly[key]=Object.fromEntries(Object.entries(map).map(([k,v])=>[text(k),number(v)]));
  }
  return {daily,weekly:safeWeekly,dutySemantics:strings(semantics,['workload','service','travel','waiting','protected','totalDuty'])};
}
function objective(value){
  const o=object(value),out={};
  for(const k of ['mode','policyVersion','integerServiceEffort','serviceEffortWireSemantics','directedTravelDuty',
    'flexibleCoverageTravelRole','acceptedRouteInsertions','weeklyEquityResource','equityIntegerScale','exactEquityCommonDenominator'])if(own(o,k)){
    const v=o[k];if(typeof v==='number')out[k]=number(v);else if(typeof v==='boolean')out[k]=v;else out[k]=text(v,2000);
  }
  for(const k of ['tiers','rankingOrder'])if(own(o,k))out[k]=rows(o[k],4096).map(v=>text(v));
  if(!Object.keys(out).length)fail();return out;
}
function lunch(value,weekStart,weekEnd,authorityDigest,replayDigest){
  const l=object(value);
  if(l.schema!=='memphis-zoo.static-weekly-lunch-authority-document.v1'||l.persistence_authority!=='NOT_PERSISTED'
    ||l.verification_status!=='VERIFIED'||l.week_start!==weekStart||l.base_authority_digest!==authorityDigest||l.base_replay_digest!==replayDigest)fail();
  const {document_identity,...document}=l;if(hash(document_identity)!==postgresJsonbContentDigest(document))fail();
  rows(l.notification_intents,100000);object(l.semantic_snapshot);
  if(l.semantic_snapshot.schema!=='memphis-zoo.static-weekly-lunch-semantic-snapshot.v1'
    ||l.semantic_snapshot.loans_digest!==postgresJsonbContentDigest(l.loans)
    ||l.semantic_snapshot.responsibilities_digest!==postgresJsonbContentDigest(l.responsibilities)
    ||l.semantic_snapshot.notification_intents_digest!==postgresJsonbContentDigest(l.notification_intents))fail();
  const loans=rows(l.loans,LIMITS.loans).map(a=>{
    object(a);dated(a.day_of_week,a.service_date,weekStart,weekEnd);if(!['PLANNED','NO_AREAS'].includes(a.status))fail();
    if(a.coverage_start>=a.coverage_end||(a.normal_owner_person_id===null&&!own(a,'normal_owner_capacity_id')))fail();
    return {loanId:hash(a.loan_id),serviceDate:a.service_date,dayOfWeek:a.day_of_week,status:a.status,
      normalOwnerSlotId:uuid(a.normal_owner_slot_id),normalOwnerPersonId:nullableUuid(a.normal_owner_person_id),
      ...Object.fromEntries(own(a,'normal_owner_capacity_id')?[['normalOwnerCapacityId',text(a.normal_owner_capacity_id)]]:[]),
      coverageStart:time(a.coverage_start),coverageEnd:time(a.coverage_end),
      helperSlotIds:rows(a.helper_slot_ids,256).map(uuid),totalDistanceMinutes:a.total_distance_minutes===null?null:number(a.total_distance_minutes)};
  });unique(loans,a=>a.loanId);
  const responsibilities=rows(l.responsibilities,LIMITS.responsibilities).map(a=>{
    object(a);dated(a.day_of_week,a.service_date,weekStart,weekEnd);
    const loan=loans.find(v=>v.loanId===a.loan_id);
    if(!loan||loan.serviceDate!==a.service_date||loan.normalOwnerSlotId!==a.normal_owner_slot_id
      ||loan.normalOwnerPersonId!==a.normal_owner_person_id||loan.coverageStart!==a.coverage_start||loan.coverageEnd!==a.coverage_end
      ||a.coverage_purpose!=='lunch_coverage'||a.check_deadline_policy!=='inherit_existing_90_minute_deadline'||a.creates_deep_clean!==false)fail();
    if((a.normal_owner_person_id===null&&!own(a,'normal_owner_capacity_id'))||(a.coverer_person_id===null&&!own(a,'coverer_capacity_id')))fail();
    return {responsibilityId:hash(a.responsibility_id),loanId:a.loan_id,serviceDate:a.service_date,dayOfWeek:a.day_of_week,
      normalOwnerSlotId:uuid(a.normal_owner_slot_id),normalOwnerPersonId:nullableUuid(a.normal_owner_person_id),
      covererSlotId:uuid(a.coverer_slot_id),covererPersonId:nullableUuid(a.coverer_person_id),
      ...Object.fromEntries(['normal_owner_capacity_id','coverer_capacity_id'].filter(k=>own(a,k)).map(k=>[k==='normal_owner_capacity_id'?'normalOwnerCapacityId':'covererCapacityId',text(a[k])])),
      coveragePurpose:a.coverage_purpose,coverageStart:time(a.coverage_start),coverageEnd:time(a.coverage_end),
      checkDeadlinePolicy:a.check_deadline_policy,createsDeepClean:a.creates_deep_clean,
      segments:rows(a.segments,LIMITS.segments).map(s=>({planWorkId:text(s.planWorkId),workId:text(s.workId),
        serviceMode:text(s.serviceMode),window:window(s.window),includedLocations:locations(s.includedLocations)}))};
  });unique(responsibilities,a=>a.responsibilityId);
  return {documentIdentity:document_identity,weekStart:l.week_start,baseAuthorityDigest:l.base_authority_digest,
    baseReplayDigest:l.base_replay_digest,sourceInputDigest:hash(l.source_input_digest),candidateDigest:hash(l.candidate_digest),loans,responsibilities};
}

export function createVacancyManagerPreview(input){
  const i=object(capture(input));if(Object.keys(i).sort().join(',')!==INPUT_KEYS.slice().sort().join(','))fail();
  for(const k of ['managerId','sourceId','slotId','employeeId','publicationId'])uuid(i[k]);
  for(const k of ['registeredSourceDigest','currentSourceDigest','reasonDigest'])hash(i[k]);
  date(i.effectiveStart);date(i.weekStart);
  const weekEnd=new Date(Date.parse(`${i.weekStart}T00:00:00Z`)+6*86400000).toISOString().slice(0,10);
  if(serviceDateWeekday(i.weekStart)!==1||i.effectiveStart<i.weekStart||i.effectiveStart>weekEnd
    ||!Number.isSafeInteger(i.expectedRevision)||i.expectedRevision<0||i.expectedRevision>Number.MAX_SAFE_INTEGER-2)fail();
  text(i.idempotencyKey,200);
  const projectionIdempotencyKey=`projection-${createHash('sha256').update(i.idempotencyKey,'utf8').digest('hex')}`;
  const p=candidate(i.projection),e=p.envelope,a=object(e.authority);
  if(p.publicationId!==i.publicationId||p.actorManagerId!==i.managerId||p.serviceDate!==i.weekStart
    ||p.expectedRevision!==i.expectedRevision+1||p.idempotencyKey!==projectionIdempotencyKey
    ||e.service_date!==i.weekStart||e.week_start!==i.weekStart||e.week_end!==weekEnd||a.effectiveDate!==i.weekStart
    ||e.compiler_version!==p.compilerVersion||e.replay_digest!==p.replayDigest||!same(e.objective,p.objective)||!same(e.metrics,p.metrics))fail();
  text(p.actorManagerName);text(p.compilerVersion);hash(p.exceptionSetDigest);hash(p.replayDigest);hash(a.inputDigest);
  if(hash(e.authority_digest)!==postgresJsonbContentDigest(a))fail();
  const {database_projection_identity,...envelope}=e;
  if(hash(database_projection_identity)!==postgresJsonbContentDigest(envelope))fail();
  const safeAvailability=availability(a.projectionAvailability,i.weekStart,weekEnd),safeMetrics=metrics(p.metrics);
  for(const row of safeAvailability.filter(v=>v.status==='working')){
    const load=safeMetrics.daily.find(d=>d.dayOfWeek===row.dayOfWeek)?.loads.find(l=>l.slotId===row.slotId);
    if(!load||!Number.isFinite(load.productiveCapacityMinutes)||!Number.isFinite(load.dutyCapacityMinutes))fail();
  }
  const {projection,...binding}=i;
  const result={schema:SCHEMA,...binding,managerName:p.actorManagerName,projectionExpectedRevision:i.expectedRevision+1,
    resultingRevision:i.expectedRevision+2,projectionIdempotencyKey,
    previewDigest:digest({schema:SCHEMA,binding,projection:p}),workerCandidateDigest:workerCandidateDigest(p),
    accepted:false,persisted:false,phoneUpdated:false,
    preview:{weekStart:i.weekStart,weekEnd,compilerVersion:p.compilerVersion,exceptionSetDigest:p.exceptionSetDigest,
      replayDigest:p.replayDigest,databaseProjectionIdentity:database_projection_identity,authorityDigest:e.authority_digest,
      sourceDigest:a.inputDigest,sourceDigestBasis:'envelope.authority.inputDigest',
      assignments:assignments(e.assignments,i.weekStart,weekEnd),projectionAvailability:safeAvailability,
      objective:objective(p.objective),metrics:safeMetrics,lunchDocument:lunch(p.lunchDocument,i.weekStart,weekEnd,e.authority_digest,p.replayDigest)}};
  if(Buffer.byteLength(canonicalJson(result),'utf8')>LIMITS.publicBytes)fail();return result;
}
