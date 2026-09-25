import {createHash} from 'node:crypto';
import {canonicalJson,normalizeWindow} from './static-weekly-schedule-model.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const list=value=>Array.isArray(value)?value:fail('coverall_print_array_required');
const text=value=>typeof value==='string'?value:'';
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
const window=value=>normalizeWindow(value,'accepted CoverAll print window');

// Presentation only. All assignments, temporary loans and dated capacity come
// from one accepted projection read under the existing authority lock.
export function createCoverAllPrintDocument({snapshot,source,lunch,serviceDate,expectedRevision,projectionId}){
 const projection=snapshot?.latest_projection,publication=snapshot?.current_publication;
 if(!Number.isSafeInteger(expectedRevision)||snapshot?.authority_revision!==expectedRevision
  ||snapshot?.projection_status!=='current'||!projectionId||projection?.projection_id!==projectionId
  ||projection.publication_id!==publication?.publication_id||projection.version_id!==publication.version_id
  ||source?.publication_id!==publication.publication_id||source?.version_id!==publication.version_id
  ||lunch?.persistence_status!=='PERSISTED'||lunch.projection_id!==projectionId||lunch.service_date!==serviceDate
  ||!/^[0-9a-f]{64}$/.test(text(lunch.document_identity))
  ||!/^[0-9a-f]{64}$/.test(text(projection.replay_digest)))fail('coverall_print_accepted_revision_required');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text(serviceDate))||serviceDate<projection.week_start||serviceDate>projection.week_end)fail('coverall_print_date_outside_projection');
 const slots=list(source.compiler_input?.slots),exceptions=list(snapshot.exceptions);
 const contractorSlots=new Map(slots.filter(s=>s.contractorCapacity===true).map(s=>[s.id,s]));
 const selected=exceptions.filter(e=>e.type==='cover_all'&&e.serviceDate===serviceDate);
 if(!selected.length||selected.length>8)fail('coverall_print_no_bounded_manual_capacity');
 const contractors=selected.map(e=>{
  const id=e.payload?.availability?.slotId,slot=contractorSlots.get(id);
  if(!slot)fail('coverall_print_registered_capacity_required');
  return {slotId:id,name:text(slot.label)||'CoverAll',shift:{...window(e.payload.availability.shift)},lunch:null,periods:[]};
 });
 if(new Set(contractors.map(c=>c.slotId)).size!==contractors.length)fail('coverall_print_duplicate_capacity');
 const rows=list(projection.assignments).filter(r=>r.service_date===serviceDate);
 if(rows.length>2000)fail('coverall_print_assignment_limit');
 const segments=[];
 for(const r of rows){
  if(r.status!=='assigned')continue;
  const w=r.work_snapshot,locations=list(w?.includedLocations),span=window(w.window);
  if(!text(r.plan_work_id)||!text(r.owner_slot_id)||!locations.length)fail('coverall_print_incomplete_assignment');
  const overrides=list(lunch.responsibilities).filter(x=>x.service_date===serviceDate&&x.normal_owner_slot_id===r.owner_slot_id)
   .flatMap(x=>list(x.segments).filter(s=>s.planWorkId===r.plan_work_id).map(s=>({span:window(s.window),owner:x.coverer_slot_id,loan:x.loan_id})));
  const boundaries=[...new Set([span.startMinute,span.endMinute,...overrides.flatMap(o=>[o.span.startMinute,o.span.endMinute])])].sort((a,b)=>a-b);
  for(let i=0;i<boundaries.length-1;i++){
   const a=boundaries[i],b=boundaries[i+1];if(a<span.startMinute||b>span.endMinute)continue;
   const loans=overrides.filter(o=>o.span.startMinute<=a&&o.span.endMinute>=b);
   if(loans.length>1)fail('coverall_print_overlapping_lunch_ownership');
   const owner=loans[0]?.owner||r.owner_slot_id;
   if(!text(owner))fail('coverall_print_missing_owner');
   segments.push({owner,start:a,end:b,area:text(w.locationNameSnapshot)||text(w.locationCodeSnapshot),
    locations:locations.map(l=>({id:text(l.locationId),name:text(l.locationNameSnapshot)})),
    purpose:loans.length?'lunch_coverage':w.serviceMode==='reminder_only'?'reminder_only':'area_owner'});
  }
 }
 const globalSignature=minute=>canonicalJson(segments.filter(s=>s.start<=minute&&minute<s.end)
  .flatMap(s=>s.locations.map(l=>`${l.id}|${s.owner}|${s.purpose}`)).sort());
 const keep0945=globalSignature(584)!==globalSignature(585);
 const roster=list(snapshot.roster);
 const ownerName=id=>{
  const capacity=contractors.find(c=>c.slotId===id);if(capacity)return capacity.name;
  const slot=roster.find(s=>s.slot_id===id),inc=list(slot?.incumbencies||[]).find(p=>p.effective_start<=serviceDate&&(!p.effective_end||serviceDate<p.effective_end));
  return text(inc?.person_name)||text(slot?.slot_label)||id;
 };
 for(const c of contractors){
  const ownLunch=list(lunch.loans).filter(l=>l.normal_owner_slot_id===c.slotId&&l.service_date===serviceDate);
  if(ownLunch.length>1)fail('coverall_print_duplicate_lunch');
  if(ownLunch.length)c.lunch={start:ownLunch[0].coverage_start,end:ownLunch[0].coverage_end};
  const own=segments.filter(s=>s.owner===c.slotId);
  if(own.some(s=>s.start<c.shift.startMinute||s.end>c.shift.endMinute))fail('coverall_print_work_outside_actual_shift');
  const times=[...new Set([c.shift.startMinute,c.shift.endMinute,...own.flatMap(s=>[s.start,s.end]),...(keep0945&&c.shift.startMinute<585&&585<c.shift.endMinute?[585]:[])])].sort((a,b)=>a-b);
  for(let i=0;i<times.length-1;i++){
   const start=times[i],end=times[i+1];
   const areas=own.filter(s=>s.start<=start&&end<=s.end).map(s=>({area:s.area,locations:s.locations,purpose:s.purpose}));
   const unique=[...new Map(areas.map(a=>[canonicalJson(a),a])).values()].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
   const prior=c.periods.at(-1);
   if(prior&&canonicalJson(prior.areas)===canonicalJson(unique)&&!(keep0945&&start===585))prior.end=clock(end);
   else c.periods.push({start:clock(start),end:clock(end),areas:unique});
  }
  const final=own.filter(s=>s.end===c.shift.endMinute);
  c.shiftEndHandoffs=final.map(s=>({area:s.area,locations:s.locations,nextOwners:[...new Set(segments.filter(next=>next.owner!==c.slotId&&next.start<=c.shift.endMinute&&c.shift.endMinute<next.end&&next.locations.some(l=>s.locations.some(old=>old.id===l.id))).map(next=>ownerName(next.owner)))]}));
  c.shift={start:clock(c.shift.startMinute),end:clock(c.shift.endMinute)};
 }
 const document={schema:'custodial.coverall-accepted-print.v1',serviceDate,authorityRevision:expectedRevision,
  publicationId:publication.publication_id,projectionId,replayDigest:projection.replay_digest,lunchDocumentIdentity:lunch.document_identity,
  show0945:keep0945,contractors,contractorCompletionRecorder:'NOT_SPECIFIED'};
 return {...document,documentDigest:hash(canonicalJson(document))};
}

