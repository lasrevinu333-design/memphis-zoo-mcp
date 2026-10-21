import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
 &&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'unexpected recurring repair fields');

// Distinguish the prior PATTERN's provenance from the invalid effective winner
// that confirmation must replace. No older publication becomes current here.
export function recurringPatternAuthority({publishedSource,managerSnapshot,effectiveDate,expectedRevision}){
 const patternPublicationId=publishedSource?.publication_id;
 assert.ok(uuid(patternPublicationId),'registered pattern publication identity required');
 assert.equal(publishedSource.authority_revision,expectedRevision,'pattern authority revision changed');
 const context=publishedSource.repair_context;
 if(context===undefined){
  assert.equal(publishedSource.repair_context_digest,undefined,'orphan repair digest');
  assert.equal(managerSnapshot?.current_publication?.publication_id,patternPublicationId,'manager snapshot publication changed');
  return{publicationId:patternPublicationId,patternPublicationId,repairContext:null};
 }
 assert.ok(context&&typeof context==='object'&&!Array.isArray(context),'complete repair context required');
 exactKeys(context,['schema','state','effectivePublicationId','patternPublicationId','patternSourceId','patternSourceDigest',
  'effectiveStart','authorityRevision','invalidations','managerConfirmationRequired','published']);
 assert.equal(context.schema,'static-weekly.recurring-repair-basis.v1');
 assert.equal(context.state,'REPLACING_INVALID_FUTURE');
 assert.ok(uuid(context.effectivePublicationId));
 assert.notEqual(context.effectivePublicationId,patternPublicationId,'repair cannot reuse invalidated publication as its pattern');
 assert.equal(context.effectivePublicationId,managerSnapshot?.current_publication?.publication_id,'repair winner changed');
 assert.equal(context.patternPublicationId,patternPublicationId);
 assert.equal(context.patternSourceId,publishedSource.source_id);
 assert.match(context.patternSourceDigest??'',/^[0-9a-f]{64}$/);
 assert.ok(date(effectiveDate));assert.equal(context.effectiveStart,effectiveDate);
 assert.equal(context.authorityRevision,expectedRevision);
 assert.equal(context.managerConfirmationRequired,true);assert.equal(context.published,false);
 assert.equal(publishedSource.repair_context_digest,digest(context),'repair context bytes changed');
 assert.ok(Array.isArray(context.invalidations)&&context.invalidations.length>0,'repair requires actual invalidation evidence');
 const ids=new Set(),weekEnd=new Date(Date.parse(effectiveDate+'T12:00:00Z')+6*86400000).toISOString().slice(0,10);
 for(const entry of context.invalidations){
  exactKeys(entry,['invalidationId','authorityRevision','effectiveStart','effectiveEnd','reasonCode']);
  assert.ok(uuid(entry.invalidationId)&&!ids.has(entry.invalidationId),'invalid or duplicate invalidation identity');ids.add(entry.invalidationId);
  assert.ok(Number.isSafeInteger(entry.authorityRevision)&&entry.authorityRevision>0&&entry.authorityRevision<=expectedRevision);
  assert.ok(date(entry.effectiveStart)&&entry.effectiveStart<=weekEnd);
  assert.ok(entry.effectiveEnd===null||(date(entry.effectiveEnd)&&entry.effectiveEnd>entry.effectiveStart&&entry.effectiveEnd>effectiveDate));
  assert.ok(['ROSTER_DEPENDENCY_CHANGED','SOURCE_RETIRED','RESTRICTION_DEPENDENCY_CHANGED'].includes(entry.reasonCode));
 }
 return{publicationId:context.effectivePublicationId,patternPublicationId,
  repairContext:structuredClone(context),repairContextDigest:publishedSource.repair_context_digest};
}

export function assertRecurringRepairCandidate(candidate,basis){
 if(!basis.repairContext){
  assert.equal(candidate.repairContext,undefined);assert.equal(candidate.repairContextDigest,undefined);
  assert.equal(candidate.patternPublicationId,undefined);return;
 }
 assert.equal(candidate.publicationId,basis.publicationId);
 assert.equal(candidate.patternPublicationId,basis.patternPublicationId);
 assert.deepEqual(candidate.repairContext,basis.repairContext);
 assert.equal(candidate.repairContextDigest,basis.repairContextDigest);
}
