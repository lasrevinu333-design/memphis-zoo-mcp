import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCoverAllPrintDocument,renderCoverAllPdfPair,createCoverAllCopyTexts} from '../src/static-weekly-coverall-print.js';
const day='2026-09-28',projectionId='71000000-0000-4000-8000-000000000009',publicationId='70000000-0000-4000-8000-000000000009',versionId='60000000-0000-4000-8000-000000000009';
const contractor='20000000-0000-4000-8000-000000000099';
const row=(id,area,owner,start,end)=>({plan_work_id:id,service_date:day,day_of_week:1,status:'assigned',owner_slot_id:owner,
 work_snapshot:{window:{start,end},serviceMode:'scan_tracked',locationId:area,locationNameSnapshot:area,locationCodeSnapshot:area,includedLocations:[{locationId:area,locationNameSnapshot:area+' restroom'}]}});
const fixture=()=>({serviceDate:day,expectedRevision:7,projectionId,issuingManager:{managerId:'10000000-0000-4000-8000-000000000091',managerName:'Synthetic Manager'},
 snapshot:{authority_revision:7,projection_status:'current',current_publication:{publication_id:publicationId,version_id:versionId},
  exceptions:[{type:'cover_all',serviceDate:day,payload:{availability:{slotId:contractor,shift:{start:'07:00',end:'15:00'}}}}],
  roster:[{slot_id:'worker',slot_label:'Synthetic employee',incumbencies:[]},{slot_id:'closer',slot_label:'Synthetic closer',incumbencies:[]}],
  latest_projection:{projection_id:projectionId,publication_id:publicationId,version_id:versionId,week_start:day,week_end:'2026-10-04',replay_digest:'a'.repeat(64),assignments:[row('a','Area A',contractor,'07:00','09:45'),row('b','Area A','worker','09:45','16:00'),row('c','Area B','worker','07:00','09:45'),row('d','Area B',contractor,'09:45','15:00'),row('e','Area B','closer','15:00','16:00'),row('f','Area C','worker','07:00','16:00')]}},
 source:{publication_id:publicationId,version_id:versionId,compiler_input:{slots:[{id:contractor,label:'SYNTHETIC TEST - CoverAll 1',contractorCapacity:true}]}},
 lunch:{persistence_status:'PERSISTED',projection_id:projectionId,document_identity:'b'.repeat(64),service_date:day,
  loans:[{normal_owner_slot_id:contractor,service_date:day,coverage_start:'12:00',coverage_end:'13:00'}],
  responsibilities:[{service_date:day,normal_owner_slot_id:contractor,coverer_slot_id:'worker',loan_id:'lunch-out',segments:[{planWorkId:'d',window:{start:'12:00',end:'13:00'}}]},
   {service_date:day,normal_owner_slot_id:'worker',coverer_slot_id:contractor,loan_id:'lunch-in',segments:[{planWorkId:'f',window:{start:'10:00',end:'11:00'}}]}]}});
