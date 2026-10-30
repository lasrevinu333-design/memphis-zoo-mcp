import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {lunchCoverageContentDigest as identityDigest} from './static-weekly-lunch-derivation.js';

const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x),
 omit=(o,keys)=>Object.fromEntries(Object.entries(o).filter(([k])=>!keys.includes(k))),
 signatures=(rows,keys)=>rows.map(r=>digest(omit(r,keys))).sort();

// The SQL owner must acquire and recheck this exact immutable prior document.
// A matching DATA object or a caller's PERSISTED label is not SQL authority.
export function validateApprovedManualLunchPrior(prior,{publicationId,versionId,frameStart,frameEnd}){
 if(prior===null)return;
 assert.ok(prior&&Object.keys(prior).sort().join(',')==='frameEnd,frameStart,lunchDocument,projectionId,publicationId,versionId');
 assert.ok(uuid(prior.projectionId));assert.equal(prior.publicationId,publicationId);assert.equal(prior.versionId,versionId);
 assert.equal(prior.frameStart,frameStart);assert.equal(prior.frameEnd,frameEnd);
 const doc=prior.lunchDocument;assert.equal(doc?.schema,'memphis-zoo.static-weekly-lunch-authority-document.v1');
 assert.equal(doc.week_start,frameStart);
 assert.equal(doc.document_identity,digest(omit(doc,['document_identity'])));
 for(const field of ['loans','responsibilities','notification_intents'])assert.ok(Array.isArray(doc[field]));
 assert.ok(doc.loans.length<=128&&doc.responsibilities.length<=4096&&doc.notification_intents.length<=512);
}

// Retain logical lunch identities where owner, helper, times and physical work
// are unchanged. Fresh proximity evidence may differ; the NEW hard-constraint
// and full-hour derivation still supplies it. Nothing here resets delivery or
// completion state, modifies the old document, or authorizes publication.
export function retainApprovedManualLunchIdentities({candidate,currentDocument,prior}){
 if(prior===null)return{candidate,retention:null};
 const old=prior.lunchDocument,result=structuredClone(candidate),retained=[];
 for(const loan of currentDocument.loans){
  const match=old.loans.filter(p=>p.service_date===loan.service_date&&p.normal_owner_slot_id===loan.normal_owner_slot_id);
  assert.ok(match.length<=1,'The actual prior must have one scheduled lunch per owner/day');
  if(!match.length)continue;const previous=match[0];
  if(digest(omit(loan,['loan_id','total_distance_minutes']))!==digest(omit(previous,['loan_id','total_distance_minutes'])))continue;
  const responsibilities=currentDocument.responsibilities.filter(r=>r.loan_id===loan.loan_id),
   oldResponsibilities=old.responsibilities.filter(r=>r.loan_id===previous.loan_id),
   intents=currentDocument.notification_intents.filter(r=>r.loan_id===loan.loan_id),
   oldIntents=old.notification_intents.filter(r=>r.loan_id===previous.loan_id);
  if(digest(signatures(responsibilities,['loan_id','responsibility_id','proximity_evidence']))
    !==digest(signatures(oldResponsibilities,['loan_id','responsibility_id','proximity_evidence']))
   ||digest(signatures(intents,['loan_id','notification_key']))!==digest(signatures(oldIntents,['loan_id','notification_key'])))continue;
  const raw=result.lunches.find(l=>l.loanId===loan.loan_id);assert.ok(raw);raw.loanId=previous.loan_id;
  for(const r of raw.responsibilities)r.responsibilityId=identityDigest({loanId:raw.loanId,areaId:r.areaId,covererSlotId:r.covererSlotId});
  for(const intent of raw.notificationIntents){
   intent.startKey=identityDigest({loanId:raw.loanId,slot:intent.covererSlotId,event:'start'});
   intent.endKey=identityDigest({loanId:raw.loanId,slot:intent.covererSlotId,event:'end'});
  }
  // Reusing a root must reproduce the original canonical member identities.
  assert.deepEqual(raw.responsibilities.map(r=>r.responsibilityId).sort(),oldResponsibilities.map(r=>r.responsibility_id).sort());
  assert.deepEqual(raw.notificationIntents.flatMap(r=>[r.startKey,r.endKey]).sort(),oldIntents.map(r=>r.notification_key).sort());
  retained.push({serviceDate:loan.service_date,normalOwnerSlotId:loan.normal_owner_slot_id,loanId:previous.loan_id});
 }
 const retention={schema:'custodial.approved-manual-lunch-identity-retention.v1',priorProjectionId:prior.projectionId,
  priorDocumentIdentity:old.document_identity,loans:retained,requiresSqlOwnerCurrentnessCheck:true};
 result.identityRetention=retention;
 return{candidate:result,retention};
}
