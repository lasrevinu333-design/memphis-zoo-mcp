// Dated employment DATA, not a schedule rewrite, absence, receipt issuer or DB client.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const DATA_SHA256='1d76af9bf8dac837c26e8a3d88b35c7a273d4b181509aa106eae0cae1037ec73';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SUBJECTS=Object.freeze([
 Object.freeze({employeeId:'1318b295-fd70-4e78-8828-62c29302f96f',slotId:'5d2d2a0e-230f-5b03-9867-2e4c2826871f',employeeName:'Xavier Green'}),
 Object.freeze({employeeId:'d5fecc86-659b-464a-bc99-f0d914385db4',slotId:'ae56a131-e2fd-5465-8ab8-6e5dbf543204',employeeName:'Jada Rawlings'}),
]);
const clone=structuredClone;
const derivedAvailability=new WeakSet();
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const exact=(v,keys)=>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...keys].sort(),'Unknown or missing employment field');};
const uuid=v=>{assert.equal(typeof v,'string');assert.match(v,UUID);return v;};
const revision=v=>{assert.ok(Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER,'Exact nonnegative revision required');return v;};
const date=v=>{assert.equal(typeof v,'string');assert.match(v,/^[12]\d{3}-\d{2}-\d{2}$/);assert.equal(new Date(v+'T12:00:00Z').toISOString().slice(0,10),v,'Invalid service date');return v;};
const subject=id=>{uuid(id);const s=SUBJECTS.find(r=>r.employeeId===id);assert.ok(s,'Employment admission scope is Xavier and Jada only');return s;};
function fact(value){
 exact(value,['effectiveFrom','state','firstServiceDate','approvedLunch','ownerEvidenceSha256']);date(value.effectiveFrom);
 assert.ok(['PRE_START','START_DATE_CONFIRMED'].includes(value.state));
 assert.match(value.ownerEvidenceSha256,/^[a-f0-9]{64}$/);
 if(value.state==='PRE_START'){assert.equal(value.firstServiceDate,null,'Pre-start has no invented first day');assert.equal(value.approvedLunch,null);}
 else {date(value.firstServiceDate);assert.ok(value.firstServiceDate>=value.effectiveFrom,'No backdated employment admission');}
 if(value.approvedLunch!==null){
  exact(value.approvedLunch,['start','end']);
  for(const t of Object.values(value.approvedLunch))assert.match(t,/^(?:[01]\d|2[0-3]):[0-5]\d$/);
  const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  assert.equal(minute(value.approvedLunch.end)-minute(value.approvedLunch.start),60,'Approved lunch remains a full hour');
 }
 return value;
}
export function readOwnerConfirmedEmploymentAdmissionData(){
 const bytes=readFileSync(new URL('../release/worker1-employment-admission-20261030/OWNER_CONFIRMED_DATED_EMPLOYMENT_DATA.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),DATA_SHA256,'Dated owner facts changed');
 const data=JSON.parse(bytes);assert.equal(data.schema,'custodial.owner-confirmed-employment-facts.v1');
 assert.equal(data.admitted,false);assert.equal(data.normalSchedulesMayChange,false);return data;
}
// explicitFact is a new proposed owner instruction, never an accepted capability.
// Only the private RPC, with a current authenticated owner credential, can admit it.
export function prepareApprovedManualEmploymentAdmission({employeeId,requestId,managerId,expectedAuthorityRevision,expectedEmploymentRevision,explicitFact=null}){
 subject(employeeId);uuid(requestId);uuid(managerId);revision(expectedAuthorityRevision);revision(expectedEmploymentRevision);
 const data=readOwnerConfirmedEmploymentAdmissionData(),original=data.employees.find(r=>r.employeeId===employeeId),
  initial={effectiveFrom:original.effectiveFrom,state:original.state,firstServiceDate:original.firstServiceDate,
   approvedLunch:clone(original.approvedLunch),ownerEvidenceSha256:data.source.sha256},selected=clone(explicitFact??initial);
 fact(selected);
 if(explicitFact&&JSON.stringify(selected)!==JSON.stringify(initial))
  assert.notEqual(selected.ownerEvidenceSha256,initial.ownerEvidenceSha256,'Changed facts need a new explicit owner evidence reference');
 if(employeeId===SUBJECTS[0].employeeId){
  assert.equal(selected.state,'START_DATE_CONFIRMED');assert.equal(selected.firstServiceDate,'2026-11-01');
  assert.deepEqual(selected.approvedLunch,{start:'12:30',end:'13:30'},'Xavier approved lunch is not a schedule-edit seam');
 }
 return {status:'PREPARED_NOT_ADMITTED',command:{schema:'custodial.employment-admission-command.v1',requestId,managerId,
  employeeId,expectedAuthorityRevision,expectedEmploymentRevision,fact:selected}};
}
function validateCommand(c){
 exact(c,['schema','requestId','managerId','employeeId','expectedAuthorityRevision','expectedEmploymentRevision','fact']);
 assert.equal(c.schema,'custodial.employment-admission-command.v1');subject(c.employeeId);uuid(c.requestId);uuid(c.managerId);
 revision(c.expectedAuthorityRevision);revision(c.expectedEmploymentRevision);fact(c.fact);
}
// acceptedRead must come from the existing control-plane transaction's private
// DB reader. This pure validation cannot authenticate caller-supplied JSON.
export function prepareApprovedManualEmploymentAvailability({serviceDate,expectedAuthorityRevision,acceptedRead}){
 date(serviceDate);revision(expectedAuthorityRevision);
 exact(acceptedRead,['schema','serviceDate','authorityRevision','employees']);
 assert.equal(acceptedRead.schema,'custodial.employment-admission-read.v1');
 assert.equal(acceptedRead.serviceDate,serviceDate);assert.equal(acceptedRead.authorityRevision,expectedAuthorityRevision,'Stale authority read');
 assert.ok(Array.isArray(acceptedRead.employees)&&acceptedRead.employees.length===SUBJECTS.length);
 const seen=new Set(),employees=acceptedRead.employees.map(r=>{
  exact(r,['employeeId','employmentRevision','acceptedByManagerId','command']);const s=subject(r.employeeId);
  assert.ok(!seen.has(s.employeeId),'Duplicate admission row');seen.add(s.employeeId);validateCommand(r.command);
  assert.equal(r.command.employeeId,s.employeeId);uuid(r.acceptedByManagerId);assert.equal(r.acceptedByManagerId,r.command.managerId);
  revision(r.employmentRevision);assert.equal(r.employmentRevision,r.command.expectedEmploymentRevision+1);
  assert.ok(r.command.expectedAuthorityRevision<=expectedAuthorityRevision,'Future admission authority');
  const f=r.command.fact;assert.ok(f.effectiveFrom<=serviceDate,'Admission fact is not effective for this service date');
  if(s.employeeId===SUBJECTS[0].employeeId){assert.equal(f.state,'START_DATE_CONFIRMED');assert.equal(f.firstServiceDate,'2026-11-01');assert.deepEqual(f.approvedLunch,{start:'12:30',end:'13:30'});}
  const eligible=f.state==='START_DATE_CONFIRMED'&&serviceDate>=f.firstServiceDate;
  return {...s,employmentRevision:r.employmentRevision,requestId:r.command.requestId,
   actualCoverageEligible:eligible,actualLunchReliefEligible:eligible,
   preStart:!eligible,unavailabilityClassification:eligible?null:'PRE_START_NOT_PTO',
   firstServiceDate:f.firstServiceDate,approvedLunch:clone(f.approvedLunch)};
 });
 const result=freeze({schema:'custodial.dated-employment-availability.v1',serviceDate,authorityRevision:expectedAuthorityRevision,employees,
  normalSchedulesChanged:false,absenceCommands:[],productionWritten:false});derivedAvailability.add(result);return result;
}
// Necessary employment guard only. It does not replace qualification, actual
// roster, absence, capacity, shift, lunch, NFC or native acceptance checks.
export function assertApprovedManualEmploymentParticipants({availability,assignmentEmployeeIds=[],lunchCovererEmployeeIds=[]}){
 assert.ok(derivedAvailability.has(availability),'Use the unchanged locally derived admission view');
 assert.equal(availability.schema,'custodial.dated-employment-availability.v1');
 assert.equal(availability.employees.length,SUBJECTS.length);
 for(const [ids,key] of [[assignmentEmployeeIds,'actualCoverageEligible'],[lunchCovererEmployeeIds,'actualLunchReliefEligible']]){
  assert.ok(Array.isArray(ids));for(const id of ids){uuid(id);if(!SUBJECTS.some(s=>s.employeeId===id))continue;
   const rows=availability.employees.filter(r=>r.employeeId===id);assert.equal(rows.length,1,'Controlled employee admission missing');
   assert.equal(rows[0][key],true,'Pre-start employee cannot supply actual coverage or lunch relief');
  }
 }
 return true;
}