if(process.argv.includes('--civil-date-only')){
 // Reuse the owning accepted-document fixture, rebinding every dated input.
 // No PDF dependency, controller, HTTP listener or database fixture is loaded.
 const dated=(serviceDate,weekStart,weekEnd)=>{
  const f=fixture();f.serviceDate=serviceDate;f.lunch.service_date=serviceDate;
  f.snapshot.latest_projection.week_start=weekStart;f.snapshot.latest_projection.week_end=weekEnd;
  for(const row of f.snapshot.latest_projection.assignments)row.service_date=serviceDate;
  for(const exception of f.snapshot.exceptions)exception.serviceDate=serviceDate;
  for(const row of [...f.lunch.loans,...f.lunch.responsibilities])row.service_date=serviceDate;
  return f;
 };
 const outcomes=[];
 const check=(name,run)=>{try{run();outcomes.push({name,status:'PASSED'});}catch(error){outcomes.push({name,status:'FAILED',error:String(error.message)});}};
 check('impossible February31 inside canonical Feb23..Mar01 week is rejected',()=>{
  const f=dated('2026-02-31','2026-02-23','2026-03-01');
  assert.throws(()=>createCoverAllPrintDocument(f),{code:'coverall_print_date_outside_projection'});
 });
 check('non-leap February29 inside canonical week is rejected',()=>{
  assert.throws(()=>createCoverAllPrintDocument(dated('2026-02-29','2026-02-23','2026-03-01')),{code:'coverall_print_date_outside_projection'});
 });
 check('valid leap day preserves accepted identity, windows and both copy languages',()=>{
  const f=dated('2024-02-29','2024-02-26','2024-03-03'),original=structuredClone(f),doc=createCoverAllPrintDocument(f);
  assert.equal(doc.serviceDate,'2024-02-29');assert.equal(doc.authorityRevision,7);
  assert.equal(doc.publicationId,publicationId);assert.equal(doc.projectionId,projectionId);
  assert.equal(doc.replayDigest,'a'.repeat(64));assert.equal(doc.lunchDocumentIdentity,'b'.repeat(64));
  assert.equal(doc.managerContact.managerId,f.issuingManager.managerId);
  assert.deepEqual(doc.contractors[0].shift,{start:'07:00',end:'15:00'});
  assert.deepEqual(doc.contractors[0].lunch,{start:'12:00',end:'13:00'});
  assert.equal(doc.contractorCompletionRecorder,'ERIC_OPERLE_PERSONAL_VERIFICATION');
  const texts=createCoverAllCopyTexts(doc);assert.deepEqual(texts.map(row=>row.language),['en','es','en-es']);
  for(const row of texts){assert.equal(row.documentDigest,doc.documentDigest);assert.ok(row.text.includes('2024-02-29'));}
  assert.deepEqual(f,original);
 });
 const failed=outcomes.filter(row=>row.status==='FAILED').length;
 console.log(JSON.stringify({scope:'owning civil-date document/copy behavior only; no PDF/HTTP/SQL',checks:outcomes.length,failed,outcomes},null,2));
 if(failed)process.exitCode=1;
}else{
 const {PDFDocument}=await import('pdf-lib');
 const {createStaticWeeklyControlPlane}=await import('../src/static-weekly-control-plane.js');
 const {createStaticWeeklyControlPlaneRuntime}=await import('../src/static-weekly-control-plane-runtime.js');
 const {createOpsManagerSession}=await import('../src/auth/shared-access-auth.js');
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;};
const doc=createCoverAllPrintDocument(fixture()),c=doc.contractors[0];
check('actual shift retained',c.shift,{start:'07:00',end:'15:00'});
check('published lunch retained',c.lunch,{start:'12:00',end:'13:00'});
check('09:45 area change shown',doc.show0945,true);
check('09:45 changed ownership',c.periods.find(p=>p.start==='09:45').areas[0].area,'Area B');
check('lunch relief does not imply full round',c.periods.find(p=>p.start==='10:00').areas.find(a=>a.area==='Area C').purpose,'lunch_coverage');
check('own lunch removes work temporarily',c.periods.find(p=>p.start==='12:00').areas,[]);
check('15:00 actual successor',c.shiftEndHandoffs[0].nextOwners,['Synthetic closer']);
check('September27 owner personally verifies contractor completion',doc.contractorCompletionRecorder,'ERIC_OPERLE_PERSONAL_VERIFICATION');
for(const mutate of [f=>f.snapshot.authority_revision++,f=>f.snapshot.projection_status='stale_staffing_change',f=>f.lunch.projection_id='wrong',f=>f.source.version_id='wrong',f=>f.snapshot.exceptions=[],f=>f.snapshot.exceptions.push(f.snapshot.exceptions[0]),f=>f.snapshot.exceptions[0].payload.availability.shift.end='14:00']){
 const f=fixture();mutate(f);assert.throws(()=>createCoverAllPrintDocument(f));checks++;
}
const continuous=fixture();continuous.snapshot.latest_projection.assignments=[row('a','Area A',contractor,'07:00','09:45'),row('b','Area A',contractor,'09:45','15:00')];continuous.lunch.loans=[];continuous.lunch.responsibilities=[];
const flat=createCoverAllPrintDocument(continuous);
check('unchanged area omits09:45',flat.show0945,false);check('unchanged adjacent assignment merged',flat.contractors[0].periods.length,1);
check('unknown lunch is not fabricated',flat.contractors[0].lunch,null);
const routedInput=fixture();Object.assign(routedInput.snapshot.exceptions[0].payload.availability,{acceptedRouteAnchorLocationId:'Area A',acceptedRouteProvenance:'Synthetic accepted starting area'});
routedInput.source.compiler_input.proximity=[['Area A','Area B',8],['Area A','Area C',1],['Area B','Area A',8],['Area B','Area C',6],['Area C','Area A',1],['Area C','Area B',3]]
 .map(([from,to,minutes])=>({from,to,minutes,verified:true,provenance:'Synthetic accepted edge'}));
