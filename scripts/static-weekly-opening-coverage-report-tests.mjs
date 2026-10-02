import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {createOpeningCoverageReport,assertOpeningCoverageReport,assertOpeningCoverageCanonicalReport,
 sanitizeOpeningCoverageDiagnostic,OPENING_COVERAGE_ERROR} from '../src/static-weekly-opening-coverage-report.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fixtureUrl=new URL('./fixtures/opening-coverage-actual-results.json',import.meta.url);
const baseUrl=new URL('./fixtures/six-person-absence-source.json',import.meta.url);
// Mechanical, explicit NEW fixture extraction from already-executed LOCAL
// synthetic results. No solver, production data, invented result or overwrite.
if(process.argv[1]===new URL(import.meta.url).pathname&&(process.argv[2]==='--extract-fixture'||process.argv[2]==='--refresh-fixture')){
 const dir=process.argv[3];assert.ok(dir);
 const refresh=process.argv[2]==='--refresh-fixture';
 if(refresh)assert.equal(sha(fs.readFileSync(fixtureUrl)),process.argv[4],'exact prior generated fixture required');
 else assert.equal(fs.existsSync(fixtureUrl),false);
 const baseBytes=fs.readFileSync(baseUrl),base=JSON.parse(baseBytes).compilerInput;
 const fields=['planWorkId','workId','dayOfWeek','serviceDate','locationId','window','status','slotId','personId',
  'ownerKind','capacityId','displayName','slotLabel','workSnapshot'];
 const cases={};for(const name of ['baseline','one','two','manual_capacity']){
  const inputBytes=fs.readFileSync(`${dir}/${name}-input.json`),resultBytes=fs.readFileSync(`${dir}/${name}-result.json`);
  const originalInput=JSON.parse(inputBytes),result=JSON.parse(resultBytes),source=structuredClone(result.canonicalAuthority.compilerInput);
  // compilerInput is immutable baseline authority; actual final overlays live
  // in the original compile request. Never silently drop those exceptions or
  // re-feed overlayCompilerInput (which already contains derived shift-end).
  source.exceptions=structuredClone(originalInput.exceptions);
  for(const key of ['serviceDate','proximity'])assert.deepEqual(source[key],base[key]);
  const originalVersion=source.version,{id,publicationId,...rest}=originalVersion;
  const {id:baseId,publicationId:basePublication,...baseRest}=base.version;assert.deepEqual(rest,baseRest);
  const rows=result.weeklyAssignments.map(row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])));
  let lunchBytes=null,lunch={loans:[],responsibilities:[],notification_intents:[]};
  if(name!=='two'){lunchBytes=fs.readFileSync(`${dir}/${name}-lunch-preview.json`);const full=JSON.parse(lunchBytes);
   lunch=Object.fromEntries(['loans','responsibilities','notification_intents'].map(k=>[k,full[k]]));}
  cases[name]={provenance:{classification:'ALREADY_EXECUTED_LOCAL_SYNTHETIC_RESULT_NOT_PRODUCTION_NOT_NEW_SOLVE',
   retainedDirectory:dir.split('/').at(-1),originalInputSha256:sha(inputBytes),originalResultSha256:sha(resultBytes),
   originalLunchSha256:lunchBytes?sha(lunchBytes):null,originalInputJsonbDigest:digest(originalInput),
   originalAssignmentDigest:digest(result.weeklyAssignments),selectedAssignmentFields:fields,
   omission:'unconsumed result/certificate/explanation fields; selected values lossless; REVIEW has no admitted lunch document'},
   sourcePatch:{versionIdentity:{id,publicationId},slots:source.slots,exceptions:source.exceptions},sourceDigest:digest(source),
   result:{status:result.status,publicationAuthority:result.publicationAuthority,verifierOk:result.verifier.ok,
    compilerVersion:result.compilerVersion,timezone:result.timezone,metrics:result.metrics,
    assignments:rows,open:result.openWork.map(r=>r.planWorkId),review:result.reviewWork.map(r=>r.planWorkId),lunch},
   selectionDigest:digest({rows,lunch})};
 }
 const fixture={schema:'custodial.opening-coverage-executed-result-selection.v1',baseFixtureSha256:sha(baseBytes),cases};
 // Generator output is a mechanical data extraction, never hand-edited proof.
 fs.writeFileSync(fixtureUrl,JSON.stringify(fixture)+'\n',{flag:refresh?'w':'wx'});
 console.log(JSON.stringify({fixtureSha256:sha(fs.readFileSync(fixtureUrl)),bytes:fs.statSync(fixtureUrl).size}));process.exit(0);
}
export function loadOpeningCoverageFixture(){
 const baseBytes=fs.readFileSync(baseUrl),fixture=JSON.parse(fs.readFileSync(fixtureUrl));
 assert.equal(fixture.schema,'custodial.opening-coverage-executed-result-selection.v1');
 assert.equal(sha(baseBytes),fixture.baseFixtureSha256);
 const base=JSON.parse(baseBytes).compilerInput;
 return Object.fromEntries(Object.entries(fixture.cases).map(([name,c])=>{
  const source=structuredClone(base);Object.assign(source.version,c.sourcePatch.versionIdentity);
  source.slots=structuredClone(c.sourcePatch.slots);source.exceptions=structuredClone(c.sourcePatch.exceptions);
  assert.equal(digest(source),c.sourceDigest);assert.equal(digest({rows:c.result.assignments,lunch:c.result.lunch}),c.selectionDigest);
  return [name,{...c,source}];
 }));
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 installStaticWeeklySha256HexAccelerator(x=>sha(x));
 let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;},start=performance.now();
 const cases=loadOpeningCoverageFixture();
 for(const [name,c]of Object.entries(cases)){
  const before=digest(c),report=createOpeningCoverageReport({source:c.source,assignments:c.result.assignments,lunch:c.result.lunch});
  check(digest(c),before);check(report.sourceDigest,c.sourceDigest);check(report.assignmentDigest,digest(c.result.assignments));
  check(report.horizon,{first:'2026-10-05',last:'2026-10-11'});check(report.serviceDates.length,7);
  check(report.performedReadinessProven,false);check(report.tasksCreated,false);check(report.physicalDurationFacts,'NOT_ESTABLISHED_NONBLOCKING');
  check(report.rows.every(r=>r.pre09Intersection.end<='09:00'&&r.physicalDurationMinutes===null),true);
  check(report.owners.every(o=>Number.isFinite(o.availablePre09ClockMinutes)&&o.availablePre09ClockMinutes>=0),true);
  check(report.rows.every(r=>r.componentLoadComplete||r.unweightedLocationIds.length>0),true);
  check(report.componentWeightUnit,'dimensionless_owner_component_weight');
  check(report.inheritedWorkloadUnit,'dimensionless_production_workload_points');
  const response=report.rows.filter(r=>r.serviceMode==='response_only_no_clean');
  check(response.length>0,true);check(response.every(r=>r.physicalMembers.length===0&&r.responseOnlyWeight===0.5),true);
  check(report.owners.filter(o=>o.ownerKind==='EMPLOYEE').every(o=>o.personId&&o.capacityId===null),true);
  if(name==='two'){check(c.result.status,'REVIEW');check(c.result.review.length,11);check(report.gaps.some(g=>g.status==='REVIEW'),true);}
  if(name==='manual_capacity'){check(c.result.assignments.filter(r=>r.ownerKind==='CONTRACTOR_CAPACITY').length,14);
   check(report.rows.filter(r=>r.ownerKind==='CONTRACTOR_CAPACITY').length,13);
   check(report.owners.filter(r=>r.ownerKind==='CONTRACTOR_CAPACITY').length,1);
   check(report.rows.filter(r=>r.ownerKind==='CONTRACTOR_CAPACITY').every(r=>r.personId===null&&r.capacityId),true);}
  assertOpeningCoverageReport(report);checks++;
 }
 const c=cases.baseline,make=()=>createOpeningCoverageReport({source:c.source,assignments:c.result.assignments,lunch:c.result.lunch});
 const report=make(),candidate={publicationId:null,authorityRevision:null,decisionDigest:null,
  openingCoverageReport:report,decision:{assignments:c.result.assignments,fixedLunch:{...c.result.lunch,notificationIntents:c.result.lunch.notification_intents}}};
 assertOpeningCoverageCanonicalReport(candidate,c.source);checks++;
 for(const mutate of [x=>x.rows[0].knownComponentWeight++,x=>x.owners[0].availablePre09ClockMinutes++,
  x=>x.ledgerDigest='a'.repeat(64),x=>x.rows[0].physicalDurationMinutes=1,x=>x.rows.pop(),x=>x.lunchDigest='b'.repeat(64)]){
  const forged=structuredClone(report);mutate(forged);const {reportDigest,...body}=forged;forged.reportDigest=digest(body);
  assert.throws(()=>assertOpeningCoverageCanonicalReport({...candidate,openingCoverageReport:forged},c.source),e=>e.code===OPENING_COVERAGE_ERROR);checks++;
 }
 for(const mutate of [r=>r.componentWeightUnit='minutes',r=>r.inheritedWorkloadUnit='dimensionless_owner_component_weight',
  r=>r.published=true,r=>r.sourceMutated=true]){const forged=structuredClone(report);mutate(forged);const {reportDigest,...body}=forged;
  forged.reportDigest=digest(body);assert.throws(()=>assertOpeningCoverageReport(forged),e=>e.code===OPENING_COVERAGE_ERROR);checks++;}
 for(const mutate of [a=>a.pop(),a=>a.push(a[0]),a=>a[0].personId='00000000-0000-4000-8000-000000000000',
  a=>a[0].workSnapshot.includedLocations=[],a=>a[0].window.start='06:59']){
  const rows=structuredClone(c.result.assignments);mutate(rows);
  assert.throws(()=>createOpeningCoverageReport({source:c.source,assignments:rows,lunch:c.result.lunch}),e=>{
   assert.ok(e.openingCoverageDiagnostic.nonAdmissible);return e.code===OPENING_COVERAGE_ERROR;});checks++;
 }
 const diagnostic=sanitizeOpeningCoverageDiagnostic({schema:'static-weekly.opening-coverage-diagnostic.v1',nonAdmissible:true,
  secret:'PRIVATE',sourceDigest:'a'.repeat(64),findings:Array.from({length:50},()=>({code:'owner_not_eligible',reason:'PRIVATE',slotId:'not-uuid'}))});
 check(diagnostic.findings.length,24);check(JSON.stringify(diagnostic).includes('PRIVATE'),false);check(diagnostic.findings[0].slotId,null);
 check(sanitizeOpeningCoverageDiagnostic({...diagnostic,findings:[{code:'secret_reason'}]}),null);
 console.log(JSON.stringify({status:'PASS',checks,elapsedMs:Math.round(performance.now()-start),
  fixtureSha256:sha(fs.readFileSync(fixtureUrl)),scope:'derived report/helper/private canonical binding; retained executed result selections; no solve/DB/publication/physical proof'}));
}
