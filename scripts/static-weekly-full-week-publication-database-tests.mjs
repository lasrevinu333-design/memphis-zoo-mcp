import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
const container=process.env.ROSTER_PUBLICATION_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_rebuild_roster_[0-9]+$/,'explicit owned test target required');
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
const packetPath=process.env.STATIC_WEEKLY_COVERAGE_PACKET;
assert.ok(packetPath,'exact reviewed local packet path required');
const originalBytes=readFileSync(packetPath),packet=JSON.parse(originalBytes);
assert.equal(packet.packetSchema,'memphis-zoo.static-weekly.verified-schedule-packet.v1');
const source=structuredClone(packet.compilerInput),originalPeople=JSON.stringify(source.slots);
const week=source.serviceDate;
assert.equal(new Date(`${week}T12:00:00Z`).getUTCDay(),1);
const days=Array.from({length:7},(_,i)=>new Date(Date.parse(`${week}T12:00:00Z`)+i*86400000).toISOString().slice(0,10));
const vacancies=[...source.version.vacantSlotIds];assert.equal(vacancies.length,3);
// Future hires are synthetic fixture inputs only; the real packet stays unchanged.
for(const id of vacancies){
 const slot=source.slots.find(s=>s.id===id);assert.ok(slot);
 slot.incumbencies.push({personId:randomUUID(),displayName:'SYNTHETIC FUTURE HIRE',effectiveStart:week,effectiveEnd:null});
 for(const availability of source.version.slotAvailability.filter(a=>a.slotId===id))availability.status='working';
}
source.version.vacantSlotIds=[];source.versions=[source.version];delete source.version;
const q=x=>`'${String(x).replaceAll("'","''")}'`,j=x=>`${q(JSON.stringify(x))}::jsonb`;
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000}).trim();}
const parsed=text=>JSON.parse(sql(text).split('\n').at(-1));let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++;};
const manager=randomUUID();
sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic publication manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);`);
const people=new Map(source.slots.flatMap(s=>s.incumbencies).map(i=>[i.personId,i]));
let employeeNumber=801;
for(const [id,person] of people){
 sql(`insert into public.employees(id,employee_code,display_name,role,active) values(${q(id)},${q('EMP'+employeeNumber++)},${q(person.displayName)},'staff',true);`);
}
const families=new Map();
for(const row of source.versions[0].assignments){
 const family=families.get(row.locationCodeSnapshot)||{id:randomUUID(),name:row.locationNameSnapshot,locations:new Map()};
 for(const item of row.includedLocations||[])family.locations.set(item.locationId,item.locationNameSnapshot);
 families.set(row.locationCodeSnapshot,family);
}
const insertedPlaces=new Set();
for(const [code,family] of families){
 sql(`insert into public.location_groups(id,group_code,group_name,active) values(${q(family.id)},${q(code)},${q(family.name)},true);`);
 for(const [id,name] of family.locations){
  if(!insertedPlaces.has(id)){
   const restroom=/restroom/i.test(name);
   sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(id)},${q('TEST_'+id)},${q(name)},${q(restroom?'restroom':'exhibit')},${q(restroom?'restroom':'exhibit')},true);`);
   insertedPlaces.add(id);
  }
  sql(`insert into public.location_group_memberships(location_group_id,location_id,active) values(${q(family.id)},${q(id)},true);`);
 }
}
console.log('SYNTHETIC_FIXTURES_READY; BEGIN_REGISTER_COMPILE_PUBLISH');
const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:days,source,label:'full-week-publication-integration',mode:'official'});
console.log('ACTUAL_SOURCE_REGISTERED_AND_PROJECTION_MATERIALIZED_IN_TEST_DATABASE');
const projection=fixture.projectionIds[week],result=fixture.compiledByWeek[week];
check('every full-staff assignment has an owner',result.openWork.length,0);
check('no hidden review work',result.reviewWork.length,0);
const document=createStaticWeeklyProjectionWithLunchRpcInput({result,publicationId:fixture.publicationId,expectedRevision:0,actor:{managerId:manager,managerName:'Synthetic publication manager',idempotencyKey:'full-week-lunch'}}).lunchDocument;
const published=parsed(`set role static_weekly_control_plane; select public.static_weekly_v8_materialize_lunch_document(${q(projection)},${j(document)},${q(manager)})::text;`);
check('lunch accepted with actual populated projection',published.persistence_status,'PERSISTED');
check('all scheduled lunches preserved',document.loans.length,45);
let areaMinuteChecks=0;
const karen='3da709bb-2223-4e15-8e3a-db02e3f32e97';
const scheduledPositions=packet.rosterSlots;
for(const day of days){
 const dow=new Date(`${day}T12:00:00Z`).getUTCDay();
 const expected=scheduledPositions.filter(s=>s.days.includes(dow));
 const roster=parsed(`select coalesce(jsonb_agg(to_jsonb(r)),'[]')::text from public.static_weekly_v6_read_roster(${q(day)}) r;`);
 check(day+' roster includes only on-duty positions',roster.length,expected.length);
 check(day+' Karen has corrected days',roster.some(r=>r.employee_id===karen),[1,2,3,5,6].includes(dow));
 check(day+' accepted current authority',parsed(`select row_to_json(a)::text from public.static_weekly_v6_schedule_authority_state(${q(day)}) a`).projection_status,'current');
 const lastEnd=Math.max(...expected.map(s=>Number(s.shift.end.slice(0,2))*60+Number(s.shift.end.slice(3,5))));
 const siteIds=[...new Set(source.versions[0].assignments.filter(r=>r.dayOfWeek===dow&&r.window.start==='09:45'&&r.serviceMode==='scan_tracked').flatMap(r=>(r.includedLocations||[]).map(x=>x.locationId)))];
 const bad=Number(sql(`with work as materialized(select * from public.custodial_operational_location_assignments(${q(day)})), ticks as(select generate_series(585,${lastEnd-1}) as minute), counts as(select minute,count(w.location_id) n,count(distinct w.location_id) distinct_n from ticks left join work w on w.coverage_start<=(time '00:00'+make_interval(mins=>minute)) and (time '00:00'+make_interval(mins=>minute))<w.coverage_end group by minute) select count(*) from counts where n<>${siteIds.length} or distinct_n<>${siteIds.length};`));
 check(day+' persisted lunch and departure coverage has no gap or duplicates',bad,0);
 areaMinuteChecks+=(lastEnd-585)*siteIds.length;
 const today=parsed(`select public.static_weekly_v8_read_lunch_document(${q(day)})::text`);
 check(day+' lunch records match scheduled staff',today.loans.length,expected.length);
}
check('one immutable lunch document persisted',Number(sql('select count(*) from public.weekly_schedule_lunch_documents')),1);
check('normal assignment rows not lost',Number(sql(`select count(*) from public.weekly_schedule_occurrences where projection_id=${q(projection)}`)),source.versions[0].assignments.length);
check('repeating accepted lunch document is idempotent',parsed(`set role static_weekly_control_plane; select public.static_weekly_v8_materialize_lunch_document(${q(projection)},${j(document)},${q(manager)})::text;`).replayed,true);
check('nothing claims a delivered notification',Number(sql('select count(*) from public.employee_native_push_delivery_receipts')),0);
check('no phone invented',Number(sql('select count(*) from public.devices')),0);
assert.deepEqual(readFileSync(packetPath),originalBytes,'production registration packet changed during simulation');
check('actual source still has three real vacancies',JSON.parse(originalBytes).compilerInput.version.vacantSlotIds.length,3);
check('actual incumbent history unchanged',JSON.stringify(JSON.parse(originalBytes).compilerInput.slots),originalPeople);
const evidence={passed,failed:0,sourcePacketSha256:createHash('sha256').update(originalBytes).digest('hex'),daysChecked:7,areaMinuteChecks,assignmentRows:source.versions[0].assignments.length,lunches:document.loans.length,fullStaffSimulation:true,actualSourceVacancies:3,registeredInProduction:false,productionWritten:false,providerSent:false,phoneChanged:false};
if(process.env.ROSTER_PUBLICATION_EVIDENCE_PATH)writeFileSync(process.env.ROSTER_PUBLICATION_EVIDENCE_PATH,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(evidence,null,2));