const routed=createCoverAllPrintDocument(routedInput),routedPeriod=routed.contractors[0].periods.find(p=>p.start==='10:00');
check('advisory order actually enters accepted document',routedPeriod.areas.map(a=>a.area),['Area C','Area B']);
check('advisory never changes accepted period windows',routed.contractors[0].periods.map(p=>[p.start,p.end]),doc.contractors[0].periods.map(p=>[p.start,p.end]));
check('document binds exact directed order',routedPeriod.advisoryOrder.status,'ADVISORY_VERIFIED_PROXIMITY');
assert.match(createCoverAllCopyTexts(routed)[0].text,/not an appointment or mandatory route/);checks++;
assert.match(createCoverAllCopyTexts(routed)[1].text,/no la posición actual/);checks++;
assert.notEqual(routed.documentDigest,doc.documentDigest);checks++;
const routeOut=process.env.OC24_ROUTE_PDF_EVIDENCE_DIR;
if(routeOut){const routedPair=await renderCoverAllPdfPair(routed);mkdirSync(routeOut,{recursive:true});for(const file of [...routedPair.files,routedPair.bilingualFile])writeFileSync(join(routeOut,file.filename),Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});}
let pair=await renderCoverAllPdfPair(doc);
check('approved issuing manager, no personal phone',doc.managerContact,{name:'Synthetic Manager',role:'Issuing custodial manager',method:'IN_PERSON',authority:'AUTHENTICATED_NAMED_MANAGER',managerId:'10000000-0000-4000-8000-000000000091'});
check('all copy languages from same document',pair.texts.map(t=>t.language),['en','es','en-es']);
for(const entry of pair.texts){assert.equal(entry.documentDigest,doc.documentDigest);checks++;assert.equal(createHash('sha256').update(entry.text).digest('hex'),entry.sha256);checks++;assert.ok(entry.text.includes('Synthetic Manager'));checks++;assert.ok(entry.text.includes(doc.projectionId));checks++;}
assert.match(pair.texts[0].text,/missing supplies directly to the issuing custodial manager/);checks++;
assert.match(pair.texts[0].text,/Eric Operle/);checks++;
assert.match(pair.texts[1].text,/suministros/);checks++;
assert.match(pair.texts[1].text,/Eric Operle/);checks++;
assert.doesNotMatch(JSON.stringify(pair),/tel:|mailto:|555-/);checks++;
const missingContact=fixture();delete missingContact.issuingManager;
assert.throws(()=>createCoverAllCopyTexts(createCoverAllPrintDocument(missingContact)),/issuing_manager_required/);checks++;
await assert.rejects(()=>renderCoverAllPdfPair(createCoverAllPrintDocument(missingContact)),/issuing_manager_required/);checks++;
assert.throws(()=>createCoverAllCopyTexts({...doc,managerContact:{...doc.managerContact,name:'forged'}}),/digest_mismatch/);checks++;
check('both languages together',pair.files.map(f=>f.language),['en','es']);
check('bilingual printable option',pair.bilingualFile.language,'en-es');
const pageCounts={};
for(const file of [...pair.files,pair.bilingualFile]){const bytes=Buffer.from(file.base64,'base64');check('PDF hash '+file.language,createHash('sha256').update(bytes).digest('hex'),file.sha256);const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>0&&pdf.getPageCount()<=48);checks++;assert.ok(pdf.getSubject().includes(doc.documentDigest));checks++;pageCounts[file.language]=pdf.getPageCount();}
check('all standalone language pages retained in bilingual PDF',pageCounts['en-es'],pageCounts.en+pageCounts.es);
assert.match(pair.texts[0].text,/Order unproven; confirm with the manager/);checks++;
await assert.rejects(()=>renderCoverAllPdfPair({...doc,authorityRevision:8}),/digest_mismatch/);checks++;
const noneInput=fixture();noneInput.snapshot.exceptions[0].payload.availability.breakChoice='NONE';
Object.assign(noneInput.source.compiler_input.slots[0],{kind:'CONTRACTOR_CAPACITY',capacityId:contractor,label:'CoverAll01',incumbencies:[]});
for(const row of noneInput.snapshot.latest_projection.assignments)if(row.owner_slot_id===contractor)Object.assign(row,{owner_kind:'CONTRACTOR_CAPACITY',capacity_id:contractor,owner_person_id:null});
noneInput.lunch.loans=[];noneInput.lunch.responsibilities=noneInput.lunch.responsibilities.filter(r=>r.normal_owner_slot_id!==contractor);
const nonePair=await renderCoverAllPdfPair(createCoverAllPrintDocument(noneInput));
assert.match(nonePair.texts[0].text,/No break: explicit manager choice/);checks++;
assert.match(nonePair.texts[1].text,/Sin descanso/);checks++;
assert.doesNotMatch(nonePair.texts[0].text,/No contractor lunch is published/);checks++;
const noneOut=process.env.OC24_NONE_PDF_EVIDENCE_DIR;
if(noneOut){mkdirSync(noneOut,{recursive:true});for(const file of [...nonePair.files,nonePair.bilingualFile])writeFileSync(join(noneOut,file.filename),Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});}

