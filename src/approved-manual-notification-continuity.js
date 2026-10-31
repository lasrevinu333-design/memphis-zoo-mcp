// Source-data comparison for targeted regression tests and preparation diagnostics.
// This module does NOT establish acceptance. The SQL consumer must reacquire its
// current authority and immutable persisted documents using the private helper.
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
const omit=(o,keys)=>Object.fromEntries(Object.entries(o).filter(([key])=>!keys.includes(key)));
const same=(a,b)=>digest(a)===digest(b);
const one=(rows,predicate)=>{const matches=rows.filter(predicate);return matches.length===1?matches[0]:null;};
const signatures=(rows,excluded=[])=>rows.map(row=>digest(omit(row,excluded))).sort();
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)
 &&Object.keys(object).sort().join(',')===[...keys].sort().join(',');
const manualSchema='custodial.approved-manual-period-projection-authority.v1';
const manualAdapter={schema:'custodial.approved-manual-period-database-adapter.v1',version:'approved-manual-period-v1'};

export function inspectApprovedManualLunchContinuity({currentState,projections,sourceProjectionId,sourceDocumentIdentity,notificationKey,serviceDate}) {
 const unavailable=()=>({state:'UNAVAILABLE_SOURCE_DATA',databaseAuthority:false});
 try {
  if(!uuid(sourceProjectionId)||!hash(sourceDocumentIdentity)||!hash(notificationKey)
   ||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||currentState?.governed!==true||currentState?.projection_status!=='current'
   ||!Array.isArray(projections))return unavailable();
  const row=id=>one(projections,p=>p.projectionId===id);
  const original=row(sourceProjectionId);let current=row(currentState.projection_id);
  const documentValid=p=>p&&p.document?.schema==='memphis-zoo.static-weekly-lunch-authority-document.v1'
   &&['loans','responsibilities','notification_intents'].every(key=>Array.isArray(p.document[key]))
   &&p.documentIdentity===p.document.document_identity
   &&p.documentIdentity===digest(omit(p.document,['document_identity']));
  if(!documentValid(original)||!current||original.documentIdentity!==sourceDocumentIdentity
   ||original.publicationId!==currentState.publication_id||original.versionId!==currentState.version_id
   ||original.weekStart>serviceDate||original.weekEnd<serviceDate)return unavailable();
  const intent=one(original.document.notification_intents,n=>n.notification_key===notificationKey&&n.service_date===serviceDate);
  const loan=one(original.document.loans,l=>l.loan_id===intent?.loan_id&&l.service_date===serviceDate&&l.status==='PLANNED');
  if(!intent||!loan)return unavailable();
  const currentId=current.projectionId,currentIdentity=current.documentIdentity,visited=new Set();
  const related=(p,field)=>p.document[field].filter(x=>x.loan_id===loan.loan_id);
  // Older fixed adapters repeat slot-label metadata already bound by the
  // immutable same-publication Source. Native rows omit those duplicate keys.
  const availability=p=>p.envelope.authority.projectionAvailability.filter(a=>a.serviceDate===serviceDate
   &&(a.slotId===loan.normal_owner_slot_id||loan.helper_slot_ids.includes(a.slotId)))
   .map(a=>omit(a,['incumbentSlotId','incumbentSlotLabel']));
  for(let hop=0;hop<128;hop++) {
   if(!documentValid(current)||visited.has(current.projectionId)||current.publicationId!==original.publicationId
    ||current.versionId!==original.versionId||current.weekStart!==original.weekStart||current.weekEnd!==original.weekEnd)return unavailable();
   visited.add(current.projectionId);
   const nextIntent=one(current.document.notification_intents,n=>n.notification_key===notificationKey&&n.service_date===serviceDate);
   const nextLoan=one(current.document.loans,l=>l.loan_id===nextIntent?.loan_id&&l.service_date===serviceDate&&l.status==='PLANNED');
   if(!nextIntent||!nextLoan||!same(intent,nextIntent)||!same(omit(loan,['total_distance_minutes']),omit(nextLoan,['total_distance_minutes']))
    ||related(original,'responsibilities').length===0
    ||!same(signatures(related(original,'responsibilities'),['proximity_evidence']),signatures(related(current,'responsibilities'),['proximity_evidence']))
    ||!same(signatures(related(original,'notification_intents')),signatures(related(current,'notification_intents')))
    ||availability(original).length===0||!same(signatures(availability(original)),signatures(availability(current))))return unavailable();
   if(current.projectionId===sourceProjectionId)return {state:'MATCHING_SOURCE_DATA_ONLY',databaseAuthority:false,
    sourceProjectionId,sourceDocumentIdentity,currentProjectionId:currentId,currentDocumentIdentity:currentIdentity,notificationKey};
   if(current.envelope?.authority?.schema!==manualSchema||!same(current.envelope.adapter,manualAdapter))return unavailable();
   const retention=current.envelope.authority.lunchIdentityRetention;
   if(!exact(retention,['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'])
    ||retention.schema!=='custodial.approved-manual-lunch-identity-retention.v1'||retention.requiresSqlOwnerCurrentnessCheck!==true
    ||!uuid(retention.priorProjectionId)||!hash(retention.priorDocumentIdentity)||!Array.isArray(retention.loans)
    ||retention.loans.filter(r=>same(r,{serviceDate,normalOwnerSlotId:loan.normal_owner_slot_id,loanId:loan.loan_id})).length!==1)return unavailable();
   const previous=row(retention.priorProjectionId);
   if(!previous||previous.documentIdentity!==retention.priorDocumentIdentity)return unavailable();
   current=previous;
  }
  return unavailable();
 } catch {return unavailable();}
}
