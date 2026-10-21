// Control-plane transaction + authenticated HTTP/PDF contract with a synthetic
// database adapter. The separately hooked disposable SQL fixture proves the
// real RPC/grants; this file never implies a production or physical handout.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {createCoverAllPrintDocument} from '../src/static-weekly-coverall-print.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';

const day='2026-10-05',week=day;
const id={manager:'10000000-0000-4000-8000-000000000091',foreign:'10000000-0000-4000-8000-000000000092',
 capacity:'20000000-0000-4000-8000-000000000091',group:'30000000-0000-4000-8000-000000000091',
 physical:'40000000-0000-4000-8000-000000000091',event:'50000000-0000-4000-8000-000000000091',
 projection:'71000000-0000-4000-8000-000000000091',publication:'70000000-0000-4000-8000-000000000091',
 version:'60000000-0000-4000-8000-000000000091'};
const SAFE='Set extra trash boxes at the accepted restroom.';
const PRIVATE='PRIVATE MANAGER SOURCE NOTE - never print';
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
let checks=0;
const fixture=()=>({
 snapshot:{authority_revision:7,projection_status:'current',
  current_publication:{publication_id:id.publication,version_id:id.version},
  exceptions:[{type:'cover_all',serviceDate:day,payload:{availability:{slotId:id.capacity,
   shift:{start:'07:00',end:'15:00'},breakChoice:'NONE'}}}],roster:[],
  latest_projection:{projection_id:id.projection,publication_id:id.publication,version_id:id.version,
   week_start:week,week_end:'2026-10-11',replay_digest:'a'.repeat(64),assignments:[{
    plan_work_id:'accepted-capacity-work',service_date:day,status:'assigned',owner_slot_id:id.capacity,
    owner_kind:'CONTRACTOR_CAPACITY',capacity_id:id.capacity,owner_person_id:null,
    work_snapshot:{window:{start:'08:00',end:'09:00'},serviceMode:'scan_tracked',
     locationNameSnapshot:'Accepted restroom group',includedLocations:[
      {locationId:id.physical,locationNameSnapshot:'Accepted restroom'}]}}]}},
 source:{publication_id:id.publication,version_id:id.version,compiler_input:{slots:[{
  id:id.capacity,capacityId:id.capacity,label:'CoverAll01',kind:'CONTRACTOR_CAPACITY',
  contractorCapacity:true,incumbencies:[]}]}},
 lunch:{persistence_status:'PERSISTED',projection_id:id.projection,
  document_identity:'b'.repeat(64),service_date:day,loans:[],responsibilities:[]},
});
const state=fixture();
const manager={manager_id:id.manager,display_name:'Synthetic named manager',roles:['OPS_MANAGER'],active:true,is_system_principal:false,system_key:'eric_custodial_manager'};
const issuer={managerId:id.manager,managerName:manager.display_name};
const acceptedPrint=()=>createCoverAllPrintDocument({snapshot:state.snapshot,source:state.source,
 lunch:state.lunch,serviceDate:day,expectedRevision:7,projectionId:id.projection,issuingManager:issuer});
let eventRevision=3,eventStatus='SCHEDULED',eventNotes=SAFE,singleReads=0,mutateOnSingleRead=0;
let snapshotReads=0,mutateOnSnapshotRead=0;
let queryLog=[],actorReads=0,revokeOnActorRead=0;
const candidate=(print)=>({schema:'custodial.coverall-event-brief-candidate.v1',
 status:'PREVIEW_ONLY',disclosure_approved:false,manager_id:id.manager,capacity_slot_id:id.capacity,
 service_date:day,projection_id:id.projection,publication_id:id.publication,
 authority_revision:7,projection_replay_digest:print.replayDigest,
 lunch_document_identity:print.lunchDocumentIdentity,print_document_digest:print.documentDigest,
 event_id:id.event,event_revision:eventRevision,event_name:'Synthetic evening event',
 display_location:'Accepted Event venue',event_date:day,
 start_instant_utc:'2026-10-06T00:00:00Z',end_instant_utc:'2026-10-06T01:00:00Z',
 start_time:'19:00:00',end_time:'20:00:00',custodial_note_codes:['trash_boxes'],
 custodial_public_notes:eventNotes,matched_areas:[{location_group_id:id.group,
  group_name:'Accepted restroom group',starts:'08:00',ends:'09:00',
  included_location_ids:[id.physical],purpose:'area_owner'}]});