// Actual control-plane transaction + HTTP/auth, with synthetic database values.
const queries=[],f=fixture();const client={async query(q){queries.push(q);const result=q.includes('custodial_action_actor_v1')?{manager_id:manager.manager_id}:q.includes('static_weekly_v3_read_manager_snapshot')?f.snapshot:q.includes('static_weekly_v3_read_publication_source')?f.source:q.includes('static_weekly_v8_read_lunch_document')?f.lunch:null;return{rows:result?[{result}]:[]}},release(){}};
const plane=createStaticWeeklyControlPlane({database:{async connect(){return client}},compiler:async()=>{throw Error('PDF must not compile/change schedules')},initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
const env={NODE_ENV:'test',SUPABASE_URL:'https://oc24.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',OPS_MANAGER_SESSION_SECRET:'oc24-synthetic-test-manager-secret-0123456789'};
const manager={manager_id:'10000000-0000-4000-8000-000000000091',display_name:'Synthetic Manager',roles:['OPS_MANAGER'],active:true,is_system_principal:false,system_key:'eric_custodial_manager'};
const device={credential_id:'90000000-0000-4000-8000-000000000092',device_id:'oc24-print-device',manager_id:manager.manager_id,manager,max_access_level:'full_access',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database:{},controlPlane:plane,trustedDeviceStore:{async find(){return device}},supabase:{async rpc(){return{data:{mutations_paused:false,state:'READY'},error:null}}}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
try{
 const base=`http://127.0.0.1:${server.address().port}/static-weekly/coverall-print?week_start=${day}&service_date=${day}&expected_revision=7&projection_id=${projectionId}`;
 for(const access of [null,'read_only','full_access']){
  const token=access?createOpsManagerSession({credentialId:device.credential_id,deviceId:device.device_id,manager,authMode:'trusted_device',accessLevel:access,maximumAccessLevel:'full_access',env}).token:null;
  const res=await fetch(base,{headers:token?{Authorization:'Bearer '+token}:{}});check('auth '+access,res.status,access==='full_access'?200:access===null?401:403);
  if(access==='full_access'){pair=(await res.json()).data;check('HTTP exact revision',pair.document.authorityRevision,7);check('HTTP same projection',pair.document.projectionId,projectionId);check('HTTP issuer from authenticated session',pair.document.managerContact.managerId,manager.manager_id);check('HTTP text/PDF same canonical digest',pair.texts.every(t=>t.documentDigest===pair.document.documentDigest),true);}
 }
 assert.ok(queries.findIndex(q=>q.includes('pg_advisory_xact_lock'))<queries.findIndex(q=>q.includes('read_manager_snapshot')));checks++;
 check('PDF performs no schedule mutation',queries.some(q=>/static_weekly_v\d+_(?:apply|materialize|publish|create)/.test(q)),false);
 const out=process.env.OC24_PDF_EVIDENCE_DIR;
 if(out){mkdirSync(out,{recursive:true});for(const file of [...pair.files,pair.bilingualFile])writeFileSync(join(out,file.filename),Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});}
}finally{await new Promise(resolve=>server.close(resolve));await plane.close();}
console.log(JSON.stringify({checks,failed:0,scope:'actual PDF/parser/HTTP/auth/transaction with synthetic database fixture; not production publication',documentDigest:doc.documentDigest,pdfs:pair.files.map(({language,filename,sha256})=>({language,filename,sha256}))}));
}
