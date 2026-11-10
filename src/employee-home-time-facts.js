import {normalizeWindow,AVAILABILITY_STATES} from './static-weekly-schedule-model.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TIME=/^(\d{2}:\d{2})(?::00)?$/;
const canonicalTime=value=>String(value??'').match(TIME)?.[1]||null;
const same=(left,right)=>typeof left==='string'&&left.toLowerCase()===String(right||'').toLowerCase();
function unavailable(day){return {contract_version:'employee-home-time-facts.v1',service_date:day.service_date,
  employee_id:day.employee_id||day.employee?.id,employee_name:day.employee_name||day.employee?.display_name,
  projection_status:day.projection_status,projection_id:day.projection_id,publication_id:day.publication_id,
  shift:null,lunch:null,source:'static_weekly_projection',reason:'published_time_facts_unavailable'};}
export function deriveHomeTimeFacts(day,record) {
  const base=unavailable(day),r=record?.roster;
  if(!r||!same(r.employee_id,base.employee_id)||!same(r.projection_id,day.projection_id)
    ||r.projection_status!=='current'||!same(r.publication_id,day.publication_id)
    ||!UUID.test(r.slot_id||'')||!UUID.test(r.version_id||'')||!Array.isArray(record.exceptions))return base;
  if(record.employee_active!==true||r.staffing_state==='departed_named_absent')return {...base,phase:'off_day',schedule_status:'off',shift:{active:false}};
  let status=r.active===true?'working':'unavailable';
  let shift=null,lunch=null;const blocked=[];
  try {
    const start=canonicalTime(r.shift_start),end=canonicalTime(r.shift_end);
    if(start&&end)shift=normalizeWindow({start,end},'published shift');
    const lunchStart=canonicalTime(r.lunch_start),lunchEnd=canonicalTime(r.lunch_end);
    if(lunchStart&&lunchEnd)lunch=normalizeWindow({start:lunchStart,end:lunchEnd},'published lunch');
    const seen=new Set();
    const commands=record.exceptions.filter(e=>e.serviceDate===day.service_date).sort((a,b)=>a.sequence-b.sequence||String(a.id).localeCompare(String(b.id)));
    for(const e of commands){
      if(!same(e.baseVersionId,r.version_id)||!same(e.publicationId,r.publication_id)
        ||e.status!=='accepted'||!UUID.test(e.id||'')||seen.has(e.id)
        ||!Number.isSafeInteger(e.sequence)||e.sequence<0)return base;
      seen.add(e.id);const payload=e.payload||{};
      if(!same(payload.slotId||e.slotId,r.slot_id))continue;
      const window=e.window||payload.window;
      if(['pto','daily_absence','partial_absence'].includes(e.type)){
        if(!window){status='absent';blocked.push({startMinute:0,endMinute:1440});}
        else blocked.push(normalizeWindow(window,'approved absence'));
      }else if(e.type==='shift_override'){
        shift=normalizeWindow(payload.shift||window,'approved shift');status=payload.status||status||'working';
      }else if(e.type==='lunch')lunch=normalizeWindow(payload.lunch||window,'approved lunch');
    }
    // The union matters: adjacent/overlapping accepted absences can cover a
    // whole shift even when no single exception covers it on its own.
    let coveredUntil=shift?.startMinute;
    for(const window of [...blocked].sort((a,b)=>a.startMinute-b.startMinute||a.endMinute-b.endMinute)){
      if(window.startMinute>coveredUntil)break;
      coveredUntil=Math.max(coveredUntil,window.endMinute);
    }
    if(!shift||status!=='working'||coveredUntil>=shift.endMinute)return {...base,phase:'off_day',schedule_status:'off',shift:{active:false}};
    if(lunch&&(lunch.startMinute<shift.startMinute||lunch.endMinute>shift.endMinute))return base;
    return {...base,reason:null,schedule_status:'scheduled',shift:{active:true,start:shift.start,end:shift.end,
      shift_start:shift.start,shift_end:shift.end,lunch_start:lunch?.start||null,lunch_end:lunch?.end||null},
      lunch:lunch?{start:lunch.start,end:lunch.end}:null,
      has_partial_absence:blocked.length>0,projection_id:r.projection_id};
  }catch{return base;}
}
// Canonical published availability already contains accepted exception effects.
// Both standard and approved-manual producers bind these rows to a dated person
// and slot. Never replay private compiler commands through the application reader.
export function deriveProjectedHomeTimeFacts(day,record) {
  const base=unavailable(day),r=record?.roster,rows=record?.availability;
  if(day.projection_status!=='current'||!r||!same(r.employee_id,base.employee_id)
    ||!same(r.projection_id,day.projection_id)||!same(r.publication_id,day.publication_id)
    ||r.projection_status!=='current'||!UUID.test(r.slot_id||'')||!UUID.test(r.version_id||'')
    ||typeof record.employee_active!=='boolean'||!Array.isArray(rows)||rows.length!==1)return base;
  const a=rows[0];
  if(!a||!same(a.slotId,r.slot_id)||!same(a.incumbentPersonId,base.employee_id)
    ||a.serviceDate!==day.service_date||a.dayOfWeek!==new Date(day.service_date+'T12:00:00Z').getUTCDay()
    ||!AVAILABILITY_STATES.has(a.status)
    ||a.blockedWindows!=null&&!Array.isArray(a.blockedWindows))return base;
  try{
    const off=()=>({...base,phase:'off_day',schedule_status:'off',shift:{active:false}});
    if(!record.employee_active||r.staffing_state==='departed_named_absent'||a.status!=='working')return off();
    const shift=normalizeWindow(a.shift,'published projected shift');
    const lunch=a.lunch==null?null:normalizeWindow(a.lunch,'published projected lunch');
    const blocked=(a.blockedWindows||[]).map(w=>normalizeWindow(w,'published absence'));
    let coveredUntil=shift.startMinute;
    for(const w of [...blocked].sort((a,b)=>a.startMinute-b.startMinute||a.endMinute-b.endMinute)){
      if(w.startMinute>coveredUntil)break;coveredUntil=Math.max(coveredUntil,w.endMinute);
    }
    if(coveredUntil>=shift.endMinute)return off();
    if(lunch&&(lunch.startMinute<shift.startMinute||lunch.endMinute>shift.endMinute))return base;
    return {...base,reason:null,schedule_status:'scheduled',shift:{active:true,start:shift.start,end:shift.end,
      shift_start:shift.start,shift_end:shift.end,lunch_start:lunch?.start||null,lunch_end:lunch?.end||null},
      lunch:lunch?{start:lunch.start,end:lunch.end}:null,has_partial_absence:blocked.length>0};
  }catch{return base;}
}
export async function readHomeTimeFacts({day,employeeId,runReadOnlySql}) {
  const fallback=unavailable(day);
  if(!UUID.test(employeeId||'')||!UUID.test(day.projection_id||'')||!UUID.test(day.publication_id||'')
    ||!/^\d{4}-\d{2}-\d{2}$/.test(day.service_date||''))return fallback;
  if(day.authority_scope==='dated_transition'){
    if(!UUID.test(day.publication_id||''))return fallback;
    try{
      const rows=await runReadOnlySql(`select public.static_weekly_v27_read_home_time_facts('${day.service_date}'::date,'${employeeId}'::uuid,'${day.publication_id}'::uuid,'${day.projection_id}'::uuid) as facts`);
      const facts=Array.isArray(rows)&&rows.length===1?rows[0].facts:null;
      return facts?.projection_id===day.projection_id&&facts?.publication_id===day.publication_id
        &&facts?.employee_id===employeeId&&facts?.service_date===day.service_date
        &&facts?.projection_status==='current'&&facts?.candidate_revision===day.candidate_revision
        &&facts?.contract_version==='employee-home-time-facts.v1'?facts:fallback;
    }catch{return fallback;}
  }
  // The existing security-definer canonical reader performs current exception,
  // staffing and projection checks inside its authorized boundary. Bind that
  // fresh result to this employee day's exact immutable projection. No direct
  // invocation of private digest/exception helpers is allowed for this reader.
  const sql=`select jsonb_build_object('roster',to_jsonb(r),'employee_active',emp.active,
      'availability',(select jsonb_agg(jsonb_build_object('slotId',a->'slotId','incumbentPersonId',a->'incumbentPersonId',
        'serviceDate',a->'serviceDate','dayOfWeek',a->'dayOfWeek','status',a->'status',
        'shift',a->'shift','lunch',a->'lunch','blockedWindows',a->'blockedWindows')) from jsonb_array_elements(
        p.projection_envelope#>'{authority,projectionAvailability}') a
        where a->>'serviceDate'='${day.service_date}' and a->>'incumbentPersonId'=r.employee_id::text)) as facts
    from public.static_weekly_v6_read_roster('${day.service_date}'::date) r
    join public.employees emp on emp.id=r.employee_id
    join public.weekly_schedule_compiled_projections p on p.projection_id=r.projection_id
      and p.publication_id=r.publication_id and p.version_id=r.version_id
    where r.employee_id='${employeeId}'::uuid and r.projection_id='${day.projection_id}'::uuid
      and r.publication_id='${day.publication_id}'::uuid and r.governed is true
      and r.projection_status='current' and '${day.service_date}'::date between p.week_start and p.week_end`;
  try{const rows=await runReadOnlySql(sql);return Array.isArray(rows)&&rows.length===1?deriveProjectedHomeTimeFacts(day,rows[0].facts):fallback;}
  catch{return fallback;}
}
