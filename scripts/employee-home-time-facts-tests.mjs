import assert from 'node:assert/strict';
import {deriveHomeTimeFacts,deriveProjectedHomeTimeFacts,deriveBoundedHomeTimeFacts,readHomeTimeFacts} from '../src/employee-home-time-facts.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const day={service_date:'2026-09-21',employee_id:id(1),employee_name:'Fixture Custodian',projection_id:id(2),publication_id:id(3),projection_status:'current'};
const record={employee_active:true,roster:{employee_id:id(1),projection_id:id(2),publication_id:id(3),version_id:id(4),slot_id:id(5),projection_status:'current',active:true,staffing_state:'working',shift_start:'08:00:00',shift_end:'17:00:00',lunch_start:'12:00:00',lunch_end:'13:00:00'},exceptions:[]};
const change=(type,payload={},sequence=1)=>({id:id(sequence+100),type,serviceDate:day.service_date,status:'accepted',sequence,baseVersionId:id(4),publicationId:id(3),payload:{slotId:id(5),...payload}});
const clone=value=>structuredClone(value),results=[];
const projected={employee_active:true,roster:clone(record.roster),availability:[{slotId:id(5),incumbentPersonId:id(1),serviceDate:day.service_date,dayOfWeek:1,status:'working',shift:{start:'08:00',end:'17:00'},lunch:{start:'12:00',end:'13:00'}}]};
const bounded={...clone(projected),contract_version:'employee-home-projected-record.v1',service_date:day.service_date,employee_id:day.employee_id,publication_id:day.publication_id,projection_id:day.projection_id,projection_status:'current'};
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}}
await check('published base shift and lunch',()=>{const r=deriveHomeTimeFacts(day,record);assert.deepEqual(r.lunch,{start:'12:00',end:'13:00'});assert.equal(r.shift.shift_start,'08:00');assert.equal(r.reason,null);});
await check('accepted dated lunch replaces only that day',()=>{const r=clone(record);r.exceptions=[change('lunch',{lunch:{start:'13:00',end:'14:00'}})];assert.equal(deriveHomeTimeFacts(day,r).lunch.start,'13:00');r.exceptions[0].serviceDate='2026-09-22';assert.equal(deriveHomeTimeFacts(day,r).lunch.start,'12:00');});
await check('accepted command sequence is not transport array order',()=>{const r=clone(record);r.exceptions=[change('lunch',{lunch:{start:'13:00',end:'14:00'}},2),change('lunch',{lunch:{start:'11:00',end:'12:00'}},1)];assert.equal(deriveHomeTimeFacts(day,r).lunch.start,'13:00');});
await check('another slot cannot change employee times',()=>{const r=clone(record);r.exceptions=[change('lunch',{slotId:id(9),lunch:{start:'13:00',end:'14:00'}})];assert.equal(deriveHomeTimeFacts(day,r).lunch.start,'12:00');});
await check('shift override supplies the approved time',()=>{const r=clone(record);r.exceptions=[change('shift_override',{shift:{start:'07:00',end:'16:00'}})];assert.equal(deriveHomeTimeFacts(day,r).shift.shift_start,'07:00');});
await check('full PTO is not a working shift',()=>{const r=clone(record);r.exceptions=[change('pto')];assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'off');});
await check('off-day and unavailable facts retain exact projection/publication binding',()=>{
 const r=clone(record);r.exceptions=[change('pto')];
 for(const value of [deriveHomeTimeFacts(day,r),deriveHomeTimeFacts(day,null)]){
  assert.equal(value.projection_id,day.projection_id);assert.equal(value.publication_id,day.publication_id);
 }
});
await check('partial absence is disclosed without inventing a new shift',()=>{const r=clone(record);r.exceptions=[{...change('partial_absence'),window:{start:'09:00',end:'10:00'}}];const value=deriveHomeTimeFacts(day,r);assert.equal(value.has_partial_absence,true);assert.equal(value.shift.shift_start,'08:00');});
await check('union of adjacent, overlapping or unordered absences covering shift is off',()=>{
 for(const windows of [[['08:00','12:00'],['12:00','17:00']],[['12:00','18:00'],['07:00','13:00']],
  [['08:00','10:00'],['12:00','17:00'],['09:00','12:00']]]){
  const r=clone(record);r.exceptions=windows.map(([start,end],i)=>({...change('partial_absence',{},i+1),window:{start,end}}));
  assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'off');
 }
});
await check('a real gap between partial absences is not erased',()=>{
 const r=clone(record);r.exceptions=[{...change('partial_absence',{},1),window:{start:'08:00',end:'11:59'}},
  {...change('partial_absence',{},2),window:{start:'12:00',end:'17:00'}}];
 assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'scheduled');
});
await check('off base needs an explicit working override',()=>{const r=clone(record);r.roster.active=false;r.exceptions=[change('shift_override',{shift:{start:'07:00',end:'16:00'}})];assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'off');r.exceptions[0].payload.status='working';assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'scheduled');});
await check('an inactive or departed person cannot be restored by a time override',()=>{for(const mode of ['inactive','departed']){const r=clone(record);if(mode==='inactive')r.employee_active=false;else r.roster.staffing_state='departed_named_absent';r.exceptions=[change('shift_override',{status:'working',shift:{start:'07:00',end:'16:00'}})];assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'off');}});
await check('missing lunch stays missing',()=>{const r=clone(record);r.roster.lunch_start=null;r.roster.lunch_end=null;assert.equal(deriveHomeTimeFacts(day,r).lunch,null);});
await check('out-of-shift lunch fails closed instead of guessing',()=>{const r=clone(record);r.exceptions=[change('lunch',{lunch:{start:'18:00',end:'19:00'}})];assert.equal(deriveHomeTimeFacts(day,r).shift,null);});
await check('wrong projection, employee and publication are rejected',()=>{for(const key of ['projection_id','employee_id','publication_id']){const r=clone(record);r.roster[key]=id(99);assert.equal(deriveHomeTimeFacts(day,r).shift,null);}});
await check('unaccepted or wrong-publication exceptions are not used',()=>{for(const key of ['status','publicationId']){const r=clone(record);r.exceptions=[change('lunch',{lunch:{start:'13:00',end:'14:00'}})];r.exceptions[0][key]=key==='status'?'draft':id(99);assert.equal(deriveHomeTimeFacts(day,r).shift,null);}});
await check('duplicate and malformed commands refuse fabricated times',()=>{const r=clone(record);r.exceptions=[change('lunch',{lunch:{start:'13:00',end:'14:00'}})];r.exceptions.push(clone(r.exceptions[0]));assert.equal(deriveHomeTimeFacts(day,r).shift,null);r.exceptions=[{...change('lunch'),sequence:'invalid'}];assert.equal(deriveHomeTimeFacts(day,r).shift,null);});
await check('lookup is scoped to the accepted employee and exact projection',async()=>{
  const queries=[];const value=await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async sql=>{queries.push(sql);return [{facts:bounded}];}});
  assert.equal(value.shift.shift_start,'08:00');assert.equal(queries.length,1);
  assert.equal(queries[0],`select public.static_weekly_v27_read_home_time_facts('${day.service_date}'::date,'${id(1)}'::uuid,'${id(3)}'::uuid,'${id(2)}'::uuid) as facts`);
  assert.doesNotMatch(queries[0],/weekly_schedule_compiled_projections|projection_envelope|static_weekly_(?:digest|compiler_exception_set|accepted_exception_set)/);
  assert.doesNotMatch(queries[0],/\b(insert|update|delete|alter|drop|truncate)\b/i);
});
await check('missing or duplicate roster facts remain unavailable',async()=>{for(const rows of [[],[{facts:record},{facts:record}]]){const value=await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async()=>rows});assert.equal(value.shift,null);}});
await check('reference lookup failure cannot stop the employee schedule response',async()=>{const value=await readHomeTimeFacts({day,employeeId:id(1),runReadOnlySql:async()=>{throw Error('connection unavailable');}});assert.equal(value.shift,null);});
await check('noncanonical identifiers never reach SQL',async()=>{let queries=0;const value=await readHomeTimeFacts({day,employeeId:"bad';--",runReadOnlySql:async()=>{queries++;return [{facts:record}];}});assert.equal(queries,0);assert.equal(value.shift,null);});
await check('a shift change cannot silently erase approved full-day PTO',()=>{const r=clone(record);r.exceptions=[change('pto',{},1),change('shift_override',{status:'working',shift:{start:'07:00',end:'16:00'}},2)];assert.equal(deriveHomeTimeFacts(day,r).schedule_status,'off');});
await check('projected normal row matches published base without optional absence list',()=>{
  for(const blocked of [undefined,null,[]]){const r=clone(projected);r.availability[0].blockedWindows=blocked;assert.deepEqual(deriveProjectedHomeTimeFacts(day,r),deriveHomeTimeFacts(day,record));}
});
await check('projected accepted time changes override unchanged base roster',()=>{const r=clone(projected);r.availability[0].shift={start:'07:00',end:'16:00'};r.availability[0].lunch={start:'13:00',end:'14:00'};
  const value=deriveProjectedHomeTimeFacts(day,r);assert.equal(value.shift.start,'07:00');assert.equal(value.lunch.start,'13:00');});
