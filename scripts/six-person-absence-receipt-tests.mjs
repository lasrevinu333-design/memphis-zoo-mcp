import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const folder=process.env.STATIC_WEEKLY_ABSENCE_PROOF_OUTPUT;
assert.ok(folder,'exact fresh owning receipt directory required');
const read=name=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
const summary=read('summary.json');
const names=['baseline','one','two','array_permutation','admission_order_permutation','manual_capacity'];
assert.equal(summary.status,'PASS');
assert.deepEqual(summary.cases.map(c=>c.name),names,'no missing, skipped or duplicate runtime case');
const config=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
const people=new Set(Object.values(config.slots).filter(s=>s.personId).map(s=>s.personId));
const baseline=read('baseline-result.json');
const baselineRows=new Map(baseline.weeklyAssignments.map(a=>[a.planWorkId,a]));
const expectedReviewPlaces=['Cat Country','Cathouse Cafe Restrooms','China','Courtyard Restrooms','East End Restrooms',
 'Nocturnal','North West Passage','Primate Canyon','Primate Pavillion','Teton','Zambezi'].sort();
let checks=0;const receipts=[];
for(const name of names){
 const result=read(`${name}-result.json`),input=read(`${name}-input.json`),verifier=read(`${name}-independent-verifier.json`);
 assert.equal(verifier.ok,true);assert.equal(result.verifier.ok,true);checks++;
 const changedDates=new Set(input.exceptions.map(e=>e.serviceDate));
 for(const row of result.weeklyAssignments.filter(a=>!changedDates.has(a.serviceDate)))
  assert.deepEqual(row,baselineRows.get(row.planWorkId),'entire unaffected-day row stays static, not only owner identity');
 checks++;
 assert.ok(result.weeklyAssignments.every(a=>!a.personId||people.has(a.personId)));checks++;
 const review=['two','array_permutation','admission_order_permutation'].includes(name);
 assert.equal(result.status,review?'REVIEW':'FEASIBLE');
 assert.equal(result.publicationAuthority,review?'REVIEW':'ACCEPTABLE');checks++;
 assert.equal(result.openWork.length,1);
 assert.equal(result.openWork[0].serviceDate,'2026-10-09');
 assert.equal(result.openWork[0].workSnapshot.locationCodeSnapshot,'HERPETARIUM');
 assert.equal(result.openWork[0].window.start,'15:00');assert.equal(result.openWork[0].window.end,'16:00');checks++;
 assert.equal(result.reviewWork.length,review?11:0);checks++;
 if(review){
  assert.deepEqual(result.reviewWork.map(a=>a.workSnapshot.locationNameSnapshot).sort(),expectedReviewPlaces);
  assert.ok(result.reviewWork.every(a=>a.status==='REVIEW'&&a.slotId===null&&a.personId===null
   &&a.serviceDate==='2026-10-05'&&a.window.start==='05:00'&&a.window.end==='09:45'));
  checks++;
 }
 const capacityRows=result.weeklyAssignments.filter(a=>a.capacityId);
 assert.equal(capacityRows.length>0,name==='manual_capacity');
 assert.ok(capacityRows.every(a=>a.ownerKind==='CONTRACTOR_CAPACITY'&&a.personId===null&&a.displayName===null
  &&a.serviceDate==='2026-10-05'&&a.capacityId==='62000000-0000-4000-8000-000000000001'));checks++;
 receipts.push({name,unchangedDatesVerified:[...new Set(result.weeklyAssignments.filter(a=>!changedDates.has(a.serviceDate)).map(a=>a.serviceDate))],
  status:result.status,openRows:result.openWork.length,reviewRows:result.reviewWork.length,capacityAssignedRows:capacityRows.length});
}
assert.equal(read('cleanup.json').state,'closed');assert.equal(read('cleanup.json').available,false);checks++;
const receipt={status:'PASS',checks,cases:receipts,
 scope:'Post-readback of already produced actual runtime/verifier receipts; no new compiler solve, SQL, publication or physical acceptance'};
fs.writeFileSync(path.join(folder,'static-and-negative-readback.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));
