import {readFileSync,writeFileSync} from 'node:fs';
import {compileStaticWeeklyScheduleIsolated,shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
import {createStaticWeeklyLunchCoverageCandidate} from '../src/static-weekly-lunch-coverage.js';
const s=JSON.parse(readFileSync(process.argv[2],'utf8')).compilerInput;
if(process.argv[3]==='filled'){
 for(const [i,id] of s.version.vacantSlotIds.entries()){
  s.slots.find(slot=>slot.id===id).incumbencies=[{personId:`40000000-0000-4000-8000-00000000020${i}`,displayName:`Synthetic Runtime Hire ${i}`,effectiveStart:s.serviceDate,effectiveEnd:null}];
  for(const a of s.version.slotAvailability.filter(a=>a.slotId===id))a.status='working';
 }
 s.version.vacantSlotIds=[];
}else throw Error('Explicit filled synthetic diagnostic required');
const {version,...rest}=s;
try{
 const start=performance.now(),result=await compileStaticWeeklyScheduleIsolated({...rest,versions:[version]});
 console.log(JSON.stringify({status:result.status,fatal:result.fatal,reviewWork:result.reviewWork,openWork:result.openWork,violations:result.verifier?.violations,elapsedMilliseconds:Math.round(performance.now()-start)}));
 if(process.argv[4])writeFileSync(process.argv[4],JSON.stringify(result)+'\n',{flag:'wx'});
 if(result.status==='FEASIBLE')console.log(JSON.stringify(createStaticWeeklyLunchCoverageCandidate({...rest,versions:[version]},result)));
}finally{await shutdownStaticWeeklyCompiler();}
