import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {recurringPatternAuthority,assertRecurringRepairCandidate} from '../src/static-weekly-recurring-repair-basis.js';

const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={schema:'static-weekly.recurring-repair-basis.v1',state:'REPLACING_INVALID_FUTURE',
 effectivePublicationId:id(1),patternPublicationId:id(2),patternSourceId:id(3),patternSourceDigest:'a'.repeat(64),
 effectiveStart:'2026-10-05',authorityRevision:42,invalidations:[{invalidationId:id(4),authorityRevision:40,
  effectiveStart:'2026-10-05',effectiveEnd:null,reasonCode:'ROSTER_DEPENDENCY_CHANGED'}],
 managerConfirmationRequired:true,published:false};
function fixture(){return {publishedSource:{publication_id:id(2),source_id:id(3),authority_revision:42,
 repair_context:structuredClone(context),repair_context_digest:digest(context)},
 managerSnapshot:{current_publication:{publication_id:id(1)}},effectiveDate:'2026-10-05',expectedRevision:42};}
let checks=0;
const basis=recurringPatternAuthority(fixture());
assert.equal(basis.publicationId,id(1));checks++;
assert.equal(basis.patternPublicationId,id(2));checks++;
assert.deepEqual(basis.repairContext,context);checks++;
const normal=fixture();delete normal.publishedSource.repair_context;delete normal.publishedSource.repair_context_digest;
normal.managerSnapshot.current_publication.publication_id=id(2);
const normalBasis=recurringPatternAuthority(normal);assert.equal(normalBasis.repairContext,null);checks++;
const candidate={publicationId:id(1),patternPublicationId:id(2),repairContext:structuredClone(context),repairContextDigest:digest(context)};
assertRecurringRepairCandidate(candidate,basis);checks++;
assertRecurringRepairCandidate({publicationId:id(2)},normalBasis);checks++;
const cases=[
 ['stale winner',f=>f.managerSnapshot.current_publication.publication_id=id(5)],
 ['stale revision',f=>f.expectedRevision=43],
 ['changed digest',f=>f.publishedSource.repair_context_digest='b'.repeat(64)],
 ['old pattern posing as winner',f=>f.publishedSource.repair_context.effectivePublicationId=id(2)],
 ['wrong pattern',f=>f.publishedSource.repair_context.patternPublicationId=id(5)],
 ['wrong source',f=>f.publishedSource.repair_context.patternSourceId=id(5)],
 ['invalid source digest',f=>f.publishedSource.repair_context.patternSourceDigest=''],
 ['unknown field',f=>f.publishedSource.repair_context.extra=true],
 ['published claim',f=>f.publishedSource.repair_context.published=true],
 ['no confirmation',f=>f.publishedSource.repair_context.managerConfirmationRequired=false],
 ['no invalidation',f=>f.publishedSource.repair_context.invalidations=[]],
 ['duplicate invalidation',f=>f.publishedSource.repair_context.invalidations.push({...f.publishedSource.repair_context.invalidations[0]})],
 ['future revision',f=>f.publishedSource.repair_context.invalidations[0].authorityRevision=43],
 ['fractional revision',f=>f.publishedSource.repair_context.invalidations[0].authorityRevision=1.5],
 ['next week',f=>f.publishedSource.repair_context.invalidations[0].effectiveStart='2026-10-12'],
 ['already ended',f=>f.publishedSource.repair_context.invalidations[0].effectiveEnd='2026-10-05'],
 ['nonfinite date',f=>f.publishedSource.repair_context.invalidations[0].effectiveEnd='infinity'],
 ['rolled date',f=>f.publishedSource.repair_context.invalidations[0].effectiveStart='2026-02-30'],
 ['unknown reason',f=>f.publishedSource.repair_context.invalidations[0].reasonCode='ASSUMED_REPAIR'],
 ['invalid identity',f=>f.publishedSource.repair_context.invalidations[0].invalidationId='bad'],
 ['orphan digest',f=>delete f.publishedSource.repair_context],
];
for(const [label,mutate] of cases){const f=fixture();mutate(f);
 if(f.publishedSource.repair_context&&label!=='changed digest')f.publishedSource.repair_context_digest=digest(f.publishedSource.repair_context);
 assert.throws(()=>recurringPatternAuthority(f),undefined,label);checks++;
}
for(const change of [c=>c.publicationId=id(2),c=>c.patternPublicationId=id(1),c=>c.repairContext.published=true,
 c=>c.repairContextDigest='b'.repeat(64),c=>delete c.repairContext]){
 const altered=structuredClone(candidate);change(altered);assert.throws(()=>assertRecurringRepairCandidate(altered,basis));checks++;
}
assert.throws(()=>assertRecurringRepairCandidate(candidate,normalBasis));checks++;
console.log(JSON.stringify({status:'PASS',checks,scope:'pure source repair provenance and candidate binding; no database or phone proof'}));
