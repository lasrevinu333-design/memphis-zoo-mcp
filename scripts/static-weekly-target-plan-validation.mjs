import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {assertNormalOwnerEligibility,mandatoryNormalOwner,isHardForbidden} from '../src/static-weekly-owner-eligibility.js';

const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const overlaps=(a,b)=>a[0]<b[1]&&b[0]<a[1];
// Local source authoring only. This validates the explicitly bound current
// target; it grants neither publication nor a physical-test result.
export function loadCurrentEightEmployeeTarget(config,root){
  if(!config.fullHourLunchPlan)return null;
  const bytes=readFileSync(resolve(root,config.fullHourLunchPlan.path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),config.fullHourLunchPlan.sha256);
  const plan=JSON.parse(bytes);
  assert.equal(plan.status,'CURRENT_PROGRAM_TARGET_PUBLICATION_PENDING');
  assert.equal(plan.lunchPolicy,'OWNER_20261028_FULL_HOUR_SAME_HELPERS_SAME_AREAS');
  assert.equal(plan.timingBasis,'STATIC_PUBLISHED_SHIFT_AND_LUNCH');
  assert.equal(plan.clocksResetOnHandoff,false);
  const people=Object.entries(plan.positions).filter(([,p])=>p.personId);
  assert.equal(people.length,8);assert.equal(new Set(people.map(([,p])=>p.personId)).size,8);
  const byKey=new Map(people),slots=new Map();
  for(const [key,person]of people){
    const slot=config.slots[person.sourceSlotKey];assert.ok(slot);slots.set(key,slot);
    for(const field of ['slotId','personId','name','shift','lunch','lunchByDay','workDays'])
      assert.deepEqual(slot[field],person[field],`${key} target ${field}`);
    assert.notEqual(slot.vacancy,true);
  }
  assert.equal(Object.values(config.slots).filter(p=>p.vacancy===true).length,1);
  assert.equal(plan.families.length,23);assert.equal(new Set(plan.families).size,23);
  let lunches=0,segments=0;
  for(let day=0;day<7;day++){
    const d=plan.days[String(day)];
    const staff=people.filter(([,p])=>p.workDays.includes(day)).map(([k])=>k);
    assert.deepEqual([...d.staff].sort(),staff.sort());
    const lunch=k=>(byKey.get(k).lunchByDay[String(day)]||byKey.get(k).lunch).map(minute);
    const shift=k=>byKey.get(k).shift.map(minute);
    for(const stage of d.stages){
      assert.deepEqual(Object.keys(stage.owners).sort(),[...plan.families].sort());
      for(const [family,who]of Object.entries(stage.owners)){
        assert.ok(staff.includes(who));assert.ok(shift(who)[1]>=stage.end);
        assert.ok(!isHardForbidden(slots.get(who),family,day));
        const fixed=mandatoryNormalOwner(config,family,day);
        if(fixed&&stage.start<minute(Object.values(config.slots).find(s=>s.slotId===fixed).shift[1]))assert.equal(slots.get(who).slotId,fixed);
        if(stage.kind!=='closing')assertNormalOwnerEligibility(slots.get(who),family,day);
      }
      if(stage.kind==='morning'||stage.kind==='regular'){
        const phase=stage.kind==='morning'?'morning':'equalized',actual={};
        for(const [key,families]of Object.entries(config.overrides[String(day)][phase]))for(const f of families){
          assert.ok(!Object.hasOwn(actual,f));actual[f]=key;
        }
        assert.deepEqual(actual,Object.fromEntries(Object.entries(stage.owners).map(([f,k])=>[f,byKey.get(k).sourceSlotKey])));
      }
    }
    let previous=null;
    for(const segment of d.segments){
      if(previous!==null)assert.equal(segment.start,previous,'coverage interval gap');previous=segment.end;
      const normal=d.stages.find(s=>s.start<=segment.start&&segment.end<=s.end);assert.ok(normal);
      assert.deepEqual(segment.regularOwners,normal.owners);
      assert.deepEqual(Object.keys(segment.owners).sort(),[...plan.families].sort());
      for(const [f,k]of Object.entries(segment.owners)){
        assert.ok(staff.includes(k));assert.ok(!isHardForbidden(slots.get(k),f,day));
        // Before the final opener arrives, its scheduled opening work remains
        // assigned to it; complete all-location coverage starts at that arrival.
        if(segment.start>=Math.max(...staff.map(k=>shift(k)[0]))){
          assert.ok(shift(k)[0]<=segment.start&&segment.end<=shift(k)[1]);
          assert.ok(!overlaps(lunch(k),[segment.start,segment.end]));
        }
      }
      segments++;
    }
    assert.equal(previous,Math.max(...staff.map(k=>shift(k)[1])));
    assert.equal(d.fullHourLunchLoans.length,staff.length);
    for(const k of staff){
      const loans=d.fullHourLunchLoans.filter(l=>l.from===k);assert.equal(loans.length,1);const loan=loans[0];
      assert.deepEqual([loan.start,loan.end],lunch(k));assert.equal(loan.end-loan.start,60);
      const areas=[...new Set(d.stages.filter(s=>overlaps([s.start,s.end],[loan.start,loan.end])).flatMap(s=>Object.entries(s.owners).filter(([,o])=>o===k).map(([f])=>f)))].sort();
      assert.deepEqual(Object.keys(loan.areas).sort(),areas);
      for(const [f,helper]of Object.entries(loan.areas)){
        assert.notEqual(helper,k);assert.ok(staff.includes(helper));
        assert.ok(shift(helper)[0]<=loan.start&&loan.end<=shift(helper)[1]);assert.ok(!overlaps(lunch(helper),[loan.start,loan.end]));
        for(let t=loan.start;t<loan.end;t++)assert.equal(d.segments.find(s=>s.start<=t&&t<s.end)?.owners[f],helper,'full-hour area continuity');
      }
      assert.deepEqual([...new Set(Object.values(loan.areas))].sort(),[...loan.helpers].sort());lunches++;
    }
  }
  for(const edge of config.namedShiftEndHandoffs||[]){
    const target=people.find(([,p])=>p.slotId===edge.toSlotId);assert.ok(target);
    for(const segment of plan.days[String(edge.dayOfWeek)].segments)
      if(segment.start>=minute(edge.at)&&segment.start<minute(target[1].shift[1]))assert.equal(segment.owners[edge.locationCode],target[0]);
  }
  return {plan,checks:{employees:8,lunches,segments,scheduledShiftEndHandoffs:true,fullHourRelief:true,publication:false}};
}
