import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated,shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';

// Read-only candidate comparison. Never publishes or modifies the registered packet.
assert.ok(process.env.OC24_LUNCH_TEMPLATE,'explicit candidate packet required');
const source=JSON.parse(readFileSync(process.env.OC24_LUNCH_TEMPLATE,'utf8')).compilerInput;
const original=digest(source),gregory='5d2d2a0e-230f-5b03-9867-2e4c2826871f';
const others=source.version.slotAvailability.filter(a=>a.slotId!==gregory);
const actor={managerId:'10000000-0000-4000-8000-000000000101',managerName:'Synthetic OC24 Lunch Comparison',idempotencyKey:'synthetic-oc24-lunch'};
try{
 for(const [start,end] of [['12:00','13:00'],['11:30','12:30'],['12:30','13:30']]){
  if(process.argv.includes('--remaining')&&start==='12:00')continue; // exact two passes retained in first log
  for(const full of [false,true]){
   if(process.argv.includes('--remaining')&&start==='11:30'&&!full)continue; // exact rejection retained in first log
   const s=structuredClone(source);
   for(const row of s.version.slotAvailability.filter(a=>a.slotId===gregory))row.lunch={start,end};
   assert.deepEqual(s.version.slotAvailability.filter(a=>a.slotId!==gregory),others);
   if(full){
    for(const [i,id] of s.version.vacantSlotIds.entries()){
     s.slots.find(slot=>slot.id===id).incumbencies=[{personId:`40000000-0000-4000-8000-00000000020${i}`,displayName:`Synthetic Future Hire ${i}`,effectiveStart:s.serviceDate,effectiveEnd:null}];
     for(const a of s.version.slotAvailability.filter(a=>a.slotId===id))a.status='working';
    }
    s.version.vacantSlotIds=[];
   }
   const {version,...rest}=s,began=performance.now();
   let p;
   try{p=await compileAndPrepareStaticWeeklyScheduleIsolated({...rest,versions:[version]},{kind:'projection',publicationId:version.publicationId,expectedRevision:0,actor});}
   catch(error){
    if(error.code!=='lunch_authority_candidate_not_publishable')throw error;
    console.log(JSON.stringify({case:full?'future-nine':'current-six',gregoryLunch:{start,end},status:'REJECTED_BY_LUNCH_AUTHORITY',code:error.code,sourceDigest:digest(s),production:false,independentAudit:false}));continue;
   }
   const loans=p.lunchDocument.loans;
   console.log(JSON.stringify({case:full?'future-nine':'current-six',gregoryLunch:{start,end},sourceDigest:digest(s),replayDigest:p.replayDigest,verification:p.lunchDocument.verification_status,derivedRows:p.envelope.authority.overlayCompilerInput.version.assignments.length,loans:loans.length,reviewRequired:loans.filter(l=>l.status==='REVIEW_REQUIRED'),fallbacks:loans.filter(l=>l.fallback),gregory:loans.filter(l=>l.normal_owner_slot_id===gregory),allLoans:loans,elapsedMilliseconds:Math.round(performance.now()-began),production:false,independentAudit:false}));
   assert.equal(p.lunchDocument.verification_status,'VERIFIED');
   assert.equal(loans.filter(l=>l.status==='REVIEW_REQUIRED').length,0);
   assert.equal(loans.length,full?45:30);
  }
 }
 assert.equal(digest(source),original,'input packet is never mutated');
}finally{await shutdownStaticWeeklyCompiler();}
