import {assertServiceDate,snapshotDatedRosterSlot} from './static-weekly-schedule-model.js';
// Pure segment completion. Runtime callers must use the source-bound derivation
// wrapper; the config-taking entry point also supports offline legacy evidence.
// Positions remain positions: this does not invent incumbents for vacant slots.
const assert={ok(value,message){if(!value)throw new Error(message);},equal(a,b,message){if(a!==b)throw new Error(message);}};
const clone=value=>JSON.parse(JSON.stringify(value));
const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
const clock=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
const ids=row=>row.includedLocations?.length?row.includedLocations.map(x=>x.locationId):[row.locationId];
function datedPositions(source,config,day){
 const base=assertServiceDate(source.serviceDate),date=new Date(`${base}T12:00:00Z`);
 date.setUTCDate(date.getUTCDate()+(day-date.getUTCDay()+7)%7);
 const serviceDate=date.toISOString().slice(0,10),capable=new Set(source.version.vacancyCapableSlotIds||[]);
 return Object.values(config.slots).filter(s=>s.workDays.includes(day)).map(position=>{
  const slot=source.slots.find(s=>s.id===position.slotId);
  assert.ok(slot,`missing stable source slot ${position.slotId}`);
  const incumbent=snapshotDatedRosterSlot(slot,serviceDate,{vacancyCapable:capable.has(slot.id)});
  return {...position,...position.datedAvailability?.[day],incumbent,serviceDate};
 });
}
export function completeRecurringShiftEndCoverage(source,config){
 const input=clone(source),version=input.version,notes=[],openResponsibilities=[];
 assert.ok(version && !input.versions,'one canonical recurring source required');
 const distances=new Map(input.proximity.filter(e=>e.verified===true).map(e=>[`${e.fromLocationId}|${e.toLocationId}`,e.minutes]));
 const original=version.assignments,added=[];
 for(let day=0;day<7;day++){
  const positions=datedPositions(input,config,day),workers=positions.filter(s=>!s.incumbent.vacant&&s.status!=='departed_named_absent');
  const slotById=new Map(positions.map(s=>[s.slotId,s]));
  assert.ok(workers.length,`${day} has no real staffed operating window`);
  const lastEnd=Math.max(...workers.map(s=>minute(s.shift[1])));
  const normal=original.filter(r=>r.dayOfWeek===day && r.window.start==='09:45');
  const vacancies=new Set(positions.filter(s=>s.incumbent.vacant).map(s=>s.slotId));
  // A vacancy retains its own OPEN responsibility only during its configured
  // shift, clipped to the actual staffed closing boundary. After that shift,
  // only a real on-duty custodian can receive the planned responsibility.
  // Never extend a vacant position beyond its shift: a later hire would
  // otherwise inherit an impossible immutable baseline without any rebuild.
  for(const row of normal)row.window.end=clock(Math.min(minute(row.window.end),lastEnd));
  const anchors=new Map(positions.map(s=>[s.slotId,normal.filter(r=>r.ownerSlotId===s.slotId).flatMap(ids)]));
  const current=normal.map(row=>({original:row,owner:row.ownerSlotId,rows:[row]}));
  const boundaries=[...new Set(positions.map(s=>minute(s.shift[1])))].filter(t=>t<lastEnd).sort((a,b)=>a-b);
  for(const at of boundaries){
   const leaving=current.filter(u=>minute(slotById.get(u.owner).shift[1])===at);
   const remaining=workers.filter(s=>minute(s.shift[0])<=at && at<minute(s.shift[1]));
   const loads=new Map(remaining.map(s=>[s.slotId,current.filter(u=>u.owner===s.slotId).reduce((n,u)=>n+Number(config.weights[u.original.locationCodeSnapshot]??1),0)]));
   for(const unit of leaving.sort((a,b)=>a.original.workId.localeCompare(b.original.workId))){
    const row=unit.original;
    const rankEligible=domain=>domain.filter(s=>!(s.forbiddenFamilies||[]).includes(row.locationCodeSnapshot)
      && (!s.normalAllowedFamilies||s.normalAllowedFamilies.includes(row.locationCodeSnapshot))
      && (!config.sourceBoundEligibility || (!(row.restrictedSlotIds||[]).includes(s.slotId)
        && (row.requiredQualifications||[]).every(q=>s.qualifications.includes(q))
        && !ids(row).some(id=>s.restrictions.includes(id))))
      && !(minute(s.lunch[0])<=at && at<minute(s.lunch[1])))
      .map(s=>({slot:s,distance:Math.max(...ids(row).map(target=>Math.min(...(anchors.get(s.slotId)||[])
        .map(anchor=>target===anchor?0:(distances.get(`${anchor}|${target}`)??Infinity))))),load:loads.get(s.slotId)||0}))
      .filter(s=>Number.isFinite(s.distance)).sort((a,b)=>a.distance-b.distance||a.load-b.load||a.slot.slotId.localeCompare(b.slot.slotId));
    const eligible=rankEligible(remaining);
    // If no real custodian is eligible, retain an explicit OPEN requirement
    // on a suitable, on-shift empty position. This is NOT a physical handoff:
    // no recipient/person/notification exists. In particular, Friday's late
    // Herpetarium gap cannot be assigned to the restricted remaining worker.
    // A future incumbent of this stable position can inherit this requirement
    // without being assigned work beyond their own configured shift.
    const open=eligible.length===0;
    if(open)eligible.push(...rankEligible(positions.filter(s=>s.incumbent.vacant
      &&minute(s.shift[0])<=at&&at<minute(s.shift[1]))));
    assert.ok(eligible.length,`${day}/${row.workId}/${clock(at)} has no eligible on-duty handoff owner`);
    const next=eligible[0],previous=unit.owner;
    const handoff={...clone(row),workId:`${row.workId}:${open?'open':'handoff'}:${clock(at)}:${config.fullSegmentIdentity?next.slot.slotId:next.slot.slotId.slice(0,8)}`,
      ownerSlotId:next.slot.slotId,originSlotId:next.slot.slotId,
      window:{start:clock(at),end:clock(Math.min(minute(next.slot.shift[1]),lastEnd))}};
    unit.owner=next.slot.slotId;unit.rows.push(handoff);added.push(handoff);
    loads.set(unit.owner,(loads.get(unit.owner)||0)+Number(config.weights[row.locationCodeSnapshot]??1));
    (open?openResponsibilities:notes).push({day,at:clock(at),workId:handoff.workId,fromSlotId:previous,toSlotId:unit.owner,
      locationCode:row.locationCodeSnapshot,locationIds:ids(row),directedProximityMinutes:next.distance,
      fromVacantPosition:vacancies.has(previous),...(open?{status:'OPEN',personId:null,reason:'no_eligible_real_on_duty_custodian'}:{})});
   }
  }
  for(const unit of current){
   assert.equal(unit.rows.at(-1).window.end,clock(lastEnd),'responsibility must reach final shift end');
   if(unit.rows.length===1)continue;
   const budget=unit.original.serviceEffortMinutes;
   assert.ok(Number.isSafeInteger(budget)&&budget>=unit.rows.length,'retained workload budget cannot cover positive handoff segments');
   const durations=unit.rows.map(r=>minute(r.window.end)-minute(r.window.start));
   const total=durations.reduce((a,b)=>a+b,0),distributable=budget-unit.rows.length;
   const allocation=durations.map((d,index)=>({index,points:1+Math.floor(distributable*d/total),remainder:(distributable*d)%total}));
   let left=budget-allocation.reduce((n,r)=>n+r.points,0);
   for(const item of allocation.slice().sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){
    if(left<=0)break;item.points++;left--;
   }
   for(const item of allocation){
    unit.rows[item.index].serviceEffortMinutes=item.points;
    unit.rows[item.index].serviceEffortProvenance+=`;shift-split-preserves-budget`;
   }
   assert.equal(unit.rows.reduce((n,r)=>n+r.serviceEffortMinutes,0),budget);
  }
 }
 version.assignments.push(...added);
 version.assignments.sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.window.start.localeCompare(b.window.start)||a.workId.localeCompare(b.workId));
 const validation=validateRecurringShiftEndCoverage(source,input,config);
 return {input,notes,openResponsibilities,validation};
}
export function validateRecurringShiftEndCoverage(baseline,candidate,config){
 let minuteSamples=0,locationMinuteChecks=0;const staffedDepartureByDay={};
 for(let day=0;day<7;day++){
  const expected=new Set(baseline.version.assignments.filter(r=>r.dayOfWeek===day&&r.window.start==='09:45').flatMap(ids));
  const dated=datedPositions(baseline,config,day),staffed=dated.filter(s=>!s.incumbent.vacant&&s.status!=='departed_named_absent');
  const positions=new Map(dated.map(s=>[s.slotId,s]));
  assert.ok(staffed.length,`${day} has no real staffed operating window`);
  const vacancies=new Set(dated.filter(s=>s.incumbent.vacant).map(s=>s.slotId));
  const final=Math.max(...staffed.map(s=>minute(s.shift[1])));
  staffedDepartureByDay[day]=clock(final);
  const rows=candidate.version.assignments.filter(r=>r.dayOfWeek===day&&minute(r.window.start)>=585);
  assert.ok(rows.every(r=>minute(r.window.end)<=final),`responsibility after final staffed departure on ${day}`);
  for(const row of rows.filter(r=>vacancies.has(r.ownerSlotId))){
   const original=baseline.version.assignments.find(r=>r.dayOfWeek===day&&r.workId===row.workId);
   assert.ok((original&&original.ownerSlotId===row.ownerSlotId||row.workId.includes(':open:'))&&!row.workId.includes(':handoff:'),
    'vacancy cannot receive a physical handoff');
  }
  for(let at=585;at<final;at++){
   const counts=new Map();
   for(const row of rows.filter(r=>minute(r.window.start)<=at&&at<minute(r.window.end))){
    const owner=positions.get(row.ownerSlotId);
    assert.ok(owner?.workDays.includes(day)&&minute(owner.shift[0])<=at
      &&at<minute(owner.shift[1]),`off-duty recurring owner at ${day}/${clock(at)}`);
    assert.ok(!(owner.forbiddenFamilies||[]).includes(row.locationCodeSnapshot),'forbidden handoff family');
    assert.ok(!owner.normalAllowedFamilies||owner.normalAllowedFamilies.includes(row.locationCodeSnapshot),'handoff outside established geographic areas');
    for(const id of ids(row))counts.set(id,(counts.get(id)||0)+1);
   }
   assert.equal(counts.size,expected.size,`coverage gap at ${day}/${clock(at)}`);
   for(const id of expected)assert.equal(counts.get(id),1,`missing/duplicate location ${id} at ${day}/${clock(at)}`);
   minuteSamples++;locationMinuteChecks+=expected.size;
  }
 }
 return {minuteSamples,locationMinuteChecks,coverageGaps:0,duplicateLocations:0,staffedDepartureByDay,
   scope:'dated real-staff handoffs and explicit vacancy OPEN responsibility until final staffed departure; lunch overlay checked separately'};
}
