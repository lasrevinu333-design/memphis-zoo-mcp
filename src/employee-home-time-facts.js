import {normalizeWindow} from './static-weekly-schedule-model.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TIME=/^(\d{2}:\d{2})(?::00)?$/;
const canonicalTime=value=>String(value??'').match(TIME)?.[1]||null;
const same=(left,right)=>typeof left==='string'&&left.toLowerCase()===String(right||'').toLowerCase();
function unavailable(day){return {contract_version:'employee-home-time-facts.v1',service_date:day.service_date,
  employee_id:day.employee_id||day.employee?.id,employee_name:day.employee_name||day.employee?.display_name,
  projection_status:day.projection_status,shift:null,lunch:null,source:'static_weekly_projection',reason:'published_time_facts_unavailable'};}
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
    if(!shift||status!=='working'||blocked.some(window=>window.startMinute<=shift.startMinute&&window.endMinute>=shift.endMinute))return {...base,phase:'off_day',schedule_status:'off',shift:{active:false}};
    if(lunch&&(lunch.startMinute<shift.startMinute||lunch.endMinute>shift.endMinute))return base;
    return {...base,reason:null,schedule_status:'scheduled',shift:{active:true,start:shift.start,end:shift.end,
      shift_start:shift.start,shift_end:shift.end,lunch_start:lunch?.start||null,lunch_end:lunch?.end||null},
      lunch:lunch?{start:lunch.start,end:lunch.end}:null,
      has_partial_absence:blocked.length>0,projection_id:r.projection_id};
  }catch{return base;}
}
export async function readHomeTimeFacts({day,employeeId,runReadOnlySql}) {
  const fallback=unavailable(day);
  if(!UUID.test(employeeId||'')||!UUID.test(day.projection_id||'')
    ||!/^\d{4}-\d{2}-\d{2}$/.test(day.service_date||''))return fallback;
  // Bind to the same already validated publication/projection as the employee day.
  // Its exception-set digest prevents an intervening unpublished change looking current.
  const sql=`select jsonb_build_object('roster',to_jsonb(r),'employee_active',emp.active,
      'exceptions',public.static_weekly_compiler_exception_set(p.publication_id,p.week_start)) as facts
    from public.static_weekly_v6_read_roster('${day.service_date}'::date) r
    join public.employees emp on emp.id=r.employee_id
    join public.weekly_schedule_compiled_projections p on p.projection_id=r.projection_id
    where r.employee_id='${employeeId}'::uuid and r.projection_id='${day.projection_id}'::uuid
      and r.projection_status='current'
      and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(p.publication_id,p.week_start))`;
  try{const rows=await runReadOnlySql(sql);return Array.isArray(rows)&&rows.length===1?deriveHomeTimeFacts(day,rows[0].facts):fallback;}
  catch{return fallback;}
}
