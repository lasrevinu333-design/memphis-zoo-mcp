"""Verify the existing held 429 metadata repair on synthetic inventory and exact object definitions."""
import runpy
from pathlib import Path
bundle=runpy.run_path(str(Path(__file__).parent/'fixtures/operational-schedule-postgres.py'))
root=bundle['root'];catalog=bundle['catalog'];blank_schema=bundle['blank_schema'];run_pg=bundle['run_pg']
def mig(prefix):return next((root/'supabase/migrations').glob(prefix+'_*')).read_text()
v=next(r for r in catalog['views'] if r['view_name']=='v_location_dashboard_status')
original=blank_schema()+'\ncreate view public.v_location_dashboard_status as '+v['definition']+';\n'
original+="""
create temp table target_source as select 100308 n,'function' k,'evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)' id,pg_get_functiondef('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'::regprocedure) def
union all select 850002,'view','public.v_location_dashboard_status',custodial_release_authority_current_view_definition('public.v_location_dashboard_status');
insert into custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 select n,k,id,def,static_weekly_digest_text(def) from target_source;
insert into custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 select n+2000000,'function','fixture-'||n,'select '||n,static_weekly_digest_text('select '||n)
 from generate_series(1,7820-(select count(*)::integer from custodial_release_authority_restore_inventory)) n;
create temp table unrelated as select * from custodial_release_authority_restore_inventory where restore_order not in (100308,850002);
"""
actual=next((root/'release/pending-reviewed-sql').glob('*rebind_installed_gps*')).read_text()
checks="""
select fixture_assert(count(*)=2 and bool_and(definition_sql=case object_kind when 'view' then custodial_release_authority_current_view_definition(object_identity)
 else pg_get_functiondef(object_identity::regprocedure) end and definition_sha256=static_weekly_digest_text(definition_sql)),'Two historical recovery bindings match exact current object definitions and digests') from custodial_release_authority_restore_inventory where restore_order in(100308,850002);
select fixture_assert(not exists((select * from unrelated except all select * from custodial_release_authority_restore_inventory where restore_order not in(100308,850002))
union all (select * from custodial_release_authority_restore_inventory where restore_order not in(100308,850002) except all select * from unrelated)), 'Other 7,818 synthetic inventory rows unchanged');
select fixture_assert((select tgenabled='A' from pg_trigger where tgrelid='custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'),'Original ALWAYS guard enabled');
"""
run_pg(original+'\nBEGIN;\n'+mig('20261110235223')+'\nCOMMIT;\n'+mig('20261110235651')+'\n'+actual+checks)
