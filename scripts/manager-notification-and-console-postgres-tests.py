"""Apply guarded successors to source-projected tables in a private disposable cluster."""
import re
import runpy
from pathlib import Path
m=runpy.run_path(str(Path(__file__).parent/'fixtures/operational-schedule-postgres.py'))
root=m['root']
sql=m['blank_schema']()
installed=next((root/'release/installed-source').glob('*basecamp*sql')).read_text()
sql+=m['definition'](installed,'public.custodial_is_basecamp_birthday')
manual=next((root/'release/installed-source').glob('20261115101824*.sql')).read_text().split('$new_body$')[1]
sql+="CREATE OR REPLACE FUNCTION custodial_coverall.reconcile_manual_application_date(p_date date) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $func$"+manual+"$func$;REVOKE ALL ON FUNCTION custodial_coverall.reconcile_manual_application_date(date) FROM PUBLIC;"
proposal=(root/'proposals/manager-digest-console-and-schedule-reader.sql').read_text()
for identity,expected in re.findall(r'\(\$v\$(.*?)\$v\$,\$v\$([0-9a-f]{64})\$v\$',proposal):
    order=next((r['restore_order'] for r in m['inv'] if r['object_identity']==identity and r['object_kind']=='function'),99006)
    sql+=f"INSERT INTO custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values({order},'function',{m['quote'](identity)},pg_get_functiondef({m['quote'](identity)}::regprocedure),'{expected}');"
sql+=proposal
sql+=(root/'scripts/fixtures/manager-notification-and-console-checks.sql').read_text()
m['run_pg'](sql)
