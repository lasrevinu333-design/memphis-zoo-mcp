"""Synthetic table shapes and retained routines, loaded solely from source fixtures."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

root=Path(__file__).resolve().parents[2]
catalog=json.loads((root/'release/fresh-only-replay/source304-fresh-evidence/MAIN_FRESH304_NORMALIZED_CATALOG.json').read_text())
inv=json.loads((root/'release/production-forward-source/current309-tail-projection.json').read_text())['inventory_metadata_before']
functions={r['function_name']:r['definition'] for r in catalog['functions'] if r['schema_name']=='public'}
proposal=(root/'proposals/operational-schedule-recovery-followup.sql').read_text()
def definition(s,n):
    start=re.search(r'(?im)^create (?:or replace )?function '+re.escape(n)+r'\(',s).start()
    s=s[start:];token=re.search(r'(?i)\bas\s+(\$\w*\$)',s).group(1);return s[:s.index(token+';')+len(token)+1]
def quote(s):return "'"+s.replace("'","''")+"'"
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def blank_schema():
    sql=["create schema extensions; create extension pgcrypto with schema extensions; create extension \"uuid-ossp\" with schema extensions;",'set check_function_bodies=off;']
    schemas=sorted({r['schema_name'] for r in catalog['tables']+catalog['functions']} | {'custodial_dr'})
    sql.extend('create schema if not exists '+n+';' for n in schemas)
    sql.append('create role anon;create role authenticated;create role service_role;create role custodial_application_reader;create role static_weekly_control_plane;create role static_weekly_release_operator;')
    for r in catalog['tables']:
        t=r['table_name'];schema=r['schema_name']; cols=[c for c in catalog['columns'] if c['table_name']==t and c['schema_name']==schema]
        def col(c):
            default=c['default_expression']
            return '"'+c['column_name']+'" '+c['data_type']+(' default '+default if default and not c['generated_kind'] and all(x not in default for x in ['nextval','custodial','static_weekly','app_','sch_']) else '')
        sql.append(f'create table {schema}."{t}" ('+','.join(col(c) for c in cols)+');')
    for r in sorted(catalog['functions'], key=lambda r:r['function_name'] not in ('sch_service_date','operational_day_start')):
        sql.append(r['definition']+';')
    for r in catalog['constraints']:
        if r['constraint_type'] in ('p','u'):
            sql.append(f"""alter table {r['schema_name']}."{r['table_name']}" add constraint "{r['constraint_name']}" {r['definition']};""")
    sql.append("""create table custodial_dr.restore_control(singleton boolean primary key,authority_generation bigint,mutations_paused boolean);
    insert into custodial_dr.restore_control values(true,1,false);""")
    fence=next((root/'supabase/migrations').glob('20260827150000_*')).read_text()
    for n in ['acquire_application_mutation_fence','guard_application_mutation','guard_application_ddl']:
        sql.append(definition(fence,'custodial_dr.'+n))
    for ident in re.findall(r'\(\$v\$(.*?)\$v\$,\$v\$[a-f0-9]{64}',proposal):
        row=next(r for r in inv if r['object_kind']=='function' and r['object_identity']==ident)
        sql.append(f"""insert into custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values({row['restore_order']},'function',{quote(ident)},pg_get_functiondef({quote(ident)}::regprocedure),{quote(row['definition_sha256'])});""")
    sql.append("""create trigger trg_custodial_release_authority_restore_inventory_immutable before update or delete on custodial_release_authority_restore_inventory for each row execute function public.custodial_reject_release_authority_inventory_mutation();
    alter table custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
    create trigger custodial_disaster_restore_mutation_fence before insert or update or delete or truncate on custodial_release_authority_restore_inventory for each statement execute function custodial_dr.guard_application_mutation();
    create event trigger custodial_dr_guard_application_ddl on ddl_command_start execute function custodial_dr.guard_application_ddl();
    create function fixture_assert(ok boolean,label text) returns text language plpgsql as $$begin if ok is distinct from true then raise exception 'Failed: %',label;end if;return label;end$$;
    create function fixture_reject(stmt text,reason text) returns void language plpgsql as $$begin begin execute stmt;exception when others then if position(reason in sqlerrm)>0 then return;end if;raise;end;raise exception 'Missing refusal: %',reason;end$$;
    """)
    return '\n'.join(sql)
def run_pg(sql):
    image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
    shell="""set -eu
initdb -D /fixture/db -U postgres -A trust --no-locale >/dev/null
pg_ctl -D /fixture/db -l /fixture/server.log -o "-c listen_addresses='' -c unix_socket_directories=/fixture -c shared_preload_libraries=''" -w start >/dev/null
trap 'pg_ctl -D /fixture/db -m fast -w stop >/dev/null' EXIT
psql -h /fixture -U postgres -XAtqb -v ON_ERROR_STOP=1 -v VERBOSITY=terse"""
    result=subprocess.run(['docker','run','-i','--pull=never','--rm','--network','none','--read-only','--user','100:101','--tmpfs','/fixture:rw,mode=0700,uid=100,gid=101','--tmpfs','/tmp:rw,mode=1777','--memory','900m','--pids-limit','96','--entrypoint','/bin/bash',image,'-c',shell],input=sql,text=True,capture_output=True)
    print(result.stdout.strip(),flush=True)
    if result.returncode:print(result.stderr[-2400:],file=sys.stderr);sys.exit(result.returncode)
if __name__=='__main__':run_pg(blank_schema()+proposal+(root/'scripts/fixtures/operational-schedule-followup-checks.sql').read_text())