const unavailable=status=>({schema:'custodial.coverall-event-brief-candidate.v1',
 status,disclosure_approved:false});
const client={
 async query(statement,values=[]){
  const q=String(statement);queryLog.push(q);
  if(q.includes('custodial_action_actor_v1')){
   actorReads++;if(actorReads===revokeOnActorRead)device.revoked_at=new Date().toISOString();
   if(device.revoked_at||values[0]!==device.manager_id)throw Object.assign(Error('Current manager revoked'),{code:'42501'});
   return {rows:[{result:{manager_id:values[0],manager_name:device.manager.display_name}}]};
  }
  if(q.includes('static_weekly_v3_read_manager_snapshot')){
   snapshotReads++;
   if(snapshotReads===mutateOnSnapshotRead)state.snapshot.authority_revision++;
   return {rows:[{result:structuredClone(state.snapshot)}]};
  }
  if(q.includes('static_weekly_v3_read_publication_source'))return {rows:[{result:structuredClone(state.source)}]};
  if(q.includes('static_weekly_v8_read_lunch_document'))return {rows:[{result:structuredClone(state.lunch)}]};
  if(q.includes('static_weekly_coverall_event_brief_candidates')){
   const print=acceptedPrint();
   return {rows:[{result:{schema:'custodial.coverall-event-brief-list.v1',status:'PREVIEW_ONLY',
    disclosure_approved:false,manager_id:values[0],capacity_slot_id:id.capacity,
    service_date:day,projection_id:id.projection,publication_id:id.publication,
    projection_replay_digest:print.replayDigest,authority_revision:7,
    lunch_document_identity:print.lunchDocumentIdentity,print_document_digest:print.documentDigest,
    candidate_limit:16,scan_limit:32,candidates:eventStatus==='SCHEDULED'?[candidate(print)]:[]}}]};
  }
  if(q.includes('static_weekly_coverall_event_brief_candidate')){
   singleReads++;
   if(singleReads===mutateOnSingleRead)eventRevision++;
   const row=eventStatus==='SCHEDULED'&&values[1]===id.event&&values[2]===eventRevision
    ?candidate(acceptedPrint()):unavailable('EVENT_NOT_CURRENT_OR_UNSCOPED');
   return {rows:[{result:row}]};
  }
  return {rows:[]};
 },release(){},
};
const database={async connect(){return client}};
const plane=createStaticWeeklyControlPlane({database,
 compiler:async()=>{throw Error('print path must not compile schedules')},
 initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
const env={NODE_ENV:'test',SUPABASE_URL:'https://coverall-event-print.invalid',
 SUPABASE_SERVICE_ROLE_KEY:'synthetic-no-real-key',
 OPS_MANAGER_SESSION_SECRET:'synthetic-coverall-event-print-secret-0123456789'};
const device={credential_id:'90000000-0000-4000-8000-000000000091',device_id:'synthetic-print-device',
 manager_id:id.manager,manager,max_access_level:'full_access',
 created_at:new Date(Date.now()-60000).toISOString(),
 expires_at:new Date(Date.now()+600000).toISOString()};
const trusted={async find(key){return key===device.credential_id?device:null}};
const activeLeases=new Set();
const supabase={async rpc(name,args){if(name==='custodial_begin_application_mutation_lease'){activeLeases.add(args.p_request_id);return {data:{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null},error:null};}if(name==='custodial_release_application_mutation_lease'){activeLeases.delete(args.p_request_id);return {data:true,error:null};}if(name==='custodial_heartbeat_application_mutation_lease')return {data:true,error:null};throw Error('Unexpected synthetic restore operation');}};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database,controlPlane:plane,
 datedTransitionController:null,trustedDeviceStore:trusted,supabase});
const server=runtime.app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const token=access=>createOpsManagerSession({credentialId:device.credential_id,
 deviceId:device.device_id,manager,authMode:'trusted_device',accessLevel:access,
 maximumAccessLevel:'full_access',env}).token;
