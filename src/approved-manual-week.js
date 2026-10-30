// Read-only adaptation of the exact owner-approved planning packet. This
// produces planning DATA, never a compiler receipt or publication capability.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest} from './static-weekly-schedule-program.js';
import {serviceDateWeekday} from './static-weekly-schedule-model.js';

const DEFAULT_CATALOG=fileURLToPath(new URL('../config/schedules/manual-approved-20261030/catalog.json',import.meta.url));
const ISSUED_MANIFEST_SHA256='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f';
const DAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const HOLDS=['prearrival_ownership','non_monday_0945','weekly_elephant_trunk_restrooms'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length
  &&[...a].sort().every((v,i)=>v===[...b].sort()[i]);
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const minutes=value=>{assert.match(value,/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/,'Exact static clock time required');return Number(value.slice(0,2))*60+Number(value.slice(3));};
const overlap=(a,b)=>minutes(a.start)<minutes(b.end)&&minutes(b.start)<minutes(a.end);
const windowOf=value=>{assert.ok(value&&typeof value==='object');const w={start:value.start,end:value.end};assert.ok(minutes(w.start)<minutes(w.end),'Invalid static window');return w;};
const onShift=(person,time)=>minutes(person.shift.start)<=time&&time<minutes(person.shift.end);
const regularFile=path=>{const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<=1024*1024,'Bounded regular packet file required');return readFileSync(path);};
const memberPath=(root,path)=>{assert.match(path,/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/);const f=resolve(root,path),r=relative(realpathSync(root),realpathSync(f));assert.ok(r&&!r.startsWith('..')&&!isAbsolute(r),'Packet path escaped its verified root');return f;};

