import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readOwnerConfirmedEmploymentAdmissionData,prepareApprovedManualEmploymentAdmission,
 prepareApprovedManualEmploymentAvailability,assertApprovedManualEmploymentParticipants} from '../src/approved-manual-employment-admission.js';

const checks=[];
function check(name,fn){fn();checks.push(name);}
const copy=structuredClone,managerId='11111111-1111-4111-8111-111111111111',
 requestIds=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],
 data=readOwnerConfirmedEmploymentAdmissionData(),[xavier,jada]=data.employees,
 prepared=data.employees.map((p,i)=>prepareApprovedManualEmploymentAdmission({employeeId:p.employeeId,managerId,
  requestId:requestIds[i],expectedAuthorityRevision:42,expectedEmploymentRevision:0}));
function acceptedRead(serviceDate='2026-11-01'){
 return {schema:'custodial.employment-admission-read.v1',serviceDate,authorityRevision:42,
  employees:prepared.map(p=>({employeeId:p.command.employeeId,employmentRevision:1,acceptedByManagerId:managerId,command:copy(p.command)}))};
}
const evaluate=(day='2026-11-01',read=acceptedRead(day))=>prepareApprovedManualEmploymentAvailability({serviceDate:day,expectedAuthorityRevision:42,acceptedRead:read});
const row=(v,id)=>v.employees.find(p=>p.employeeId===id);
const build=changes=>prepareApprovedManualEmploymentAdmission({employeeId:jada.employeeId,managerId,requestId:requestIds[1],
 expectedAuthorityRevision:42,expectedEmploymentRevision:0,...changes});
