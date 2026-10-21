"""Synthetic private-reader and complete captured-view schema exercise."""
from pathlib import Path
import json,re

def exercise(sql,check,root,prefix,manifest,uid):
 fixture=json.loads((root/'scripts/fixtures/dashboard-reader-live-catalog-20261021.json').read_text())
 protected=next((root/'release/dashboard-reader/forward-source').glob('*_dashboard_original_completion_reader_restoration.sql')).read_text()
 view_migration=next((root/'release/dashboard-reader/forward-source').glob('*_dashboard_verified_check_view_contract.sql')).read_text()
 # Add only synthetic fixture columns with observed catalog types.
 setup=prefix
 for c in fixture['protected_columns']:
  setup+='create table if not exists '+c['relation_name']+'(fixture_anchor boolean);\n'
  setup+='alter table '+c['relation_name']+' add column if not exists '+c['column_name']+' '+c['sql_type']+';\n'
 setup+='''
create schema custodial_release_identity authorization postgres;
revoke all on schema custodial_release_identity from public,anon,authenticated,service_role,custodial_application_reader;
grant usage on schema custodial_release_identity to custodial_application_reader;
do $$begin
 if not exists(select 1 from pg_roles where rolname='static_weekly_control_plane') then create role static_weekly_control_plane nologin;end if;
 if not exists(select 1 from pg_roles where rolname='static_weekly_release_operator') then create role static_weekly_release_operator nologin;end if;
end$$;
alter table public.sessions enable row level security;
alter table public.sessions force row level security;
alter table public.completion_responses enable row level security;
alter table public.completion_responses force row level security;
-- Synthetic owner-only fixture policy, never part of product migrations.
create policy fixture_owner_only on public.sessions to postgres using(true) with check(true);
create policy fixture_owner_only on public.completion_responses to postgres using(true) with check(true);
'''
 sql(setup)
 sql(prefix+protected)
 check('private canonical body exact',"select md5(prosrc) from pg_proc where oid='custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure;",manifest['protected_dashboard_reader']['body_md5'])
 check('private reader owner security path exact',"select proowner='postgres'::regrole and prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, public'] from pg_proc where oid='custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure;",'t')
 check('private ACL exact reader and owner only',"select string_agg(r.rolname||':'||a.privilege_type||':'||a.is_grantable::text,',' order by r.rolname) from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee where p.oid='custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure;",'custodial_application_reader:EXECUTE:false,postgres:EXECUTE:false')
 sql(prefix+'''update public.custodial_offline_actor_contexts set
 started_at=public.operational_day_start(now())+interval '30 minutes',
 native_completed_at=public.operational_day_start(now())+interval '31 minutes',
 snapshot_id=repeat('c',64),snapshot_employee_id=employee_id,snapshot_assignment_epoch=1,assignment_epoch=1;
update public.sessions set started_at=(select started_at from public.custodial_offline_actor_contexts limit 1),
 ended_at=(select native_completed_at from public.custodial_offline_actor_contexts limit 1),session_uuid='synthetic-session-uuid';
update public.custodial_offline_reconciliation_records set result_json='{"status":"closed"}',payload_fingerprint=repeat('b',64),created_at=now();
update public.custodial_offline_scan_event_evidence set event_payload=jsonb_set(event_payload,'{scanned_at}',
 to_jsonb(public.custodial_canonical_utc_millis((select native_completed_at from public.custodial_offline_actor_contexts limit 1))));
''')
 sql(prefix+"insert into public.employees(id,display_name) values('"+uid(6)+"','Synthetic Custodian');")
 call='custodial_release_identity.read_current_original_dashboard_completions_v1()'
 check('private reader returns accepted exact original to restricted caller',"set role custodial_application_reader;select latest_original_completion->>'state' from "+call+';','SERVER_ACCEPTED_ORIGINAL_RECORD')
 changes=[('original snapshot employee mismatch','custodial_offline_actor_contexts',"snapshot_employee_id='"+uid(99)+"'"),('original snapshot epoch mismatch','custodial_offline_actor_contexts','snapshot_assignment_epoch=2'),('original snapshot digest malformed','custodial_offline_actor_contexts',"snapshot_id='bad'"),('original receipt not closed','custodial_offline_reconciliation_records',"result_json='{}'"),('original different native employee','completion_responses',"submitted_by_employee_id='"+uid(99)+"'"),('original provider evidence refused','custodial_offline_scan_event_evidence',"event_payload=jsonb_set(event_payload,'{payload_json,entry_source}','\"provider\"')"),('original check has services contradiction','completion_responses',"response_json=jsonb_set(response_json,'{services_performed}','[\"restroom\"]')")]
 for name,table,change in changes:
  check(name,prefix+'begin;update public.'+table+' set '+change+';set local role custodial_application_reader;select count(*) from '+call+';rollback;','0')
 denial=sql('set role service_role;select * from '+call+';',False)
 assert 'permission denied' in denial
 check('private reader rerun idempotent',prefix+protected+"select count(*) from pg_proc where oid='custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure;",'1')
 # Build the complete captured predecessor, including all output columns and
 # exact SQL. Only schedule/helper *fixture implementations* are synthetic.
 extra=prefix+'''
alter table public.sessions add column duration_minutes integer,add column duration_display text,add column created_at timestamptz;
alter table public.completion_responses add column submitted_at timestamptz;
create table public.locations(id uuid,location_code text,location_name text,location_type text,form_type text,active boolean);
create table public.scan_events(location_id uuid,scanned_at timestamptz,created_at timestamptz);
create table public.maintenance_tickets(location_id uuid,status text);
'''
 # Stable helper signatures match the live view's full captured output contract.
 helpers={
 'sch_service_date':('p_ref timestamptz','date',"select (p_ref at time zone 'America/Chicago'-interval '4 hours')::date"),
 'static_weekly_v6_schedule_authority_state':('p_day date','table(service_date date,governed boolean,authority_source text,projection_status text,version_id uuid,publication_id uuid,projection_id uuid,projection_authority_revision bigint,staffing_authority_revision bigint,week_start date)',"select p_day,true,'fixture'::text,'fixture'::text,null::uuid,null::uuid,null::uuid,1::bigint,1::bigint,p_day"),
 'custodial_operational_location_assignments':('p_day date','table(service_date date,authority_source text,projection_status text,version_id uuid,publication_id uuid,projection_id uuid,occurrence_id uuid,location_group_id uuid,group_code text,group_name text,assigned_employee_id uuid,assigned_employee_name text,assignment_status text,coverage_start time,coverage_end time,location_id uuid,location_code text,location_name text,form_type text)',"select p_day,'fixture'::text,'fixture'::text,null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::text,null::text,null::uuid,null::text,null::text,time '04:00',time '23:00',id,location_code,location_name,form_type from public.locations"),
 'custodial_open_work':('','table(open_work_id uuid,source_kind text,session_id uuid,context_id uuid,session_uuid text,client_session_id text,location_id uuid,location_code text,location_name text,employee_id uuid,employee_name text,device_id uuid,device_identifier text,status text,started_at timestamptz,ended_at timestamptz,duration_minutes integer,duration_display text,created_at timestamptz)',"select null::uuid,null::text,null::uuid,null::uuid,null::text,null::text,null::uuid,null::text,null::text,null::uuid,null::text,null::uuid,null::text,null::text,null::timestamptz,null::timestamptz,null::integer,null::text,null::timestamptz where false")}
 for name,(args,ret,body) in helpers.items():
  extra+='create function public.'+name+'('+args+') returns '+ret+' language sql stable as $$'+body+'$$;\n'
  signature='public.'+name+'('+('' if name=='custodial_open_work' else 'timestamptz' if name=='sch_service_date' else 'date')+')'
  extra+='grant execute on function '+signature+' to custodial_application_reader;\n'
 extra+='create view public.v_location_dashboard_status as '+fixture['view']['definition_sql']+'\n'
 extra+='grant select on public.v_location_dashboard_status to custodial_application_reader;\n'
 utilities=(root/'supabase/migrations/20260916010000_project_native_start_into_operational_truth.sql').read_text()
 extra+=re.search(r'create or replace function public\.custodial_release_authority_current_view_definition\([\s\S]*?\$function\$;',utilities,re.I).group()+'\n'
 extra+="insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(800001,'view','public.v_location_dashboard_status',public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status'),'synthetic');\n"
 sql(extra)
 livecols=sql("select string_agg(attname,',' order by attnum) from pg_attribute where attrelid='public.v_location_dashboard_status'::regclass and attnum>0 and not attisdropped;").split(',')
 old_md5=sql("select md5(pg_get_viewdef('public.v_location_dashboard_status'::regclass,true));")
 # Metadata hashes necessarily differ for four synthetic helper bodies. The
 # exact full captured old-view SQL and canonical new-view SQL remain unchanged.
 substitute=view_migration
 substitutions={}
 for h in fixture['helpers']:
  if h['signature'] in ['public.sch_service_date(timestamptz)','public.static_weekly_v6_schedule_authority_state(date)','public.custodial_operational_location_assignments(date)','public.custodial_open_work()']:
   actual=sql("select md5(pg_get_functiondef('"+h['signature']+"'::regprocedure));")
   substitute=substitute.replace(h['definition_md5'],actual);substitutions[h['signature']]=actual
 if old_md5!=fixture['view']['definition_md5']:
  # PostgreSQL major-version pretty printing is recorded, never forced into a
  # claimed production match. Only the fixture predecessor constant is adjusted.
  substitute=substitute.replace(fixture['view']['definition_md5'],old_md5)
 sql(prefix+substitute)
 newcols=sql("select string_agg(attname,',' order by attnum) from pg_attribute where attrelid='public.v_location_dashboard_status'::regclass and attnum>0 and not attisdropped;").split(',')
 assert newcols[:-1]==livecols and newcols[-1]=='latest_checked_at',(livecols,newcols)
 check('complete captured view column order preserved with appended latest_checked_at',"select count(*) from pg_attribute where attrelid='public.v_location_dashboard_status'::regclass and attname='latest_checked_at' and atttypid='timestamptz'::regtype;",'1')
 check('canonical view restricted reader executes actual query',"set role custodial_application_reader;select count(*) from public.v_location_dashboard_status;",'0')
 check('restored view preserves postgres owner and NULL options',"select relowner='postgres'::regrole and reloptions is null from pg_class where oid='public.v_location_dashboard_status'::regclass;",'t')
 check('view and private reader recovery capture exact',"select count(*) from public.custodial_release_authority_restore_inventory where (object_kind='view' and object_identity='public.v_location_dashboard_status' and definition_sql=public.custodial_release_authority_current_view_definition(object_identity)) or (object_kind='function' and to_regprocedure(object_identity)='custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure and definition_sql=pg_get_functiondef(to_regprocedure(object_identity)));",'2')
 return {'full_captured_predecessor_columns':len(livecols),'old_view_fixture_md5':old_md5,'observed_live_view_md5':fixture['view']['definition_md5'],'exact_canonical_view_sql':True,'fixture_only_expected_helper_hash_substitutions':substitutions,'view_guard_prettyprint_substitution':old_md5!=fixture['view']['definition_md5'],'production_metadata_not_claimed':True}