export function readApprovedManualWeek({catalogPath=DEFAULT_CATALOG,expectedManifestSha256=ISSUED_MANIFEST_SHA256}={}) {
  const catalog=JSON.parse(regularFile(resolve(catalogPath))),root=resolve(dirname(resolve(catalogPath)),catalog.packetDirectory);
  assert.equal(catalog.schema,'custodial.approved-manual-packet-catalog.v1');
  assert.match(expectedManifestSha256,/^[a-f0-9]{64}$/);assert.equal(catalog.manifestSha256,expectedManifestSha256,'Manifest differs from the independently issued handoff pin');
  assert.equal(catalog.publication.state,'ACTIVATION_HELD');assert.equal(catalog.publication.published,false);
  assert.equal(catalog.publication.effectiveStart,null);assert.deepEqual(catalog.unresolvedPolicies,HOLDS);
  assert.equal(catalog.objectiveNormalization.formula,null);assert.equal(catalog.objectiveNormalization.state,'NOT_APPROVED');
  const contents=new Map();
  for(const row of catalog.files){
    assert.ok(!contents.has(row.path),'Duplicate packet file');
    const bytes=regularFile(memberPath(root,row.path));
    assert.equal(bytes.length,row.bytes,`Packet length changed: ${row.path}`);
    assert.equal(sha(bytes),row.sha256,`Packet bytes changed: ${row.path}`);contents.set(row.path,bytes);
  }
  assert.equal(contents.size,14);assert.equal(sha(contents.get('MANIFEST.json')),catalog.manifestSha256);
  const manifest=JSON.parse(contents.get('MANIFEST.json'));
  assert.equal(manifest.snapshot_id,catalog.packetId);
  for(const row of manifest.files){assert.ok(contents.has(row.path));assert.equal(sha(contents.get(row.path)),row.sha256);assert.equal(contents.get(row.path).length,row.bytes);}
  const source=path=>{assert.ok(contents.has(path),'Source is outside the verified manifest');return JSON.parse(contents.get(path));};
  const ratingSource=source(catalog.ratingsSource),ratings=ratingSource.ratings_in_user_discussion_order.map(r=>({group:r.group,score:r.score}));
  assert.equal(ratings.length,23);assert.equal(new Set(ratings.map(r=>r.group)).size,23);
  for(const r of ratings)assert.ok(typeof r.group==='string'&&r.group.trim()===r.group&&Number.isInteger(r.score)&&r.score>=1&&r.score<=10,'Combined1-10 group rating required');
  const scores=new Map(ratings.map(r=>[r.group,r.score])),inventory=[...scores.keys()],days=[];
  // Rating values are data. Do not freeze this packet's136-point total into
  // the model or reinterpret the new group ratings as old component weights.
  const intent=source(catalog.sourcesByDay.tuesday).scoring_intent;
  const proximityPercent=intent.gps_proximity_percent,loadPercent=intent.difficulty_percent;
  assert.ok(Number.isInteger(proximityPercent)&&Number.isInteger(loadPercent)&&proximityPercent>=0&&loadPercent>=0
    &&proximityPercent+loadPercent===100,'Explicit proximity/load percentage intent required');
  for(const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']){
    const raw=source(catalog.sourcesByDay[day]);assert.equal(raw.timezone,'America/Chicago');
    const employees=raw.employees.map(p=>({name:p.name,shift:windowOf(day==='monday'?p.shift:p.shift_baseline),
      lunch:windowOf(day==='monday'?p.lunch:p.own_lunch_baseline),
      baseGroups:structuredClone(day==='monday'?p.morning_owned_areas:p.requested_base_areas)}));
    const people=new Map(employees.map(p=>[p.name,p]));assert.equal(people.size,employees.length);
    assert.ok(sameSet(employees.flatMap(p=>p.baseGroups),inventory),'Approved bases must own every combined group exactly once');
    for(const p of employees){
      assert.equal(p.name,p.name.trim());assert.equal(minutes(p.lunch.end)-minutes(p.lunch.start),60);
      assert.ok(minutes(p.lunch.start)>=minutes(p.shift.start)&&minutes(p.lunch.end)<=minutes(p.shift.end));
      p.basePoints=p.baseGroups.reduce((n,g)=>n+scores.get(g),0);
    }
    const lunches=raw.lunch_relief_assignments.map(l=>({recipient:l.employee_on_lunch??l.recipient,
      coverer:l.relief_employee??l.coverer,start:l.start,end:l.end,groups:structuredClone(l.areas),retainsOwnBase:true}));
    assert.equal(lunches.length,employees.length);assert.equal(new Set(lunches.map(l=>l.recipient)).size,employees.length);
    for(const l of lunches){
      const p=people.get(l.recipient),c=people.get(l.coverer);assert.ok(p&&c&&p!==c,'Lunch identities must be current staff');
      assert.deepEqual({start:l.start,end:l.end},p.lunch);assert.ok(sameSet(l.groups,p.baseGroups),'Relief must retain all current recipient bases');
      assert.ok(minutes(l.start)>=minutes(c.shift.start)&&minutes(l.end)<=minutes(c.shift.end)&&!overlap(l,c.lunch),'Coverer must be available for the whole hour');
      assert.ok(!lunches.some(other=>other!==l&&other.coverer===l.coverer&&overlap(l,other)),'Coverer relief windows overlap');
    }
    const checkedStart=employees.map(p=>p.shift.start).sort().at(-1),staffedEnd=employees.map(p=>p.shift.end).sort().at(-1);
    const owners=new Map(employees.flatMap(p=>p.baseGroups.map(g=>[g,p.name]))),transfers=[];
    const rawHandoffs=Array.isArray(raw.afternoon_handoffs)?raw.afternoon_handoffs:raw.afternoon_handoffs.assignments;
    const events=new Map();
    for(const h of rawHandoffs){assert.ok(minutes(h.time)>=minutes(checkedStart)&&minutes(h.time)<minutes(staffedEnd));const rows=events.get(h.time)||[];rows.push(h);events.set(h.time,rows);}
    const phases=[{start:checkedStart,owners:Object.fromEntries(owners)}];
    for(const [time,items]of [...events].sort(([a],[b])=>a.localeCompare(b))){
      const before=new Map(owners),moved=new Set(),rows=[];
      for(const h of items){
        if(Array.isArray(h.incoming_additions)){
          for(const added of h.incoming_additions)for(const group of added.areas){
            const from=before.get(group);assert.ok(h.departing_employees.includes(from),'Inherited group must come from a declared departure');
            rows.push({time,from,to:added.employee,group});
          }
        }else for(const t of h.transfers??[h])for(const group of t.areas)rows.push({time,from:t.from,to:t.to,group});
      }
      for(const t of rows){
        assert.ok(!moved.has(t.group)&&before.get(t.group)===t.from,'Handoff changed, duplicated or reversed an accepted owner');moved.add(t.group);
        const donor=people.get(t.from),recipient=people.get(t.to);
        assert.ok(donor&&recipient&&donor.shift.end===time&&onShift(recipient,minutes(time)),'Handoff must use static scheduled departure and a remaining employee');
        owners.set(t.group,t.to);transfers.push({...t,coverage:'INHERITED_ALERTS_AND_ISSUES_ONLY',createsMandatoryCleaningRoute:false});
      }
      for(const name of owners.values())assert.ok(onShift(people.get(name),minutes(time)),'Departed owner remains in the approved phase');
      phases.push({start:time,owners:Object.fromEntries(owners)});
    }
    for(let i=0;i<phases.length;i++){
      const phase=phases[i];phase.end=phases[i+1]?.start??staffedEnd;
      const remaining=employees.filter(p=>onShift(p,minutes(phase.start)));
      phase.zooWideCoverage=remaining.length===1;phase.points={};
      for(const [group,name]of Object.entries(phase.owners)){assert.ok(onShift(people.get(name),minutes(phase.end)-1),'Ownership crosses an unhandled departure');phase.points[name]=(phase.points[name]||0)+scores.get(group);}
    }
    days.push({day,weekday:DAYS.indexOf(day),sourcePath:catalog.sourcesByDay[day],employees,lunches,transfers,phases,
      checkedWindow:{start:checkedStart,end:staffedEnd},prearrivalPolicy:'UNRESOLVED',
      policy0945:day==='monday'?'OWNER_APPROVED_NO_CHANGEOVER':'UNRESOLVED',
      coveragePurpose:'INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING'});
  }
  const body={schema:'custodial.approved-manual-week-data.v1',packetId:catalog.packetId,zipSha256:catalog.zipSha256,
    manifestSha256:catalog.manifestSha256,timezone:'America/Chicago',ratings,
    ratingUnit:'COMBINED_GROUP_OWNER_RATING_1_TO_10_NOT_MINUTES',
    proximityIntent:structuredClone(ratingSource.proximity_planning),absenceRequirement:structuredClone(ratingSource.absence_recalculation_requirement),
    objective:{proximityPercent,loadPercent,normalizedFormula:null,formulaApproved:false},days,
    runtimeBinding:{state:'NOT_YET_BOUND_TO_CANONICAL_SOURCE',registeredSourceId:null},
    activation:{state:'HELD',unresolvedPolicies:[...HOLDS],effectiveStart:null,published:false},receiptEligible:false};
  return freeze({...body,dataDigest:postgresJsonbContentDigest(body)});
}

