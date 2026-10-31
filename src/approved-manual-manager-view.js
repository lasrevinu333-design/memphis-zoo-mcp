import assert from 'node:assert/strict';

const minute=t=>Number(String(t).slice(0,2))*60+Number(String(t).slice(3,5));
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const dayOf=d=>new Date(d+'T12:00:00Z').getUTCDay();

// Display data from an already admitted publication and its actual current
// projection/lunch companion. Ratings do not replace the conserved legacy
// effort budgets, authorize an assignment, or choose an absence objective.
export function approvedManualManagerView({snapshot,source,lunchDocument,projectionAvailability=null}){
 const version=source?.version||source?.versions?.[0],ratings=version?.manualGroupRatingAuthority;
 if(!ratings)return null;
 assert.equal(ratings.schema,'custodial.approved-manual-group-ratings.v1');
 assert.equal(ratings.manifestSha256,'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f');
 assert.equal(ratings.groups.length,23);
 const groups=ratings.groups.map(g=>{
  assert.ok(Number.isInteger(g.score)&&g.score>=1&&g.score<=10);
  const names=new Set(version.assignments.filter(a=>a.locationCodeSnapshot===g.locationCode).map(a=>a.locationNameSnapshot));
  assert.equal(names.size,1);return{code:g.locationCode,name:[...names][0],score:g.score,locationId:g.primaryLocationId};
 });
 assert.equal(new Set(groups.map(g=>g.code)).size,23);assert.equal(groups.reduce((n,g)=>n+g.score,0),136);
 const view={schema:'custodial.approved-manual-manager-view.v1',manifestSha256:ratings.manifestSha256,
  publicationId:snapshot.current_publication?.publication_id??null,projectionId:snapshot.latest_projection?.projection_id??null,
  unit:'group rating points',groups,days:[],changesOwnership:false,effortBudgetsReplaced:false};
 if(snapshot.projection_status!=='current'||!view.projectionId||lunchDocument?.persistence_status!=='PERSISTED')return view;
 assert.equal(lunchDocument.projection_id,view.projectionId);
 const projected=snapshot.latest_projection.assignments,
  availabilityRows=projectionAvailability===null?(snapshot.availability||[]):projectionAvailability.map(a=>({
   slot_id:a.slotId,service_date:a.serviceDate,day_of_week:a.dayOfWeek,availability_state:a.status,
   shift_start:a.shift?.start??null,shift_end:a.shift?.end??null}));
 assert.ok(Array.isArray(projected)&&projected.length>0);
 const codesByWorkId=new Map([...version.assignments,...projected.map(r=>r.work_snapshot)].map(r=>[r.workId,r.locationCodeSnapshot]));
 const dates=[...new Set(projected.map(r=>r.service_date))].sort();
 for(const date of dates){
  const rows=projected.filter(r=>r.service_date===date),loans=lunchDocument.loans.filter(l=>l.service_date===date),
   responsibilities=lunchDocument.responsibilities.filter(r=>r.service_date===date),
   availability=availabilityRows.filter(a=>a.service_date?a.service_date===date:Number(a.day_of_week)===dayOf(date));
  const edges=new Set(rows.flatMap(r=>[minute(r.work_snapshot.window.start),minute(r.work_snapshot.window.end)]));
  const first=Math.min(...edges),last=Math.max(...edges);
  for(const l of loans){edges.add(minute(l.coverage_start));edges.add(minute(l.coverage_end));}
  for(const a of availability){if(a.shift_start)edges.add(minute(a.shift_start));if(a.shift_end)edges.add(minute(a.shift_end));}
  const boundaries=[...edges].filter(m=>m>=first&&m<=last).sort((a,b)=>a-b),phases=[];
  for(let i=0;i<boundaries.length-1;i++){
   const at=boundaries[i],owners=new Map(),notYetStartedGroups=[],completeWindow=ratings.completeCoverageWindows?.find(w=>w.dayOfWeek===dayOf(date)),
    workingStarts=availability.filter(a=>a.availability_state==='working'&&a.shift_start).map(a=>minute(a.shift_start)),
    completeStart=projectionAvailability!==null&&workingStarts.length?Math.max(...workingStarts):completeWindow?minute(completeWindow.start):first,
    completeSiteCoverageRequired=completeStart<=at,liveLoans=loans.filter(l=>l.status==='PLANNED'&&minute(l.coverage_start)<=at&&at<minute(l.coverage_end));
   for(const group of groups){
    const active=rows.filter(r=>r.work_snapshot.locationCodeSnapshot===group.code&&minute(r.work_snapshot.window.start)<=at&&at<minute(r.work_snapshot.window.end));
    if(!active.length&&!completeSiteCoverageRequired){notYetStartedGroups.push(group.code);continue;}
    assert.equal(active.length,1,'A displayed group must retain one current projection row');
    const row=active[0];let slotId=row.owner_slot_id,personId=row.owner_person_id,kind='NORMAL_OR_INHERITED';
    for(const loan of liveLoans){
     if(loan.normal_owner_slot_id!==slotId)continue;
     const relief=responsibilities.filter(r=>r.loan_id===loan.loan_id&&(r.segments||[]).some(s=>codesByWorkId.get(s.workId)===group.code));
     assert.equal(relief.length,1,'Full-hour display requires the accepted named coverer');
     slotId=relief[0].coverer_slot_id;personId=relief[0].coverer_person_id;kind='FULL_HOUR_LUNCH_RELIEF';
    }
    if(row.status!=='assigned'||!slotId)continue;
    const capacity=source.slots.find(s=>s.id===slotId&&s.kind==='CONTRACTOR_CAPACITY');
    if(capacity){assert.equal(capacity.capacityId,slotId);assert.equal(personId,null);assert.deepEqual(capacity.incumbencies,[]);}
    else if(!personId)continue;
    if(!owners.has(slotId))owners.set(slotId,{slotId,personId,...(capacity?{ownerKind:'CONTRACTOR_CAPACITY',capacityId:slotId}:{}),points:0,groups:[],lunchGroups:[]});
    const owner=owners.get(slotId);assert.equal(owner.personId,personId);owner.points+=group.score;owner.groups.push(group.code);
    if(kind==='FULL_HOUR_LUNCH_RELIEF')owner.lunchGroups.push(group.code);
   }
   const activeStaff=availability.filter(a=>a.availability_state==='working'&&a.shift_start&&a.shift_end&&minute(a.shift_start)<=at&&at<minute(a.shift_end)),
    ownerRows=[...owners.values()].sort((a,b)=>a.slotId.localeCompare(b.slotId));
   const phase={start:time(at),end:time(boundaries[i+1]),owners:ownerRows,
    completeSiteCoverageRequired,notYetStartedGroups,
    totalPoints:ownerRows.reduce((n,r)=>n+r.points,0),zooWideCoverage:activeStaff.length===1&&ownerRows.length===1&&ownerRows[0].groups.length===23};
   const previous=phases.at(-1);
   if(previous&&previous.end===phase.start&&JSON.stringify(previous.owners)===JSON.stringify(phase.owners)&&previous.zooWideCoverage===phase.zooWideCoverage&&previous.completeSiteCoverageRequired===phase.completeSiteCoverageRequired&&JSON.stringify(previous.notYetStartedGroups)===JSON.stringify(phase.notYetStartedGroups))previous.end=phase.end;
   else phases.push(phase);
  }
  view.days.push({serviceDate:date,phases});
 }
 return view;
}
