import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {createCoverAllPrintDocument,renderCoverAllPdfPair} from '../src/static-weekly-coverall-print.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
const day='2026-09-28',projectionId='71000000-0000-4000-8000-000000000009',publicationId='70000000-0000-4000-8000-000000000009',versionId='60000000-0000-4000-8000-000000000009';
const contractor='20000000-0000-4000-8000-000000000099';
const row=(id,area,owner,start,end)=>({plan_work_id:id,service_date:day,day_of_week:1,status:'assigned',owner_slot_id:owner,
 work_snapshot:{window:{start,end},serviceMode:'scan_tracked',locationId:area,locationNameSnapshot:area,locationCodeSnapshot:area,includedLocations:[{locationId:area,locationNameSnapshot:area+' restroom'}]}});
const fixture=()=>({serviceDate:day,expectedRevision:7,projectionId,
 snapshot:{authority_revision:7,projection_status:'current',current_publication:{publication_id:publicationId,version_id:versionId},
  exceptions:[{type:'cover_all',serviceDate:day,payload:{availability:{slotId:contractor,shift:{start:'07:00',end:'15:00'}}}}],
  roster:[{slot_id:'worker',slot_label:'Synthetic employee',incumbencies:[]},{slot_id:'closer',slot_label:'Synthetic closer',incumbencies:[]}],
  latest_projection:{projection_id:projectionId,publication_id:publicationId,version_id:versionId,week_start:day,week_end:'2026-10-04',replay_digest:'a'.repeat(64),assignments:[row('a','Area A',contractor,'07:00','09:45'),row('b','Area A','worker','09:45','16:00'),row('c','Area B','worker','07:00','09:45'),row('d','Area B',contractor,'09:45','15:00'),row('e','Area B','closer','15:00','16:00'),row('f','Area C','worker','07:00','16:00')]}},
 source:{publication_id:publicationId,version_id:versionId,compiler_input:{slots:[{id:contractor,label:'SYNTHETIC TEST - CoverAll 1',contractorCapacity:true}]}},
 lunch:{persistence_status:'PERSISTED',projection_id:projectionId,document_identity:'b'.repeat(64),service_date:day,
  loans:[{normal_owner_slot_id:contractor,service_date:day,coverage_start:'12:00',coverage_end:'13:00'}],
  responsibilities:[{service_date:day,normal_owner_slot_id:contractor,coverer_slot_id:'worker',loan_id:'lunch-out',segments:[{planWorkId:'d',window:{start:'12:00',end:'13:00'}}]},
   {service_date:day,normal_owner_slot_id:'worker',coverer_slot_id:contractor,loan_id:'lunch-in',segments:[{planWorkId:'f',window:{start:'10:00',end:'11:00'}}]}]}});
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;};
const doc=createCoverAllPrintDocument(fixture()),c=doc.contractors[0];
check('actual shift retained',c.shift,{start:'07:00',end:'15:00'});
check('published lunch retained',c.lunch,{start:'12:00',end:'13:00'});
check('09:45 area change shown',doc.show0945,true);
check('09:45 changed ownership',c.periods.find(p=>p.start==='09:45').areas[0].area,'Area B');
check('lunch relief does not imply full round',c.periods.find(p=>p.start==='10:00').areas.find(a=>a.area==='Area C').purpose,'lunch_coverage');
check('own lunch removes work temporarily',c.periods.find(p=>p.start==='12:00').areas,[]);
check('15:00 actual successor',c.shiftEndHandoffs[0].nextOwners,['Synthetic closer']);
check('no completion recorder invented',doc.contractorCompletionRecorder,'NOT_SPECIFIED');
for(const mutate of [f=>f.snapshot.authority_revision++,f=>f.snapshot.projection_status='stale_staffing_change',f=>f.lunch.projection_id='wrong',f=>f.source.version_id='wrong',f=>f.snapshot.exceptions=[],f=>f.snapshot.exceptions.push(f.snapshot.exceptions[0]),f=>f.snapshot.exceptions[0].payload.availability.shift.end='14:00']){
 const f=fixture();mutate(f);assert.throws(()=>createCoverAllPrintDocument(f));checks++;
}
const continuous=fixture();continuous.snapshot.latest_projection.assignments=[row('a','Area A',contractor,'07:00','09:45'),row('b','Area A',contractor,'09:45','15:00')];continuous.lunch.loans=[];continuous.lunch.responsibilities=[];
const flat=createCoverAllPrintDocument(continuous);
check('unchanged area omits09:45',flat.show0945,false);check('unchanged adjacent assignment merged',flat.contractors[0].periods.length,1);
check('unknown lunch is not fabricated',flat.contractors[0].lunch,null);
let pair=await renderCoverAllPdfPair(doc);
check('both languages together',pair.files.map(f=>f.language),['en','es']);
for(const file of pair.files){const bytes=Buffer.from(file.base64,'base64');check('PDF hash '+file.language,createHash('sha256').update(bytes).digest('hex'),file.sha256);const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>0&&pdf.getPageCount()<=48);checks++;assert.ok(pdf.getSubject().includes(doc.documentDigest));checks++;}
await assert.rejects(()=>renderCoverAllPdfPair({...doc,authorityRevision:8}),/digest_mismatch/);checks++;

