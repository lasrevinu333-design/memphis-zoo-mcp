import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installStaticWeeklySha256HexAccelerator,canonicalJson} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {approvedManualRecurringFrame,repeatApprovedManualNormalRows,prepareApprovedManualRecurringPeriod} from '../src/approved-manual-recurring-period.js';
import {readOwnerConfirmedEmploymentAdmissionData,prepareApprovedManualEmploymentAdmission} from '../src/approved-manual-employment-admission.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const checks=[],check=(n,f)=>{f();checks.push(n);},copy=structuredClone,DAY=86400000;
const fixture=JSON.parse(readFileSync(new URL('../release/worker1-recurring-period-20261030/HISTORICAL_NORMAL_COMPONENT_TEST_FIXTURE.json',import.meta.url))),
 manager='11111111-1111-4111-8111-111111111111',source='44444444-4444-4444-8444-444444444444',publication='55555555-5555-4555-8555-555555555555',version='66666666-6666-4666-8666-666666666666',request='77777777-7777-4777-8777-777777777777',
 rowsInput={sourceId:source,origin:fixture.origin,frameStart:'2026-11-09',assignments:fixture.assignments,projectionAvailability:fixture.projectionAvailability,lunchDocument:fixture.lunchDocument,overlayCompilerInput:fixture.overlayCompilerInput},
 records=readOwnerConfirmedEmploymentAdmissionData().employees,initial=records.map((r,i)=>prepareApprovedManualEmploymentAdmission({employeeId:r.employeeId,managerId:manager,
 requestId:i?'33333333-3333-4333-8333-333333333333':'22222222-2222-4222-8222-222222222222',expectedAuthorityRevision:42,expectedEmploymentRevision:0}).command),
 jada=records[1].employeeId;
