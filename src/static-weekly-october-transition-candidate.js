// Local candidate preparation only. No database, registration or publication entrypoint.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertServiceDate, selectEffectiveWeeklyVersion} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from './static-weekly-schedule-program.js';

export const OCTOBER_START='2026-10-01';
export const RECURRING_START='2026-10-05';
const clone=structuredClone;
const uuid=label=>{
 const hex=createHash('sha256').update(label).digest('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
export function compilerInput(source){
 const input=clone(source);input.versions=[input.version];delete input.version;return input;
}
export function createOctoberTransitionCandidate(recurringPacket){
 assert.equal(recurringPacket.effectiveDate,RECURRING_START,'recurring source must start Monday October 5');
 const source=recurringPacket.compilerInput;
 assert.equal(source.version.effectiveStart,RECURRING_START);
 assert.equal(source.serviceDate,RECURRING_START);
 assert.equal(postgresJsonbContentDigest(source),recurringPacket.sourceDigest,'recurring source digest mismatch');
 const transition=clone(source);
 transition.serviceDate=OCTOBER_START;
 transition.version.effectiveStart=OCTOBER_START;
 transition.version.effectiveEnd=RECURRING_START;
 transition.version.id=uuid(`october-transition-version:${recurringPacket.sourceDigest}`);
 transition.version.publicationId=uuid(`october-transition-candidate:${recurringPacket.sourceDigest}`);
 // A distinct bounded local compiler input. It is deliberately not a recurring
 // registration packet: SQL's Monday control is retained in its owning path.
 delete transition.version.contentDigest;
 const body={schema:'custodial.dated-transition-candidate.v1',classification:'LOCAL_UNPUBLISHED_NOT_REGISTRABLE',
  effectiveStart:OCTOBER_START,effectiveEndExclusive:RECURRING_START,
  recurringStart:RECURRING_START,recurringSourceDigest:recurringPacket.sourceDigest,
  compilerInput:transition,sourceDigest:postgresJsonbContentDigest(transition),
  productionWritten:false,independentReview:'NOT_RUN',
  publicationBlocker:'Owning manager acceptance and dated production materialization contract required; never pass this candidate to Monday recurring finalizer.'};
 return {...body,candidateDigest:postgresJsonbContentDigest(body)};
}
export function assertTransitionDate(candidate,date){
 assertServiceDate(date);
 const {candidateDigest,...body}=candidate;
 assert.equal(postgresJsonbContentDigest(body),candidateDigest,'transition candidate digest mismatch');
 assert.equal(candidate.sourceDigest,postgresJsonbContentDigest(candidate.compilerInput),'transition source digest mismatch');
 assert.equal(candidate.effectiveStart,OCTOBER_START);
 assert.equal(candidate.effectiveEndExclusive,RECURRING_START);
 assert.ok(date>=OCTOBER_START&&date<RECURRING_START,'outside October 1-4 transition; no backdating or recurring spill');
 assert.equal(selectEffectiveWeeklyVersion([candidate.compilerInput.version],date).id,candidate.compilerInput.version.id);
 return date;
}
export function selectOctoberCandidateDay(document,date){
 assertServiceDate(date);
 const {revision,...body}=document;
 assert.equal(postgresJsonbContentDigest(body),revision,'phone/PDF candidate revision mismatch');
 assert.ok(date>=OCTOBER_START&&date<='2026-10-11','outside prepared candidate dates');
 const day=document.days.find(row=>row.serviceDate===date);
 assert.ok(day,'missing exact dated projection');
 assert.equal(day.phase,date<RECURRING_START?'dated_transition':'recurring');
 return clone(day);
}