await check('projected working override can activate an off base but not departed employee',()=>{const r=clone(projected);r.roster.active=false;
  assert.equal(deriveProjectedHomeTimeFacts(day,r).schedule_status,'scheduled');r.roster.staffing_state='departed_named_absent';assert.equal(deriveProjectedHomeTimeFacts(day,r).schedule_status,'off');});
await check('projected absent unavailable and departed states remain off',()=>{for(const status of ['absent','unavailable','departed_named_absent']){const r=clone(projected);r.availability[0].status=status;assert.equal(deriveProjectedHomeTimeFacts(day,r).schedule_status,'off');}
  const r=clone(projected);r.employee_active=false;assert.equal(deriveProjectedHomeTimeFacts(day,r).schedule_status,'off');});
await check('projected partial absence union preserves full PTO and real gaps',()=>{for(const [windows,off]of [[[['08:00','12:00'],['12:00','17:00']],true],[[['12:00','18:00'],['07:00','13:00']],true],[[['08:00','11:59'],['12:00','17:00']],false]]){
  const r=clone(projected);r.availability[0].blockedWindows=windows.map(([start,end])=>({start,end}));const value=deriveProjectedHomeTimeFacts(day,r);
  assert.equal(value.schedule_status,off?'off':'scheduled');if(!off)assert.equal(value.has_partial_absence,true);}});
