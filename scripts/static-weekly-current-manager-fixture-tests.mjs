import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,symlinkSync,unlinkSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet,
 loadCurrentManagerPublicationFixture,CURRENT_MANAGER_MIGRATION_MANIFEST,CURRENT_MANAGER_217_MIGRATION_MANIFEST,
 CURRENT_MANAGER_217_MIGRATION,CURRENT_MANAGER_218_MIGRATION_MANIFEST,CURRENT_MANAGER_218_MIGRATION} from './fixtures/current-manager-publication-source.mjs';
import {validateSixPersonAbsenceFixtureBytes} from './fixtures/six-person-absence-source.mjs';
import {validateFullNineV6FixtureBytes} from './fixtures/full-nine-v6-source.mjs';
import {deriveDatedShiftEndCoverage} from '../src/static-weekly-shift-end-derivation.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {normalizeStaticWeeklyAuthority} from '../src/static-weekly-schedule-program.js';
import {assertStoredNamedSourceBoundary} from './static-weekly-named-handoff-contract-tests.mjs';

let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const f=loadCurrentManagerPublicationFixture(),p=f.packet;
check('exact218 manifest extends pinned old217 and 216, separately from old176',()=>{
 const files=assertCurrentManager218MigrationSet();assert.equal(files.length,218);
 assert.deepEqual(files.at(-1),CURRENT_MANAGER_218_MIGRATION);
 assert.deepEqual(files.at(-2),CURRENT_MANAGER_217_MIGRATION);
 assert.equal(createHash('sha256').update(JSON.stringify(files.slice(0,216))).digest('hex'),CURRENT_MANAGER_MIGRATION_MANIFEST);
 assert.equal(createHash('sha256').update(JSON.stringify(files.slice(0,217))).digest('hex'),CURRENT_MANAGER_217_MIGRATION_MANIFEST);
 assert.equal(createHash('sha256').update(JSON.stringify(files)).digest('hex'),CURRENT_MANAGER_218_MIGRATION_MANIFEST);
});
check('historical216 and 217 identities explicitly refuse the changed218 manifest',()=>{
 assert.throws(()=>assertCurrentManagerMigrationSet(),/all216 migrations/);
 assert.throws(()=>assertCurrentManager217MigrationSet(),/all217 migrations/);
});
check('218 rejects a changed predecessor and an unapproved extra migration, not count-only acceptance',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mz-manager218-manifest-')),
  migrations=join(directory,'supabase','migrations'),source=new URL('../supabase/migrations/',import.meta.url);
 try{
  mkdirSync(migrations,{recursive:true});
  for(const file of readdirSync(source).filter(name=>name.endsWith('.sql')))
   symlinkSync(fileURLToPath(new URL(file,source)),join(migrations,file));
  const root=pathToFileURL(directory+'/'),prior=join(migrations,CURRENT_MANAGER_217_MIGRATION.file);
  unlinkSync(prior);
  writeFileSync(prior,readFileSync(new URL(CURRENT_MANAGER_217_MIGRATION.file,source))+'\n-- hostile predecessor delta\n');
  assert.throws(()=>assertCurrentManager218MigrationSet(root),/217 ordered predecessor migration bytes changed/);
  unlinkSync(prior);symlinkSync(fileURLToPath(new URL(CURRENT_MANAGER_217_MIGRATION.file,source)),prior);
  const latest=join(migrations,CURRENT_MANAGER_218_MIGRATION.file);
  unlinkSync(latest);
  writeFileSync(latest,readFileSync(new URL(CURRENT_MANAGER_218_MIGRATION.file,source))+'\n-- hostile latest delta\n');
  assert.throws(()=>assertCurrentManager218MigrationSet(root),/exact native event decision forward migration required/);
  unlinkSync(latest);symlinkSync(fileURLToPath(new URL(CURRENT_MANAGER_218_MIGRATION.file,source)),latest);
  const extra=join(migrations,'20261004000001_unapproved_extra.sql');
  writeFileSync(extra,'select 1;\n');
  assert.throws(()=>assertCurrentManager218MigrationSet(root),/all218 migrations/);
 }finally{rmSync(directory,{recursive:true});}
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
 assert.ok(runner.includes("STATIC_WEEKLY_TEST_CURRENT_218:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'"));
 assert.ok(runner.includes("if(currentManager218Stage){assertCurrentManager218MigrationSet();loadCurrentManagerPublicationFixture();}"));
 assert.ok(publication.includes('currentManager218Http?testRecurringConfirmationHttp:testRecurringConfirmation)({pool,week,originalManagerId:managerId,check})'));
 assert.ok(publication.includes('if(currentManager218Stage)assertCurrentManager218MigrationSet();'));
 assert.ok(publication.includes('if(currentManager217Stage||currentManager218Stage)await testNamedHandoffSql({pool,authority:projection.authority,check,'));
 assert.ok(publication.includes('versionId:published.data.version_id,publicationId:published.data.publication_id'));
});
check('HTTP SQL confirmation is one explicit 218-only alternative writer, default direct path unchanged',()=>{
 assert.ok(runner.includes("const currentManager218Http=process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_HTTP==='1'"));
 assert.ok(runner.includes('!currentManager218Http||currentManager218Stage'));
 assert.ok(runner.includes("...(currentManager218Stage?{STATIC_WEEKLY_TEST_CURRENT_218:'1',STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION:'1'}:{})"));
 assert.ok(publication.includes('!currentManager218Http||currentManager218Stage'));
 assert.ok(publication.includes('currentManager218Http?testRecurringConfirmationHttp:testRecurringConfirmation'));
 assert.equal(publication.match(/recurringConfirmationProof=await/g)?.length,1);
});
const httpHelper=readFileSync(new URL('./static-weekly-recurring-confirmation-http-integration.mjs',import.meta.url),'utf8');
const {testRecurringConfirmationHttp}=await import('./static-weekly-recurring-confirmation-http-integration.mjs');
check('HTTP SQL variant retains real route, auth, exact lost response and saved status checks',()=>{
 assert.equal(typeof testRecurringConfirmationHttp,'function');
 for(const phrase of ['createStaticWeeklyControlPlane({database','createStaticWeeklyControlPlaneRuntime({env,database,controlPlane:plane,supabase,trustedDeviceStore})',
  'createOpsManagerSession','server.listen(0','lost COMMIT HTTP response is unavailable','HTTP exact-key SQL recovery',
  'HTTP concurrent retries append nothing','different manager sees no private operation','revoked current credential cannot read status',
  'HTTP durable target manifest covers seven dates','no phone is claimed updated'])assert.ok(httpHelper.includes(phrase),phrase);
 assert.ok(!httpHelper.includes('affectedPhonesUpdated:true'));
});
for(const [label,stage,value,pattern] of [
 ['HTTP selector refuses historical217','current-manager-217','1',/belongs only to exact current-manager-218/],
 ['HTTP selector refuses implicit false','current-manager-218','0',/accepts only explicit 1/]
])check(label+' before Docker or SQL',()=>{
 const denied=spawnSync(process.execPath,[new URL('./run-isolated-shift-end-tests.mjs',import.meta.url).pathname,stage],
  {encoding:'utf8',timeout:5000,env:{...process.env,STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_HTTP:value}});
 assert.equal(denied.error,undefined);assert.notEqual(denied.status,0);
 assert.match(denied.stderr,pattern);assert.doesNotMatch(denied.stdout,/OWNED_CONTAINER|REPLAYED_EXACT_MIGRATIONS/);
});
check('old176 contract, exact image, isolation/default grants and cleanup remain',()=>{
 for(const text of ["currentManager217Stage||dualSource217Stage?217:currentManager216Stage?216:176","20260929125440_custodial_recovery_inventory_closure.sql",
  "supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed",
  "'--network','none'",'absenceGuard','finally{cleanup();}'])assert.ok(runner.includes(text),text);
});
check('current stage registers original only as immutable source and preserves source digest',()=>{
 assert.ok(publication.includes("check('registered original314 exact digest without historical person import'"));
 assert.ok(publication.includes("check('full source remains unchanged in database'"));
});
console.log(JSON.stringify({status:'PASS',checks,scope:'current-manager fixture and executable-route preflight only',
 migrationCount:218,originalRows:314,currentRows:323,derivedRows:494,solver:false,database:false,publication:false,production:false}));
