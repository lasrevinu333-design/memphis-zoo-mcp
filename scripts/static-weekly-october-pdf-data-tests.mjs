#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compareScheduleDisplayItems} from '../src/schedule-display-order.js';
const [dataPath,pdfDir]=process.argv.slice(2);assert.ok(dataPath&&pdfDir);
const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
const qa=JSON.parse(fs.readFileSync(path.join(pdfDir,'pdf-qa-layout.json'),'utf8'));
assert.equal(qa.revision,data.revision);
const normalize=s=>s.replace(/\s+/g,' ').trim();let duties=0,lunchSegments=0,pages=0;
for(const report of qa.reports){
 // Text is extracted by the supported shell pdftotext invocation before this check.
 const text=fs.readFileSync(path.join(pdfDir,report.file.replace(/\.pdf$/,'.txt')),'utf8');
 const rendered=text.split('\f').filter(p=>p.trim());assert.equal(rendered.length,report.pages);pages+=report.pages;
 const grouped=new Map();
 for(const fact of report.pageFacts){
  assert.ok(fact.minY>=56,'layout clips footer/content');
  const page=normalize(rendered[fact.page-1]);assert.ok(page.includes(data.revision),'every page carries same revision');
  assert.ok(page.includes(`${fact.person} | ${fact.date}`));
  const key=`${fact.person}|${fact.date}`;grouped.set(key,`${grouped.get(key)||''} ${page}`);
 }
 for(const [key,printed] of grouped){
  const [name,date]=key.split('|'),day=data.days.find(d=>d.serviceDate===date),person=data.rosterSlots.find(s=>s.displayName===name);
  const av=day.availability.find(a=>a.slotId===person.slotId&&a.status==='working');
  if(!av){assert.ok(printed.includes('OFF - no scheduled duties or lunch coverage.'));continue;}
  assert.ok(printed.includes(`Shift ${av.shift.start}-${av.shift.end} | Lunch ${av.lunch.start}-${av.lunch.end}`));
  for(const row of day.assignments.filter(r=>r.slotId===person.slotId)){
   assert.ok(printed.includes(normalize(`${row.window.start}-${row.window.end} | ${row.workSnapshot.locationNameSnapshot}`)),`${name}/${date} exact duty absent`);duties++;
  }
  let previous=-1;
  for(const row of day.assignments.filter(r=>r.slotId===person.slotId).sort(compareScheduleDisplayItems)){
   const at=printed.indexOf(normalize(`${row.window.start}-${row.window.end} | ${row.workSnapshot.locationNameSnapshot}`));
   assert.ok(at>=previous,`${name}/${date} restroom/name display order differs`);previous=at;
  }
  assert.ok(!printed.includes('Initial clean'),'morning label cannot require a cleaning service');
  for(const loan of day.lunchLoans)for(const r of loan.responsibilities.filter(r=>r.covererSlotId===person.slotId)){
   const owner=data.rosterSlots.find(s=>s.slotId===loan.normalOwnerSlotId).displayName;
   const windows=new Map();
   for(const seg of r.segments){const w=`${seg.window.start}-${seg.window.end}`,places=windows.get(w)||new Set();places.add(day.assignments.find(a=>a.planWorkId===seg.planWorkId).workSnapshot.locationNameSnapshot);windows.set(w,places);lunchSegments++;}
   for(const [window,places] of windows)assert.ok(printed.includes(normalize(`${window} | Cover ${owner}: ${[...places].join('; ')}`)),`${name}/${date} exact lunch segment absent`);
   if(name==='Gregory Staples')assert.ok(printed.includes('On-call; respond to issues only.'));
  }
  if(day.assignments.some(r=>r.status==='OPEN'))assert.ok(printed.includes('Herpetarium 15:00-16:00 is OPEN'));
 }
}
console.log(JSON.stringify({ok:true,revision:data.revision,pages,assignedDutyRowsMatched:duties,lunchSegmentsMatched:lunchSegments,pdfDataIdentity:'EXACT_LOCAL_CANDIDATE',delivered:false}));