check('Exact owner instruction and retained IDs, not candidate effective-start authority',()=>{
 assert.equal(xavier.firstServiceDate,'2026-11-01');assert.deepEqual(xavier.approvedLunch,{start:'12:30',end:'13:30'});
 assert.equal(jada.firstServiceDate,null);assert.equal(jada.state,'PRE_START');assert.equal(data.admitted,false);
 const bindings=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/reference-bindings.json',import.meta.url)));
 for(const p of data.employees){const b=bindings.people.find(b=>b.approvedName===p.employeeName);assert.equal(b.employeeId,p.employeeId);assert.equal(b.slotId,p.slotId);}
 assert.equal(bindings.people.find(p=>p.approvedName===jada.employeeName).referenceEffectiveStart,'2026-11-02');
});
check('Prepared command is not accepted availability',()=>{assert.equal(prepared[0].status,'PREPARED_NOT_ADMITTED');assert.throws(()=>evaluate('2026-11-01',prepared[0]));});
check('Xavier pre-start Oct31 cannot be actual coverage or relief',()=>{
 const v=evaluate('2026-10-31');assert.equal(row(v,xavier.employeeId).preStart,true);
 assert.throws(()=>assertApprovedManualEmploymentParticipants({availability:v,assignmentEmployeeIds:[xavier.employeeId]}));
 assert.throws(()=>assertApprovedManualEmploymentParticipants({availability:v,lunchCovererEmployeeIds:[xavier.employeeId]}));
});
check('Xavier starts on Nov1 inclusive, retains exact approved full-hour lunch',()=>{
 const v=evaluate();assert.equal(row(v,xavier.employeeId).actualCoverageEligible,true);
 assert.equal(row(v,xavier.employeeId).actualLunchReliefEligible,true);assert.deepEqual(row(v,xavier.employeeId).approvedLunch,{start:'12:30',end:'13:30'});
 assertApprovedManualEmploymentParticipants({availability:v,assignmentEmployeeIds:[xavier.employeeId],lunchCovererEmployeeIds:[xavier.employeeId]});
});
for(const day of ['2026-10-31','2026-11-01','2026-11-02','2026-11-30'])check(`Jada remains pre-start without explicit admission on ${day}`,()=>{
 const v=evaluate(day);assert.equal(row(v,jada.employeeId).firstServiceDate,null);assert.equal(row(v,jada.employeeId).actualCoverageEligible,false);
 assert.throws(()=>assertApprovedManualEmploymentParticipants({availability:v,assignmentEmployeeIds:[jada.employeeId]}));
 assert.throws(()=>assertApprovedManualEmploymentParticipants({availability:v,lunchCovererEmployeeIds:[jada.employeeId]}));
 assert.deepEqual(v.absenceCommands,[]);assert.equal(row(v,jada.employeeId).unavailabilityClassification,'PRE_START_NOT_PTO');
});
check('No PTO or weekly source changes are generated',()=>{const v=evaluate();assert.equal(v.normalSchedulesChanged,false);assert.equal(v.productionWritten,false);assert.deepEqual(v.absenceCommands,[]);});
check('Missing admission fails closed',()=>{const r=acceptedRead();r.employees.pop();assert.throws(()=>evaluate('2026-11-01',r));});
check('Duplicate or swapped employee receipt refuses',()=>{const r=acceptedRead();r.employees[1]=copy(r.employees[0]);assert.throws(()=>evaluate('2026-11-01',r));});
check('Stale global revision refuses',()=>{const r=acceptedRead();r.authorityRevision=41;assert.throws(()=>evaluate('2026-11-01',r));});
check('Wrong per-employee accepted revision refuses',()=>{const r=acceptedRead();r.employees[1].employmentRevision=2;assert.throws(()=>evaluate('2026-11-01',r));});
check('Boolean revision does not coerce to zero',()=>{assert.throws(()=>build({expectedAuthorityRevision:false}));const r=acceptedRead();r.employees[1].employmentRevision=true;assert.throws(()=>evaluate('2026-11-01',r));});
check('Manager identity cannot change between command and read',()=>{const r=acceptedRead();r.employees[1].acceptedByManagerId=requestIds[0];assert.throws(()=>evaluate('2026-11-01',r));});
check('Command for foreign employee cannot replace Jada',()=>{const r=acceptedRead();r.employees[1].command.employeeId=xavier.employeeId;assert.throws(()=>evaluate('2026-11-01',r));});
check('Future authority admission cannot be used in an older snapshot',()=>{const r=acceptedRead();r.employees[1].command.expectedAuthorityRevision=43;assert.throws(()=>evaluate('2026-11-01',r));});
check('Pre-start cannot smuggle an invented first day or lunch',()=>{
 const r=acceptedRead();r.employees[1].command.fact.firstServiceDate='2026-11-02';assert.throws(()=>evaluate('2026-11-01',r));
 const s=acceptedRead();s.employees[1].command.fact.approvedLunch={start:'12:30',end:'13:30'};assert.throws(()=>evaluate('2026-11-01',s));
});
check('Missing or invalid dates, not rollover dates, are refused',()=>{
 for(const day of ['2026-02-29','2026-11-31','2026-1-01','2026-11-01T00:00:00Z',null])assert.throws(()=>evaluate(day));
});
check('Unknown fields and statuses cannot change semantics',()=>{
 const r=acceptedRead();r.employees[1].command.fact.pto=true;assert.throws(()=>evaluate('2026-11-01',r));
 const s=acceptedRead();s.employees[1].command.fact.state='PTO';assert.throws(()=>evaluate('2026-11-01',s));
});
check('Identity and bounded integer validation',()=>{
 for(const changes of [{managerId:null},{requestId:'pretend'},{employeeId:requestIds[0]},{expectedEmploymentRevision:-1},{expectedAuthorityRevision:Number.MAX_SAFE_INTEGER}])assert.throws(()=>build(changes));
});
check('Xavier instruction is not a start/lunch edit seam',()=>{
 const f=copy(prepared[0].command.fact);f.ownerEvidenceSha256='b'.repeat(64);f.firstServiceDate='2026-11-02';
 assert.throws(()=>prepareApprovedManualEmploymentAdmission({employeeId:xavier.employeeId,managerId,requestId:requestIds[0],expectedAuthorityRevision:42,expectedEmploymentRevision:0,explicitFact:f}));
 const r=acceptedRead();r.employees[0].command.fact.approvedLunch={start:'12:00',end:'13:00'};assert.throws(()=>evaluate('2026-11-01',r));
});
check('Changed proposed Jada facts require a new explicit evidence reference',()=>{
 const f=copy(prepared[1].command.fact);f.state='START_DATE_CONFIRMED';f.firstServiceDate='2026-11-05';assert.throws(()=>build({explicitFact:f}));
});
check('Jada explicit future start remains merely prepared until actual RPC admission',()=>{
 const f={effectiveFrom:'2026-11-05',state:'START_DATE_CONFIRMED',firstServiceDate:'2026-11-05',approvedLunch:null,ownerEvidenceSha256:'b'.repeat(64)};
 const p=build({expectedEmploymentRevision:1,explicitFact:f});assert.equal(p.status,'PREPARED_NOT_ADMITTED');assert.throws(()=>evaluate('2026-11-05',p));
 const r=acceptedRead('2026-11-05');r.employees[1]={employeeId:jada.employeeId,employmentRevision:2,acceptedByManagerId:managerId,command:p.command};
 const v=evaluate('2026-11-05',r);assert.equal(row(v,jada.employeeId).actualCoverageEligible,true);
 // Synthetic accepted read demonstrates date semantics, not actual admission.
 assert.throws(()=>evaluate('2026-11-04',{...r,serviceDate:'2026-11-04'}));
});
check('A partial-hour or overnight lunch is not accepted',()=>{
 for(const lunch of [{start:'12:30',end:'13:00'},{start:'23:30',end:'00:30'}]){
  const f={effectiveFrom:'2026-11-05',state:'START_DATE_CONFIRMED',firstServiceDate:'2026-11-05',approvedLunch:lunch,ownerEvidenceSha256:'b'.repeat(64)};
  assert.throws(()=>build({explicitFact:f}));
 }
});
check('No caller mutation, serialized boolean view or fabricated capability',()=>{
 const r=acceptedRead(),before=JSON.stringify(r),v=evaluate('2026-11-01',r);assert.equal(JSON.stringify(r),before);
 assert.throws(()=>{row(v,jada.employeeId).actualCoverageEligible=true;});
 assert.throws(()=>assertApprovedManualEmploymentParticipants({availability:copy(v),assignmentEmployeeIds:[jada.employeeId]}));
});
check('Other employees retain their existing separate admission rules',()=>{
 const v=evaluate();assertApprovedManualEmploymentParticipants({availability:v,assignmentEmployeeIds:['77d50e9a-6338-43b1-aed5-9f47d7129466']});
 assert.equal(v.employees.length,2); // no invented dates/admissions for anybody else
});
check('Locked seven normal sources and all14 packet members remain exact',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/catalog.json',import.meta.url)));
 assert.equal(Object.keys(catalog.sourcesByDay).length,7);assert.equal(catalog.files.length,14);
 for(const r of catalog.files){const bytes=readFileSync(new URL('../config/schedules/manual-approved-20261030/packet/'+r.path,import.meta.url));assert.equal(bytes.length,r.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),r.sha256);}
});
check('Proposal keeps existing owner identity and least privilege; no production SQL execution',()=>{
 const sql=readFileSync(new URL('../proposals/approved-manual-employment-admission.sql',import.meta.url),'utf8');
 for(const text of ['custodial_action_actor_v1(manager,p_credential_id,p_device_id,p_session_access,\'write\')','static_weekly_v3_assert_control_plane()','ENABLE ROW LEVEL SECURITY','FOR UPDATE','40001','replay.command IS DISTINCT FROM p_command','previous.employment_revision,0)<>expected_employment'])assert.ok(sql.includes(text),text);
 assert.ok(sql.includes('REVOKE ALL ON TABLE custodial_employment.admissions'));
 assert.ok(sql.includes("AND display_name=CASE WHEN employee="),'Scoped existing name/UUID binding is required');
 assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION custodial_employment.admit(jsonb,uuid,text,text) TO static_weekly_control_plane'));
 assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.(?:employees|weekly_roster|weekly_schedule|static_weekly)/i);
 assert.doesNotMatch(sql,/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE).*TO\s+(?:anon|authenticated|service_role)/i);
});
console.log(JSON.stringify({status:'PASS',groups:checks.length,checks,scope:'Pure employment DATA and refusal tests; SQL proposal assertions only, no database, native acceptance or deployment',syntheticManagersAndReceipts:true,sqlExecuted:false,productionWritten:false}));
