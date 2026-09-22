/** Derived lunch-responsibility candidate from the verified static-weekly result.
 * This never rewrites normal assignments, due-check clocks, or production data.
 * Database publication and notification delivery must admit this separate layer.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, normalizeWindow } from './static-weekly-schedule-model.js';
import { generateStaticWeeklySchedulingProgram, STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE,
  weekdayDate } from './static-weekly-schedule-program.js';
import { verifyStaticWeeklyScheduleResult } from './static-weekly-schedule-verifier.js';

export const LUNCH_COVERAGE_SCHEMA = 'memphis-zoo.static-weekly-lunch-candidate.v1';
const POLICY = 'owner-20260921-two-nearby-full-hour-v1';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const clone = value => structuredClone(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\u0000-\u001f]/.test(value);
const overlap = (a, b) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;
const contains = (a, b) => a.startMinute <= b.startMinute && b.endMinute <= a.endMinute;
const minuteTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const windowOf = value => normalizeWindow(value, 'lunch responsibility window');
const scoreCompare = (a, b) => a.cost - b.cost || compare(a.owners.join('\0'), b.owners.join('\0'));

/** Exact minimum-distance partition into TWO used helpers; no phantom second helper.
 * Costs must already come from verified normal-area proximity and eligibility.
 * A four-state dynamic program proves both chosen people receive an intact area.
 */
export function partitionLunchAreas(areaCosts, availableSlotIds) {
  if (!Array.isArray(areaCosts) || areaCosts.length > 128 || !Array.isArray(availableSlotIds)
    || availableSlotIds.length > 32) fail('lunch_partition_limit');
  const slots = [...availableSlotIds].sort(compare);
  if (slots.some(value => !id(value)) || new Set(slots).size !== slots.length) fail('lunch_slot_identity_invalid');
  const areas = areaCosts.map(row => ({ areaId: row.areaId, costs: { ...row.costs } })).sort((a,b)=>compare(a.areaId,b.areaId));
  if (areas.some(row=>!id(row.areaId)) || new Set(areas.map(row=>row.areaId)).size !== areas.length) fail('lunch_area_identity_invalid');
  for (const row of areas) for (const [slot, cost] of Object.entries(row.costs)) {
    if (!slots.includes(slot) || !Number.isSafeInteger(cost) || cost < 0 || cost > 1440) fail('lunch_proximity_cost_invalid');
  }
  if (!areas.length) return { status: 'NO_AREAS', helperSlotIds: [], assignments: [], totalDistance: 0 };
  const eligible = slots.filter(slot => areas.some(area=>Object.hasOwn(area.costs,slot)));
  const required = Math.min(2, eligible.length);
  if (!required) return { status: 'REVIEW_REQUIRED', reason: 'no_eligible_nearby_custodian', helperSlotIds: [], assignments: [] };
  if (required > areas.length) return { status: 'REVIEW_REQUIRED', reason: 'indivisible_area_cannot_use_two_custodians', helperSlotIds: [], assignments: [] };
  const pairs = required === 1 ? [[eligible[0]]]
    : eligible.flatMap((left,i)=>eligible.slice(i+1).map(right=>[left,right]));
  let best = null;
  for (const pair of pairs) {
    let states = new Map([[0, { cost: 0, owners: [] }]]);
    for (const area of areas) {
      const next = new Map();
      for (const [mask,state] of states) for (let i=0;i<pair.length;i++) {
        const slot=pair[i];
        if (!Object.hasOwn(area.costs,slot)) continue;
        const candidate={cost:state.cost+area.costs[slot],owners:[...state.owners,slot]};
        const newMask=mask|(1<<i),prior=next.get(newMask);
        if (!prior || scoreCompare(candidate,prior)<0) next.set(newMask,candidate);
      }
      states=next;
    }
    const candidate=states.get((1<<pair.length)-1);
    if (candidate && (!best || scoreCompare(candidate,best)<0)) best={...candidate,pair};
  }
  if (!best) return { status: 'REVIEW_REQUIRED', reason: 'no_eligible_two_person_partition', helperSlotIds: [], assignments: [] };
  return {status:'PLANNED',helperSlotIds:best.pair,helperCount:required,
    fallback:required===1?'only_one_eligible_custodian':null,totalDistance:best.cost,
    assignments:areas.map((area,i)=>({areaId:area.areaId,covererSlotId:best.owners[i],distance:area.costs[best.owners[i]]}))};
}