const labels={
 en:{title:'CoverAll assignments',revision:'Accepted revision',date:'Service date',shift:'Shift',lunch:'Lunch',unpublished:'No contractor lunch is published; confirm with the manager.',empty:'No assigned areas in this period.',lunchCoverage:'Temporary lunch coverage',reminder:'Reminder-only work',end:'Shift-end coverage',none:'No later owner in this accepted schedule.',note:'Follow these accepted coverage times. Lunch relief does not add a full cleaning round.',page:'Page'},
 es:{title:'Asignaciones de CoverAll',revision:'Revisión aceptada',date:'Fecha de servicio',shift:'Turno',lunch:'Almuerzo',unpublished:'No hay almuerzo del contratista publicado; confirme con el encargado.',empty:'No hay áreas asignadas en este período.',lunchCoverage:'Cobertura temporal de almuerzo',reminder:'Trabajo de recordatorio',end:'Cobertura al terminar el turno',none:'No hay responsable posterior en este horario aceptado.',note:'Siga estos horarios de cobertura. El relevo de almuerzo no añade una limpieza completa.',page:'Página'},
};

export async function renderCoverAllPdfPair(document){
 if(document?.schema!=='custodial.coverall-accepted-print.v1')fail('coverall_print_document_required');
 const {documentDigest,...canonical}=document;
 if(documentDigest!==hash(canonicalJson(canonical)))fail('coverall_print_document_digest_mismatch');
 const {PDFDocument,StandardFonts,rgb}=await import('pdf-lib');
 const files=[];
 for(const language of ['en','es']){
  const t=labels[language],pdf=await PDFDocument.create();
  pdf.setTitle(`${t.title} ${document.serviceDate}`);pdf.setLanguage(language);pdf.setSubject(`projection=${document.projectionId}; revision=${document.authorityRevision}; document=${documentDigest}`);
  const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let page,y=0;
  const newPage=()=>{if(pdf.getPageCount()>=48)fail('coverall_pdf_page_limit');page=pdf.addPage([612,792]);y=750;};
  function line(value,size=10,strong=false){
   const f=strong?bold:font,words=String(value).replace(/[\r\n\t]/g,' ').replace(/[–—]/g,'-').split(' ');let part='';
   const draw=()=>{if(y<56)newPage();page.drawText(part,{x:40,y,size,font:f,color:rgb(.08,.12,.13)});y-=size+5;};
   for(const word of words){if(f.widthOfTextAtSize(word,size)>532)fail('coverall_pdf_unbreakable_text');const next=part?part+' '+word:word;if(f.widthOfTextAtSize(next,size)>532){draw();part=word;}else part=next;}if(part)draw();
  }
  for(const c of document.contractors){
   newPage();line('MEMPHIS ZOO',10,true);line(`${t.title} - ${c.name}`,19,true);
   line(`${t.date}: ${document.serviceDate} | ${t.revision}: ${document.authorityRevision}`,11,true);
   line(`${t.shift}: ${c.shift.start} - ${c.shift.end}`,12,true);
   line(`${t.lunch}: ${c.lunch?c.lunch.start+' - '+c.lunch.end:t.unpublished}`);line(t.note);y-=10;
   for(const period of c.periods){
    if(y<115)newPage();line(`${period.start} - ${period.end}`,13,true);
    if(!period.areas.length)line(t.empty);
    for(const a of period.areas){line(a.area,11,true);line(a.locations.map(l=>l.name).join('; '));if(a.purpose==='lunch_coverage')line(t.lunchCoverage);if(a.purpose==='reminder_only')line(t.reminder);}y-=7;
   }
   if(y<115)newPage();line(`${t.end} - ${c.shift.end}`,13,true);
   for(const h of c.shiftEndHandoffs)line(`${h.area}: ${h.nextOwners.length?h.nextOwners.join(', '):t.none}`);
  }
  pdf.getPages().forEach((p,i)=>{p.drawText(`${t.page} ${i+1}/${pdf.getPageCount()} | ${document.serviceDate} | r${document.authorityRevision}`,{x:40,y:32,size:8,font});p.drawText(documentDigest,{x:40,y:20,size:7,font});});
  const bytes=await pdf.save();if(bytes.length>2*1024*1024)fail('coverall_pdf_size_limit');
  files.push({language,filename:`CoverAll_${document.serviceDate}_r${document.authorityRevision}_${language}.pdf`,sha256:hash(bytes),base64:Buffer.from(bytes).toString('base64')});
 }
 return {schema:'custodial.coverall-pdf-pair.v1',document,files};
}