const full=token('full_access'),readOnly=token('read_only');
const body=()=>({week_start:week,service_date:day,expected_revision:7,projection_id:id.projection});
async function request(path,{method='POST',payload=body(),auth=full}={}){
 const response=await fetch(base+path,{method,headers:{'content-type':'application/json',
  ...(auth?{Authorization:`Bearer ${auth}`,'X-Device-Id':device.device_id}:{})},
  ...(method==='POST'?{body:JSON.stringify(payload)}:{})});
 return {status:response.status,body:await response.json()};
}
const selection=preview=>({event_id:id.event,event_revision:preview.eventRevision,
 capacity_slot_id:id.capacity,preview,confirmation:{decision:'CONFIRM_FOR_COVERALL_PRINT',
 managerId:id.manager,capacitySlotId:id.capacity,eventId:id.event,
 eventRevision:preview.eventRevision,digest:preview.digest}});

try{
 const previewPath='/static-weekly/coverall-event-previews',printPath='/static-weekly/coverall-print';
 check('anonymous preview denied',(await request(previewPath,{auth:null})).status,401);
 check('read-only preview denied',(await request(previewPath,{auth:readOnly})).status,403);
 check('anonymous print denied',(await request(printPath,{auth:null,payload:{...body(),event_selections:[]}})).status,401);
 check('read-only print denied',(await request(printPath,{auth:readOnly,payload:{...body(),event_selections:[]}})).status,403);
 check('spoofed manager/source field denied',(await request(previewPath,{payload:{...body(),manager_id:id.foreign}})).status,409);
 const page=await request(previewPath);check('named manager obtains preview',page.status,200);
 check('preview does not claim contractor disclosure',page.body.data.disclosureApproved,false);
 check('exact accepted capacity shown',page.body.data.groups[0].capacitySlotId,id.capacity);
 const eventPreview=page.body.data.groups[0].previews[0];
 check('manager selects stable Event identity',eventPreview.eventId,id.event);
 check('manager sees current revision',eventPreview.eventRevision,3);
 check('manager preview never includes raw manager note',JSON.stringify(page.body).includes(PRIVATE),false);
 check('preview has no printable files',Object.hasOwn(page.body.data,'files'),false);
 const oldGet=await request(`${printPath}?week_start=${week}&service_date=${day}&expected_revision=7&projection_id=${id.projection}`,{method:'GET'});
 check('default GET remains available',oldGet.status,200);
 check('default GET has no Event brief',oldGet.body.data.document.eventBriefs,undefined);
 check('default GET omits even safe Event note',JSON.stringify(oldGet.body).includes(SAFE),false);
 const ownerDevice={...device};
 const delegatedManager={...manager,manager_id:id.foreign,display_name:'Synthetic CoverAll Delegate',system_key:'synthetic_delegate'};
 Object.assign(device,{manager_id:delegatedManager.manager_id,manager:delegatedManager});
 const delegated=createOpsManagerSession({credentialId:device.credential_id,deviceId:device.device_id,manager:delegatedManager,authMode:'trusted_device',accessLevel:'read_only',maximumAccessLevel:'full_access',env}).token;
 try{
  const delegatedGet=await request(`${printPath}?week_start=${week}&service_date=${day}&expected_revision=7&projection_id=${id.projection}`,{method:'GET',auth:delegated});
  check('delegate can read accepted CoverAll PDF route',delegatedGet.status,200);
  check('delegate print has no selected event disclosure',delegatedGet.body.data.document.eventBriefs,undefined);
  check('delegate print binds its actual named issuer',delegatedGet.body.data.document.managerContact.managerId,id.foreign);
  check('delegate cannot approve event disclosure',(await request(printPath,{auth:delegated,payload:{...body(),event_selections:[]}})).status,403);
  revokeOnActorRead=actorReads+2;
  const revokedOutput=await request(`${printPath}?week_start=${week}&service_date=${day}&expected_revision=7&projection_id=${id.projection}`,{method:'GET',auth:delegated});
  check('revocation during PDF rendering rejects handout',revokedOutput.status,403);
  check('revoked response has no PDF bytes',Boolean(revokedOutput.body.data?.files),false);
 }finally{Object.assign(device,ownerDevice);delete device.revoked_at;revokeOnActorRead=0;}

 const plain=await request(printPath,{payload:{...body(),event_selections:[]}});
 check('unselected POST prints base only',plain.status,200);
 check('unselected POST has no Event notes',JSON.stringify(plain.body).includes(SAFE),false);
 const selected=await request(printPath,{payload:{...body(),event_selections:[selection(eventPreview)]}});
 check('explicit selected print succeeds',selected.status,200);
 check('one source-confirmed brief in document',selected.body.data.document.eventBriefs.length,1);
 check('exact safe note included',JSON.stringify(selected.body.data).includes(SAFE),true);
 check('private raw note excluded from files/text',JSON.stringify(selected.body.data).includes(PRIVATE),false);
 check('all output text bound to final document digest',selected.body.data.texts.every(t=>
  t.documentDigest===selected.body.data.document.documentDigest),true);
 const originalDigest=selected.body.data.document.documentDigest;
 if(process.env.COVERALL_EVENT_PDF_EVIDENCE_DIR){
  const out=process.env.COVERALL_EVENT_PDF_EVIDENCE_DIR;mkdirSync(out,{recursive:true});
  for(const file of [...selected.body.data.files,selected.body.data.bilingualFile])
   writeFileSync(join(out,file.filename),Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});
  writeFileSync(join(out,'synthetic-selected-event-receipt.json'),JSON.stringify({document:selected.body.data.document,
   files:[...selected.body.data.files,selected.body.data.bilingualFile].map(({language,filename,sha256})=>({language,filename,sha256}))},null,2)+'\n',{flag:'wx',mode:0o600});
 }
 check('base print digest retained separately',selected.body.data.document.baseDocumentDigest,
  oldGet.body.data.document.documentDigest);
 check('selected final digest differs from base',originalDigest===oldGet.body.data.document.documentDigest,false);
 check('foreign confirmation actor denied',(await request(printPath,{payload:{...body(),
  event_selections:[{...selection(eventPreview),confirmation:{...selection(eventPreview).confirmation,
   managerId:id.foreign}}]}})).status,409);
 check('unknown top-level print source denied',(await request(printPath,{payload:{...body(),
  event_selections:[selection(eventPreview)],candidate_source:{forged:true}}})).status,409);
 eventRevision++;
 check('changed Event revision between preview and confirm denied',(await request(printPath,{payload:{...body(),
  event_selections:[selection(eventPreview)]}})).status,409);
 eventRevision--;
 state.snapshot.authority_revision=8;
 check('changed schedule revision between preview and confirm denied',(await request(printPath,{payload:{...body(),
  event_selections:[selection(eventPreview)]}})).status,409);
 state.snapshot.authority_revision=7;
 state.snapshot.latest_projection.projection_id='71000000-0000-4000-8000-000000000099';
 check('changed projection identity between preview and confirm denied',(await request(printPath,{payload:{...body(),
  event_selections:[selection(eventPreview)]}})).status,409);
 state.snapshot.latest_projection.projection_id=id.projection;
 mutateOnSingleRead=singleReads+2;
 const readsBefore=singleReads;
 const raced=await request(printPath,{payload:{...body(),event_selections:[selection(eventPreview)]}});
 check('changed Event at final post-render read denied',raced.status,409);
 check('confirm and final revalidation both reached exact reader',singleReads-readsBefore,2);
 check('failed final revalidation sends no PDF or safe note',JSON.stringify(raced.body).includes(SAFE),false);
 eventRevision=3;mutateOnSingleRead=0;
 mutateOnSnapshotRead=snapshotReads+2;
 const snapshotBefore=snapshotReads;
 const projectionRace=await request(printPath,{payload:{...body(),event_selections:[selection(eventPreview)]}});
 check('changed projection at final post-render authority read denied',projectionRace.status,409);
 check('confirm and final authority snapshots both reached',snapshotReads-snapshotBefore,2);
 check('failed final projection read sends no PDF or safe note',JSON.stringify(projectionRace.body).includes(SAFE),false);
 state.snapshot.authority_revision=7;
 check('no schedule mutation RPC used',queryLog.some(q=>/public\.static_weekly_v\d+_(apply|materialize|publish|create)/.test(q)),false);
 check('synthetic transaction used authority lock',queryLog.some(q=>q.includes('pg_advisory_xact_lock')),true);
 console.log(JSON.stringify({status:'PASS',checks,scope:'actual control-plane/HTTP/PDF source integration with synthetic database responses; no actual SQL, provider, production or physical proof',
  baselineDocumentDigest:oldGet.body.data.document.documentDigest,selectedDocumentDigest:originalDigest,
  queryDigest:createHash('sha256').update(queryLog.join('\n')).digest('hex')}));
}finally{
 await new Promise(resolve=>server.close(resolve));
 await plane.close();
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(activeLeases.size,0,"all synthetic restore leases settled");
}
