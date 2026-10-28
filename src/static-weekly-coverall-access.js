import {createHash} from 'node:crypto';
import {canonicalJson,isIsoServiceDate} from './static-weekly-schedule-model.js';
import {createCoverAllCopyTexts} from './static-weekly-coverall-print.js';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code,status:403});};
export const coverAllAccessTokenHash=token=>{
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('coverall_link_invalid');
 return createHash('sha256').update(token).digest('hex');
};
export function coverAllCanonicalBinding(document,capacityId){
 createCoverAllCopyTexts(document); // Existing full current-document integrity gate.
 if(!uuid.test(capacityId)||document.eventBriefs!==undefined||!isIsoServiceDate(document.serviceDate)
  ||!uuid.test(document.publicationId)||!uuid.test(document.projectionId)
  ||!Number.isSafeInteger(document.authorityRevision)||document.authorityRevision<0
  ||![document.replayDigest,document.lunchDocumentIdentity,document.documentDigest].every(x=>sha.test(x))
  ||document.contractors.filter(c=>c.slotId===capacityId).length!==1)fail('coverall_link_capacity_or_document_invalid');
 const d=new Date(document.serviceDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
 return {schema:'custodial.coverall-canonical-binding.v1',week_start:d.toISOString().slice(0,10),service_date:document.serviceDate,
  capacity_id:capacityId,publication_id:document.publicationId,projection_id:document.projectionId,
  authority_revision:document.authorityRevision,replay_digest:document.replayDigest,
  lunch_document_identity:document.lunchDocumentIdentity,document_digest:document.documentDigest};
}
export function scopeCanonicalCoverAllDocument(document,binding){
 const actual=coverAllCanonicalBinding(document,binding.capacity_id);
 if(canonicalJson(actual)!==canonicalJson(binding))fail('coverall_link_authority_changed');
 const {documentDigest,...base}=document;
 const selected={...base,contractors:document.contractors.filter(c=>c.slotId===binding.capacity_id)};
 return {...selected,documentDigest:createHash('sha256').update(canonicalJson(selected)).digest('hex')};
}
export function renderCanonicalCoverAllLink(document,language='both'){
 if(!['en','es','both'].includes(language))fail('coverall_link_language_invalid');
 const texts=createCoverAllCopyTexts(document),selected=texts.find(t=>t.language===(language==='both'?'en-es':language));
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<!doctype html><html lang="${language==='both'?'en':language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CoverAll assignments</title></head><body><main><pre style="white-space:pre-wrap;font:1rem system-ui">${escape(selected.text)}</pre></main></body></html>`;
}
