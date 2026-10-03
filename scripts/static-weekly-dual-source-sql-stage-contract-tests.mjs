import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDualSourceRegisteredCorrectionSqlSource} from './fixtures/dual-source-registered-correction-sql-source.mjs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';

let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const fixture=createDualSourceRegisteredCorrectionSqlSource();
const runner=readFileSync(new URL('./run-isolated-shift-end-tests.mjs',import.meta.url),'utf8');
const child=readFileSync(new URL('./static-weekly-dual-source-current-correction-sql-tests.mjs',import.meta.url),'utf8');
check('disposable fixture keeps original314, historical313 and current323 separate',()=>{
 assert.deepEqual([fixture.original.compilerInput.version.assignments.length,
  fixture.historical.compilerInput.version.assignments.length,fixture.correction.compilerInput.version.assignments.length],
  [314,313,323]);
 assert.equal(new Set([fixture.original.sourceId,fixture.historical.sourceId,fixture.correction.sourceId]).size,3);
});
check('valid accepted historical assignment and availability remain unmodified',()=>{
 assert.deepEqual(fixture.historical.compilerInput.version.vacantSlotIds,[]);
 assert.equal(fixture.historical.compilerInput.version.slotAvailability.length,45);
 assert.equal(digest(fixture.historical.compilerInput),fixture.historical.sourceDigest);
 assert.equal(digest(fixture.correction.compilerInput),fixture.correction.sourceDigest);
 assert.equal(fixture.former.length,3);
 for(const former of fixture.former){
  const old=fixture.historical.compilerInput.slots.find(s=>s.id===former.slotId);
  const now=fixture.correction.compilerInput.slots.find(s=>s.id===former.slotId);
  assert.equal(old.incumbencies.at(-1).personId,former.personId);
  assert.equal(old.incumbencies.at(-1).effectiveEnd,null);
  assert.equal(now.incumbencies.at(-1).effectiveEnd,fixture.syntheticServiceDate);
  assert.ok(fixture.correction.compilerInput.version.vacantSlotIds.includes(former.slotId));
 }
});
check('new stage pins exact217 and preserves older stage branches',()=>{
 assert.match(runner,/const currentManager217Stage=stage==='current-manager-217'/);
 assert.match(runner,/const dualSource217Stage=stage==='dual-source-217'/);
 assert.match(runner,/if\(dualSource217Stage\)\{assertCurrentManager217MigrationSet\(\);loadCurrentManagerPublicationFixture\(\);\}/);
 assert.match(runner,/files\.length,currentManager217Stage\|\|dualSource217Stage\?217/);
 assert.match(runner,/20261003230000_static_weekly_named_handoff_derivation\.sql/);
 assert.match(runner,/if\(publishedStage\)execFileSync/);
 assert.match(runner,/if\(dualSource217Stage\)execFileSync\(process\.execPath,\['scripts\/static-weekly-dual-source-current-correction-sql-tests\.mjs'\]/);
});
check('new stage retains network-none, full replay, default-grant absence and owned cleanup',()=>{
 assert.match(runner,/--network','none'/);
 assert.match(runner,/sql\(removeDefaultsSql\+absenceGuard\)/);
 assert.match(runner,/for\(const file of files\)/);
 assert.match(runner,/sql\(absenceGuard\+'\\n'\+bytes/);
 assert.match(runner,/finally\{cleanup\(\);\}/);
 assert.match(runner,/SHIFT_END_TEST_CONTAINER:container,SHIFT_END_TEST_SOCKET:socket/);
});
check('child invokes real official source and manager paths without missing-day false claim',()=>{
 for(const needle of ['static_weekly_v6_initialize_registered_roster','static_weekly_v8_vacate_roster_slot',
  'plane.createInitialDraft','plane.publishDraft','plane.previewRecurringStaffing',
  'plane.confirmRecurringStaffing','plane.getRecurringConfirmationStatus',
  'immutable source remains','historical publication remains byte-exact',
  'no missing-day availability SQL claim']){
  assert.ok(child.includes(needle),`missing actual child path ${needle}`);
 }
 assert.ok(!child.includes('createSyntheticRegisteredCurrentCorrectionReductionFixture('),
  'SQL child must use valid historical fixture boundary, not removed availability');
 assert.match(child,/createDualSourceRegisteredCorrectionSqlSource\(\)/);
 assert.match(child,/finally\{await closeClock\(originalClock\);\}/);
});
console.log(JSON.stringify({status:'PASS_DUAL_SOURCE_217_SOURCE_ONLY',checks,digests:[fixture.historical.sourceDigest,
 fixture.correction.sourceDigest],database:'NOT_RUN',solver:'NOT_RUN',production:false}));