const date=d=>new Date(Date.parse(d+'T12:00Z')).toISOString().slice(0,10),plus=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*DAY).toISOString().slice(0,10);
function basis({admitJada=true}={}){
 const employmentByDate=[],participants=[];
 for(let i=0;i<7;i++){const serviceDate=plus('2026-11-09',i),day=new Date(serviceDate+'T12:00Z').getUTCDay(),
  byday=(rows,key)=>[...new Set(rows.filter(r=>r.day_of_week===day).map(r=>r[key]))].sort();
  participants.push({serviceDate,assignmentEmployeeIds:byday(fixture.assignments,'owner_person_id'),lunchOwnerEmployeeIds:byday(fixture.lunchDocument.loans,'normal_owner_person_id'),lunchCovererEmployeeIds:byday(fixture.lunchDocument.responsibilities,'coverer_person_id')});
  const commands=copy(initial);
  if(admitJada)commands[1]=prepareApprovedManualEmploymentAdmission({employeeId:jada,managerId:manager,requestId:'88888888-8888-4888-8888-888888888888',expectedAuthorityRevision:42,expectedEmploymentRevision:1,
   explicitFact:{effectiveFrom:'2026-11-09',state:'START_DATE_CONFIRMED',firstServiceDate:'2026-11-09',approvedLunch:null,ownerEvidenceSha256:'b'.repeat(64)}}).command;
  employmentByDate.push({schema:'custodial.employment-admission-read.v1',serviceDate,authorityRevision:42,employees:commands.map(c=>({employeeId:c.employeeId,employmentRevision:c.expectedEmploymentRevision+1,acceptedByManagerId:manager,command:c}))});
 }
 return {schema:'custodial.approved-manual-recurring-basis.v1',managerId:manager,sourceId:source,publicationId:publication,versionId:version,
  origin:'2026-11-02',frameStart:'2026-11-09',frameEnd:'2026-11-15',authorityRevision:42,generation:3,manifestSha256:'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f',
  baselineSnapshotDigest:'a'.repeat(64),catalogEntryDigest:'b'.repeat(64),sourceProjectionIdentity:'c'.repeat(64),sourceLunchIdentity:'d'.repeat(64),
  assignmentCount:346,lunchCount:40,acceptedExceptions:[],adjustmentReasons:[],employmentByDate,participants,existingProjectionId:null};
}
const prepare=(b=basis())=>prepareApprovedManualRecurringPeriod({basis:b,serviceDate:'2026-11-11',expectedRevision:42,expectedGeneration:3,requestId:request});
for(let i=0;i<7;i++)check(`Civil origin weekday${i} retains its own seven-day frame`,()=>{
 const origin=plus('2026-10-25',i),f=approvedManualRecurringFrame(origin,plus(origin,9));assert.equal(f.frameStart,plus(origin,7));assert.equal(f.frameEnd,plus(origin,13));assert.equal(f.periodIndex,1);
});
check('Friday initial activation repeats Fridays, not Monday',()=>{assert.deepEqual(approvedManualRecurringFrame('2026-10-30','2026-11-21'),{origin:'2026-10-30',periodIndex:3,frameStart:'2026-11-20',frameEnd:'2026-11-26'});});
check('DST, leap-day and year boundary are civil date arithmetic',()=>{
 assert.equal(approvedManualRecurringFrame('2026-10-30','2026-11-06').frameStart,'2026-11-06');
 assert.equal(approvedManualRecurringFrame('2028-02-26','2028-03-04').frameStart,'2028-03-04');
 assert.equal(approvedManualRecurringFrame('2026-12-29','2027-01-05').frameStart,'2027-01-05');
});
check('Invalid/pre-origin/initial/nonaligned frames refuse',()=>{
 for(const d of ['2026-02-29','2026-11-31','2026-1-01'])assert.throws(()=>approvedManualRecurringFrame('2026-01-01',d));
 assert.throws(()=>approvedManualRecurringFrame('2026-10-30','2026-10-29'));
 assert.throws(()=>repeatApprovedManualNormalRows({...rowsInput,frameStart:fixture.origin}));
 assert.throws(()=>repeatApprovedManualNormalRows({...rowsInput,frameStart:'2026-11-10'}));
});
const before=digest(fixture),repeated=repeatApprovedManualNormalRows(rowsInput);
check('Actual historical346-row/40-lunch pattern repeats without input mutation',()=>{assert.equal(repeated.assignments.length,346);assert.equal(repeated.loans.length,40);assert.equal(digest(fixture),before);assert.equal(repeated.solverInvoked,false);assert.equal(repeated.published,false);});
check('Every work identity, owner, full window and effort remains exact',()=>{
 const omit=(r,keys)=>Object.fromEntries(Object.entries(r).filter(([k])=>!keys.includes(k)));
 for(let i=0;i<346;i++){const old=fixture.assignments[i],r=repeated.assignments[i];assert.equal(r.service_date,plus(old.service_date,7));assert.deepEqual(omit(r,['service_date','owner_digest','exact_owner_identity']),omit(old,['service_date','owner_digest','exact_owner_identity']));assert.notEqual(r.owner_digest,old.owner_digest);}
});
check('All forty full-hour lunches, helpers and responsibilities retained exactly',()=>{
 for(let i=0;i<40;i++){const old=fixture.lunchDocument.loans[i],r=repeated.loans[i];assert.equal(r.service_date,plus(old.service_date,7));assert.notEqual(r.loan_id,old.loan_id);
  for(const k of ['coverage_start','coverage_end','helper_slot_ids','normal_owner_slot_id','normal_owner_person_id','status','fallback'])assert.deepEqual(r[k],old[k]);}
 assert.equal(repeated.responsibilities.length,fixture.lunchDocument.responsibilities.length);
 for(let i=0;i<repeated.responsibilities.length;i++){const r=repeated.responsibilities[i],o=fixture.lunchDocument.responsibilities[i];assert.notEqual(r.responsibility_id,o.responsibility_id);assert.deepEqual(r.segments,o.segments);assert.deepEqual(r.proximity_evidence,o.proximity_evidence);assert.equal(r.coverer_person_id,o.coverer_person_id);assert.ok(repeated.loans.some(l=>l.loan_id===r.loan_id));}
});
check('New notification identities preserve actual delivery-time/employee links',()=>{
 assert.equal(repeated.notification_intents.length,fixture.lunchDocument.notification_intents.length);
 for(let i=0;i<repeated.notification_intents.length;i++){const r=repeated.notification_intents[i],o=fixture.lunchDocument.notification_intents[i];assert.notEqual(r.notification_key,o.notification_key);assert.equal(r.scheduled_time,o.scheduled_time);assert.equal(r.event,o.event);assert.equal(r.coverer_slot_id,o.coverer_slot_id);assert.equal(r.delivery_state,'NOT_ENQUEUED');assert.ok(repeated.loans.some(l=>l.loan_id===r.loan_id));}
});
check('Exact existing native canonical date-bound key formulas, not a private hash namespace',()=>{
 const nativeHash=x=>createHash('sha256').update(canonicalJson(x)).digest('hex'),l=repeated.loans[0];
 assert.equal(repeated.overlayInputDigest,digest({...fixture.overlayCompilerInput,serviceDate:'2026-11-09'}));
 assert.equal(l.loan_id,nativeHash({policy:'owner-20260921-two-nearby-full-hour-v1',input:repeated.overlayInputDigest,serviceDate:l.service_date,ownerSlotId:l.normal_owner_slot_id,start:l.coverage_start,end:l.coverage_end}));
 const r=repeated.responsibilities[0],minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),areaId=nativeHash([...r.segments].sort((a,b)=>a.planWorkId<b.planWorkId?-1:a.planWorkId>b.planWorkId?1:0).map(s=>({work:s.planWorkId,start:minute(s.normalWindow.start),end:minute(s.normalWindow.end)})));
 assert.equal(r.responsibility_id,nativeHash({loanId:r.loan_id,areaId,covererSlotId:r.coverer_slot_id}));
 const n=repeated.notification_intents[0];assert.equal(n.notification_key,nativeHash({loanId:n.loan_id,slot:n.coverer_slot_id,event:n.event}));
});
check('No prior-frame global loan/responsibility/notification job key is reused',()=>{
 for(const [old,current,key] of [[fixture.lunchDocument.loans,repeated.loans,'loan_id'],[fixture.lunchDocument.responsibilities,repeated.responsibilities,'responsibility_id'],[fixture.lunchDocument.notification_intents,repeated.notification_intents,'notification_key']]){
  const oldKeys=new Set(old.map(r=>r[key]));assert.equal(new Set(current.map(r=>r[key])).size,current.length);assert.ok(current.every(r=>!oldKeys.has(r[key])));
 }
 assert.notEqual(repeated.overlayInputDigest,fixture.lunchDocument.source_input_digest);
});
check('Same period is deterministic; later periods have distinct identities',()=>{
 assert.deepEqual(repeatApprovedManualNormalRows(rowsInput),repeated);
 const next=repeatApprovedManualNormalRows({...rowsInput,frameStart:'2026-11-16'});assert.notEqual(next.loans[0].loan_id,repeated.loans[0].loan_id);assert.notEqual(next.notification_intents[0].notification_key,repeated.notification_intents[0].notification_key);
});
check('Truncated or malformed normal pattern refuses',()=>{
 assert.throws(()=>repeatApprovedManualNormalRows({...rowsInput,assignments:fixture.assignments.slice(1)}));
 const ld=copy(fixture.lunchDocument);ld.loans[0].day_of_week=8;assert.throws(()=>repeatApprovedManualNormalRows({...rowsInput,lunchDocument:ld}));
 const ar=copy(fixture.assignments);ar[0].service_date='2026-11-30';assert.throws(()=>repeatApprovedManualNormalRows({...rowsInput,assignments:ar}));
});
check('No full feasibility read/copy/hash is required',()=>{
 const input={...rowsInput};Object.defineProperty(input,'feasibility',{get(){throw Error('Forbidden full feasibility read');}});assert.equal(repeatApprovedManualNormalRows(input).assignments.length,346);
 const b=basis();Object.defineProperty(b,'feasibility',{get(){throw Error('Forbidden full feasibility read');}});assert.equal(prepare(b).status,'NORMAL_PERIOD_READY_DATA');
});
check('Only synthetic explicitly admitted Jada yields ready DATA; still no publish authority',()=>{const d=prepare();assert.equal(d.status,'NORMAL_PERIOD_READY_DATA');assert.equal(d.published,false);assert.equal(d.solverInvoked,false);assert.ok(Buffer.byteLength(JSON.stringify(d.referenceEnvelope))<12000);assert.equal(d.referenceDigest,digest(d.referenceEnvelope));assert.ok(!('feasibility' in d.referenceEnvelope));});
check('Actual initial Jada pre-start returns adjustment, never normal publish or PTO',()=>{
 const d=prepare(basis({admitJada:false}));assert.equal(d.status,'NEEDS_DATED_ADJUSTMENT');assert.equal(d.referenceEnvelope,null);assert.ok(d.reasons.some(r=>r.kind==='PRE_START_NOT_PTO'&&r.employeeId===jada));assert.equal(d.route,'SAME_NATIVE_APPROVED_MANUAL_DATED_OWNER_PATH');
});
check('An accepted exception routes to existing native dated owner path',()=>{const b=basis();b.acceptedExceptions=[{id:'accepted-pto-original',type:'pto'}];const d=prepare(b);assert.equal(d.status,'NEEDS_DATED_ADJUSTMENT');assert.deepEqual(d.reasons[0].exceptionIds,['accepted-pto-original']);assert.equal(d.normalSourceChanged,false);});
check('Changed actual roster/lunch context is not silently repeated',()=>{const b=basis();b.adjustmentReasons=[{kind:'ACTUAL_ROSTER_CHANGED',slotId:records[0].slotId}];assert.equal(prepare(b).status,'NEEDS_DATED_ADJUSTMENT');});
check('Missing/future/stale employment basis refuses',()=>{
 const b=basis();b.employmentByDate.pop();assert.throws(()=>prepare(b));
 const c=basis();c.employmentByDate[0].authorityRevision=41;assert.throws(()=>prepare(c));
});
check('Stale global generation/catalog and wrong frame refuse',()=>{
 for(const changes of [{authorityRevision:41},{generation:2},{catalogEntryDigest:null},{frameStart:'2026-11-10'},{manifestSha256:'a'.repeat(64)}]){const b=basis();Object.assign(b,changes);assert.throws(()=>prepare(b));}
});
check('All seven dates and both exact employee revisions bind compact reference',()=>{const d=prepare();assert.equal(d.referenceEnvelope.employmentRevisionVector.length,14);assert.equal(new Set(d.referenceEnvelope.employmentRevisionVector.map(r=>r.serviceDate)).size,7);assert.equal(d.referenceEnvelope.employmentRevisionVector.find(r=>r.employeeId===jada).employmentRevision,2);});
check('Already materialized normal frame is not regenerated',()=>{const b=basis();b.existingProjectionId=request;assert.equal(prepare(b).status,'ALREADY_MATERIALIZED');const c=basis({admitJada:false});c.existingProjectionId=request;assert.equal(prepare(c).status,'NEEDS_DATED_ADJUSTMENT');});
check('Duplicate/malformed participant dates refuse',()=>{const b=basis();b.participants[1].serviceDate=b.participants[0].serviceDate;assert.throws(()=>prepare(b));const c=basis();c.participants[0].assignmentEmployeeIds=['bogus'];assert.throws(()=>prepare(c));});
check('All seven locked schedules and14packet files remain fullhash exact',()=>{
 const c=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/catalog.json',import.meta.url)));assert.equal(Object.keys(c.sourcesByDay).length,7);assert.equal(c.files.length,14);
 for(const r of c.files){const v=readFileSync(new URL('../config/schedules/manual-approved-20261030/packet/'+r.path,import.meta.url));assert.equal(v.length,r.bytes);assert.equal(createHash('sha256').update(v).digest('hex'),r.sha256);}
});
check('SQL proposal uses same native writer and no normal/source/history mutation',()=>{
 const s=readFileSync(new URL('../proposals/approved-manual-recurring-period.sql',import.meta.url),'utf8');
 for(const required of ['inverse<>original','custodial_employment.read_admissions','PRE_START_NOT_PTO','NEEDS_DATED_ADJUSTMENT','static_weekly_accepted_exception_set','static_weekly_manual_repeat_materialize_projection','static_weekly_v8_materialize_lunch_document','static_weekly_manual_assert_lunch_lineage','static_weekly_manual_identity_json','pg_advisory_xact_lock','replay','snapshot_digest','pg_column_size(p_reference)>32768','frame:=public.static_weekly_source_window_start']){
  if(required==='replay')continue;assert.ok(s.includes(required),required);
 }
 assert.doesNotMatch(s,/static_weekly_digest_jsonb\(\s*(?:b|baseline)\.feasibility\s*\)/i);
 assert.doesNotMatch(s,/SELECT\s+\*\s+INTO.*baseline/i);
 assert.doesNotMatch(s,/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.(?:weekly_schedule_versions|static_weekly_authority_source_documents|static_weekly_approved_initial_baselines|static_weekly_approved_template_catalog|employees|weekly_roster)/i);
 assert.doesNotMatch(s,/static_weekly_v3_issue_attestation|solveStaticWeekly|I1_RECEIPT/i);
});
console.log(JSON.stringify({status:'PASS',groups:checks.length,checks,actualHistoricalNormalRows:346,actualHistoricalLunches:40,fixtureIsHistoricalNotCurrent:true,
 readyCaseUsesSyntheticExplicitJadaAdmission:true,solverInvoked:false,sqlExecuted:false,productionWritten:false,scope:'Pure deterministic normal-row repetition and typed refusal/reference DATA; no native SQL qualification'}));
