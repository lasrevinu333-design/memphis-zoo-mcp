// Pure exact-source successor for one test-only historical-period assumption.
// No SQL, fixture adoption, date/clock override, runtime change or plan rewrite.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const originalManualPeriodSha='a7d9aadb9c629985ff2fc6232bfbd452b7f3c77b45d9299bc9055183d60bb16e';
export function assertHistoricalPeriodRevisionState({state,serviceDate,currentPublicationId,activationDate}){
 const a=state.authority;assert.equal(a.governed,true);assert.equal(a.service_date,serviceDate);
 assert.notEqual(a.publication_id,currentPublicationId);
 assert.match(a.projection_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.ok(Number.isSafeInteger(a.projection_authority_revision)&&a.projection_authority_revision>0);
 assert.ok(a.staffing_authority_revision===null||(Number.isSafeInteger(a.staffing_authority_revision)&&a.staffing_authority_revision>0));
 assert.equal(state.matching_projection_rows,1);assert.equal(state.projections.length,1);
 const p=state.projections[0];assert.equal(p.id,a.projection_id);assert.equal(p.week_start,a.week_start);
 const day=s=>{assert.match(s,/^\d{4}-\d{2}-\d{2}$/);const n=Date.parse(s+'T12:00:00Z');assert.ok(Number.isFinite(n));assert.equal(new Date(n).toISOString().slice(0,10),s);return n/86400000;};
 assert.equal(day(p.week_end)-day(p.week_start),6);assert.ok(serviceDate>=a.week_start&&serviceDate<=p.week_end);
 assert.equal(day(activationDate)-day(serviceDate),1);
 const expected=a.staffing_authority_revision!==null&&a.projection_authority_revision<=a.staffing_authority_revision?'stale_staffing_change':'current';
 assert.equal(a.projection_status,expected);
 if(expected==='current')assert.ok(p.week_end<activationDate,'Current historical week must end before this activation staffing becomes applicable');
 return expected;
}
const call=' assertStoredStaleHistoricalPeriod({state:historicalStale,serviceDate:historicalDate,currentPublicationId:accepted.publicationId});';
const replacement=" const historicalStatus=assertHistoricalPeriodRevisionState({state:historicalStale,serviceDate:historicalDate,currentPublicationId:accepted.publicationId,activationDate:origin});\n if(historicalStatus==='stale_staffing_change')assertStoredStaleHistoricalPeriod({state:historicalStale,serviceDate:historicalDate,currentPublicationId:accepted.publicationId});";
const importLine="import {assertHistoricalPeriodRevisionState} from './manual-period-historical-state-successor.mjs';\n";
const labels=[['F03 actual stored-stale historical authority is distinct from an absent future projection','F03 actual revision-validated historical authority is distinct from an absent future projection'],['HISTORICAL_STALE_READ_ONLY; not native-manual stale recovery','HISTORICAL_REVISION_VALIDATED_READ_ONLY; not native-manual stale recovery'],['Historical stored-stale authority preserved without rebuild or source changes','Historical authority preserved without rebuild or source changes'],["scope:'HISTORICAL_STALE_READ_ONLY'","scope:'HISTORICAL_REVISION_VALIDATED_READ_ONLY'"]];
export function deriveManualPeriodHistoricalStateSource(bytes){
 assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.length,24686);assert.equal(sha(bytes),originalManualPeriodSha);
 const original=bytes.toString('utf8');assert.equal(original.split(call).length,2);
 let candidate=importLine+original.replace(call,replacement);const applied=[];
 for(const [a,b] of labels){assert.equal(candidate.split(a).length,2);candidate=candidate.replace(a,b);applied.push([a,b]);}
 let inverse=candidate;for(const [a,b] of applied.reverse())inverse=inverse.replace(b,a);
 inverse=inverse.replace(importLine,'').replace(replacement,call);assert.equal(inverse,original);
 return {source:candidate,originalSha:sha(bytes),candidateSha:sha(candidate),originalBytes:bytes.length,candidateBytes:Buffer.byteLength(candidate),runtimeSqlChanged:false,originalPlanChanged:false};
}
