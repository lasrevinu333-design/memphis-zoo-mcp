// Pure presentation checks. No listener, database, provider, compiler or link is created.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {createCoverAllPrintDocument,createCoverAllCopyTexts,renderCoverAllPdfPair} from '../src/static-weekly-coverall-print.js';
import {coverAllCanonicalBinding,scopeCanonicalCoverAllDocument,renderCanonicalCoverAllLink} from '../src/static-weekly-coverall-access.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const id=n=>`15000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const day='2026-11-03',capacity=id(1),areaA=id(2),areaB=id(3),areaR=id(4);
const outcomes=[];
const check=async(name,run)=>{await run();outcomes.push({name,status:'PASS'});};
const row=(key,area,owner,start,end,mode='response_only_no_clean')=>({
 service_date:day,status:'assigned',plan_work_id:key,owner_slot_id:owner,
 ...(owner===capacity?{owner_kind:'CONTRACTOR_CAPACITY',capacity_id:capacity,owner_person_id:null}:{}),
 work_snapshot:{locationId:area,locationNameSnapshot:area===areaR?'Reminder area':area===areaA?'Response A':'Response B',
  serviceMode:mode,window:{start,end},includedLocations:mode==='scan_tracked'?[{locationId:area,locationNameSnapshot:'Physical member'}]:[]},
});
function fixture(){return {
 serviceDate:day,expectedRevision:17,projectionId:id(5),issuingManager:{managerId:id(8),managerName:'Synthetic named manager'},
 source:{publication_id:id(6),version_id:id(7),compiler_input:{slots:[{id:capacity,capacityId:capacity,kind:'CONTRACTOR_CAPACITY',label:'CoverAll01',contractorCapacity:true,incumbencies:[]}]}},
 snapshot:{authority_revision:17,projection_status:'current',current_publication:{publication_id:id(6),version_id:id(7)},
  roster:['worker','closer','physical-closer','other-mode'].map(slot=>({slot_id:slot,slot_label:slot,incumbencies:[]})),
  exceptions:[{type:'cover_all',serviceDate:day,payload:{availability:{slotId:capacity,shift:{start:'07:00',end:'15:00'}}}}],
  latest_projection:{projection_id:id(5),publication_id:id(6),version_id:id(7),week_start:'2026-10-31',week_end:'2026-11-06',replay_digest:'a'.repeat(64),assignments:[
   row('a',areaA,capacity,'07:00','09:45'),row('b',areaA,'worker','09:45','17:00'),
   row('c',areaB,'worker','07:00','09:45'),row('d',areaB,capacity,'09:45','15:00'),row('e',areaB,'closer','15:00','17:00'),
   row('f',areaR,'worker','07:00','17:00','reminder_only'),
   row('g',areaB,'physical-closer','15:00','17:00','scan_tracked'),row('h',areaB,'other-mode','15:00','17:00','reminder_only'),
  ]}},
 lunch:{persistence_status:'PERSISTED',projection_id:id(5),service_date:day,document_identity:'b'.repeat(64),
  loans:[{normal_owner_slot_id:capacity,service_date:day,coverage_start:'12:00',coverage_end:'13:00'}],responsibilities:[
   {service_date:day,normal_owner_slot_id:capacity,coverer_slot_id:'worker',loan_id:'own-lunch',segments:[{planWorkId:'d',window:{start:'12:00',end:'13:00'}}]},
   {service_date:day,normal_owner_slot_id:'worker',coverer_slot_id:capacity,loan_id:'reminder-lunch',segments:[{planWorkId:'f',window:{start:'10:00',end:'11:00'}},{planWorkId:'f',window:{start:'14:00',end:'15:00'}}]},
  ]},
};}

