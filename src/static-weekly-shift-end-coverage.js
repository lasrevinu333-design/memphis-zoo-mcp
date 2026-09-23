import assert from 'node:assert/strict';
// Build-time completion of a recurring template, never a second live scheduler.
// Positions remain positions: this does not invent incumbents for vacant slots.
const clone=value=>JSON.parse(JSON.stringify(value));
const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
const clock=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
const ids=row=>row.includedLocations?.length?row.includedLocations.map(x=>x.locationId):[row.locationId];
export function completeRecurringShiftEndCoverage(source,config){
 const input=clone(source),version=input.version,notes=[];
 assert.ok(version && !input.versions,'one canonical recurring source required');
 const slots=Object.values(config.slots),slotById=new Map(slots.map(s=>[s.slotId,s]));
 const distances=new Map(input.proximity.filter(e=>e.verified===true).map(e=>[`${e.fromLocationId}|${e.toLocationId}`,e.minutes]));
 const original=version.assignments,added=[];
 for(let day=0;day<7;day++){
  const workers=slots.filter(s=>s.workDays.includes(day));
  const lastEnd=Math.max(...workers.map(s=>minute(s.shift[1])));
  const normal=original.filter(r=>r.dayOfWeek===day && r.window.start==='09:45');
  const anchors=new Map(workers.map(s=>[s.slotId,normal.filter(r=>r.ownerSlotId===s.slotId).flatMap(ids)]));
  const current=normal.map(row=>({original:row,owner:row.ownerSlotId,rows:[row]}));
  const boundaries=[...new Set(workers.map(s=>minute(s.shift[1])))].filter(t=>t<lastEnd).sort((a,b)=>a-b);
  for(const at of boundaries){
   const leaving=current.filter(u=>minute(slotById.get(u.owner).shift[1])===at);
   const remaining=workers.filter(s=>minute(s.shift[0])<=at && at<minute(s.shift[1]));
   const loads=new Map(remaining.map(s=>[s.slotId,current.filter(u=>u.owner===s.slotId).reduce((n,u)=>n+Number(config.weights[u.original.locationCodeSnapshot]??1),0)]));
   for(const unit of leaving.sort((a,b)=>a.original.workId.localeCompare(b.original.workId))){
    const row=unit.original;
    const eligible=remaining.filter(s=>!(s.forbiddenFamilies||[]).includes(row.locationCodeSnapshot)
      && (!s.normalAllowedFamilies||s.normalAllowedFamilies.includes(row.locationCodeSnapshot))
      && !(minute(s.lunch[0])<=at && at<minute(s.lunch[1])))
      .map(s=>({slot:s,distance:Math.max(...ids(row).map(target=>Math.min(...(anchors.get(s.slotId)||[])
        .map(anchor=>target===anchor?0:(distances.get(`${anchor}|${target}`)??Infinity))))),load:loads.get(s.slotId)}))
      .filter(s=>Number.isFinite(s.distance)).sort((a,b)=>a.distance-b.distance||a.load-b.load||a.slot.slotId.localeCompare(b.slot.slotId));
    assert.ok(eligible.length,`${day}/${row.workId}/${clock(at)} has no eligible on-duty handoff owner`);
    const next=eligible[0],previous=unit.owner;
    const handoff={...clone(row),workId:`${row.workId}:handoff:${clock(at)}:${next.slot.slotId.slice(0,8)}`,
      ownerSlotId:next.slot.slotId,originSlotId:next.slot.slotId,
      window:{start:clock(at),end:next.slot.shift[1]}};
    unit.owner=next.slot.slotId;unit.rows.push(handoff);added.push(handoff);
    loads.set(unit.owner,loads.get(unit.owner)+Number(config.weights[row.locationCodeSnapshot]??1));
    notes.push({day,at:clock(at),workId:handoff.workId,fromSlotId:previous,toSlotId:unit.owner,
      locationCode:row.locationCodeSnapshot,locationIds:ids(row),directedProximityMinutes:next.distance});
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
 return {input,notes,validation};
}
export function validateRecurringShiftEndCoverage(baseline,candidate,config){
 let minuteSamples=0,locationMinuteChecks=0;
 const positions=new Map(Object.values(config.slots).map(s=>[s.slotId,s]));
 for(let day=0;day<7;day++){
  const expected=new Set(baseline.version.assignments.filter(r=>r.dayOfWeek===day&&r.window.start==='09:45').flatMap(ids));
  const final=Math.max(...[...positions.values()].filter(s=>s.workDays.includes(day)).map(s=>minute(s.shift[1])));
  const rows=candidate.version.assignments.filter(r=>r.dayOfWeek===day&&minute(r.window.start)>=585);
  for(let at=585;at<final;at++){
   const counts=new Map();
   for(const row of rows.filter(r=>minute(r.window.start)<=at&&at<minute(r.window.end))){
    const owner=positions.get(row.ownerSlotId);
    assert.ok(owner?.workDays.includes(day)&&minute(owner.shift[0])<=at&&at<minute(owner.shift[1]),`off-duty recurring owner at ${day}/${clock(at)}`);
    assert.ok(!(owner.forbiddenFamilies||[]).includes(row.locationCodeSnapshot),'forbidden handoff family');
    assert.ok(!owner.normalAllowedFamilies||owner.normalAllowedFamilies.includes(row.locationCodeSnapshot),'handoff outside established geographic areas');
    for(const id of ids(row))counts.set(id,(counts.get(id)||0)+1);
   }
   assert.equal(counts.size,expected.size,`coverage gap at ${day}/${clock(at)}`);
   for(const id of expected)assert.equal(counts.get(id),1,`missing/duplicate location ${id} at ${day}/${clock(at)}`);
   minuteSamples++;locationMinuteChecks+=expected.size;
  }
 }
 return {minuteSamples,locationMinuteChecks,coverageGaps:0,duplicateLocations:0,
   scope:'full-staff stable-position responsibility until final scheduled departure; lunch overlay checked separately'};
}