function lunchAreas(rows, byWork, lunch) {
  const selected = [];
  for (const row of rows) {
    const work=byWork.get(row.planWorkId);
    if (!work || work.schedulingMode!==STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE
      || work.serviceMode==='reminder_only' || !overlap(windowOf(row.window),lunch)) continue;
    const ownWindow=windowOf(row.window);
    selected.push({row,work,locations:work.includedLocations.map(location=>location.locationId),
      start:Math.max(ownWindow.startMinute,lunch.startMinute),end:Math.min(ownWindow.endMinute,lunch.endMinute)});
  }
  // Shared members bind the complete restroom package; never split men/women.
  const groups=[];
  for (const entry of selected.sort((a,b)=>compare(a.row.planWorkId,b.row.planWorkId))) {
    const matches=groups.filter(group=>entry.locations.some(location=>group.locations.has(location)));
    const group=matches[0] || {entries:[],locations:new Set()};
    if (!matches.length) groups.push(group);
    for (const match of matches.slice(1)) {
      group.entries.push(...match.entries);for(const location of match.locations)group.locations.add(location);
      groups.splice(groups.indexOf(match),1);
    }
    group.entries.push(entry);for(const location of entry.locations)group.locations.add(location);
  }
  return groups.map(group=>{
    group.entries.sort((a,b)=>compare(a.row.planWorkId,b.row.planWorkId));
    return {...group,areaId:digest(group.entries.map(entry=>({work:entry.row.planWorkId,start:entry.start,end:entry.end}))),
      routingLocations:[...new Set(group.entries.map(entry=>entry.work.locationId))].sort(compare)};
  }).sort((a,b)=>compare(a.areaId,b.areaId));
}

function normalAnchors(rows, byWork, lunch) {
  return [...new Set(rows.filter(row=>{
    const work=byWork.get(row.planWorkId);
    return work?.schedulingMode===STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE
      && work.serviceMode!=='reminder_only' && overlap(windowOf(row.window),lunch);
  }).map(row=>row.locationId))].sort(compare);
}

function availableForLunch(context, lunch) {
  if (!context || context.availability.status!=='working' || !contains(windowOf(context.availability.shift),lunch)) return false;
  const availability=context.availability;
  if (!Array.isArray(availability.qualifications) || !availability.qualificationProvenance
    || !Array.isArray(availability.restrictions) || !availability.restrictionProvenance) return false;
  if (!availability.lunch) return false;
  const helperLunch=windowOf(availability.lunch);
  if(helperLunch.endMinute-helperLunch.startMinute!==60 || !contains(windowOf(availability.shift),helperLunch) || overlap(helperLunch,lunch)) return false;
  return !(availability.blockedWindows||[]).some(window=>overlap(windowOf(window),lunch));
}

function costForArea(area, slotId, context, anchors, edges) {
  const qualified=new Set(context.availability.qualifications),restricted=new Set(context.availability.restrictions);
  for(const entry of area.entries) {
    if ((entry.work.restrictedSlotIds||[]).includes(slotId)
      || entry.locations.some(location=>restricted.has(location))
      || entry.work.requiredQualifications.some(value=>!qualified.has(value))) return null;
  }
  let cost=0;const evidence=[];
  for(const target of area.routingLocations) {
    let best=null;
    for(const anchor of anchors) {
      const edge=anchor===target?{minutes:0,verified:true,provenance:'same_normal_assigned_area'}:edges.get(`${anchor}\0${target}`);
      if(!edge || edge.verified!==true || !edge.provenance || !Number.isSafeInteger(edge.minutes) || edge.minutes<0)continue;
      if(!best || edge.minutes<best.minutes || edge.minutes===best.minutes && compare(anchor,best.fromLocationId)<0)
        best={fromLocationId:anchor,toLocationId:target,minutes:edge.minutes,provenance:edge.provenance};
    }
    if(!best)return null;
    cost=Math.max(cost,best.minutes);evidence.push(best);
  }
  return {cost,evidence};
}

