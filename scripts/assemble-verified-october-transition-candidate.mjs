#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {verifyStaticWeeklyScheduleResult} from '../src/static-weekly-schedule-verifier.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {createStaticWeeklyLunchCoverageCandidate} from '../src/static-weekly-lunch-coverage.js';
import {createOctoberTransitionCandidate,compilerInput,assertTransitionDate} from '../src/static-weekly-october-transition-candidate.js';
// Reuse retained complete witnesses after a presentation-policy correction.
// No repeated solver execution and no publication.
const [packetPath,proofDir,out]=process.argv.slice(2);
assert.ok(packetPath&&proofDir&&out,'usage: assemble-verified-october-transition-candidate.mjs <October5 packet> <proof directory> <new output directory>');
assert.equal(fs.existsSync(out),false,'immutable evidence output already exists');
const packet=JSON.parse(fs.readFileSync(packetPath,'utf8'));
const transition=createOctoberTransitionCandidate(packet);
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
write('transition-candidate.json',transition);
const days=[],proofs=[];
for(const [phase,source,first,last] of [
 ['dated_transition',transition.compilerInput,'2026-10-01','2026-10-04'],
 ['recurring',packet.compilerInput,'2026-10-05','2026-10-11']]){
 const input=compilerInput(source);
 const result=JSON.parse(fs.readFileSync(path.join(proofDir,`${phase}-compiler-result.json`),'utf8'));
 assert.equal(verifyStaticWeeklyScheduleResult(input,result).ok,true,'retained complete witness must validate');
 assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal||result.reviewWork));
 assert.equal(result.publicationAuthority,'ACCEPTABLE');
 assert.equal(result.verifier.ok,true);
 assert.equal(result.reviewWork.length,0);
 const lunch=createStaticWeeklyLunchCoverageCandidate(input,result);
 assert.equal(lunch.status,'PLANNED');
 assert.ok(lunch.lunches.every(row=>row.status==='PLANNED'&&!row.fallback));
 write(`${phase}-compiler-result.json`,result);
 write(`${phase}-lunch-proof.json`,lunch);
 proofs.push({phase,sourceDigest:postgresJsonbContentDigest(source),authorityDigest:result.authorityDigest,
  replayDigest:result.replayDigest,verifierOk:true,lunchDigest:lunch.candidateDigest,
  fullCompilerWeek:first,exportStart:first,exportEnd:last});
 for(let date=first;date<=last;){
  if(phase==='dated_transition')assertTransitionDate(transition,date);
  const availability=result.canonicalAuthority.projectionAvailability.filter(row=>row.serviceDate===date);
  assert.ok(availability.length,'exact dated availability missing');
  const assignments=result.weeklyAssignments.filter(row=>row.serviceDate===date);
  assert.ok(assignments.length,'exact dated assignments missing');
  const lunchLoans=lunch.lunches.filter(row=>row.serviceDate===date);
  days.push({serviceDate:date,phase,weeklyVersionId:result.weeklyVersionId,inputDigest:result.inputDigest,
   authorityDigest:result.authorityDigest,availability,assignments,
   lunchLoans:lunchLoans.map(row=>({...row,responsibilities:row.responsibilities.map(item=>({...item,
    ...(item.covererSlotId===packet.rosterSlots.find(s=>s.displayName==='Gregory Staples').slotId?{responseMode:'on_call_issues_only',instruction:'Respond only when an issue is reported during this lunch; this is not a new standing cleaning route.'}:{}),
    ...(item.segments.some(s=>['EAST_ADMIN','WEST_ADMIN'].includes(assignments.find(a=>a.planWorkId===s.planWorkId)?.workSnapshot.locationCodeSnapshot))?{checkDeadlinePolicy:'inherit_existing_180_minute_admin_deadline'}:{})}))})),
   checkPolicy:{adminMaximumHoursBetweenChecks:3,adminFamilies:['EAST_ADMIN','WEST_ADMIN'],otherChecks:'inherit_existing_90_minute_deadline',adminMorningAllowed:true,obsoleteAdmin0945Gate:false}});
  const next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);
 }
}
const body={schema:'custodial.october-phone-pdf-candidate.v1',classification:'DRAFT_UNPUBLISHED_NOT_PHONE_READBACK',
 timezone:'America/Chicago',effectiveStart:'2026-10-01',recurringStart:'2026-10-05',
 transitionCandidateDigest:transition.candidateDigest,recurringSourceDigest:packet.sourceDigest,
 rosterSlots:packet.rosterSlots,proofs,days,productionWritten:false,
 independentReview:'NOT_RUN',acceptedRevision:null,pdfStatus:'DRAFT_SAME_CANDIDATE_REVISION',
 materializationStatus:'NOT_INTEGRATED_WITH_PRODUCTION_DATED_MANAGER_ACCEPTANCE'};
const document={...body,revision:postgresJsonbContentDigest(body)};
write('phone-pdf-data.json',document);
console.log(JSON.stringify({revision:document.revision,transitionDigest:transition.sourceDigest,
 recurringDigest:packet.sourceDigest,dates:days.map(row=>row.serviceDate),fullCompilerVerifier:'PASS',
 lunchProofs:proofs.map(row=>row.lunchDigest),publication:'NOT_RUN',independentReview:'NOT_RUN'}));
