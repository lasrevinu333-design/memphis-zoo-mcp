"""Live-shaped RLS boundary and independent check/clean ordering cases."""
from pathlib import Path
import json,hashlib,re

def exercise(sql,check,root,prefix,manifest,uid):
 migration=next((root/'release/dashboard-reader/forward-source').glob('*_dashboard_verified_check_private_reader.sql')).read_text()
 direct=(root/'release/dashboard-reader/verified-check-query-preimage.sql').read_text().strip()
 meta=manifest['independent_verified_check_reader']
 original="select md5(pg_get_functiondef('custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure));"
 cleaning_view="select public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status');"
 original_before=sql(original);view_before=sql(cleaning_view)
 # Model exactly the observed live boundary: SQL table/column privilege exists,
 # FORCE RLS has no session/response policies, and the existing migration owner
 # has BYPASSRLS. These fixture privileges are never product migration grants.
 sql('''alter role postgres nosuperuser bypassrls;
set role postgres;
drop policy fixture_owner_only on public.sessions;
drop policy fixture_owner_only on public.completion_responses;
grant select on public.custodial_offline_reconciliation_records,public.custodial_offline_actor_contexts,
 public.custodial_offline_scan_event_evidence,public.sessions,public.completion_responses to custodial_application_reader;
grant select(id,display_name) on public.employees to custodial_application_reader;
-- The fixture schedule helper is INVOKER and reads its synthetic locations.
grant select on public.locations to custodial_application_reader;
''')
 check('live-shaped protected relations FORCE RLS without policies',"select count(*) from pg_class c where c.oid in('public.sessions'::regclass,'public.completion_responses'::regclass) and c.relrowsecurity and c.relforcerowsecurity and not exists(select 1 from pg_policy p where p.polrelid=c.oid);",'2')
 check('direct checked join silently empty for normal restricted reader',"set role custodial_application_reader;select count(*) from ("+direct+") result;",'0')
 check('same genuine checked row exists through owner boundary',prefix+'select count(*) from ('+direct+') result;','1')
 sql(prefix+migration)
 check('new fixed reader returns genuine check through same restricted caller',"set role custodial_application_reader;select count(*) from custodial_release_identity.read_current_verified_dashboard_checks_v1();",'1')
 check('new reader exact body owner path security',"select md5(prosrc)="+"'"+meta['body_md5']+"' and proowner='postgres'::regrole and prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, public'] from pg_proc where oid='custodial_release_identity.read_current_verified_dashboard_checks_v1()'::regprocedure;",'t')
 check('new reader exact private EXECUTE ACL',"select string_agg(r.rolname||':'||a.privilege_type||':'||a.is_grantable::text,',' order by r.rolname) from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee where p.oid='custodial_release_identity.read_current_verified_dashboard_checks_v1()'::regprocedure;",'custodial_application_reader:EXECUTE:false,postgres:EXECUTE:false')
 # Preserve all existing source data; clone into distinct synthetic locations.
 def quote(v):return "'"+(json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list)) else str(v)).replace("'","''")+"'"
 tables=['custodial_offline_reconciliation_records','custodial_offline_actor_contexts','sessions','completion_responses','custodial_offline_scan_event_evidence']
 bases={t:json.loads(sql('select row_to_json(t)::text from public.'+t+' t limit 1;')) for t in tables}
 def at(minutes):return sql("select public.custodial_canonical_utc_millis(public.operational_day_start(now())+make_interval(mins=>"+str(minutes)+"));")
 def visit(n,location,minutes,work='checked_no_cleaning_needed',retained=False,bad_evidence=False):
  stamp=at(minutes);start=at(minutes-1)
  values={t:dict(v) for t,v in bases.items()}
  common={'context_id':uid(n+1),'credential_id':uid(2),'device_id':uid(3),'location_id':location,
   'occurrence_id':uid(n+5),'occurrence_fingerprint':'synthetic-occurrence-'+str(n),'client_session_id':'synthetic-session-'+str(n)}
  response={'work_result':work,'services_performed':[] if work=='checked_no_cleaning_needed' else ['Full cleaning services']}
  ctx=values['custodial_offline_actor_contexts'];ctx.update(common);ctx.update({'started_at':start,'native_completed_at':stamp,'employee_id':uid(6),
   'native_scan_entry_id':uid(n+10),'native_finish_scan_entry_id':uid(n+11),
   'snapshot_id':None if retained else 'c'*64,'snapshot_employee_id':None if retained else uid(6),
   'snapshot_assignment_epoch':None if retained else 1,'assignment_epoch':1})
  session=values['sessions'];session.update({'id':uid(n+7),'location_id':location,'device_id':uid(3),'employee_id':uid(6),
   'client_session_id':common['client_session_id'],'session_uuid':'synthetic-uuid-'+str(n),'started_at':start,'ended_at':stamp})
  completion=values['completion_responses'];completion.update({'id':uid(n+8),'location_id':location,'device_id':uid(3),'submitted_by_employee_id':uid(6),
   'session_id':uid(n+7),'client_completion_id':'synthetic-completion-'+str(n),'response_json':response,'submitted_at':stamp})
  receipt=values['custodial_offline_reconciliation_records'];receipt.update(common);receipt.update({'reconciliation_id':uid(n+9),
   'session_id':uid(n+7),'completion_response_id':uid(n+8),'client_completion_id':completion['client_completion_id'],
   'payload_json':{'response_json':response},'result_json':{'status':'closed'},'created_at':stamp})
  evidence=values['custodial_offline_scan_event_evidence'];evidence.update({'context_id':uid(n+1),'reconciliation_id':uid(n+9),
   'session_id':uid(n+7),'client_event_id':uid(n+11),'event_payload':{'event_type':'scan_finish','result':'ok','scanned_at':stamp,
    'payload_json':{'entry_source':'provider' if bad_evidence else 'native-nfc'}}})
  for table,row in values.items():
   sql(prefix+'insert into public.'+table+' select (jsonb_populate_record(null::public.'+table+','+quote(row)+'::jsonb)).*;')
  return {'session':'synthetic-uuid-'+str(n),'completion':completion['client_completion_id'],'finish':stamp,'context':uid(n+1),'reconciliation':uid(n+9),'location':location}
 def add_location(n):
  location=uid(n)
  sql(prefix+"insert into public.locations(id,location_code,location_name,location_type,form_type,active) values('"+location+"','R"+str(n)+"','Synthetic ordering location','restroom','restroom',true);")
  return location
 a=add_location(604);a_check=visit(610,a,20);a_clean=visit(630,a,30,'full')
 b=add_location(704);b_clean=visit(710,b,20,'full');b_check=visit(730,b,30)
 c=add_location(804);retained=visit(810,c,15,retained=True)
 d=add_location(904);old=visit(910,d,-10)
 e=add_location(1004);e_clean=visit(1010,e,10,'full');provider=visit(1030,e,40,bad_evidence=True)
 def check_row(location):return "select row_to_json(r)::text from custodial_release_identity.read_current_verified_dashboard_checks_v1() r where location_id='"+location+"';"
 for label,location,checked,cleaned in [('check-before-clean',a,a_check,a_clean),('clean-before-check',b,b_check,b_clean)]:
  got=json.loads(sql('set role custodial_application_reader;'+check_row(location)))
  assert got['latest_verified_check_session_uuid']==checked['session']
  assert got['latest_verified_check_completion_id']==checked['completion']
  assert got['latest_verified_check_at']==checked['finish'].replace('Z','+00:00') or __import__('datetime').datetime.fromisoformat(got['latest_verified_check_at'])==__import__('datetime').datetime.fromisoformat(checked['finish'].replace('Z','+00:00'))
  check(label+' genuine cleaning survives independent check selection',"set role custodial_application_reader;select latest_completed_session_uuid from public.v_location_dashboard_status where location_id='"+location+"';",cleaned['session'])
  check(label+' original record remains latest overall',"set role custodial_application_reader;select latest_original_completion->>'session_uuid' from custodial_release_identity.read_current_original_dashboard_completions_v1() where location_id='"+location+"';",cleaned['session'] if label=='check-before-clean' else checked['session'])
  check(label+' check selected independently by same fixed predicate',prefix+'select latest_verified_check_session_uuid from ('+direct+") r where location_id='"+location+"';",checked['session'])
 check('retained genuine check without new snapshot metadata remains visible',"set role custodial_application_reader;select latest_verified_check_session_uuid from custodial_release_identity.read_current_verified_dashboard_checks_v1() where location_id='"+c+"';",retained['session'])
 check('retained check does not invent stronger original-completion snapshot proof',"set role custodial_application_reader;select count(*) from custodial_release_identity.read_current_original_dashboard_completions_v1() where location_id='"+c+"';",'0')
 check('old-day check excluded from current reader',"set role custodial_application_reader;select count(*) from custodial_release_identity.read_current_verified_dashboard_checks_v1() where location_id='"+d+"';",'0')
 check('old-day history row remains retained',prefix+"select count(*) from public.custodial_offline_reconciliation_records where reconciliation_id='"+old['reconciliation']+"';",'1')
 check('provider-only later check excluded',"set role custodial_application_reader;select count(*) from custodial_release_identity.read_current_verified_dashboard_checks_v1() where location_id='"+e+"';",'0')
 check('invalid later check does not erase genuine cleaning',"set role custodial_application_reader;select latest_completed_session_uuid from public.v_location_dashboard_status where location_id='"+e+"';",e_clean['session'])
 for label,table,assignment in [('wrong native entry source','custodial_offline_scan_event_evidence',"event_payload=jsonb_set(event_payload,'{payload_json,entry_source}','\"provider\"')"),('wrong native finish timestamp','custodial_offline_scan_event_evidence',"event_payload=jsonb_set(event_payload,'{scanned_at}','\"2026-01-01T00:00:00.000Z\"')"),('wrong original credential','custodial_offline_reconciliation_records',"credential_id='"+uid(9999)+"'")]:
  where="context_id='"+a_check['context']+"'"
  check(label+' rejected by private check reader',prefix+'begin;update public.'+table+' set '+assignment+' where '+where+";set local role custodial_application_reader;select count(*) from custodial_release_identity.read_current_verified_dashboard_checks_v1() where location_id='"+a+"';rollback;",'0')
 check('canonical original reader byte unchanged',original,original_before)
 check('canonical cleaning view byte unchanged',cleaning_view,view_before)
 # Newly captured sibling must also recover through the SAME existing canonical
 # controller; no extra controller/framework or inventory recapture.
 inventory_before=sql("select md5(string_agg(row_to_json(i)::text,'' order by restore_order,object_kind,object_identity)) from public.custodial_release_authority_restore_inventory i;")
 fn_before=sql("select pg_get_functiondef('custodial_release_identity.read_current_verified_dashboard_checks_v1()'::regprocedure);")
 sql(prefix+'drop function custodial_release_identity.read_current_verified_dashboard_checks_v1();')
 recovered=sql(prefix+"select public.custodial_control_release_canary('"+uid(123)+"','"+uid(901)+"','KIOSK_10','restore_authority','synthetic independent-check recovery','{\"scope\":\"G31-independent-check\"}','g31-owned-synthetic-recovery-fixture-secret-only')->>'restored_objects';")
 assert int(recovered)>0
 check('new sibling exact canonical recovery definition',"select pg_get_functiondef('custodial_release_identity.read_current_verified_dashboard_checks_v1()'::regprocedure);",fn_before)
 check('new sibling recovery inventory byte unchanged',"select md5(string_agg(row_to_json(i)::text,'' order by restore_order,object_kind,object_identity)) from public.custodial_release_authority_restore_inventory i;",inventory_before)
 check('new sibling restricted check result survives canonical recovery',"set role custodial_application_reader;select latest_verified_check_session_uuid from custodial_release_identity.read_current_verified_dashboard_checks_v1() where location_id='"+a+"';",a_check['session'])
 return {'silent_empty_reproduced_under_force_rls_no_policies':True,'fixed_query_sha256':meta['source_query_sha256'],
  'body_md5':meta['body_md5'],'check_before_clean_preserved':True,'clean_before_check_preserved':True,
  'retained_genuine_without_new_snapshot_condition_preserved':True,'old_day_retained_not_deleted':True,
  'original_reader_and_cleaning_view_unchanged':True,'canonical_controller_recovers_new_sibling':True,
  'direct_reader_RLS_not_weakened':True,'production':False,'G14_whole_acceptance_claimed':False}