/** Internal pure derivation. Call the verified-result wrapper at trust boundaries. */
export function deriveLunchCoverageFromPreparedProblem(problem, weeklyAssignments) {
  if (!(problem?.states instanceof Map) || !(problem?.edges instanceof Map)
    || !(problem?.incumbencyByDaySlot instanceof Map) || !Array.isArray(problem.work)
    || !Array.isArray(weeklyAssignments)) fail('lunch_verified_problem_required');
  const byWork=new Map(problem.work.map(work=>[work.key,work]));
  const assigned=weeklyAssignments.filter(row=>row.status==='ASSIGNED');
  const lunches=[];
  for(const [day,state] of [...problem.states].sort(([a],[b])=>a-b)) {
    const dayRows=assigned.filter(row=>row.dayOfWeek===day);
    const rowsBySlot=new Map(problem.slots.map(slot=>[slot.id,dayRows.filter(row=>row.slotId===slot.id)]));
    for(const [ownerSlotId,availability] of [...state.availability].sort(([a],[b])=>compare(a,b))) {
      if(availability.status!=='working')continue;
      const incumbent=problem.incumbencyByDaySlot.get(`${day}\0${ownerSlotId}`);
      if(!incumbent?.personId)continue;
      const serviceDate=weekdayDate(problem.serviceDate,day);
      if(!availability.lunch) {
        lunches.push({serviceDate,dayOfWeek:day,normalOwnerSlotId:ownerSlotId,normalOwnerPersonId:incumbent.personId,
          loanId:digest({policy:POLICY,input:problem.inputDigest,serviceDate,ownerSlotId,missingLunch:true}),window:null,
          status:'REVIEW_REQUIRED',reason:'scheduled_lunch_missing',helperSlotIds:[],responsibilities:[],notificationIntents:[]});
        continue;
      }
      const lunch=windowOf(availability.lunch);
      const base={serviceDate,dayOfWeek:day,normalOwnerSlotId:ownerSlotId,normalOwnerPersonId:incumbent.personId,
        window:{start:lunch.start,end:lunch.end},loanId:digest({policy:POLICY,input:problem.inputDigest,serviceDate,ownerSlotId,start:lunch.start,end:lunch.end})};
      if(lunch.endMinute-lunch.startMinute!==60 || !contains(windowOf(availability.shift),lunch)) {
        lunches.push({...base,status:'REVIEW_REQUIRED',reason:'scheduled_lunch_must_be_one_hour_within_shift',responsibilities:[]});continue;
      }
      const areas=lunchAreas(rowsBySlot.get(ownerSlotId)||[],byWork,lunch);
      const contexts=new Map(),costRows=areas.map(area=>({areaId:area.areaId,costs:Object.create(null)})),evidence=new Map();
      for(const slot of problem.slots) {
        if(slot.id===ownerSlotId)continue;
        const context=problem.availabilityByDaySlot.get(`${day}\0${slot.id}`);
        const person=problem.incumbencyByDaySlot.get(`${day}\0${slot.id}`);
        if(!person?.personId || !availableForLunch(context,lunch))continue;
        const anchors=normalAnchors(rowsBySlot.get(slot.id)||[],byWork,lunch);
        if(!anchors.length)continue;
        contexts.set(slot.id,{...context,person});
        for(let i=0;i<areas.length;i++) {
          const proximity=costForArea(areas[i],slot.id,context,anchors,problem.edges);
          if(proximity){costRows[i].costs[slot.id]=proximity.cost;evidence.set(`${areas[i].areaId}\0${slot.id}`,proximity.evidence);}
        }
      }
      const partition=partitionLunchAreas(costRows,[...contexts.keys()]);
      const responsibilities=(partition.assignments||[]).map(item=>{
        const area=areas.find(area=>area.areaId===item.areaId),person=contexts.get(item.covererSlotId).person;
        return {responsibilityId:digest({loanId:base.loanId,areaId:area.areaId,covererSlotId:item.covererSlotId}),
          areaId:area.areaId,covererSlotId:item.covererSlotId,covererPersonId:person.personId,
          normalOwnerSlotId:ownerSlotId,normalOwnerPersonId:incumbent.personId,
          coveragePurpose:'lunch_coverage',proximityEvidence:evidence.get(`${area.areaId}\0${item.covererSlotId}`),
          checkDeadlinePolicy:'inherit_existing_90_minute_deadline',createsDeepClean:false,
          segments:area.entries.map(entry=>({planWorkId:entry.row.planWorkId,workId:entry.row.workId,
            serviceMode:entry.work.serviceMode,window:{start:minuteTime(entry.start),end:minuteTime(entry.end)},
            includedLocations:clone(entry.work.includedLocations)}))};
      });
      lunches.push({...base,status:partition.status,reason:partition.reason||null,
        helperSlotIds:partition.helperSlotIds,fallback:partition.fallback||null,totalDistance:partition.totalDistance??null,
        responsibilities,notificationIntents:partition.helperSlotIds.map(slot=>({covererSlotId:slot,
          startKey:digest({loanId:base.loanId,slot,event:'start'}),endKey:digest({loanId:base.loanId,slot,event:'end'}),
          startTime:lunch.start,endTime:lunch.end,deliveryState:'NOT_ENQUEUED'}))});
    }
  }
  return {schema:LUNCH_COVERAGE_SCHEMA,policy:POLICY,publicationAuthority:'NOT_PUBLISHED',
    status:lunches.some(lunch=>lunch.status==='REVIEW_REQUIRED')?'REVIEW_REQUIRED':'PLANNED',
    sourceInputDigest:problem.inputDigest,weekStart:problem.serviceDate,lunches};
}

export function createStaticWeeklyLunchCoverageCandidate(input, result) {
  if(!result?.canonicalAuthority || !result.authorityDigest || !result.replayDigest)fail('lunch_complete_base_authority_required');
  const verification=verifyStaticWeeklyScheduleResult(input,result);
  if(!verification.ok || result.status!=='FEASIBLE' || result.publicationAuthority!=='ACCEPTABLE')
    fail('lunch_base_schedule_not_verified');
  const program=generateStaticWeeklySchedulingProgram(input);
  if(program.error || program.problem.inputDigest!==result.inputDigest)fail('lunch_base_schedule_identity_mismatch');
  const candidate={...deriveLunchCoverageFromPreparedProblem(program.problem,result.weeklyAssignments),
    baseAuthorityDigest:result.authorityDigest,baseReplayDigest:result.replayDigest};
  return {...candidate,candidateDigest:digest(candidate)};
}

export function verifyStaticWeeklyLunchCoverageCandidate(input,result,candidate) {
  try {
    const expected=createStaticWeeklyLunchCoverageCandidate(input,result);
    return {ok:canonicalJson(expected)===canonicalJson(candidate),expectedDigest:expected.candidateDigest};
  }catch(error){return {ok:false,reason:error.code||'lunch_candidate_invalid'};}
}
