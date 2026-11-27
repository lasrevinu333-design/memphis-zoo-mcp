"""Check the roster compatibility proposal in a disposable, network-isolated PostgreSQL instance."""
import io
import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
# No database URL or device is accepted. Git supplies only the checked-in
# deterministic historical compiler and schedule inputs.
historical_commit = "59b3f02242db351cf09558bfd3c6ca8f8264389c"
def make_fixtures(directory):
    historical = directory / "historical"
    historical.mkdir()
    paths = ["src", "config", "package.json", "scripts/fixtures/manual-live-roster-20261030.json",
             "release/static-schedules/custodial-eight-20261102-registration.json"]
    archive = subprocess.check_output(["git", "archive", historical_commit, "--", *paths], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as members:
        members.extractall(historical, filter="data")
    (historical / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
    for edition, tree in [("original",historical), ("current",root), ("seven",root)]:
        subprocess.run(["node",root / "scripts/fixtures/manual-roster-source-regression.mjs",tree,edition,
                        directory / (edition + ".json")], check=True)

migrations = root / "supabase/migrations"
proposal = (root / "proposals/approved-manual-roster-source-compatibility.sql").read_text()
def migration(prefix):
    return next(migrations.glob(prefix + "_*.sql")).read_text()

def definition(source, name):
    declaration = re.search(r"^create (?:or replace )?function " + re.escape(name) + r"\(", source, re.I | re.M)
    if not declaration:
        raise ValueError(name)
    body = source[declaration.start():]
    delimiter = re.search(r"\bas\s+(\$[a-z_0-9]*\$)", body, re.I).group(1)
    end = body.index(delimiter + ";")
    return body[:end + len(delimiter) + 1]

def quoted_fixture(fixtures, name):
    text = (fixtures / (name + ".json")).read_text()
    assert "$fixture$" not in text
    return "$fixture$" + text + "$fixture$::jsonb"

accepted = json.loads(migration("20261115205201").split("$target_defs$")[1])
routine = "public.static_weekly_assert_manual_roster_transition"
caller = "public.static_weekly_coverall_assert_activation_data"
source = {row["identity"].split("(")[0]: row for row in accepted}
fence = migration("20260827150000")
inventory = migration("20260813210000")
grant = migration("20260825174500")
routines = [
    (migration("20260810200000"), "public.static_weekly_digest_text"),
    (migration("20260810200000"), "public.static_weekly_digest_jsonb"),
    (migration("20260810220000"), "public.static_weekly_v3_assert_text"),
    (migration("20260810220000"), "public.static_weekly_v3_assert_uuid"),
    (migration("20261003140000"), "public.static_weekly_capacity_assert_shape"),
    (grant, "public.custodial_release_authority_current_grant_definition"),
    (fence, "custodial_dr.acquire_application_mutation_fence"),
    (fence, "custodial_dr.guard_application_mutation"),
    (fence, "custodial_dr.guard_application_ddl"),
]
setup = """
create schema extensions;
create extension pgcrypto with schema extensions;
create schema custodial_dr;
create table custodial_dr.restore_control(singleton boolean primary key, authority_generation bigint, mutations_paused boolean);
insert into custodial_dr.restore_control values(true,1,false);
create table public.weekly_roster_slots(slot_id uuid primary key);
create table public.static_weekly_contractor_capacity_registrations(capacity_code text primary key);
"""
setup += "\n".join(definition(s, n) for s,n in routines)
setup += inventory[inventory.index("create table public.custodial_release_authority_restore_inventory ("):
                   inventory.index("revoke all on table public.custodial_release_authority_restore_inventory")]
setup += "\n".join(source[n]["definition"] + ";" for n in [routine,caller])
setup += """
revoke all on function public.static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb) from public;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
create trigger custodial_disaster_restore_mutation_fence before insert or update or delete or truncate on public.custodial_release_authority_restore_inventory
 for each statement execute function custodial_dr.guard_application_mutation();
create event trigger custodial_dr_guard_application_ddl on ddl_command_start execute function custodial_dr.guard_application_ddl();
create function public.custodial_release_canary_authority_surface() returns table(object_kind text,object_identity text,purpose text)
 language sql immutable as $$values ('function','static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)','fixture root'),
 ('grant','static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)','fixture root')$$;
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 select n,k,ident,def,public.static_weekly_digest_text(def) from (
 select 100001 n,'function' k,ident,pg_get_functiondef(ident::regprocedure) def from (select 'static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)' ident) a
 union all select 900001,'grant',ident,public.custodial_release_authority_current_grant_definition(ident)
 from (select 'static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)' ident) a) rows;
create table packets(name text primary key, fixture jsonb);
"""
with tempfile.TemporaryDirectory(prefix="custodial-roster-fixture-") as owned:
    fixtures = Path(owned)
    make_fixtures(fixtures)
    for name in ["current", "original", "seven"]:
        setup += "insert into packets values ('" + name + "'," + quoted_fixture(fixtures,name) + ");\n"
setup += """
insert into public.weekly_roster_slots select (slot->>'slotId')::uuid from packets cross join lateral jsonb_array_elements(fixture#>'{snapshot,rosterSlots}') slot where name='current';
create function fixture_outer(v jsonb) returns void language sql as $$select public.static_weekly_coverall_assert_activation_data(v->'packet',v->'snapshot')$$;
create function fixture_inner(v jsonb) returns void language sql as $$select public.static_weekly_assert_manual_roster_transition(v->'transition',v->'snapshot',v->'config')$$;
create function fixture_refusal(label text, statement text, expected text) returns text language plpgsql as $fn$
begin
 begin execute statement;
 exception when others then
   if position(expected in sqlerrm)=0 then raise exception 'Unexpected rejection for %: %',label,sqlerrm;end if;
   return label;
 end;
 raise exception 'Missing refusal for %',label;
end $fn$;
create function fixture_check(ok boolean, label text) returns text language plpgsql as $$begin if ok is distinct from true then raise exception 'Failed: %',label;end if;return label;end$$;
create temp table original_inventory as select * from public.custodial_release_authority_restore_inventory;
select fixture_refusal('BEFORE corrected 327 is refused',$$select fixture_outer(fixture) from packets where name='current'$$,'manual activation roster');
select fixture_outer(fixture) from packets where name='original';
select fixture_inner(fixture) from packets where name='seven';
select 'BEFORE historical 346 and seven-person retained roster pass';
"""
assert proposal.strip().endswith("COMMIT;")
rollback = proposal.rstrip()[:-len("COMMIT;")] + "ROLLBACK;"
rollback_checks = """
select fixture_check((select count(*) from (select * from original_inventory except select * from public.custodial_release_authority_restore_inventory) d)=0
 and (select count(*) from original_inventory)=(select count(*) from public.custodial_release_authority_restore_inventory),'ROLLBACK exact function and grant catalog rows');
select fixture_refusal('ROLLBACK restored old roster behavior',$$select fixture_outer(fixture) from packets where name='current'$$,'manual activation roster');
"""
checks = """
select fixture_outer(fixture) from packets where name='current';
select fixture_outer(fixture) from packets where name='original';
select fixture_inner(fixture) from packets where name='seven';
select 'PASS complete 327 and 346 packets and seven retained employees';
select fixture_check((select count(*) from public.custodial_release_authority_restore_inventory)=2 and
 (select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='function')=
 public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)'::regprocedure))
 and not exists(select * from original_inventory where object_kind='grant' except select * from public.custodial_release_authority_restore_inventory),
 'PASS changed function bound to recovery and grant row byte-identical');
select fixture_refusal('PASS immutable recovery guard active',$$update public.custodial_release_authority_restore_inventory set definition_sha256=definition_sha256$$,'immutable');
select fixture_refusal('PASS corrected transition with historical configuration',$$select fixture_outer(jsonb_set(fixture,'{packet,ownerConfig,approvedManualDataDigest}',
 (select fixture#>'{packet,ownerConfig,approvedManualDataDigest}' from packets where name='original'))) from packets where name='current'$$,'manual activation roster');
select fixture_refusal('PASS historical transition with corrected configuration',$$select fixture_outer(jsonb_set(fixture,'{packet,ownerConfig,approvedManualDataDigest}',
 (select fixture#>'{packet,ownerConfig,approvedManualDataDigest}' from packets where name='current'))) from packets where name='original'$$,'manual activation roster');
select fixture_refusal('PASS missing configuration digest',$$select fixture_outer(fixture#-'{packet,ownerConfig,approvedManualDataDigest}') from packets where name='current'$$,'manual activation roster');
with changed as (
 select fixture#-'{packet,source,version,assignments,0}' v from packets where name='current'
)
insert into packets select 'wrong-source-count',jsonb_set(v,'{packet,sourceDigest}',to_jsonb(public.static_weekly_digest_jsonb(v#>'{packet,source}'))) from changed;
select fixture_refusal('PASS wrong source count with recomputed source digest',$$select fixture_outer(fixture) from packets where name='wrong-source-count'$$,'normal geometry');
with changed as (
 select fixture#-'{packet,feasibility,lunchDocument,loans,0}' v from packets where name='original'
)
insert into packets select 'wrong-lunch-count',v from changed;
select fixture_refusal('PASS incomplete lunch count',$$select fixture_outer(fixture) from packets where name='wrong-lunch-count'$$,'fixed-pattern');
select fixture_refusal('PASS incorrect projection count',$$select fixture_outer(fixture#-'{packet,feasibility,initialBaseline,projection,assignments,0}') from packets where name='current'$$,'fixed-pattern');
select fixture_refusal('PASS seven-person configuration mixed with corrected eight',$$select fixture_inner(jsonb_set(fixture,'{config,approvedManualDataDigest}',
 (select fixture#>'{packet,ownerConfig,approvedManualDataDigest}' from packets where name='current'))) from packets where name='seven'$$,'manual activation roster');
update custodial_dr.restore_control set mutations_paused=true;
select fixture_refusal('PASS real DDL fence rejects paused schema mutation',$$create table fixture_disallowed_ddl(i int)$$,'mutations are paused');
update custodial_dr.restore_control set mutations_paused=false;
"""
image = "supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed"
shell = """
set -eu
initdb -D /fixture/db -U postgres -A trust --no-locale >/dev/null
pg_ctl -D /fixture/db -l /fixture/server.log -o "-c listen_addresses='' -c unix_socket_directories=/fixture -c shared_preload_libraries=''" -w start >/dev/null
trap 'pg_ctl -D /fixture/db -m fast -w stop >/dev/null' EXIT
psql -h /fixture -d postgres -U postgres -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=terse
"""
command=["docker","run","-i","--rm","--pull=never","--network","none","--read-only","--user","100:101",
         "--tmpfs","/fixture:rw,mode=0700,uid=100,gid=101","--tmpfs","/tmp:rw,mode=1777",
         "--memory","1200m","--pids-limit","96","--entrypoint","/bin/bash",image,"-c",shell]
result=subprocess.run(command,input=setup+rollback+rollback_checks+proposal+checks,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
print(result.stdout.strip())
if result.returncode:
    print(result.stderr[:2500],file=sys.stderr)
    sys.exit(result.returncode)
print(json.dumps({"status":"PASS","full_backup":False,"production":False,"postgres_image":image,"catalog_fixture":"isolated function and grant","actual_ddl_fence":True}))