// Actual control-plane transaction + HTTP/auth, with synthetic database values.
const queries=[],f=fixture();const client={async query(q){queries.push(q);const result=q.includes('static_weekly_v3_read_manager_snapshot')?f.snapshot:q.includes('static_weekly_v3_read_publication_source')?f.source:q.includes('static_weekly_v8_read_lunch_document')?f.lunch:null;return{rows:result?[{result}]:[]}},release(){}};
const plane=createStaticWeeklyControlPlane({database:{async connect(){return client}},compiler:async()=>{throw Error('PDF must not compile/change schedules')},initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
const env={NODE_ENV:'test',SUPABASE_URL:'https://oc24.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',OPS_MANAGER_SESSION_SECRET:'oc24-synthetic-test-manager-secret-0123456789'};
const manager={manager_id:'10000000-0000-4000-8000-000000000091',display_name:'Synthetic Manager',roles:['OPS_MANAGER'],active:true};
const device={credential_id:'oc24-print-credential',device_id:'oc24-print-device',manager_id:manager.manager_id,manager,max_access_level:'full_access',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database:{},controlPlane:plane,trustedDeviceStore:{async find(){return device}},supabase:{async rpc(){return{data:{mutations_paused:false,state:'READY'},error:null}}}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
try{
 const base=`http://127.0.0.1:${server.address().port}/static-weekly/coverall-print?week_start=${day}&service_date=${day}&expected_revision=7&projection_id=${projectionId}`;
 for(const access of [null,'read_only','full_access']){
  const token=access?createOpsManagerSession({credentialId:device.credential_id,deviceId:device.device_id,manager,authMode:'trusted_device',accessLevel:access,maximumAccessLevel:'full_access',env}).token:null;
  const res=await fetch(base,{headers:token?{Authorization:'Bearer '+token}:{}});check('auth '+access,res.status,access==='full_access'?200:access===null?401:403);
  if(access==='full_access'){pair=(await res.json()).data;check('HTTP exact revision',pair.document.authorityRevision,7);check('HTTP same projection',pair.document.projectionId,projectionId);}
 }
 assert.ok(queries.findIndex(q=>q.includes('pg_advisory_xact_lock'))<queries.findIndex(q=>q.includes('read_manager_snapshot')));checks++;
 check('PDF performs no schedule mutation',queries.some(q=>/static_weekly_v\d+_(?:apply|materialize|publish|create)/.test(q)),false);
 const out=process.env.OC24_PDF_EVIDENCE_DIR;
 if(out){mkdirSync(out,{recursive:true});for(const file of pair.files)writeFileSync(join(out,file.filename),Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});}
}finally{await new Promise(resolve=>server.close(resolve));await plane.close();}
console.log(JSON.stringify({checks,failed:0,scope:'actual PDF/parser/HTTP/auth/transaction with synthetic database fixture; not production publication',documentDigest:doc.documentDigest,pdfs:pair.files.map(({language,filename,sha256})=>({language,filename,sha256}))}));