await check('projected missing lunch stays missing and out-of-shift lunch refuses times',()=>{const r=clone(projected);r.availability[0].lunch=null;assert.equal(deriveProjectedHomeTimeFacts(day,r).lunch,null);
  r.availability[0].lunch={start:'18:00',end:'19:00'};assert.equal(deriveProjectedHomeTimeFacts(day,r).shift,null);});
await check('projected wrong day person slot weekday status and malformed windows fail closed',()=>{
  for(const [field,value]of [['serviceDate','2026-09-22'],['incumbentPersonId',id(99)],['slotId',id(99)],['dayOfWeek',2],['status','unknown'],['shift',null],['blockedWindows',{}],['blockedWindows',[{start:'invalid',end:'17:00'}]]]){
    const r=clone(projected);r.availability[0][field]=value;assert.equal(deriveProjectedHomeTimeFacts(day,r).shift,null,field);
  }
});
await check('projected missing or ambiguous availability and mismatched authority refuse times',()=>{
  for(const rows of [undefined,null,[],[projected.availability[0],projected.availability[0]]]){const r=clone(projected);r.availability=rows;assert.equal(deriveProjectedHomeTimeFacts(day,r).shift,null);}
  for(const field of ['employee_id','projection_id','publication_id','slot_id','version_id','projection_status']){const r=clone(projected);r.roster[field]='wrong';assert.equal(deriveProjectedHomeTimeFacts(day,r).shift,null,field);}
  const r=clone(projected);delete r.employee_active;assert.equal(deriveProjectedHomeTimeFacts(day,r).shift,null);
  assert.equal(deriveProjectedHomeTimeFacts({...day,projection_status:'stale_staffing_change'},projected).shift,null);
});
await check('noncanonical publication cannot interpolate into reader SQL',async()=>{let calls=0;const value=await readHomeTimeFacts({day:{...day,publication_id:"bad';--"},employeeId:id(1),runReadOnlySql:async()=>{calls++;return[];}});assert.equal(calls,0);assert.equal(value.shift,null);});
await check('bounded reader contract rejects every mismatched top-level binding',()=>{
  assert.equal(deriveBoundedHomeTimeFacts(day,bounded).shift.start,'08:00');
  for(const key of ['contract_version','service_date','employee_id','publication_id','projection_id','projection_status']){
    const r=clone(bounded);r[key]='wrong';assert.equal(deriveBoundedHomeTimeFacts(day,r).shift,null,key);
  }
  assert.equal(deriveBoundedHomeTimeFacts(day,projected).shift,null);
});
await check('coverage bounded facts must match its independently current canonical slot and version',()=>{
  for(const key of ['slot_id','version_id','employee_id','publication_id','projection_id']){
    const expected=clone(record.roster);expected[key]=id(99);assert.equal(deriveBoundedHomeTimeFacts(day,bounded,expected).shift,null,key);
  }
});
await check('dated reader contract remains unchanged with exact revision requirement',async()=>{
  const datedDay={...day,authority_scope:'dated_transition',candidate_revision:'fixture-revision'};
  const facts={...deriveHomeTimeFacts(day,record),candidate_revision:datedDay.candidate_revision};
  assert.deepEqual(await readHomeTimeFacts({day:datedDay,employeeId:day.employee_id,runReadOnlySql:async()=>[{facts}]}),facts);
  const wrong={...facts,candidate_revision:'stale'};
  assert.equal((await readHomeTimeFacts({day:datedDay,employeeId:day.employee_id,runReadOnlySql:async()=>[{facts:wrong}]})).shift,null);
});
console.log(JSON.stringify({scope:'Published-time model and read-only query construction with synthetic SQL results; no database write or migration execution',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2));
process.exitCode=results.some(result=>!result.passed)?1:0;
