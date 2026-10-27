#!/usr/bin/env python3
"""One disposable synthetic fixture; no ports, volumes, production URLs or keys."""
from pathlib import Path
import subprocess,re,json,time,os,uuid,hashlib,runpy
ROOT=Path(__file__).resolve().parents[1]
IMAGE='sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
NAME='mz_dashboard_reader_'+str(os.getpid())
checks=[]
def docker(args,input=None,timeout=30):return subprocess.run(['docker',*args],input=input,text=True,capture_output=True,timeout=timeout)
def sql(s,ok=True):
 r=docker(['exec','-e','PGPASSWORD=synthetic-isolated-only','-i',NAME,'psql','-X','-q','-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres'],s)
 if ok and r.returncode:raise AssertionError(r.stderr)
 if not ok and r.returncode==0:raise AssertionError('expected rejection')
 return r.stdout.strip() if ok else r.stderr.strip()
def check(name,s,expected):
 actual=sql(s)
 assert actual==expected,(name,actual,expected)
 checks.append(name)
def read(name):return (ROOT/'supabase/migrations'/name).read_text()
def extract(s,name):return re.search(r'create or replace function public\.'+name+r'\([\s\S]*?\$function\$;',s,re.I).group()
manifest=json.loads((ROOT/'release/dashboard-reader-restoration-manifest.json').read_text())
first=next((ROOT/'release/dashboard-reader/forward-source').glob('*_dashboard_application_reader_dependencies.sql')).read_text()
second=next((ROOT/'release/dashboard-reader/forward-source').glob('*_dashboard_verified_check_restoration.sql')).read_text()
prefix="set role postgres;set custodial.deployment_project_ref='rqquvtjdmugpigbndmne';\n"
started=False
try:
 r=docker(['run','--rm','-d','--name',NAME,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic-isolated-only',IMAGE],timeout=30)
 assert r.returncode==0,r.stderr
 started=True
 for _ in range(100):
  r=docker(['exec',NAME,'pg_isready','-U','supabase_admin'],timeout=5)
  if r.returncode==0:
   r=docker(['logs',NAME])
   if 'PostgreSQL init process complete' in r.stdout+r.stderr:break
  time.sleep(.2)
 else:raise AssertionError('isolated server did not initialize')
 inspection=json.loads(docker(['inspect',NAME]).stdout)[0]
 assert inspection['HostConfig']['NetworkMode']=='none'
 assert not inspection['HostConfig']['PortBindings']
 assert not [m for m in inspection['Mounts'] if m['Type']=='bind']
 bootstrap='''do $$begin
 if not exists(select 1 from pg_roles where rolname='custodial_application_reader') then create role custodial_application_reader nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;
end $$;
set role postgres;
create table public.system_settings(setting_key text,setting_value jsonb);
grant select on public.system_settings to custodial_application_reader;
'''
 baseline=read('00000000000000_production_baseline.sql')
 bootstrap+=extract(baseline,'get_setting_int')+'\n'+extract(baseline,'operational_day_start')+'\n'+extract(read('20260813210000_custodial_u4_ops_closure.sql'),'custodial_canonical_utc_millis')
 bootstrap+='''
revoke all on function public.operational_day_start(timestamptz),public.get_setting_int(text,integer) from public,anon,authenticated,custodial_application_reader;
grant execute on function public.get_setting_int(text,integer) to custodial_application_reader;
create function public.static_weekly_digest_text(p text) returns text language sql immutable as $$select encode(sha256(convert_to(p,'UTF8')),'hex')$$;
create table public.custodial_release_authority_restore_inventory(restore_order integer unique,object_kind text,object_identity text,definition_sql text,definition_sha256 text,captured_at timestamptz default now(),unique(object_kind,object_identity));
create function public.fixture_inventory_guard() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
create trigger trg_custodial_release_authority_restore_inventory_immutable before update or delete on public.custodial_release_authority_restore_inventory for each row execute function public.fixture_inventory_guard();
create function public.custodial_release_canary_authority_surface() returns table(object_kind text,object_identity text,purpose text) language sql immutable as $function$
  values ('relation','public.system_settings','synthetic anchor')
$function$;
'''
 bootstrap+=extract(read('20260825174500_rebind_application_reader_release_recovery.sql'),'custodial_release_authority_current_grant_definition')
 bootstrap+='''
insert into public.custodial_release_authority_restore_inventory values
(100001,'function','custodial_release_canary_authority_surface()',pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),'synthetic',now()),
(900001,'grant','custodial_release_canary_authority_surface()',public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()'),'synthetic',now());
'''
 sql(bootstrap)
 denial=sql('set role custodial_application_reader;select public.operational_day_start(now());',False)
 assert 'permission denied' in denial;checks.append('observed reader denial reproduced')
 target=sql("set role postgres;set custodial.deployment_project_ref='dwzdqekusvivjbxsapdu';"+first,False)
 assert 'Expected explicit Custodial deployment target' in target;checks.append('wrong target rejected')
 sql(prefix+first)
 check('exact old Dashboard grant works',"set role custodial_application_reader;select public.operational_day_start('2026-10-21T12:00:00Z')='2026-10-21T09:00:00Z';",'t')
 check('old repair independent of absent candidate helper',"select to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)') is null;",'t')
 before=sql("select md5(string_agg(row_to_json(i)::text,'' order by restore_order)) from public.custodial_release_authority_restore_inventory i;")
 err=sql(prefix+second,False)
 assert 'Missing canonical relation' in err;checks.append('missing dependency fails')
 check('failed restore leaves no helper',"select to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)') is null;",'t')
 check('failed restore retains exact inventory',"select md5(string_agg(row_to_json(i)::text,'' order by restore_order)) from public.custodial_release_authority_restore_inventory i;",before)
 # Exact direct-column fixture. No public reader SELECT on the private native tables.
 fixture=prefix
 for table,cols in manifest['direct_relation_columns'].items():
  definitions=[]
  for c in cols:
   typ=('jsonb' if c in ['payload_json','event_payload','response_json'] else 'timestamptz' if c in ['started_at','ended_at','native_completed_at'] else 'text' if c in ['client_session_id','client_completion_id','client_event_id','state','status','occurrence_fingerprint','native_start_attestation_version','native_completion_attestation_version','native_completion_attestation_sha256'] else 'uuid')
   definitions.append(c+' '+typ)
  fixture+='create table public.'+table+'('+','.join(definitions)+');\n'
 sql(fixture)
 sql(prefix+'alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;')
 sql(prefix+second)
 check('canonical source body restored',"select md5(prosrc) from pg_proc where oid='public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'::regprocedure;",manifest['canonical_function']['body_md5'])
 check('canonical owner security path',"select (proowner='postgres'::regrole and prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, public']) from pg_proc where oid='public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'::regprocedure;",'t')
 check('exact canonical ACL; no grant options',"select string_agg(r.rolname||':'||a.privilege_type||':'||a.is_grantable::text,',' order by r.rolname) from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee where p.oid='public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'::regprocedure;",'custodial_application_reader:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false')
 check('reader permitted; clients denied',"select has_function_privilege('custodial_application_reader','public.mz_latest_verified_check(uuid,timestamptz,timestamptz)','EXECUTE') and not has_function_privilege('anon','public.mz_latest_verified_check(uuid,timestamptz,timestamptz)','EXECUTE') and not has_function_privilege('authenticated','public.mz_latest_verified_check(uuid,timestamptz,timestamptz)','EXECUTE');",'t')
 check('reader cannot SELECT private native rows',"select has_table_privilege('custodial_application_reader','public.custodial_offline_actor_contexts','SELECT');",'f')
 # Distinct synthetic identity values ensure every equality matters.
 uid=lambda n:str(uuid.UUID(int=n))
 ids={'context_id':uid(1),'credential_id':uid(2),'device_id':uid(3),'location_id':uid(4),'occurrence_id':uid(5),'employee_id':uid(6),'id':uid(7),'session_id':uid(7),'completion_response_id':uid(8),'reconciliation_id':uid(9),'native_scan_entry_id':uid(10),'native_finish_scan_entry_id':uid(11)}
 response={'work_result':'checked_no_cleaning_needed','services_performed':[]}
 payload={'response_json':response}
 evidence={'event_type':'scan_finish','result':'ok','payload_json':{'entry_source':'native-nfc'},'scanned_at':'2026-10-21T15:00:00.000Z'}
 rows={}
 for table,cols in manifest['direct_relation_columns'].items():
  row={}
  for c in cols:
   if c in ['payload_json','response_json','event_payload']:v={'payload_json':payload,'response_json':response,'event_payload':evidence}[c]
   elif c=='id':v=uid(8 if table=='completion_responses' else 7)
   elif c in ['employee_id','original_employee_id','submitted_by_employee_id']:v=uid(6)
   elif c in ['started_at']:v='2026-10-21T14:00:00Z'
   elif c in ['ended_at','native_completed_at']:v='2026-10-21T15:00:00Z'
   elif c=='state':v='committed'
   elif c=='status':v='closed' if table=='sessions' else 'committed'
   elif c=='native_start_attestation_version':v='custodial-native-start.v1'
   elif c=='native_completion_attestation_version':v='custodial-native-completion.v2'
   elif c=='native_completion_attestation_sha256':v='a'*64
   elif c=='client_event_id':v=uid(11)
   elif c=='client_session_id':v='synthetic-client-session'
   elif c=='client_completion_id':v='synthetic-completion'
   elif c=='occurrence_fingerprint':v='synthetic-fingerprint'
   else:v=ids[c]
   row[c]=v
  rows[table]=row
 def quote(v):return "'"+(json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list)) else str(v)).replace("'","''")+"'"
 for table,row in rows.items():sql(prefix+'insert into public.'+table+'('+','.join(row)+') values('+','.join(quote(v) for v in row.values())+');')
 call="public.mz_latest_verified_check('"+uid(4)+"','2026-10-21T09:00:00Z','2026-10-21T16:00:00Z')"
 check('restricted reader receives exact verified finish',"set role custodial_application_reader;select "+call+"='2026-10-21T15:00:00Z';",'t')
 negatives=[('receipt credential mismatch','custodial_offline_reconciliation_records','credential_id',uid(99)),('occurrence mismatch','custodial_offline_actor_contexts','occurrence_fingerprint','other'),('wrong employee','completion_responses','submitted_by_employee_id',uid(99)),('uncommitted receipt','custodial_offline_reconciliation_records','state','pending'),('same start finish tag entry','custodial_offline_actor_contexts','native_finish_scan_entry_id',uid(10)),('bad native digest','custodial_offline_actor_contexts','native_completion_attestation_sha256','bad'),('provider-only evidence','custodial_offline_scan_event_evidence','event_payload',{**evidence,'payload_json':{'entry_source':'provider'}}),('wrong native timestamp','custodial_offline_scan_event_evidence','event_payload',{**evidence,'scanned_at':'2026-10-21T15:00:01.000Z'}),('cleaning is not check only','completion_responses','response_json',{'work_result':'cleaned','services_performed':['restroom']})]
 for name,table,col,value in negatives:
  result=sql(prefix+'begin;update public.'+table+' set '+col+'='+quote(value)+';set local role custodial_application_reader;select '+call+' is null;rollback;')
  assert result=='t',(name,result);checks.append(name)
 check('future finish excluded',"set role custodial_application_reader;select public.mz_latest_verified_check('"+uid(4)+"','2026-10-21T09:00:00Z','2026-10-21T14:59:59Z') is null;",'t')
 check('post restore recovery guard ALWAYS state preserved',"select tgenabled from pg_trigger where tgname='trg_custodial_release_authority_restore_inventory_immutable';",'A')
 # Idempotent exact restoration; drift is rejected and inventory preserved.
 sql(prefix+second)
 before_drift=sql("select md5(string_agg(row_to_json(i)::text,'' order by restore_order)) from public.custodial_release_authority_restore_inventory i;")
 err=sql(prefix+"alter function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) security invoker;"+second,False)
 assert 'Canonical signature/body/owner/security mismatch' in err;checks.append('existing changed security rejected')
 check('security drift reject preserves exact inventory',"select md5(string_agg(row_to_json(i)::text,'' order by restore_order)) from public.custodial_release_authority_restore_inventory i;",before_drift)
 sql(prefix+'alter function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) security definer;')
 closure=runpy.run_path(str(ROOT/'scripts/fixtures/dashboard-reader-closure-fixture.py'))['exercise'](sql,check,ROOT,prefix,manifest,uid)
 recovery=runpy.run_path(str(ROOT/'scripts/fixtures/dashboard-reader-canonical-recovery-fixture.py'))['exercise'](sql,check,ROOT,prefix,manifest,uid)
 independent=runpy.run_path(str(ROOT/'scripts/fixtures/dashboard-independent-check-reader-fixture.py'))['exercise'](sql,check,ROOT,prefix,manifest,uid)
 result={'independent_check_reader_fixture':independent,'canonical_recovery_fixture':recovery,'closure_fixture':closure,'status':'PASS','checks':checks,'passed':len(checks),'image':IMAGE,'container':NAME,'container_id':inspection['Id'],'network':'none','ports':[],'bind_mounts':[],'synthetic_fixture':True,'production':False,'physical_verification':False}
finally:
 if started:
  cleanup=docker(['rm','-f',NAME],timeout=30)
  assert cleanup.returncode==0,cleanup.stderr
result['container_removed']=True
print(json.dumps(result,indent=2))
