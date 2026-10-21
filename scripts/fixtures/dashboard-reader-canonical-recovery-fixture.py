"""Exercise the existing canonical controller, never a replacement restorer."""
from pathlib import Path
import re,json,hashlib

def exercise(sql,check,root,prefix,manifest,uid):
 source=(root/'supabase/migrations/20260813210000_custodial_u4_ops_closure.sql').read_text()
 def canonical(name):
  return re.search(r'create or replace function public\.'+name+r'\([\s\S]*?\$function\$;',source,re.I).group()
 controller=canonical('custodial_control_release_canary')
 reset=canonical('custodial_release_authority_reset_grants')
 manager=uid(123); secret='g31-owned-synthetic-recovery-fixture-secret-only'
 setup=prefix+'''
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.custodial_backend_execution_config(config_key boolean primary key,enabled boolean,execution_secret_digest text);
create table public.ops_manager_managers(manager_id uuid primary key,active boolean,revoked_at timestamptz,roles text[]);
create table public.custodial_release_canary_controls(device_identifier text primary key,paused boolean,updated_at timestamptz default now(),updated_by_manager_id uuid,reason text,last_transport_probe_id uuid);
create table public.custodial_release_canary_rollback_audits(audit_id uuid primary key default gen_random_uuid(),requested_at timestamptz default now(),requested_by_manager_id uuid,request_id uuid,device_identifier text,action text,reason text,authoritative_health jsonb,result_json jsonb,unique(requested_by_manager_id,request_id));
'''+reset+'\n'+controller+'''
revoke all on function public.custodial_release_authority_reset_grants(text),public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)
 from public,anon,authenticated,service_role,custodial_application_reader;
'''
 setup+="insert into public.custodial_backend_execution_config values(true,true,encode(extensions.digest(convert_to('"+secret+"','UTF8'),'sha256'),'hex'));\n"
 setup+="insert into public.ops_manager_managers values('"+manager+"',true,null,array['DIRECTOR']);\n"
 setup+="insert into public.custodial_release_canary_controls(device_identifier,paused,updated_by_manager_id,reason) values('KIOSK_10',true,'"+manager+"','owned synthetic fixture only');\n"
 # The real deployment already has this captured grant row (read-only receipt).
 # Reproduce it rather than concealing a missing fixture prerequisite.
 setup+="insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) select 950000,'grant','public.v_location_dashboard_status',d,public.static_weekly_digest_text(d) from (select public.custodial_release_authority_current_grant_definition('public.v_location_dashboard_status') d) captured;\n"
 sql(setup)
 signatures=['public.operational_day_start(timestamptz)','public.get_setting_int(text,integer)','public.mz_latest_verified_check(uuid,timestamptz,timestamptz)','custodial_release_identity.read_current_original_dashboard_completions_v1()']
 q=lambda s:"'"+s.replace("'","''")+"'"
 targets=','.join(q(s) for s in signatures)
 # Whole-inventory and unrelated-row fingerprints are separate assertions.
 inventory="select md5(string_agg(row_to_json(i)::text,'' order by restore_order,object_kind,object_identity)) from public.custodial_release_authority_restore_inventory i;"
 unrelated="select md5(string_agg(row_to_json(i)::text,'' order by restore_order,object_kind,object_identity)) from public.custodial_release_authority_restore_inventory i where not (object_kind='view' and object_identity='public.v_location_dashboard_status') and not (object_kind in('function','grant') and case when object_kind in('function','grant') and object_identity like '%(%' then to_regprocedure(object_identity)::text=any(array["+targets+"]::text[]) else false end);"
 # Record exact executable surfaces before corruption, including their owners
 # and complete ACLs. pg_get_functiondef alone does not encode function owner.
 function_snapshot="select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'owner',pg_get_userbyid(proowner),'acl',proacl::text,'config',proconfig) order by oid::regprocedure::text)::text from pg_proc where oid=any(array["+','.join(q(s)+'::regprocedure' for s in signatures)+"]);"
 view_snapshot="select public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status');"
 baseline_functions=sql(function_snapshot);baseline_view=sql(view_snapshot);baseline_inventory=sql(inventory);baseline_unrelated=sql(unrelated)
 baseline_columns=sql("select string_agg(attname,',' order by attnum) from pg_attribute where attrelid='public.v_location_dashboard_status'::regclass and attnum>0 and not attisdropped;")
 original_view_order=sql("select restore_order from public.custodial_release_authority_restore_inventory where object_kind='view' and object_identity='public.v_location_dashboard_status';")
 count=0
 def restore(request,expected=True):
  nonlocal count
  count+=1
  return sql(prefix+"select public.custodial_control_release_canary('"+manager+"','"+uid(request)+"','KIOSK_10','restore_authority','owned G31 synthetic restoration','{\"scope\":\"G31-synthetic\",\"ok\":false}','"+secret+"')->>'restored_objects';",expected)
 def exact(label):
  check(label+' function definitions owners ACL paths exact',function_snapshot,baseline_functions)
  check(label+' view definition owner options exact',view_snapshot,baseline_view)
  check(label+' all39 view columns exact',"select string_agg(attname,',' order by attnum) from pg_attribute where attrelid='public.v_location_dashboard_status'::regclass and attnum>0 and not attisdropped;",baseline_columns)
  check(label+' complete inventory unchanged',inventory,baseline_inventory)
  check(label+' unrelated inventory unchanged',unrelated,baseline_unrelated)
  check(label+' ALWAYS inventory guard retained',"select tgenabled from pg_trigger where tgname='trg_custodial_release_authority_restore_inventory_immutable';",'A')
  check(label+' view executes as restricted reader',"set role custodial_application_reader;select count(*) from public.v_location_dashboard_status;",'0')
  check(label+' protected original reader executes',"set role custodial_application_reader;select latest_original_completion->>'state' from custodial_release_identity.read_current_original_dashboard_completions_v1();",'SERVER_ACCEPTED_ORIGINAL_RECORD')
 # Positive 1: remove the two new functions and their dependent new view. The
 # canonical controller must recreate nested-schema ownership and exact grants.
 sql(prefix+'''drop function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) cascade;
drop function custodial_release_identity.read_current_original_dashboard_completions_v1();
revoke execute on function public.operational_day_start(timestamptz),public.get_setting_int(text,integer) from custodial_application_reader;
''')
 restored=restore(501)
 assert int(restored)>0
 exact('missing-surface recovery')
 # Positive 2: existing bodies/security/options and excess/revoked grants must
 # be repaired through that same controller, without recapture or a new path.
 sql(prefix+'''alter function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) security invoker;
alter function custodial_release_identity.read_current_original_dashboard_completions_v1() set search_path=public;
alter view public.v_location_dashboard_status set(security_barrier=true);
grant execute on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) to anon;
grant execute on function custodial_release_identity.read_current_original_dashboard_completions_v1() to service_role;
revoke execute on function public.get_setting_int(text,integer) from custodial_application_reader;
''')
 restore(502)
 exact('altered-surface recovery')
 # Causal negative: deliberately put the new view before its missing new
 # verified-check dependency. Canonical SQL body checking must reject it and
 # roll back every earlier restoration/audit effect in this transaction.
 sql(prefix+'''alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
update public.custodial_release_authority_restore_inventory set restore_order=99999 where object_kind='view' and object_identity='public.v_location_dashboard_status';
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
drop function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) cascade;
''')
 damaged_inventory=sql(inventory)
 audit_before=sql('select count(*) from public.custodial_release_canary_rollback_audits;')
 denied=restore(503,False)
 assert 'mz_latest_verified_check' in denied and ('does not exist' in denied or 'missing' in denied),denied
 check('bad dependency order transaction keeps damaged inventory exact',inventory,damaged_inventory)
 check('bad dependency order transaction creates no audit',"select count(*) from public.custodial_release_canary_rollback_audits;",audit_before)
 check('bad dependency order leaves verified-check reader missing',"select to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)') is null;",'t')
 check('bad dependency order does not partially recreate view',"select to_regclass('public.v_location_dashboard_status') is null;",'t')
 check('bad dependency order leaves old opday intact',"select md5(prosrc) from pg_proc where oid='public.operational_day_start(timestamptz)'::regprocedure;",'d33db6b640b600d3018f70a57e54f5b9')
 sql(prefix+"alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;update public.custodial_release_authority_restore_inventory set restore_order="+original_view_order+" where object_kind='view' and object_identity='public.v_location_dashboard_status';alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;")
 restore(504)
 exact('correct-dependency-order recovery')
 return {'existing_controller_source':'supabase/migrations/20260813210000_custodial_u4_ops_closure.sql','controller_declaration_sha256':hashlib.sha256(controller.encode()).hexdigest(),'existing_reset_declaration_sha256':hashlib.sha256(reset.encode()).hexdigest(),'controller_unmodified':True,'existing_canonical_controller_calls':count,'production':False,'native_runtime_or_ACK_authorities_touched':False,'new_parallel_recovery_framework':False,'dependency_order_negative':'new-view-before-missing-new-verified-check rejects with exact rollback; corrected captured order restores', 'damage_scope':'new verified-check/private reader/view and affected grants only; existing opday body retained','no_inventory_recapture_during_restore':True}
