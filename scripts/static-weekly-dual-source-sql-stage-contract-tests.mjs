import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createDualSourceRegisteredCorrectionSqlSource} from './fixtures/dual-source-registered-correction-sql-source.mjs';
import {assertCurrentManager218MigrationSet,CURRENT_MANAGER_218_MIGRATION_MANIFEST}
 from './fixtures/current-manager-publication-source.mjs';
import {assertCurrentManager219Manifest,assertCurrentManager219MigrationSet,CURRENT_MANAGER_219_MESSAGE_MIGRATION}
 from './fixtures/current-manager-219-source.mjs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';

let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const fixture=createDualSourceRegisteredCorrectionSqlSource();
const runner=readFileSync(new URL('./run-isolated-shift-end-tests.mjs',import.meta.url),'utf8');
const child=readFileSync(new URL('./static-weekly-dual-source-current-correction-sql-tests.mjs',import.meta.url),'utf8');
const publishedStart=runner.indexOf(' if(publishedStage)runRecurringClockedChild(');
const publishedEnd=runner.indexOf('\n if(dualSource217Stage)',publishedStart);
assert.ok(publishedStart>=0&&publishedEnd>publishedStart,'real published child delegation block required');
const publishedDelegation=runner.slice(publishedStart,publishedEnd);
function invokePublishedDelegation(source,{childError=null}={}){
 const calls={wrapper:0,child:0,args:null,options:null,clock:null};
 const clock=Object.freeze({deadlineMilliseconds:60000});
 const context={publishedStage:true,publishedChildClock:clock,stage:'current-manager-219',
  currentManagerStage:true,currentManager216Stage:false,currentManager217Stage:false,
  currentManager218Stage:false,currentManager219Stage:true,currentManager218Browser:false,
  container:'synthetic-container',socket:'/synthetic-socket',
  process:{execPath:'/exact/node',env:{PARENT_MARKER:'retained'}},
  runRecurringClockedChild(work,boundClock){calls.wrapper++;calls.clock=boundClock;return work();},
  execFileSync(...args){calls.child++;calls.args=args[0];calls.options=args[2];
   calls.argv=args[1];if(childError)throw childError;return 'exact-child-result';}};
 const value=runInNewContext(source,context);
 return {calls,value,clock};
}
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
check('new219 stage pins exact predecessor and preserves older stage branches',()=>{
 const rows=assertCurrentManager219MigrationSet();
 assert.equal(rows.length,219);
 const predecessor=rows.filter(row=>row.file!==CURRENT_MANAGER_219_MESSAGE_MIGRATION.file);
 assert.equal(rows.length-predecessor.length,1,'only the exact MESSAGE row may be removed');
 assert.equal(createHash('sha256').update(JSON.stringify(predecessor)).digest('hex'),CURRENT_MANAGER_218_MIGRATION_MANIFEST);
 const oldTree=mkdtempSync(join(tmpdir(),'mz-dual-source-218-predecessor-'));
 try {
  mkdirSync(join(oldTree,'supabase','migrations'),{recursive:true});
  for(const row of predecessor)symlinkSync(fileURLToPath(new URL('../supabase/migrations/'+row.file,import.meta.url)),
   join(oldTree,'supabase','migrations',row.file));
  assert.deepEqual(assertCurrentManager218MigrationSet(pathToFileURL(oldTree+'/')),predecessor);
 } finally {rmSync(oldTree,{recursive:true});}
 for(const mutate of [
  r=>r.pop(),
  r=>r.push({file:'20261004010000_unapproved.sql',sha256:'0'.repeat(64)}),
  r=>r.find(row=>row.file===CURRENT_MANAGER_219_MESSAGE_MIGRATION.file).sha256='0'.repeat(64),
  r=>r[0].sha256='0'.repeat(64),
  r=>[r[1],r[2]]=[r[2],r[1]],
  r=>r[2]={...r[1]},
 ]){const bad=structuredClone(rows);mutate(bad);assert.throws(()=>assertCurrentManager219Manifest(bad));}
 assert.match(runner,/const currentManager217Stage=stage==='current-manager-217'/);
 assert.match(runner,/const dualSource217Stage=stage==='dual-source-217'/);
 assert.match(runner,/const currentManager218Stage=stage==='current-manager-218'/);
 assert.match(runner,/const dualSource218Stage=stage==='dual-source-218'/);
 assert.match(runner,/const dualSource219Stage=stage==='dual-source-219'/);
 assert.match(runner,/if\(dualSource219Stage\)\{assertCurrentManager219MigrationSet\(\);loadCurrentManagerPublicationFixture\(\);\}/);
 assert.match(runner,/if\(dualSource217Stage\)\{assertCurrentManager217MigrationSet\(\);loadCurrentManagerPublicationFixture\(\);\}/);
 assert.match(runner,/if\(dualSource218Stage\)\{assertCurrentManager218MigrationSet\(\);loadCurrentManagerPublicationFixture\(\);\}/);
 assert.match(runner,/files\.length,currentManager219Stage\|\|dualSource219Stage\?219:currentManager218Stage\|\|dualSource218Stage\?218/);
 assert.match(runner,/20261003230000_static_weekly_named_handoff_derivation\.sql/);
 assert.match(runner,/20261004000000_native_provider_event_decision_lookup\.sql/);
 assert.match(runner,/createRecurringClockRecorder\(\{deadlineMilliseconds:60000/);
 assert.match(runner,/if\(publishedStage\)runRecurringClockedChild\(\(\)=>execFileSync/);
 assert.match(runner,/if\(dualSource217Stage\)execFileSync\(process\.execPath,\['scripts\/static-weekly-dual-source-current-correction-sql-tests\.mjs'\]/);
 assert.match(runner,/if\(dualSource218Stage\)execFileSync\(process\.execPath,\['scripts\/static-weekly-dual-source-current-correction-sql-tests\.mjs'\]/);
 assert.match(runner,/if\(dualSource219Stage\)execFileSync\(process\.execPath,\['scripts\/static-weekly-dual-source-current-correction-sql-tests\.mjs'\]/);
 assert.match(runner,/STATIC_WEEKLY_TEST_DUAL_SOURCE_218:'1'/);
 assert.match(runner,/STATIC_WEEKLY_TEST_DUAL_SOURCE_219:'1'/);
 assert.match(child,/if\(dual218\)assertCurrentManager218MigrationSet\(\)/);
 assert.match(child,/if\(dual219\)assertCurrentManager219MigrationSet\(\)/);
 assert.match(child,/assert\.equal\(\[dual217,dual218,dual219\]\.filter\(Boolean\)\.length,1/);
});
check('published wrapper actually delegates one exact current-manager child and preserves failures',()=>{
 const {calls,clock}=invokePublishedDelegation(publishedDelegation);
 assert.equal(calls.wrapper,1);assert.equal(calls.child,1);
 assert.equal(calls.clock,clock);
 assert.equal(calls.args,'/exact/node');
 assert.deepEqual(Array.from(calls.argv),['scripts/static-weekly-current-roster-publication-tests.mjs']);
 assert.equal(calls.options.timeout,60000);
 assert.equal(calls.options.stdio,'inherit');
 assert.deepEqual(JSON.parse(JSON.stringify(calls.options.env)),{
  PARENT_MARKER:'retained',SHIFT_END_TEST_CONTAINER:'synthetic-container',
  SHIFT_END_TEST_SOCKET:'/synthetic-socket',STATIC_WEEKLY_TEST_CURRENT_219:'1',
  STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'});
 const original=new Error('exact child failure');
 assert.throws(()=>invokePublishedDelegation(publishedDelegation,{childError:original}),error=>error===original);
});
check('published delegation rejects mention-only and changed child/timeout mutations',()=>{
 const mentionOnly='if(publishedStage)runRecurringClockedChild(()=>undefined,publishedChildClock); // execFileSync token';
 assert.throws(()=>assert.equal(invokePublishedDelegation(mentionOnly).calls.child,1,
  'published child must actually execute'),/published child must actually execute/);
 const wrongChild=publishedDelegation.replace('scripts/static-weekly-current-roster-publication-tests.mjs',
  'scripts/wrong-child.mjs');
 assert.notDeepEqual(Array.from(invokePublishedDelegation(wrongChild).calls.argv),
  ['scripts/static-weekly-current-roster-publication-tests.mjs']);
 const wrongTimeout=publishedDelegation.replace('timeout:60000','timeout:999');
 assert.notEqual(invokePublishedDelegation(wrongTimeout).calls.options.timeout,60000);
});
check('old stage and malformed child selectors refuse changed219 source before Docker',()=>{
 const env={...process.env};
 for(const name of ['STATIC_WEEKLY_TEST_DUAL_SOURCE_217','STATIC_WEEKLY_TEST_DUAL_SOURCE_218',
  'STATIC_WEEKLY_TEST_DUAL_SOURCE_219'])delete env[name];
 const old=spawnSync(process.execPath,[new URL('./run-isolated-shift-end-tests.mjs',import.meta.url).pathname,'dual-source-218'],
  {encoding:'utf8',timeout:5000,env});
 assert.equal(old.error,undefined);assert.notEqual(old.status,0);
 assert.match(old.stderr,/current manager 218 fixture requires all218 migrations/);
 assert.doesNotMatch(old.stdout,/OWNED_CONTAINER|REPLAYED_EXACT_MIGRATIONS/);
 for(const [flags,pattern] of [
  [{},/exactly one pinned dual-source stage required/],
  [{STATIC_WEEKLY_TEST_DUAL_SOURCE_219:'0'},/dual-source stage accepts only explicit 1/],
  [{STATIC_WEEKLY_TEST_DUAL_SOURCE_218:'1',STATIC_WEEKLY_TEST_DUAL_SOURCE_219:'1'},/exactly one pinned dual-source stage required/],
 ]){
  const denied=spawnSync(process.execPath,[new URL('./static-weekly-dual-source-current-correction-sql-tests.mjs',import.meta.url).pathname],
   {encoding:'utf8',timeout:5000,env:{...env,...flags}});
  assert.equal(denied.error,undefined);assert.notEqual(denied.status,0);
  assert.match(denied.stderr,pattern);
  assert.doesNotMatch(denied.stdout,/OWNED_CONTAINER|REPLAYED_EXACT_MIGRATIONS/);
 }
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
check('child executes lost-COMMIT response, concurrent retries and denied roles rather than inspecting ACL only',()=>{
 assert.match(child,/const result=await client\.query\(sql,args\);/);
 assert.match(child,/if\(sql==='commit'&&loseCommit\)/);
 assert.match(child,/loseCommit=true;/);
 assert.match(child,/static_weekly_control_plane_database_unavailable/);
 assert.match(child,/getRecurringConfirmationStatus\(\{manager:second,confirmationKey\}\)/);
 assert.match(child,/Promise\.all\(\[plane\.confirmRecurringStaffing\(request\),plane\.confirmRecurringStaffing\(request\)\]\)/);
 assert.match(child,/concurrent retries append no parents\/sources\/publications\/proofs/);
 assert.match(child,/rpc\(role,'static_weekly_v8_vacate_roster_slot'/);
 assert.match(child,/error\.code==='42501'&&\/permission denied\/i\.test\(error\.message\)/);
});
console.log(JSON.stringify({status:'PASS_DUAL_SOURCE_219_SOURCE_ONLY',checks,digests:[fixture.historical.sourceDigest,
 fixture.correction.sourceDigest],database:'NOT_RUN',solver:'NOT_RUN',production:false}));
