import {projectOperationsEvents} from './operations-board.js';

// Owner-authorized link access to operational display facts. This is a separate
// read surface, not an anonymous manager session or a grant on manager routes.
const scalar = value => value === null || ['string','number','boolean'].includes(typeof value);
function pick(value, fields) {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value || {}, key))
    .map(key => {
      const field = value[key];
      // The PostgreSQL reader returns timestamp columns as Date objects. Match
      // normal JSON serialization before filtering approved display fields.
      if (field instanceof Date) {
        if (!Number.isFinite(field.getTime())) throw Error('public_display_source_invalid');
        return [key, field.toISOString()];
      }
      return [key, field];
    }).filter(([, field]) => scalar(field)));
}
function rows(value, fields, arrays = []) {
  if (!Array.isArray(value) || value.length > 10000) throw Error('public_display_source_invalid');
  return value.map(row => ({...pick(row, fields), ...Object.fromEntries(arrays
    .filter(key => Array.isArray(row?.[key]) && row[key].every(item => typeof item === 'string'))
    .map(key => [key, [...row[key]]]))}));
}
const LOCATION = ['location_id','location_code','location_name','location_type','form_type',
  'latest_employee_name','latest_completed_at','latest_checked_at','latest_completed_session_id',
  'latest_completed_session_uuid','latest_completed_at_display','open_ticket_count','status_code',
  'status_color','duration_display','open_session_status','open_session_uuid',
  'open_session_employee_name','open_session_started_at_display','latest_verified_check_at','latest_verified_checker_name'];
const TICKET = ['ticket_id','location_code','location_name','maintenance_issue','reported_by',
  'fixture_type','fixture_identifier','issue_source','out_of_order','date_submitted_display','created_at_display'];
export function publicDashboardDetails(data) {
  if (data?.meta?.contracts?.dashboard !== 'dashboard.v1') throw Error('public_dashboard_contract_unavailable');
  return {
    snapshot: pick(data.snapshot, ['snapshot_at','operational_day_start','active_sessions','pending_submit_sessions',
      'closed_sessions_today','open_ticket_count','overdue_locations','due_soon_locations','in_progress_locations','active_locations']),
    meta: {generated_at:data.meta.generated_at, contracts:{dashboard:'dashboard.v1'},audience:'public_readonly'},
    restrooms: rows(data.restrooms, LOCATION, ['services_performed']),
    exhibits: rows(data.exhibits, LOCATION, ['services_performed']),
    open_tickets: rows(data.open_tickets, TICKET),
  };
}
function mailFeed(feed, fields) {
  if (!['current','snapshot'].includes(feed?.state)) return {state:'unavailable',reason:'source_unavailable',rows:[]};
  return {...pick(feed,['state','generated_at','source_latest_at','coverage','mailbox_completeness_verified']),rows:rows(feed.rows,fields)};
}
export function publicOperationsDetails(events, mail, now = new Date(), city = null) {
  // Addressed employee messages and unresolved audiences are not a public event feed.
  const visible = events.filter(row => ['assigned_location','all_working_employees'].includes(row?.audience_scope));
  return {schema:'custodial.operations-board.v1',generated_at:now.toISOString(),timezone:'America/Chicago',
    events:projectOperationsEvents(visible),
    schools:mailFeed(mail?.schools,['id','order_id','name','date','arrival_at','departure_at','departure_source',
      'status','issue','students','chaperones','teachers','unclassified','buses','adults','total']),
    spiceworks:mailFeed(mail?.spiceworks,['ticket_id','title','category','assignee','status','custodial','active']),
    spiceworks_activity:mailFeed(mail?.spiceworks_activity,['ticket_id','title','kind','from','to','at']),
    city:mailFeed(city,['id','work_order_id','facility','facility_label_conflict','description','status','requested_at','source_close_date','updated_at']),
    staff_locations:{state:'unavailable',reason:'qualified_location_projection_not_bound',rows:[]},school_departure_policy:null};
}
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
export async function readPublicSchedule(runReadOnlySql, serviceDate) {
  if (!date(serviceDate)) throw Object.assign(Error('invalid_service_date'), {status:400});
  // One statement binds the roster and assignments to the same current accepted
  // publication/projection. Stale/absent authority returns no claimed schedule.
  const result = await runReadOnlySql(`select jsonb_build_object(
    'service_date','${serviceDate}','projection_status',a.projection_status,
    'publication_id',a.publication_id,'projection_id',a.projection_id,
    'roster',coalesce((select jsonb_agg(to_jsonb(r)) from public.static_weekly_v6_read_roster('${serviceDate}'::date) r
      where a.governed and a.projection_status='current' and r.publication_id=a.publication_id and r.projection_id=a.projection_id),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(s)) from public.static_weekly_v6_read_schedule_segments('${serviceDate}'::date) s
      where a.governed and a.projection_status='current' and s.publication_id=a.publication_id and s.projection_id=a.projection_id),'[]'::jsonb)
    ) as data from public.static_weekly_v6_schedule_authority_state('${serviceDate}'::date) a`);
  const data = Array.isArray(result) && result.length === 1 ? result[0].data : null;
  if (!data || data.projection_status !== 'current' || !data.publication_id || !data.projection_id)
    return {service_date:serviceDate,projection_status:'unavailable',roster:[],assignments:[]};
  return {...pick(data,['service_date','projection_status','publication_id','projection_id']),
    roster:rows(data.roster,['employee_name','shift_start','shift_end','lunch_start','lunch_end','active','slot_label','staffing_state']),
    assignments:rows(data.assignments,['group_name','assigned_employee_name','coverage_start','coverage_end','status','coverage_purpose','service_mode'],['included_locations'])};
}
export function installPublicDashboardDetails(app, {readSummary, readEvents, readMail, readCity=async()=>null, runReadOnlySql, now=()=>new Date()}) {
  const readers = {
    summary:async()=>publicDashboardDetails(await readSummary()),
    operations:async()=>{
      const [events,mail,city] = await Promise.all([readEvents(),readMail().catch(()=>null),readCity().catch(()=>null)]);
      return publicOperationsDetails(events,mail,now(),city);
    },
    schedule:req=>readPublicSchedule(runReadOnlySql,req.query.service_date || now().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})),
  };
  for (const [path,read] of Object.entries(readers)) {
    app.get('/viewer-api/'+path,async(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      try {res.json({ok:true,data:await read(req)});}
      catch(error) {res.status(error.status===400?400:503).json({ok:false,error:error.status===400?'Invalid service date.':'Operational source unavailable.'});}
    });
    app.all('/viewer-api/'+path,(_req,res)=>res.status(405).json({ok:false,error:'Read-only dashboard.'}));
  }
}
