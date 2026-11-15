import {deriveHomeTimeFacts} from './employee-home-time-facts.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const minute=value=>{
  const m=/^(\d{2}):(\d{2})(?::00)?$/.exec(String(value??''));
  return m&&Number(m[1])<=24&&Number(m[2])<60&&(m[1]!=='24'||m[2]==='00')?Number(m[1])*60+Number(m[2]):null;
};
const clock=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;

// Display summary only. Keep the actual per-location assignments and clocks.
// Never describe an OPEN gap or a restricted location as zoo-wide ownership.
export function deriveZooWideCoverage(day,document){
  if(day?.projection_status!=='current'||!UUID.test(day.employee_id||'')
    ||!Array.isArray(document?.roster)||!document.roster.length
    ||!Array.isArray(document.exceptions)||!Array.isArray(document.assignments))return null;
  const workers=[],seen=new Set();
  for(const record of document.roster){
    const employee=record.roster?.employee_id;
    if(employee==null)continue; // An open position is not a custodian.
    if(!UUID.test(employee)||seen.has(employee))return null;
    seen.add(employee);
    const facts=deriveHomeTimeFacts({...day,employee_id:employee},{...record,exceptions:document.exceptions});
    if(facts.shift?.active===false)continue;
    if(!facts.shift||facts.has_partial_absence)return null;
    workers.push({employee,start:minute(facts.shift.start),end:minute(facts.shift.end),lunchEnd:minute(facts.lunch?.end)});
  }
  const own=workers.find(w=>w.employee===day.employee_id);
  if(!own||workers.some(w=>w.start===null||w.end===null)||workers.some(w=>w.employee!==own.employee&&w.end>=own.end))return null;
  const start=Math.max(585,own.start,own.lunchEnd??own.start,...workers.filter(w=>w.employee!==own.employee).map(w=>w.end));
  if(start>=own.end)return null;
  const rows=document.assignments,locations=new Set(),boundaries=new Set([start,own.end]);
  for(const row of rows){
    if(row.service_date!==day.service_date||row.projection_id!==day.projection_id
      ||row.publication_id!==day.publication_id||row.projection_status!=='current'||!UUID.test(row.location_id||''))return null;
    const from=minute(row.coverage_start),to=minute(row.coverage_end);
    if(from===null||to===null||from>=to)return null;
    locations.add(row.location_id);
    for(const at of [from,to])if(start<at&&at<own.end)boundaries.add(at);
  }
  if(!locations.size)return null;
  for(const at of [...boundaries].filter(at=>at<own.end)){
    const active=rows.filter(row=>minute(row.coverage_start)<=at&&at<minute(row.coverage_end));
    for(const location of locations){
      const owners=active.filter(row=>row.location_id===location);
      if(owners.length!==1||owners[0].assigned_employee_id!==own.employee
        ||String(owners[0].assignment_status).toLowerCase()!=='assigned')return null;
    }
  }
  return {schema:'employee-zoo-wide-coverage.v1',service_date:day.service_date,
    employee_id:own.employee,publication_id:day.publication_id,projection_id:day.projection_id,
    start:clock(start),end:clock(own.end)};
}

export async function readZooWideCoverage({day,runReadOnlySql}){
  if(day?.projection_status!=='current'||day.authority_scope==='dated_transition'
    ||!UUID.test(day.employee_id||'')||!UUID.test(day.projection_id||'')||!UUID.test(day.publication_id||'')
    ||!/^\d{4}-\d{2}-\d{2}$/.test(day.service_date||''))return null;
  // The same accepted projection supplies roster, exceptions and location
  // ownership in one read. No roster identities are returned to the phone.
  const sql=`select jsonb_build_object(
    'roster',(select jsonb_agg(jsonb_build_object('roster',to_jsonb(r),'employee_active',e.active))
      from public.static_weekly_v6_read_roster('${day.service_date}'::date) r
      left join public.employees e on e.id=r.employee_id
      where r.projection_id=p.projection_id and r.publication_id=p.publication_id and r.projection_status='current'),
    'exceptions',public.static_weekly_compiler_exception_set(p.publication_id,p.week_start),
    'assignments',(select jsonb_agg(to_jsonb(a)) from public.custodial_operational_location_assignments('${day.service_date}'::date) a
      where a.projection_id=p.projection_id and a.publication_id=p.publication_id)
    ) as facts
    from public.weekly_schedule_compiled_projections p
    join public.static_weekly_v6_schedule_authority_state('${day.service_date}'::date) current_plan
      on current_plan.projection_id=p.projection_id and current_plan.publication_id=p.publication_id
    where p.projection_id='${day.projection_id}'::uuid and p.publication_id='${day.publication_id}'::uuid
      and current_plan.projection_status='current'
      and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(p.publication_id,p.week_start))`;
  try{
    const rows=await runReadOnlySql(sql);
    return Array.isArray(rows)&&rows.length===1?deriveZooWideCoverage(day,rows[0].facts):null;
  }catch{return null;} // Preserve the ordinary location list when unavailable.
}
