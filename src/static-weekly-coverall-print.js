import {createHash} from 'node:crypto';
import {canonicalJson,normalizeWindow,snapshotContractorCapacity} from './static-weekly-schedule-model.js';
import {suggestCoverAllAreaOrder} from './coverall-advisory-order.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const list=value=>Array.isArray(value)?value:fail('coverall_print_array_required');
const text=value=>typeof value==='string'?value:'';
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
const window=value=>normalizeWindow(value,'accepted CoverAll print window');

// Presentation only. All assignments, temporary loans and dated capacity come
// from one accepted projection read under the existing authority lock.
export function createCoverAllPrintDocument({snapshot,source,lunch,serviceDate,expectedRevision,projectionId,issuingManager=null}){
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
  if(slot.kind==='CONTRACTOR_CAPACITY')snapshotContractorCapacity(slot,serviceDate);
  if (e.payload.availability.breakChoice === 'NONE' && slot.kind !== 'CONTRACTOR_CAPACITY') fail('coverall_print_no_break_requires_typed_capacity');
  return {slotId:id,name:text(slot.label)||'CoverAll',shift:{...window(e.payload.availability.shift)},lunch:null,periods:[],...(e.payload.availability.breakChoice === 'NONE'?{breakChoice:'NONE'}:{})};
 });
 if(new Set(contractors.map(c=>c.slotId)).size!==contractors.length)fail('coverall_print_duplicate_capacity');
 const rows=list(projection.assignments).filter(r=>r.service_date===serviceDate);
 if(rows.length>2000)fail('coverall_print_assignment_limit');
 const segments=[];
 for(const r of rows){
  if(r.status!=='assigned')continue;
  const capacity=contractorSlots.get(r.owner_slot_id);
  if(capacity?.kind==='CONTRACTOR_CAPACITY'&&(r.owner_kind!=='CONTRACTOR_CAPACITY'||r.capacity_id!==capacity.id||r.owner_person_id!==null))fail('coverall_print_nonemployee_identity_mismatch');
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
   segments.push({owner,start:a,end:b,areaId:text(w.locationId),area:text(w.locationNameSnapshot)||text(w.locationCodeSnapshot),
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
  if(c.breakChoice==='NONE'&&ownLunch.length)fail('coverall_print_no_break_conflicts_with_lunch');
  if(ownLunch.length)c.lunch={start:ownLunch[0].coverage_start,end:ownLunch[0].coverage_end};
  const own=segments.filter(s=>s.owner===c.slotId);
  if(own.some(s=>s.start<c.shift.startMinute||s.end>c.shift.endMinute))fail('coverall_print_work_outside_actual_shift');
  const times=[...new Set([c.shift.startMinute,c.shift.endMinute,...own.flatMap(s=>[s.start,s.end]),...(keep0945&&c.shift.startMinute<585&&585<c.shift.endMinute?[585]:[])])].sort((a,b)=>a-b);
  for(let i=0;i<times.length-1;i++){
   const start=times[i],end=times[i+1];
   const areas=own.filter(s=>s.start<=start&&end<=s.end).map(s=>({areaId:s.areaId,area:s.area,locations:s.locations,purpose:s.purpose}));
   const unique=[...new Map(areas.map(a=>[canonicalJson(a),a])).values()].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
   const prior=c.periods.at(-1);
   if(prior&&canonicalJson(prior.areas)===canonicalJson(unique)&&!(keep0945&&start===585))prior.end=clock(end);
   else c.periods.push({start:clock(start),end:clock(end),areas:unique});
  }
  const final=own.filter(s=>s.end===c.shift.endMinute);
  c.shiftEndHandoffs=final.map(s=>({area:s.area,locations:s.locations,nextOwners:[...new Set(segments.filter(next=>next.owner!==c.slotId&&next.start<=c.shift.endMinute&&c.shift.endMinute<next.end&&next.locations.some(l=>s.locations.some(old=>old.id===l.id))).map(next=>ownerName(next.owner)))]}));
  const availability=selected.find(e=>e.payload.availability.slotId===c.slotId).payload.availability;
  for(const period of c.periods)Object.assign(period,suggestCoverAllAreaOrder({areas:period.areas,proximity:source.compiler_input.proximity,
   anchorLocationId:availability.acceptedRouteAnchorLocationId,anchorProvenance:availability.acceptedRouteProvenance}));
  c.shift={start:clock(c.shift.startMinute),end:clock(c.shift.endMinute)};
 }
 const document={schema:'custodial.coverall-accepted-print.v1',serviceDate,authorityRevision:expectedRevision,
  publicationId:publication.publication_id,projectionId,replayDigest:projection.replay_digest,lunchDocumentIdentity:lunch.document_identity,
  // September27 owner decision: Eric verifies the contractor's work himself.
  // This metadata does not invent a contractor account, phone or NFC workflow.
  show0945:keep0945,contractors,contractorCompletionRecorder:'ERIC_OPERLE_PERSONAL_VERIFICATION',
  guidanceVersion:'custodial.coverall-guidance.v1',
  managerContact:issuingManager&&typeof issuingManager.managerId==='string'&&typeof issuingManager.managerName==='string'
   &&issuingManager.managerId.trim()&&issuingManager.managerName.trim()
   ?{name:issuingManager.managerName.trim(),role:'Issuing custodial manager',method:'IN_PERSON',
    authority:'AUTHENTICATED_NAMED_MANAGER',managerId:issuingManager.managerId}:null};
 return {...document,documentDigest:hash(canonicalJson(document))};
}

const labels={
 en:{title:'CoverAll assignments',revision:'Accepted revision',date:'Service date',shift:'Shift',lunch:'Lunch',unpublished:'No contractor lunch is published; confirm with the manager.',empty:'No assigned areas in this period.',lunchCoverage:'Temporary lunch coverage',reminder:'Reminder-only work',end:'Shift-end coverage',none:'No later owner in this accepted schedule.',note:'Follow these accepted coverage times. Lunch relief does not add a full cleaning round.',page:'Page'},
 es:{title:'Asignaciones de CoverAll',revision:'Revisión aceptada',date:'Fecha de servicio',shift:'Turno',lunch:'Almuerzo',unpublished:'No hay almuerzo del contratista publicado; confirme con el encargado.',empty:'No hay áreas asignadas en este período.',lunchCoverage:'Cobertura temporal de almuerzo',reminder:'Trabajo de recordatorio',end:'Cobertura al terminar el turno',none:'No hay responsable posterior en este horario aceptado.',note:'Siga estos horarios de cobertura. El relevo de almuerzo no añade una limpieza completa.',page:'Página'},
};

const instructions={
 en:['Check the condition, supplies, fixtures and trash at your assigned locations. Perform the full cleaning OR only the individual services actually needed; do not invent a cleaning service when only a check is needed.',
  'Follow the accepted time windows and temporary lunch coverage. Taking over lunch relief does not require an extra full cleaning round.',
  'Report problems, unsafe conditions, out-of-order fixtures and missing supplies directly to the issuing custodial manager. State the location and what you observed; ask for approved product or procedure guidance when needed.',
  'Contact the issuing custodial manager in person. This schedule does not publish personal phone numbers or require a contractor phone, app account, NFC scan or employee login.',
  'Eric Operle personally verifies CoverAll completion. Do not record contractor work as if it were performed by an employee.'],
 es:['Revise el estado, los suministros, las instalaciones y la basura en los lugares asignados. Haga la limpieza completa O solo los servicios individuales realmente necesarios; no invente un servicio de limpieza cuando solo haga falta una revisión.',
  'Respete los horarios aceptados y la cobertura temporal de almuerzo. El relevo de almuerzo no requiere otra ronda de limpieza completa.',
  'Informe directamente al encargado que emitió el horario sobre problemas, condiciones inseguras, instalaciones fuera de servicio y suministros faltantes. Indique el lugar y lo observado; pida instrucciones aprobadas sobre productos o procedimientos cuando sea necesario.',
  'Hable en persona con el encargado que emitió el horario. Este documento no publica teléfonos personales ni requiere teléfono de contratista, cuenta de aplicación, lectura NFC o inicio de sesión de empleado.',
  'Eric Operle verifica personalmente la finalización del trabajo de CoverAll. No registre el trabajo del contratista como si lo hubiera realizado un empleado.'],
};

function assertCurrentPrintDocument(document){
 if(document?.schema!=='custodial.coverall-accepted-print.v1')fail('coverall_print_document_required');
 const {documentDigest,...canonical}=document;
 if(documentDigest!==hash(canonicalJson(canonical)))fail('coverall_print_document_digest_mismatch');
 if(document.guidanceVersion!=='custodial.coverall-guidance.v1'||document.managerContact?.authority!=='AUTHENTICATED_NAMED_MANAGER'
  ||document.managerContact.method!=='IN_PERSON'||!text(document.managerContact.name).trim()||!text(document.managerContact.managerId).trim())fail('coverall_print_issuing_manager_required');
}

function contractorLines(document,c,language){
 const t=labels[language],out=[];
 const add=(text,size=10,strong=false)=>out.push({text,size,strong});
 add('MEMPHIS ZOO',10,true);add(`${t.title} - ${c.name}`,19,true);
 add(`${t.date}: ${document.serviceDate} | ${t.revision}: ${document.authorityRevision}`,11,true);
 add(`${t.shift}: ${c.shift.start} - ${c.shift.end}`,12,true);
 add(`${t.lunch}: ${c.breakChoice==='NONE'?(language==='es'?'Sin descanso: elección explícita del encargado.':'No break: explicit manager choice.'):c.lunch?c.lunch.start+' - '+c.lunch.end:t.unpublished}`);
 add(`${language==='es'?'Encargado que emitió el horario':'Issuing custodial manager'}: ${document.managerContact.name}`,11,true);
 add(language==='es'?'Instrucciones y comunicación':'Instructions and reporting',12,true);
 for(const instruction of instructions[language])add(instruction);
 if(c.periods.some(p=>p.advisoryOrder?.status==='ADVISORY_VERIFIED_PROXIMITY'))add(language==='es'
  ?'El orden sugerido usa proximidad desde el inicio aceptado, no la posición actual. No son citas ni una ruta obligatoria; adapte la secuencia a las condiciones.'
  :'Suggested order uses proximity from the accepted starting area, not current position. It is not an appointment or mandatory route; adapt the sequence to conditions.');
 for(const period of c.periods){
  add(`${period.start} - ${period.end}`,13,true);
  if(!period.areas.length)add(t.empty);
  else if(period.advisoryOrder?.status==='ADVISORY_VERIFIED_PROXIMITY')add(language==='es'?'Orden sugerido por proximidad:':'Suggested proximity order:');
  else add(language==='es'?'Orden no comprobado; confirme con el encargado.':'Order unproven; confirm with the manager.');
  for(const a of period.areas){add(a.area,11,true);add(a.locations.map(l=>l.name).join('; '));if(a.purpose==='lunch_coverage')add(t.lunchCoverage);if(a.purpose==='reminder_only')add(t.reminder);}
 }
 add(`${t.end} - ${c.shift.end}`,13,true);
 for(const h of c.shiftEndHandoffs)add(`${h.area}: ${h.nextOwners.length?h.nextOwners.join(', '):t.none}`);
 return out;
}

export function createCoverAllCopyTexts(document){
 assertCurrentPrintDocument(document);
 const texts=['en','es'].map(language=>{
  const body=document.contractors.map(c=>contractorLines(document,c,language).map(line=>line.text).join('\n')).join('\n\n');
  return {language,documentDigest:document.documentDigest,text:`${body}\n\nProjection: ${document.projectionId}\n${document.documentDigest}`};
 });
 texts.push({language:'en-es',documentDigest:document.documentDigest,text:texts.map(entry=>entry.text).join('\n\n---\n\n')});
 return texts.map(entry=>({...entry,sha256:hash(entry.text)}));
}

export async function renderCoverAllPdfPair(document){
 assertCurrentPrintDocument(document);
 const {documentDigest}=document;
 const {PDFDocument,StandardFonts,rgb}=await import('pdf-lib');
 const files=[];
 for(const language of ['en','es','en-es']){
  const t=labels[language]||labels.en,pdf=await PDFDocument.create();
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
   for(const partLanguage of language==='en-es'?['en','es']:[language]){
    newPage();for(const entry of contractorLines(document,c,partLanguage)){if(entry.strong&&y<100)newPage();line(entry.text,entry.size,entry.strong);}
   }
  }
  pdf.getPages().forEach((p,i)=>{p.drawText(`${t.page} ${i+1}/${pdf.getPageCount()} | ${document.serviceDate} | r${document.authorityRevision}`,{x:40,y:32,size:8,font});p.drawText(documentDigest,{x:40,y:20,size:7,font});});
  const bytes=await pdf.save();if(bytes.length>2*1024*1024)fail('coverall_pdf_size_limit');
  files.push({language,filename:`CoverAll_${document.serviceDate}_r${document.authorityRevision}_${language}.pdf`,sha256:hash(bytes),base64:Buffer.from(bytes).toString('base64')});
 }
 return {schema:'custodial.coverall-pdf-pair.v1',document,files:files.filter(f=>f.language!=='en-es'),bilingualFile:files.find(f=>f.language==='en-es'),texts:createCoverAllCopyTexts(document)};
}
