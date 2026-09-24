import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {createStaticWeeklyDraftRpcInput} from '../src/static-weekly-schedule-database-adapter.js';
const container=process.env.SHIFT_END_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input:'set statement_timeout=120000;'+text,encoding:'utf8',timeout:125000,maxBuffer:16*1024*1024}).trim();
const artifact=JSON.parse(readFileSync(process.env.STATIC_WEEKLY_CONTINUITY_RESULT,'utf8'));
assert.equal(artifact.classification,'SYNTHETIC_LOCAL_NOT_ADMITTED');
const result=artifact.result,a=result.canonicalAuthority;
const draft=createStaticWeeklyDraftRpcInput({result,expectedRevision:0,actor:{managerId:'10000000-0000-4000-8000-000000000001',managerName:'SYNTHETIC ONLY',idempotencyKey:'synthetic-shift-end'}});
sql(`create schema custodial_shift_end_test;create table custodial_shift_end_test.evidence(authority jsonb,receipt jsonb,document jsonb);
 insert into custodial_shift_end_test.evidence values(${j(a)},${j(draft.document.receipt)},${j(draft.document)});`);
let checks=0;const pass=name=>{checks++;console.log('PASS',name);};
sql(`select public.static_weekly_v9_assert_shift_end_derivation(authority) from custodial_shift_end_test.evidence;`);pass('real corrected canonical derivation admitted by PostgreSQL');
sql(`select public.static_weekly_assert_compiler_authority(authority,receipt,${q(result.serviceDate)}::date,true) from custodial_shift_end_test.evidence;`);pass('complete v9 solver authority admitted');
// Use the same compact-to-legacy identity reconstruction as the production
// attested wrapper. Removing the snapshot without rebinding is invalid.
sql(`select public.static_weekly_assert_document(jsonb_set(document-'semantic_snapshot','{validation,database_document_identity}',
 to_jsonb(public.static_weekly_document_identity(document-'semantic_snapshot'))),${q(result.serviceDate)}::date,true)
 from custodial_shift_end_test.evidence;`);pass('full derived relational document admitted');
sql(`set role static_weekly_release_operator;select public.static_weekly_v3_configure_initial_authority_key(
 'static-weekly-authority-hmac-v2','SYNTHETIC-ONLY-NOT-A-PRODUCTION-CREDENTIAL-20260924','synthetic shift-end test');`);
sql(`select public.static_weekly_assert_document_attested(jsonb_set(document,'{attestation}',
 public.static_weekly_v6_issue_document_attestation(document)),${q(result.serviceDate)}::date,true)
 from custodial_shift_end_test.evidence;`);pass('actual signed compact v3 document wrapper admitted');
const thin={compilerInput:a.compilerInput,overlayCompilerInput:a.overlayCompilerInput,shiftEndDerivation:a.shiftEndDerivation,
 derivedBaselineDigest:a.derivedBaselineDigest,optimizerResult:{assignments:a.optimizerResult.assignments}};
function rebind(x){
 const r=x.shiftEndDerivation;
 const effective=structuredClone(x.overlayCompilerInput);effective.exceptions=[];
 x.derivedBaselineDigest=r.derivedBaselineDigest=digest(effective);
 r.outputWorkDigest=digest(effective.version.assignments);r.templateDigest=digest(x.compilerInput);
 return x;
}
function reject(name,mutate){
 const bad=structuredClone(thin);mutate(bad);rebind(bad);
 assert.throws(()=>sql(`select public.static_weekly_v9_assert_shift_end_derivation(${j(bad)});`),/ERROR/,name);pass(name);
}
const chain=x=>x.shiftEndDerivation.parentChains.find(c=>c.segments.length>1);
const row=(x,s,c)=>x.overlayCompilerInput.version.assignments.find(w=>w.workId===s.workId&&w.dayOfWeek===c.dayOfWeek);
reject('missing parent chain rejected',x=>x.shiftEndDerivation.parentChains.pop());
reject('duplicate parent chain rejected',x=>{x.shiftEndDerivation.parentChains[1]=structuredClone(x.shiftEndDerivation.parentChains[0]);});
reject('missing derived row rejected after digest rebind',x=>x.overlayCompilerInput.version.assignments.pop());
reject('changed paired physical identity rejected',x=>{const c=chain(x),s=c.segments[1];row(x,s,c).includedLocations[0].locationId='10000000-0000-4000-8000-000000000099';});
reject('workload drift rejected after digest rebind',x=>{const c=chain(x),s=c.segments[1];s.serviceEffortMinutes++;row(x,s,c).serviceEffortMinutes++;});
reject('window gap rejected after digest rebind',x=>{const c=chain(x),s=c.segments[1];s.window.start='15:01';row(x,s,c).window.start='15:01';});
reject('closing boundary forged',x=>{x.shiftEndDerivation.staffedDepartureByDay[4]='17:00';});
reject('dated roster digest forged',x=>{x.shiftEndDerivation.datedRosterDigest='0'.repeat(64);});
reject('unknown policy field rejected',x=>{x.compilerInput.version.shiftEndContinuityPolicy.invented=true;});
reject('derived input cannot replace template',x=>{x.compilerInput.version.shiftEndDerivationApplied=x.shiftEndDerivation.policyDigest;});
reject('OPEN execution identity rejected',x=>{const r=x.optimizerResult.assignments.find(w=>w.status==='OPEN');assert.ok(r);r.personId='10000000-0000-4000-8000-000000000099';});
reject('unknown continuity assertion rejected',x=>{x.shiftEndDerivation.continuity.unproven=true;});
for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
 assert.throws(()=>sql(`set role ${role};select public.static_weekly_v9_assert_shift_end_derivation('{}'::jsonb);`),/permission denied/);pass('private derivation validator denied '+role);
}
const id='public.static_weekly_v9_assert_shift_end_derivation(jsonb)';
const original=sql(`select pg_get_functiondef(${q(id)}::regprocedure);`);
sql(`create or replace function public.static_weekly_v9_assert_shift_end_derivation(p_authority jsonb) returns void language plpgsql immutable as $x$begin return;end$x$;
 grant execute on function public.static_weekly_v9_assert_shift_end_derivation(jsonb) to anon;`);
for(const kind of ['function','grant'])sql(`do $r$declare d text;begin select definition_sql into strict d from public.custodial_release_authority_restore_inventory
 where object_kind=${q(kind)} and to_regprocedure(object_identity)=${q(id)}::regprocedure;execute d;end$r$;`);
assert.equal(sql(`select pg_get_functiondef(${q(id)}::regprocedure);`),original);pass('exact private validator definition recovered');
assert.throws(()=>sql(`set role anon;select public.static_weekly_v9_assert_shift_end_derivation('{}'::jsonb);`),/permission denied/);pass('private validator grants recovered');
sql(`select public.static_weekly_v9_assert_shift_end_derivation(authority) from custodial_shift_end_test.evidence;`);pass('admission succeeds after exact recovery');
console.log(JSON.stringify({status:'PASS',checks,migrations:143,production:false,independentAudit:false,physicalAcceptance:false}));