const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();assert.ok(['--actual-inputs','--actual-sha256','--artifacts'].includes(key)&&value&&!Object.hasOwn(options,key),'bounded explicit arguments required');options[key]=value;}
assert.equal(!!options['--actual-inputs'],!!options['--actual-sha256']);
if(options['--artifacts'])mkdirSync(options['--artifacts'],{recursive:true});
const original=fixture(),before=sha(JSON.stringify(original)),document=createCoverAllPrintDocument(original),contractor=document.contractors[0];
await check('nonphysical duties retain empty physical lists and exact accepted mode',()=>{
 const areas=contractor.periods.flatMap(period=>period.areas);
 assert.ok(areas.some(area=>area.serviceMode==='response_only_no_clean'));
 assert.ok(areas.some(area=>area.serviceMode==='reminder_only'));
 assert.ok(areas.every(area=>area.locations.length===0));
 assert.equal(sha(JSON.stringify(original)),before);
});
await check('09:45 routing-duty ownership change is retained',()=>{
 assert.equal(document.show0945,true);
 assert.equal(contractor.periods.find(period=>period.start==='09:45').areas[0].areaId,areaB);
 const same=fixture();same.snapshot.latest_projection.assignments=[row('one',areaA,capacity,'07:00','09:45'),row('two',areaA,capacity,'09:45','15:00')];same.lunch.loans=[];same.lunch.responsibilities=[];
 const continuous=createCoverAllPrintDocument(same);assert.equal(continuous.show0945,false);assert.equal(continuous.contractors[0].periods.length,1);
});
await check('full-hour own lunch removes duty and borrowed reminder keeps both meanings',()=>{
 assert.deepEqual(contractor.lunch,{start:'12:00',end:'13:00'});
 assert.deepEqual(contractor.periods.find(period=>period.start==='12:00').areas,[]);
 const reminder=contractor.periods.find(period=>period.start==='10:00').areas.find(area=>area.areaId===areaR);
 assert.equal(reminder.serviceMode,'reminder_only');assert.equal(reminder.purpose,'lunch_coverage');
});
await check('shift-end successor uses same routing duty, never a coincident physical ID or other mode',()=>{
 assert.deepEqual(contractor.shiftEndHandoffs.find(area=>area.area==='Response B').nextOwners,['closer']);
 assert.deepEqual(contractor.shiftEndHandoffs.find(area=>area.area==='Reminder area').nextOwners,['worker']);
});
for(const mode of ['scan_tracked','reminder_only','response_only_no_clean']){
 for(const field of ['plan_work_id','owner_slot_id'])await check(`${mode} missing ${field} remains rejected`,()=>{
  const f=fixture(),r=f.snapshot.latest_projection.assignments[0];r.work_snapshot.serviceMode=mode;r.work_snapshot.includedLocations=mode==='scan_tracked'?[{locationId:areaA,locationNameSnapshot:'Physical member'}]:[];delete r[field];
  assert.throws(()=>createCoverAllPrintDocument(f),{code:'coverall_print_incomplete_assignment'});
 });
}
for(const mode of ['scan_tracked','unknown_mode',undefined])await check(`empty cleaning or unrecognized mode ${String(mode)} remains rejected`,()=>{
 const f=fixture();f.snapshot.latest_projection.assignments[0].work_snapshot.serviceMode=mode;
 assert.throws(()=>createCoverAllPrintDocument(f),{code:'coverall_print_incomplete_assignment'});
});
for(const mode of ['reminder_only','response_only_no_clean']){
 for(const patch of [{locationId:''},{locationNameSnapshot:''},{includedLocations:[{locationId:areaA,locationNameSnapshot:'Invented physical room'}]}])await check(`${mode} malformed routing facts rejected ${JSON.stringify(patch)}`,()=>{
  const f=fixture();Object.assign(f.snapshot.latest_projection.assignments[0].work_snapshot,{serviceMode:mode},patch);
  assert.throws(()=>createCoverAllPrintDocument(f),{code:'coverall_print_incomplete_assignment'});
 });
}
await check('malformed cleaning row blocks the whole print even when assigned to an employee',()=>{
 const f=fixture();f.snapshot.latest_projection.assignments.at(-2).work_snapshot.includedLocations=[];
 assert.throws(()=>createCoverAllPrintDocument(f),{code:'coverall_print_incomplete_assignment'});
});
await check('cleaning DTO retains its existing physical ownership shape',()=>{
 const f=fixture();f.snapshot.latest_projection.assignments=[row('physical',areaA,capacity,'07:00','15:00','scan_tracked')];f.lunch.loans=[];f.lunch.responsibilities=[];
 const d=createCoverAllPrintDocument(f);assert.deepEqual(d.contractors[0].periods[0].areas,[{areaId:areaA,area:'Response A',locations:[{id:areaA,name:'Physical member'}],purpose:'area_owner'}]);
 assert.ok(!Object.hasOwn(d.contractors[0].shiftEndHandoffs[0],'serviceMode'));
});
await check('English/Spanish/bilingual copies and selected assignment views preserve explicit mode',()=>{
 const copies=createCoverAllCopyTexts(document);
 assert.match(copies[0].text,/Response only; no scheduled cleaning\./);assert.match(copies[0].text,/Temporary lunch coverage\nReminder-only work/);
 assert.match(copies[1].text,/Solo respuesta; sin limpieza programada\./);assert.match(copies[1].text,/Cobertura temporal de almuerzo\nTrabajo de recordatorio/);
 const scoped=scopeCanonicalCoverAllDocument(document,coverAllCanonicalBinding(document,capacity,'2026-10-31'));
 for(const language of ['en','es','both']){
  const html=renderCanonicalCoverAllLink(scoped,language);assert.match(html,language==='es'?/Solo respuesta; sin limpieza programada\./:/Response only; no scheduled cleaning\./);
  assert.ok(html.includes(document.projectionId));
 }
});
async function verifyPdf(label,doc){
 const pair=await renderCoverAllPdfPair(doc),pages={};
 assert.equal(pair.document.documentDigest,doc.documentDigest);assert.deepEqual(pair.texts,createCoverAllCopyTexts(doc));
 for(const file of [...pair.files,pair.bilingualFile]){
  const bytes=Buffer.from(file.base64,'base64');assert.equal(sha(bytes),file.sha256);
  const pdf=await PDFDocument.load(bytes);pages[file.language]=pdf.getPageCount();assert.ok(pages[file.language]>0&&pages[file.language]<=48);assert.ok(pdf.getSubject().includes(doc.documentDigest));
  if(options['--artifacts'])writeFileSync(join(options['--artifacts'],`${label}-${file.language}.pdf`),bytes,{flag:'wx'});
 }
 assert.equal(pages['en-es'],pages.en+pages.es);
 return {documentDigest:doc.documentDigest,pages};
}
let syntheticPdf;
await check('all three PDF files parse and bind the same nonphysical document',async()=>{syntheticPdf=await verifyPdf('synthetic',document);});
let actual=null;
if(options['--actual-inputs']){
 const bytes=readFileSync(options['--actual-inputs']);assert.equal(sha(bytes),options['--actual-sha256']);
 const input=JSON.parse(bytes),inputDigest=sha(JSON.stringify(input));
 await check('exact immutable database015 inputs build without inventing physical membership',()=>{
  const rows=input.snapshot.latest_projection.assignments.filter(row=>row.service_date===input.serviceDate&&row.status==='assigned');
  assert.equal(rows.length,64);assert.equal(rows.filter(row=>row.work_snapshot.serviceMode==='response_only_no_clean'&&row.work_snapshot.includedLocations.length===0).length,5);
  actual=createCoverAllPrintDocument(input);assert.equal(actual.authorityRevision,17);assert.equal(actual.projectionId,'e225836a-25ac-4468-a8c1-cfe3338de2d4');
  assert.deepEqual(actual.contractors[0].shift,{start:'05:00',end:'14:00'});assert.deepEqual(actual.contractors[0].lunch,{start:'09:30',end:'10:30'});
  assert.equal(actual.managerContact.managerId,input.issuingManager.managerId);assert.equal(sha(JSON.stringify(input)),inputDigest);assert.equal(sha(readFileSync(options['--actual-inputs'])),options['--actual-sha256']);
 });
 await check('actual accepted document reaches selected assignment HTML and all PDFs offline',async()=>{
  const binding=coverAllCanonicalBinding(actual,actual.contractors[0].slotId,input.snapshot.week_start),scoped=scopeCanonicalCoverAllDocument(actual,binding);
  for(const language of ['en','es','both'])assert.ok(renderCanonicalCoverAllLink(scoped,language).includes(actual.projectionId));
  const pdf=await verifyPdf('actual015',actual);actual={documentDigest:actual.documentDigest,projectionId:actual.projectionId,authorityRevision:actual.authorityRevision,...pdf};
 });
}
console.log(JSON.stringify({status:'PASS',scope:'offline actual print/copy/PDF/canonical assignment functions; synthetic boundary cases plus optional immutable database015 read-only export; no live SQL, HTTP, provider or independent acceptance',checks:outcomes.length,outcomes,syntheticPdf,actual},null,2));
