"""Run the retained projection and lunch validators with compiler-produced synthetic inputs."""
import json
from pathlib import Path
import runpy
import subprocess
src=runpy.run_path(str(Path(__file__).parent/'fixtures/operational-schedule-postgres.py'))
root=src['root']
import tempfile
with tempfile.TemporaryFile(mode='w+') as emitted:
    subprocess.run(['node','scripts/approved-static-template-control-plane-tests.mjs','--approved-dated-partial-native-consumer-only','--emit-partial-postgres-fixtures'],cwd=root,stdout=emitted,check=True)
    emitted.seek(0);result=emitted.read()
fixtures=[row['partialFixture'] for row in map(json.loads,result.splitlines()) if 'partialFixture' in row]
assert len(fixtures)==2
sql=src['blank_schema']()+src['proposal']+"""
create table partial_fixture(input jsonb,feasibility jsonb,dated jsonb generated always as (feasibility->'datedAbsence') stored);
create or replace function static_weekly_v15_read_recurring_generation() returns bigint language sql as $$select 1::bigint$$;
create or replace function static_weekly_read_approved_template_basis(p_manager_id uuid,p_publication_id uuid,p_service_date date,p_kind text,p_template_id text,p_expected_revision bigint) returns jsonb language sql as $$select jsonb_build_object('schema','custodial.approved-static-template-basis.v1','publicationId',$2,'serviceDate',$3,'kind',$4,'authorityRevision',$6,'generation',1,'currentSource',input->'currentSource','ownerConfig',input->'currentOwnerConfig','templates',input->'templates','admittedBindings',input->'admittedBindings') from partial_fixture$$;
create view public.v_weekly_schedule_effective_ranges as select (dated->>'sourceVersionId')::uuid version_id,(dated#>>'{projection,week_start}')::date effective_start,null::date effective_end from partial_fixture;
create view public.v_weekly_roster_slot_incumbency_ranges as select (slot->>'id')::uuid slot_id,(i->>'personId')::uuid person_id,i->>'displayName' person_name_snapshot,(i->>'effectiveStart')::date effective_start,(i->>'effectiveEnd')::date effective_end from partial_fixture cross join lateral jsonb_array_elements(input#>'{currentSource,slots}') slot cross join lateral jsonb_array_elements(slot->'incumbencies') i;
create or replace function public.static_weekly_v6_schedule_authority_state(p_service_date date) returns table(service_date date,governed boolean,authority_source text,projection_status text,version_id uuid,publication_id uuid,projection_id uuid,projection_authority_revision bigint,staffing_authority_revision bigint,week_start date) language sql as $$select $1,true,'fixture','current',p.version_id,p.publication_id,p.projection_id,21::bigint,21::bigint,p.week_start from weekly_schedule_compiled_projections p where p.week_start=$1$$;
insert into ops_manager_managers(manager_id,display_name,active,is_system_principal,roles) values('99000000-0000-4000-8000-000000000005','Fixture Manager',true,false,ARRAY['OPS_MANAGER']);

insert into static_weekly_schedule_control(singleton,current_revision) values(true,20);
create or replace function static_weekly_v3_assert_control_plane() returns void language sql as $$select$$;
create or replace function static_weekly_effective_version(p_service_date date) returns uuid language sql as $$select (dated->>'sourceVersionId')::uuid from partial_fixture$$;
create or replace function static_weekly_v3_read_publication_source(p_publication_id uuid,p_service_date date) returns jsonb language sql as $$select jsonb_build_object('publication_id',dated->'sourcePublicationId','version_id',dated->'sourceVersionId','compiler_input',dated#>'{projection,authority,compilerInput}','exceptions',input#>'{currentSource,exceptions}') from partial_fixture$$;
create or replace function static_weekly_accepted_exception_set(p_publication_id uuid,p_week_start date) returns jsonb language sql as $$select dated#>'{projection,applied_exceptions}' from partial_fixture$$;
create or replace function static_weekly_compiler_exception_set(p_publication_id uuid,p_week_start date) returns jsonb language sql as $$select input#>'{currentSource,exceptions}' from partial_fixture$$;
"""
for i,fx in enumerate(fixtures):
    sql+='\nBEGIN;\ninsert into partial_fixture(input,feasibility) values('+src['quote'](json.dumps(fx['input']))+','+src['quote'](json.dumps(fx['feasibility']))+');\n'
    sql+="""
insert into weekly_schedule_publications(publication_id,version_id) select (dated->>'sourcePublicationId')::uuid,(dated->>'sourceVersionId')::uuid from partial_fixture;
insert into weekly_schedule_versions(version_id,authority_source_id) select (dated->>'sourceVersionId')::uuid,'99000000-0000-4000-8000-000000000001' from partial_fixture;
insert into static_weekly_authority_source_documents(source_id,canonical_source,source_digest,active) select '99000000-0000-4000-8000-000000000001',v,static_weekly_digest_jsonb(v),true from partial_fixture cross join lateral (select dated#>'{projection,authority,compilerInput}' v)x;
insert into static_weekly_approved_template_source_configs(source_id,owner_config,config_digest) select '99000000-0000-4000-8000-000000000001',v,static_weekly_digest_jsonb(v) from partial_fixture cross join lateral (select input->'currentOwnerConfig' v)x;
insert into static_weekly_approved_template_catalog(template_id,staffing_count,owner_config,template_json,binding_json,approval_evidence,catalog_entry_digest)
 select t->>'templateId',(t->>'staffingCount')::int,c,t,b,'{}',static_weekly_digest_jsonb(jsonb_build_object('template',t,'binding',b,'ownerConfig',c,'approvalEvidence','{}'::jsonb)) from partial_fixture cross join lateral (select input#>'{templates,0}' t,input->'currentOwnerConfig' c,input#>'{admittedBindings,0}' b)x;
insert into employees(id,display_name,active) select distinct (i->>'personId')::uuid,i->>'displayName',true from partial_fixture cross join lateral jsonb_array_elements(input#>'{currentSource,slots}') slot cross join lateral jsonb_array_elements(slot->'incumbencies') i;
insert into weekly_schedule_slot_assignments(assignment_id,version_id,day_of_week,work_id) select gen_random_uuid(),(dated->>'sourceVersionId')::uuid,(w->>'dayOfWeek')::int,w->>'workId' from partial_fixture cross join lateral jsonb_array_elements(input#>'{currentSource,version,assignments}') w;
select fixture_assert(jsonb_array_length(static_weekly_assert_approved_dated_projection(dated->'projection',(dated->>'sourcePublicationId')::uuid,(dated#>>'{projection,week_start}')::date,dated#>'{projection,applied_exceptions}')->'projection_assignments')=jsonb_array_length(dated#>'{projection,assignments}'),'All dated SQL projection assignments match') from partial_fixture;
create temporary table projected as select static_weekly_approved_dated_materialize_projection('99000000-0000-4000-8000-000000000005',(dated->>'sourcePublicationId')::uuid,(dated->>'serviceDate')::date,input#>>'{templates,0,templateId}',20,1,repeat('f',64),feasibility) res from partial_fixture;
select fixture_assert(res->>'status'='PERSISTED_CURRENT' and p.projection_envelope=dated->'projection' and (select count(*) from weekly_schedule_occurrences)=jsonb_array_length(dated#>'{projection,assignments}'),'Original confirmation persisted projection, all occurrences and full lunch') from projected join weekly_schedule_compiled_projections p on p.projection_id=(res->>'projection_id')::uuid cross join partial_fixture;
select fixture_assert(l.document_json=dated->'lunchDocument' and l.accepted_by_manager_id=p.compiled_by_manager_id,'Both database originals match compiler output and manager') from weekly_schedule_compiled_projections p join weekly_schedule_lunch_documents l using(projection_id) cross join partial_fixture;
ROLLBACK;
"""
src['run_pg'](sql)
