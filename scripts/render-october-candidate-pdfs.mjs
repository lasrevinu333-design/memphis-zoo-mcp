#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {selectOctoberCandidateDay} from '../src/static-weekly-october-transition-candidate.js';
const [dataPath,out]=process.argv.slice(2);assert.ok(dataPath&&out,'usage: render-october-candidate-pdfs.mjs <phone-pdf-data.json> <new output directory>');
assert.equal(fs.existsSync(out),false,'refuse to replace candidate PDFs');
const document=JSON.parse(fs.readFileSync(dataPath,'utf8'));fs.mkdirSync(out,{recursive:true});
const reports=[];
for(const [phase,name] of [['dated_transition','October_1-4_Transition_DRAFT.pdf'],['recurring','October_5_Recurring_First_Week_DRAFT.pdf']]){
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 pdf.setTitle(name.replaceAll('_',' '));pdf.setSubject(`UNPUBLISHED candidate revision ${document.revision}`);
 const pageFacts=[];let page,y,current;
 const footer=()=>{
  page.drawText(`Candidate revision: ${document.revision}`,{x:38,y:27,size:7,font,color:rgb(.25,.3,.35)});
  page.drawText(`${pdf.getPageCount()}`,{x:560,y:27,size:8,font});
 };
 const newPage=(person,date,continuation=false)=>{
  page=pdf.addPage([612,792]);y=752;footer();
  page.drawRectangle({x:0,y:778,width:612,height:14,color:rgb(.08,.3,.25)});
  page.drawText('MEMPHIS ZOO | CUSTODIAL SCHEDULE',{x:38,y,size:13,font:bold,color:rgb(.08,.3,.25)});y-=25;
  page.drawText(`${person} | ${date}${continuation?' (continued)':''}`,{x:38,y,size:17,font:bold});y-=22;
  page.drawText('DRAFT - UNPUBLISHED - OWNER REVIEW REQUIRED',{x:38,y,size:9,font:bold,color:rgb(.65,.2,.12)});y-=20;
  pageFacts.push({page:pdf.getPageCount(),person,date,revision:document.revision,lines:0,minY:99});
 };
 const wrap=(value,size,fontUsed)=>{
  const words=String(value).split(/\s+/),lines=[];let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(fontUsed.widthOfTextAtSize(next,size)>536){if(line)lines.push(line);line=word;}else line=next;}
  if(line)lines.push(line);return lines;
 };
 const text=(value,{heading=false,color=rgb(.12,.16,.19)}={})=>{
  const size=heading?10:9.5,fontUsed=heading?bold:font;
  const lines=wrap(value,size,fontUsed);
  if(y-lines.length*13<56)newPage(current.person,current.date,true);
  for(const line of lines){assert.ok(fontUsed.widthOfTextAtSize(line,size)<=536,'text exceeds usable width');page.drawText(line,{x:38,y,size,font:fontUsed,color});y-=13;pageFacts.at(-1).lines++;pageFacts.at(-1).minY=y;}
  y-=heading?4:2;
 };
 const dutyLabel=row=>{
  const mode=row.workSnapshot.serviceMode;
  const action=mode==='reminder_only'?'One-time weekly reminder; no verified NFC tag':mode==='response_only_no_clean'?'Respond to issues only':row.window.start<'09:45'?'Initial clean':row.workId.includes(':handoff:')?'Take over checks':'Checks / issues';
  return `${row.window.start}-${row.window.end} | ${row.workSnapshot.locationNameSnapshot} | ${action}`;
 };
 for(const day of document.days.filter(d=>d.phase===phase)){
  selectOctoberCandidateDay(document,day.serviceDate);
  for(const person of document.rosterSlots.filter(r=>r.personId)){
   current={person:person.displayName,date:day.serviceDate};newPage(current.person,current.date);
   const av=day.availability.find(a=>a.slotId===person.slotId&&a.status==='working');
   if(!av){text('OFF - no scheduled duties or lunch coverage.');continue;}
   text(`Shift ${av.shift.start}-${av.shift.end} | Lunch ${av.lunch.start}-${av.lunch.end}`,{heading:true});
   text('Work only within your scheduled shift. Follow the named handoff when an earlier custodian leaves.');
   text('Admin: morning cleaning is permitted; check every 3 hours. Other locations retain the existing check deadline.');
   const open=day.assignments.filter(r=>r.status==='OPEN');
   for(const row of open)text(`STAFFING EXCEPTION: ${row.workSnapshot.locationNameSnapshot} ${row.window.start}-${row.window.end} is OPEN. No eligible scheduled coverage.`,{heading:true,color:rgb(.65,.2,.12)});
   text('YOUR ASSIGNED WORK',{heading:true});
   const owned=day.assignments.filter(r=>r.slotId===person.slotId).sort((a,b)=>a.window.start.localeCompare(b.window.start)||a.workSnapshot.locationNameSnapshot.localeCompare(b.workSnapshot.locationNameSnapshot));
   for(const row of owned)text(dutyLabel(row));
   const incoming=day.lunchLoans.flatMap(l=>l.responsibilities.map(r=>({loan:l,responsibility:r}))).filter(r=>r.responsibility.covererSlotId===person.slotId).sort((a,b)=>a.loan.window.start.localeCompare(b.loan.window.start));
   if(incoming.length){text('TEMPORARY LUNCH COVERAGE',{heading:true});
    if(person.displayName==='Gregory Staples')text('Gregory: on-call / issues-only. Respond if an issue occurs; these locations are not a new standing cleaning route.',{heading:true});
    for(const {loan,responsibility:r} of incoming){
     const owner=document.rosterSlots.find(s=>s.slotId===loan.normalOwnerSlotId)?.displayName;
     const windows=new Map();
     for(const segment of r.segments){
      const key=`${segment.window.start}-${segment.window.end}`;
      const places=windows.get(key)||new Set();
      places.add(day.assignments.find(a=>a.planWorkId===segment.planWorkId)?.workSnapshot.locationNameSnapshot);
      windows.set(key,places);
     }
     for(const [window,places] of [...windows].sort(([a],[b])=>a.localeCompare(b)))text(`${window} | Cover ${owner}: ${[...places].filter(Boolean).join('; ')}. ${r.responseMode==='on_call_issues_only'?'On-call; respond to issues only.':'Checks / issues only; no new deep clean.'}`);
    }
   }
   assert.equal(owned.length,day.assignments.filter(r=>r.personId===person.personId&&r.status==='ASSIGNED').length,'PDF employee binding differs from exact phone rows');
  }
 }
 fs.writeFileSync(path.join(out,name),await pdf.save(),{flag:'wx'});
 reports.push({file:name,pages:pdf.getPageCount(),revision:document.revision,pageFacts});
}
fs.writeFileSync(path.join(out,'pdf-qa-layout.json'),JSON.stringify({sourceData:dataPath,revision:document.revision,reports},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(reports.map(({file,pages,revision})=>({file,pages,revision}))));