export function previewApprovedManualDay(week,{day,serviceDate,time}) {
  assert.equal(week?.schema,'custodial.approved-manual-week-data.v1');
  const datedDay=serviceDate==null?null:DAYS[serviceDateWeekday(serviceDate)];
  if(day!=null&&datedDay!=null)assert.equal(day,datedDay,'Manual weekday differs from the selected date');
  const selected=day??datedDay,plan=week.days.find(d=>d.day===selected);assert.ok(plan,'Unknown manual weekday');
  const at=minutes(time),start=minutes(plan.checkedWindow.start),end=minutes(plan.checkedWindow.end);
  const common={schema:'custodial.approved-manual-day-preview.v1',day:plan.day,dataDigest:week.dataDigest,
    activation:'HELD',published:false,receiptEligible:false,unresolvedPolicies:[...HOLDS]};
  if(at<start)return {...common,status:'PREARRIVAL_POLICY_UNRESOLVED',owners:[]};
  if(at>=end)return {...common,status:'OUTSIDE_STAFFED_COVERAGE',owners:[]};
  const phase=plan.phases.find(p=>minutes(p.start)<=at&&at<minutes(p.end)),base=new Map(plan.employees.flatMap(p=>p.baseGroups.map(g=>[g,p.name])));
  const live=new Map(Object.entries(phase.owners).map(([group,employee])=>[group,{group,employee,
    reason:base.get(group)===employee?'BASE':'INHERITED_ALERTS_AND_ISSUES_ONLY'}]));
  const activeLunches=plan.lunches.filter(l=>minutes(l.start)<=at&&at<minutes(l.end));
  for(const l of activeLunches)for(const group of l.groups){assert.equal(live.get(group).employee,l.recipient);live.set(group,{group,employee:l.coverer,reason:'FULL_HOUR_LUNCH_RELIEF'});}
  for(const row of live.values()){
    const p=plan.employees.find(p=>p.name===row.employee);assert.ok(p&&onShift(p,at));
    assert.ok(!activeLunches.some(l=>l.recipient===row.employee),'Employee on lunch still owns a current group');
  }
  return {...common,status:'APPROVED_PLANNING_PREVIEW_ONLY',owners:[...live.values()],
    zooWideCoverage:phase.zooWideCoverage,createsMandatoryInheritedCleaningRoutes:false};
}
