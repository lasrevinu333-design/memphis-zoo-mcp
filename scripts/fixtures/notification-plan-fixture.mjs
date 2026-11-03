// Disposable network-none migrated database only. Real official compiler,
// roster/projection and accepted lunch RPCs own their output. Only the final
// recurring target INSERT is an explicit synthetic acceptance boundary; no
// manager recurring-confirmation/native-send/physical evidence is claimed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {seedCompiledEventAuthority} from './event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../../src/static-weekly-lunch-publication.js';
import {outcomeCredentialSeed} from '../original-delivery-outcome-http-tests.mjs';
const q=value=>`'${String(value).replaceAll("'","''")}'`,j=value=>`${q(JSON.stringify(value))}::jsonb`;
export async function seedNormalNotificationPlanFixture({client,container}){
 const sql=async statement=>{const all=await client.query(statement),result=Array.isArray(all)?all.at(-1):all;
   await client.query('reset role'); // Success only: caller finally rolls back original SQL failures.
   return result.rows.map(row=>{const value=Object.values(row)[0];return typeof value==='string'?value:JSON.stringify(value);}).join('\n');
  };
 const serviceDate=(await client.query('select public.sch_service_date(clock_timestamp())::text as service_date')).rows[0].service_date;
 const serviceDay=new Date(`${serviceDate}T12:00:00Z`),dayOfWeek=serviceDay.getUTCDay(),weekStartDate=new Date(serviceDay);
 weekStartDate.setUTCDate(weekStartDate.getUTCDate()-((dayOfWeek+6)%7));const week=weekStartDate.toISOString().slice(0,10),manager=randomUUID();
const slots=['a','b','c','d'].map((key,i)=>({key,id:randomUUID(),person:randomUUID(),name:`Synthetic lunch ${i}`}));
const codes=['W','E','B','B2','C','C2','D','D2'];
const locations=Object.fromEntries(codes.map(code=>[code,{id:randomUUID(),group:randomUUID(),code:`LUNCH_${code}`} ]));
const ownerCodes=[['W','E'],['B','B2'],['C','C2'],['D','D2']];
const lunches=[['12:00','13:00'],['12:30','13:30'],['10:00','11:00'],['14:00','15:00']];
await sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic lunch manager');`);
for(const slot of slots)await sql(`insert into public.employees(id,employee_code,display_name,role) values(${q(slot.person)},${q('EMP'+BigInt('0x'+slot.person.replaceAll('-','')).toString(10))},${q(slot.name)},'staff');`);
for(const location of Object.values(locations))await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type)
 values(${q(location.id)},${q(location.code)},${q(location.code)},'restroom','restroom');
 insert into public.location_groups(id,group_code,group_name) values(${q(location.group)},${q(location.code)},${q(location.code)});
 insert into public.location_group_memberships(location_group_id,location_id) values(${q(location.group)},${q(location.id)});`);
const source={serviceDate:week,timezone:'America/Chicago',exceptions:[],
 slots:slots.map(s=>({id:s.id,label:s.name,incumbencies:[{personId:s.person,displayName:s.name,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
 proximity:codes.flatMap(from=>codes.filter(to=>from!==to).map(to=>({from:locations[from].id,to:locations[to].id,
  minutes:(from==='B'&&to==='W')||(from==='C'&&to==='E')?1:10,verified:true,provenance:'synthetic geometry'}))),
 versions:[{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:week,effectiveEnd:null,
 objective:{requireVerifiedProximity:true},slotAvailability:slots.map((s,i)=>({slotId:s.id,dayOfWeek,status:'working',
 shift:{start:'07:00',end:'17:00'},lunch:{start:lunches[i][0],end:lunches[i][1]},
 productiveCapacityProvenance:'fixture-shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'fixture-capacity',
 qualifications:['general'],qualificationProvenance:'fixture-role',restrictions:[],restrictionProvenance:'fixture-restrictions',
 acceptedRouteAnchorLocationId:locations[ownerCodes[i][0]].id,acceptedRouteProvenance:'fixture-normal-area'})),
 assignments:slots.flatMap((s,i)=>ownerCodes[i].map(code=>({workId:code,dayOfWeek,ownerSlotId:s.id,
 locationId:locations[code].id,locationCodeSnapshot:locations[code].code,locationNameSnapshot:locations[code].code,
 includedLocations:[{locationId:locations[code].id,locationNameSnapshot:locations[code].code}],
 schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:'16:00'},serviceEffortMinutes:20,
 serviceEffortProvenance:'fixture-effort',priority:2,priorityProvenance:'fixture-priority',requiredQualifications:['general'],
 qualificationProvenance:'fixture-work-role',restrictions:[],restrictionProvenance:'fixture-work-restrictions'})))}]};
const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[serviceDate],source,label:'lunch-publication-test',mode:'official'});
const projectionId=fixture.projectionIds[week],result=fixture.compiledByWeek[week];

 const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result,publicationId:fixture.publicationId,expectedRevision:0,
  actor:{managerId:manager,managerName:'Synthetic lunch manager',idempotencyKey:'synthetic-notification-plan'}});
 await sql(`set role static_weekly_control_plane;select public.static_weekly_v8_materialize_lunch_document(${q(projectionId)}::uuid,${j(prepared.lunchDocument)},${q(manager)}::uuid)::text;`);
 const original=(await client.query("select to_jsonb(d) value from public.devices d where device_id='KIOSK_08'")).rows[0]?.value??null;
 const device=original?.id??randomUUID(),employee=slots[1].person,credential=randomUUID(),seed=outcomeCredentialSeed(),intent=randomUUID(),operation=randomUUID();
 await client.query('begin');
 try{
  await client.query('set local session_replication_role=replica');
  if(original)await client.query('update public.devices set active=true,assigned_employee_id=$2,assignment_epoch=7 where id=$1',[device,employee]);
  else await client.query("insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)values($1,'KIOSK_08','Synthetic notification-plan phone',true,$2,7)",[device,employee]);
  await client.query("insert into public.device_auth_credentials(credential_id,device_id,token_hash,metadata_json,confirmed_at,expires_at) values($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+interval '1 day')",[credential,device,seed.hash,seed.metadata]);
  await client.query(`insert into public.static_weekly_recurring_application_intents(intent_id,operation_id,publication_id,projection_id,
   service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   select $1,$2,a.publication_id,a.projection_id,$3,$4,$5,$6,7,a.projection_authority_revision,l.document_identity,v.body,public.static_weekly_digest_jsonb(v.body),
    t.body,public.static_weekly_digest_jsonb(t.body)
   from public.static_weekly_v6_schedule_authority_state($3) a
   join public.weekly_schedule_lunch_documents l on l.projection_id=a.projection_id
   cross join lateral(select public.static_weekly_v22_recurring_render_view(a.projection_id,$3,$4) body) v
   cross join lateral(select jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',$2::uuid,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',$3::date,'authorityRevision',a.projection_authority_revision,
    'lunchDocumentIdentity',l.document_identity,'employeeId',$4::uuid,'deviceId',$5::uuid,'credentialId',$6::uuid,'assignmentEpoch',7,'viewDigest',public.static_weekly_digest_jsonb(v.body)) body)t
   where a.projection_status='current'`,[intent,operation,serviceDate,employee,device,credential]);
  const datedOperation=randomUUID(),datedIntent=randomUUID();
  await client.query(`insert into public.static_weekly_staffing_commands(operation_id,command_kind,employee_id,start_date,end_date,absence_kind,
   semantic_body,semantic_digest,client_prepare_key,expected_revision,prepared_by_manager_id,state,accepted_revision,accepted_receipt,accepted_at,
   confirmation_key,confirmed_by_manager_id,authority_command_id)
   values($1,'absence',$2,$3,$3,'daily_absence','{}',repeat('a',64),$4,0,$5,'ACCEPTED',1,'{}',clock_timestamp(),
    $6,$5,$1)`,[datedOperation,employee,serviceDate,randomUUID(),manager,randomUUID()]);
  await client.query(`insert into public.static_weekly_schedule_application_intents(intent_id,operation_id,service_date,employee_id,device_id,credential_id,
   assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity)
   select $1,$2,service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity
   from public.static_weekly_recurring_application_intents where intent_id=$3`,[datedIntent,datedOperation,intent]);
  // Committed only inside this network-none disposable database, permitting
  // genuine separate-transaction row-lock races. These are synthetic dated
  // propagation boundary rows, not accepted staffing/publication evidence.
  await client.query('commit');
  fixture.datedIntent=datedIntent;fixture.datedOperation=datedOperation;
 }catch(error){await client.query('rollback');throw error;}
 const delivery=(await client.query('select public.static_weekly_v22_read_recurring_application_target($1,$2,$3,$4,7) data',[serviceDate,device,credential,employee])).rows[0].data;
 assert.equal(delivery.intentId,intent);assert.ok(delivery.view.raw_items.length>0);
 return {serviceDate,device,employee,credential,epoch:7,intent,projectionId,manager,slots,locations,fixture,delivery,originalDevice:original,
  datedIntent:fixture.datedIntent,datedOperation:fixture.datedOperation,seedScope:'official compiler/accepted projection+lunch; synthetic final recurring target only; committed disposable fixtures; Root must destroy isolated database'};
}
