import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateStaticWeeklySchedulingProgram} from '../src/static-weekly-schedule-program.js';

// Captured synthetic source only. Exercise the real candidate generator without
// a solver, database, phone, publication, or mutable production authority.
const original=JSON.parse(readFileSync(process.argv[2],'utf8'));
const originalBytes=JSON.stringify(original);
let checks=0;
for(const shift of [
 {start:'07:00',end:'14:00'}, {start:'07:00',end:'15:00'},
 {start:'07:00',end:'16:00'}, {start:'08:00',end:'15:00'},
]){
 const input=structuredClone(original);
 const capacity=input.exceptions.find(row=>row.type==='cover_all');
 assert.ok(capacity?.payload?.availability);checks++;
 capacity.payload.availability.shift=shift;
 const contractor=capacity.payload.availability.slotId;
 const program=generateStaticWeeklySchedulingProgram(input);
 assert.equal(program.error,undefined,JSON.stringify(program.error));checks++;
 const candidates=program.problem.candidates.filter(row=>row.slot.id===contractor);
 assert.ok(candidates.length,'manual capacity still has eligible work');checks++;
 for(const row of candidates){
  assert.ok(row.item.window.start>=shift.start&&row.item.window.end<=shift.end,
   JSON.stringify({shift,window:row.item.window,work:row.item.workId}));checks++;
 }
 const outside=program.problem.work.filter(work=>work.window.start<shift.start||work.window.end>shift.end);
 if(shift.start==='07:00'&&shift.end==='16:00'){
  assert.equal(outside.length,0,'full synthetic coverage window has no out-of-shift work');checks++;
  assert.ok(candidates.some(row=>row.item.window.start==='15:00'&&row.item.window.end==='16:00'),
   'positive boundary: contractor remaining until16:00 may cover closing');checks++;
 }else{
  assert.ok(outside.length,'fixture contains work beyond the shorter contractor shift');checks++;
 }
 for(const work of outside){
  assert.equal(candidates.some(row=>row.item.key===work.key),false,'out-of-shift responsibility has no contractor candidate');checks++;
 }
}
assert.equal(JSON.stringify(original),originalBytes,'original synthetic source remains byte-equivalent');checks++;
console.log(JSON.stringify({status:'PASS',checks,scope:'actual candidate generator; synthetic shift variants; no solver, database, phone or independent review'}));
