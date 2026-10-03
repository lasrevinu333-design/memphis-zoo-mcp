import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,loadCurrentManagerPublicationFixture,
 CURRENT_MANAGER_MIGRATION_MANIFEST,CURRENT_MANAGER_217_MIGRATION_MANIFEST,CURRENT_MANAGER_217_MIGRATION} from './fixtures/current-manager-publication-source.mjs';
import {validateSixPersonAbsenceFixtureBytes} from './fixtures/six-person-absence-source.mjs';
import {validateFullNineV6FixtureBytes} from './fixtures/full-nine-v6-source.mjs';
import {deriveDatedShiftEndCoverage} from '../src/static-weekly-shift-end-derivation.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {normalizeStaticWeeklyAuthority} from '../src/static-weekly-schedule-program.js';
import {assertStoredNamedSourceBoundary} from './static-weekly-named-handoff-contract-tests.mjs';

let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const f=loadCurrentManagerPublicationFixture(),p=f.packet;
check('exact217 manifest extends pinned old216, separately from old176',()=>{
 const files=assertCurrentManager217MigrationSet();assert.equal(files.length,217);
 assert.deepEqual(files.at(-1),CURRENT_MANAGER_217_MIGRATION);
 assert.equal(createHash('sha256').update(JSON.stringify(files.slice(0,216))).digest('hex'),CURRENT_MANAGER_MIGRATION_MANIFEST);
 assert.equal(createHash('sha256').update(JSON.stringify(files)).digest('hex'),CURRENT_MANAGER_217_MIGRATION_MANIFEST);
});
check('historical216 identity explicitly refuses the changed217 manifest',()=>{
 assert.throws(()=>assertCurrentManagerMigrationSet(),/all216 migrations/);
});
check('current323 and accepted original314 remain separate',()=>{
 assert.equal(p.compilerInput.version.assignments.length,323);assert.equal(p.original.compilerInput.version.assignments.length,314);
 assert.notEqual(p.sourceId,p.original.sourceId);assert.notEqual(p.sourceDigest,p.original.sourceDigest);assert.equal(p.original.registration,false);
});
check('fixture is deterministic and has no admitted claim',()=>{
 assert.deepEqual(loadCurrentManagerPublicationFixture().bytes,f.bytes);
 assert.equal(p.classification,'SYNTHETIC_CURRENT323_PLUS_IMMUTABLE_ORIGINAL314_NOT_PRODUCTION_REGISTRATION');
});
check('six current people and three stable vacancies; no old-person resurrection',()=>{
 assert.equal(p.rosterSlots.filter(s=>s.personId).length,6);assert.equal(p.rosterSlots.filter(s=>!s.personId).length,3);
 assert.equal(new Set(p.rosterSlots.map(s=>s.slotId)).size,9);
});
check('Karen immutable days and current Gregory lunch retained',()=>{
 assert.deepEqual(f.config.slots.KAREN.workDays,[1,2,3,5,6]);
 assert.deepEqual(f.config.slots.GREGORY.lunch,['12:30','13:30']);
});
check('current dated coverage has exact494 segments without rewriting323',()=>{
 const before=JSON.stringify(p.compilerInput),d=deriveDatedShiftEndCoverage(p.compilerInput,postgresJsonbContentDigest);
 assert.equal(d.effectiveInput.version.assignments.length,494);assert.equal(d.receipt.parentChains.length,323);
 assert.equal(JSON.stringify(p.compilerInput),before);
});
check('registered source to dated draft permits only exact roster and lifecycle deltas',()=>{
 const registered=structuredClone(p.compilerInput),hydrated=structuredClone(registered);
 const versionId='10000000-0000-4000-8000-000000000217';
 const publicationId='20000000-0000-4000-8000-000000000217';
 const serviceDate=p.compilerInput.serviceDate;
 const version={...structuredClone(hydrated.version),id:versionId,publicationId,
  status:'published',effectiveStart:serviceDate,effectiveEnd:null};
 const stored=normalizeStaticWeeklyAuthority(version,hydrated.slots,[],hydrated.proximity,serviceDate);
 const boundary=()=>assertStoredNamedSourceBoundary({registeredSource:registered,hydratedSource:hydrated,
  storedInput:stored,versionId,publicationId,serviceDate});
 assert.equal(boundary().registeredDigest,p.sourceDigest);
 for(const mutate of [
  x=>x.version.assignments[0].workId='invented-work',
  x=>x.version.shiftEndContinuityPolicy.namedHandoffs[0].at='14:01',
  x=>x.version.publicationId='30000000-0000-4000-8000-000000000217',
  x=>x.proximity.pop(),
 ]){
  const bad=structuredClone(stored);mutate(bad);
  assert.throws(()=>assertStoredNamedSourceBoundary({registeredSource:registered,hydratedSource:hydrated,
   storedInput:bad,versionId,publicationId,serviceDate}));
 }
 const wrongHydration=structuredClone(hydrated);wrongHydration.version.assignments[0].workId='invented-work';
 assert.throws(()=>assertStoredNamedSourceBoundary({registeredSource:registered,hydratedSource:wrongHydration,
  storedInput:stored,versionId,publicationId,serviceDate}),/hydration changed/);
});
for(const [name,file,validate] of [
 ['current','./fixtures/six-person-absence-source.json',validateSixPersonAbsenceFixtureBytes],
 ['original','./fixtures/full-nine-v6-source.json',validateFullNineV6FixtureBytes]]) {
 for(const mutate of [j=>j.compilerInput.version.assignments.pop(),j=>j.compilerInput.serviceDate='2099-01-01',j=>j.sourceDigest='0'.repeat(64)])
  check(`${name} changed bytes rejected`,()=>{const j=JSON.parse(readFileSync(new URL(file,import.meta.url)));mutate(j);assert.throws(()=>validate(Buffer.from(JSON.stringify(j)+'\n')));});
}
const runner=readFileSync(new URL('./run-isolated-shift-end-tests.mjs',import.meta.url),'utf8');
const publication=readFileSync(new URL('./static-weekly-current-roster-publication-tests.mjs',import.meta.url),'utf8');
check('current stage invokes publication caller and mandatory confirmation, not export-only Node',()=>{
 assert.ok(runner.includes("stage==='current-roster-only'||currentManagerStage?'scripts/static-weekly-current-roster-publication-tests.mjs'"));
 assert.ok(runner.includes("STATIC_WEEKLY_TEST_CURRENT_216:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'"));
 assert.ok(runner.includes("STATIC_WEEKLY_TEST_CURRENT_217:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'"));
 assert.ok(publication.includes('recurringConfirmationProof=await testRecurringConfirmation({pool,week,originalManagerId:managerId,check})'));
 assert.ok(publication.includes('if(currentManager217Stage)await testNamedHandoffSql({pool,authority:projection.authority,check,'));
 assert.ok(publication.includes('versionId:published.data.version_id,publicationId:published.data.publication_id'));
});
check('old176 contract, exact image, isolation/default grants and cleanup remain',()=>{
 for(const text of ["currentManager217Stage?217:currentManager216Stage?216:176","20260929125440_custodial_recovery_inventory_closure.sql",
  "supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed",
  "'--network','none'",'absenceGuard','finally{cleanup();}'])assert.ok(runner.includes(text),text);
});
check('current stage registers original only as immutable source and preserves source digest',()=>{
 assert.ok(publication.includes("check('registered original314 exact digest without historical person import'"));
 assert.ok(publication.includes("check('full source remains unchanged in database'"));
});
console.log(JSON.stringify({status:'PASS',checks,scope:'current-manager fixture and executable-route preflight only',
 migrationCount:217,originalRows:314,currentRows:323,derivedRows:494,solver:false,database:false,publication:false,production:false}));
