import assert from 'node:assert/strict';
import {week,args,result} from './approved-manual-native-template-tests.mjs';
import {approvedManualManagerView} from '../src/approved-manual-manager-view.js';

const projectionId='00000000-0000-4000-8000-000000001003',source=args.currentSource,
 snapshot={projection_status:'current',current_publication:{publication_id:source.version.publicationId},
  latest_projection:{projection_id:projectionId,assignments:result.initialBaseline.projection.assignments},
  availability:result.projectionAvailability.map(a=>({slot_id:a.slotId,service_date:a.serviceDate,availability_state:a.status,
   shift_start:a.shift?.start??null,shift_end:a.shift?.end??null}))},
 lunchDocument={...structuredClone(result.lunchDocument),projection_id:projectionId,persistence_status:'PERSISTED'},
 view=approvedManualManagerView({snapshot,source,lunchDocument});
assert.equal(view.groups.length,23);assert.equal(view.days.length,7);assert.equal(view.effortBudgetsReplaced,false);
for(const day of view.days)for(const phase of day.phases){assert.equal(phase.totalPoints,136);assert.equal(phase.owners.flatMap(o=>o.groups).length,23);}
const slot=name=>args.currentOwnerConfig.slots[name].slotId,
 phase=(date,time)=>view.days.find(d=>d.serviceDate===date).phases.find(p=>p.start<=time&&time<p.end),
 points=(date,time,name)=>phase(date,time).owners.find(o=>o.slotId===slot(name))?.points??0;
assert.equal(points('2026-11-02','08:00','TAMMY'),24);
assert.equal(points('2026-11-06','15:00','KILTRA'),67);assert.equal(points('2026-11-06','15:00','ALIJAH'),69);
for(const [name,n]of [['ALIJAH',45],['KILTRA',52],['XAVIER',39]])assert.equal(points('2026-11-07','15:00',name),n);
for(const [name,n]of [['ALIJAH',36],['KILTRA',35],['DERRICK',36],['XAVIER',29]])assert.equal(points('2026-11-08','15:00',name),n);
assert.ok(view.days.flatMap(d=>d.phases).some(p=>p.owners.some(o=>o.lunchGroups.length>0)));
for(const date of ['2026-11-02','2026-11-03','2026-11-04','2026-11-07','2026-11-08']){
 const end=phase(date,'16:00');assert.equal(end.zooWideCoverage,true);assert.equal(end.owners[0].slotId,slot('XAVIER'));assert.equal(end.owners[0].points,136);
}
for(const date of ['2026-11-05','2026-11-06'])assert.equal(view.days.find(d=>d.serviceDate===date).phases.at(-1).end,'16:00');
const bad=structuredClone(lunchDocument);bad.responsibilities=[];assert.throws(()=>approvedManualManagerView({snapshot,source,lunchDocument:bad}),/accepted named coverer/);
const legacy=structuredClone(source);delete legacy.version.manualGroupRatingAuthority;assert.equal(approvedManualManagerView({snapshot,source:legacy,lunchDocument}),null);
assert.equal(approvedManualManagerView({snapshot:{...snapshot,projection_status:'stale'},source,lunchDocument}).days.length,0);
console.log(JSON.stringify({marker:'APPROVED_MANUAL_MANAGER_VIEW_PASS',groups:23,days:7,fullHourReliefIncluded:true,
 conservedPointsPerPhase:136,acceptedClosingLoadsPreserved:true,zooWideWhenOnlyEmployeeRemains:true,legacyBudgetsUntouched:true}));
