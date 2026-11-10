// Exact captured owner + exact narrow repair in a task-owned, networkless PG17.
// Dependency ports below are synthetic; this is not full activation admission.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const prefix='../docs/pending-repairs/20261110042233_custodial_activation_baseline_jsonb_materialization';
const before=readFileSync(new URL(prefix+'.preimage.sql',import.meta.url),'utf8');
const repair=readFileSync(new URL(prefix+'.sql',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(before).digest('hex'),'05c3a7ed26461506dd28e36c355d14e9ca0636d67d816271dab2f9d66699d448');
const body=repair.slice(repair.indexOf('do $baseline_materialization$'),repair.lastIndexOf('commit;'));
assert.ok(body.startsWith('do $baseline_materialization$'));
const metadataRefusals=`
create role fixture_nonowner;
do $metadata_negative$ begin
 begin
  alter function public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb) owner to fixture_nonowner;
  execute $repair$${body}$repair$;
  raise exception 'Changed owner accepted';
 exception when others then if sqlerrm<>'Activation baseline owner metadata differs' then raise;end if;end;
 begin
  grant execute on function public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb) to public;
  execute $repair$${body}$repair$;
  raise exception 'Changed ACL accepted';
 exception when others then if sqlerrm<>'Activation baseline owner metadata differs' then raise;end if;end;
 if (select proowner from pg_proc where oid='public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)'::regprocedure)<>'postgres'::regrole::oid
  or (select proacl::text from pg_proc where oid='public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)'::regprocedure)<>'{postgres=X/postgres}'
  or pg_get_functiondef('public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)'::regprocedure) is distinct from (select definition_sql from original_inventory where restore_order=100614)
 then raise exception 'Metadata refusal changed original';end if;
 raise notice 'PASS changed owner and public ACL refused; original definition and authority unchanged';
end $metadata_negative$;
`;

let sql=String.raw`\set ON_ERROR_STOP on
create function public.static_weekly_digest_text(v text) returns text language sql stable strict as $$select encode(pg_catalog.sha256(convert_to(v,'UTF8')),'hex')$$;
create function public.static_weekly_digest_jsonb(v jsonb) returns text language sql stable strict as $$select public.static_weekly_digest_text(v::text)$$;
create table public.static_weekly_approved_template_catalog(template_id text primary key,template_json jsonb,binding_json jsonb,owner_config jsonb,approval_evidence jsonb,catalog_entry_digest text);
create table public.static_weekly_approved_template_retirements(template_id text);
create table public.static_weekly_approved_initial_baselines(source_id uuid primary key,template_id text,effective_start date,feasibility jsonb,snapshot_digest text);
create table public.static_weekly_authority_source_documents(source_id uuid primary key,canonical_source jsonb,source_digest text,active boolean,retired_at timestamptz);
-- Explicit synthetic dependency ports, never real authority/validator evidence.
create function public.static_weekly_v4_hydrate_compiler_source(value jsonb,day date) returns jsonb language sql as $$select value$$;
create function public.static_weekly_v9_assert_shift_end_derivation(value jsonb) returns void language sql as $$select null::void$$;
create function public.static_weekly_v3_source_identity(value jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
create table fixture(document jsonb);
do $fixture$
declare source jsonb;authority jsonb;doc jsonb;baseline jsonb;
begin
 source:=jsonb_build_object('serviceDate','2026-11-09','version',jsonb_build_object('effectiveStart','2026-11-09'),'exceptions','[]'::jsonb);
 authority:=jsonb_build_object('schema','custodial.approved-static-authority.v1');
 baseline:=jsonb_build_object('schema','custodial.approved-static-initial-baseline.v1',
  'document',jsonb_build_object('assignments','[]'::jsonb,'slot_availability','[]'::jsonb,'authority',authority,'receipt',jsonb_build_object('independentDerivations',2)),
  'projection',jsonb_build_object('assignments','[]'::jsonb,'authority',authority,'authority_digest',public.static_weekly_digest_jsonb(authority)),
  'lunchDocument','{}'::jsonb);
 doc:=jsonb_build_object('schema','custodial.approved-static-feasibility.v1','solverInvoked',false,'optimized',false,
  'mapping',jsonb_build_object('serviceDate','2026-11-09','templateId','synthetic-template','templateDigest','synthetic-binding','unchanged',true,'scopeDays','[0,1,2,3,4,5,6]'::jsonb),
  'publicationAuthority','NOT_PUBLISHED','candidateSource',source,'currentSourceDigest',public.static_weekly_digest_jsonb(source),
  'baselineAssignments','[]'::jsonb,'slotAvailability','[]'::jsonb,'projectionAssignments','[]'::jsonb,'lunchDocument','{}'::jsonb,
  'lunch',jsonb_build_object('status','PLANNED'),'shiftEndDerivation','null'::jsonb,'padding',repeat('synthetic compressed feasibility ',250000));
 doc:=doc||jsonb_build_object('digest',public.static_weekly_digest_jsonb(doc),'initialBaseline',baseline);
 insert into fixture values(doc);
 insert into public.static_weekly_authority_source_documents values('82000000-0000-4000-8000-000000000001',source,public.static_weekly_digest_jsonb(source),true,null);
 insert into public.static_weekly_approved_template_catalog values('synthetic-template',jsonb_build_object('source',source),jsonb_build_object('sourceDigest','synthetic-binding'),'{}','{}',null);
 update public.static_weekly_approved_template_catalog set catalog_entry_digest=public.static_weekly_digest_jsonb(jsonb_build_object('template',template_json,'binding',binding_json,'ownerConfig',owner_config,'approvalEvidence',approval_evidence));
end $fixture$;
`+before+`;\n`;
sql+=String.raw`
revoke all on function public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb) from public;
create table public.custodial_release_authority_restore_inventory(restore_order bigint primary key,object_kind text,object_identity text,definition_sql text,definition_sha256 text,captured_at timestamptz default statement_timestamp());
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
select 100614,'function','static_weekly_manual_store_initial_baseline(uuid,text,jsonb)',pg_get_functiondef('public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)'::regprocedure),public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)'::regprocedure));
insert into public.custodial_release_authority_restore_inventory values(42,'grant','static_weekly_digest_jsonb(jsonb)','unrelated exact original','unrelated',statement_timestamp());
create function immutable_fixture() returns trigger language plpgsql as $$begin raise exception 'immutable original';end$$;
create trigger trg_custodial_release_authority_restore_inventory_immutable before update or delete on public.custodial_release_authority_restore_inventory for each row execute function immutable_fixture();
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
create temp table original_inventory as select * from public.custodial_release_authority_restore_inventory;
create temp table expected as select public.static_weekly_manual_store_initial_baseline('82000000-0000-4000-8000-000000000001','synthetic-template',document) receipt from fixture;
create temp table expected_stored as select * from public.static_weekly_approved_initial_baselines;
truncate public.static_weekly_approved_initial_baselines;
create temp table negative_results(kind text,sqlstate text,message text);
do $before_negatives$
declare kind text;doc jsonb;
begin
 foreach kind in array array['null','array','false','digest','lunch','mapping'] loop
  select document into doc from fixture;
  case kind when 'null' then doc:=null;when 'array' then doc:='[]';when 'false' then doc:='false';
   when 'digest' then doc:=jsonb_set(doc,'{digest}','"wrong"');
   when 'lunch' then doc:=jsonb_set(doc,'{lunch,status}','"UNKNOWN"');
   when 'mapping' then doc:=jsonb_set(doc,'{mapping,unchanged}','false');end case;
  begin
   perform public.static_weekly_manual_store_initial_baseline('82000000-0000-4000-8000-000000000001','synthetic-template',doc);
   raise exception 'Invalid fixture accepted';
  exception when others then
   if sqlerrm='Invalid fixture accepted' then raise;end if;
   insert into negative_results values(kind,sqlstate,sqlerrm);
  end;
 end loop;
end $before_negatives$;
`+metadataRefusals+repair+String.raw`
do $after$
declare actual jsonb;doc jsonb;test_kind text;expected_error record;
begin
 select document into doc from fixture;
 actual:=public.static_weekly_manual_store_initial_baseline('82000000-0000-4000-8000-000000000001','synthetic-template',doc);
 if actual is distinct from (select receipt from expected) then raise exception 'Receipt changed';end if;
 if public.static_weekly_manual_store_initial_baseline('82000000-0000-4000-8000-000000000001','synthetic-template',doc) is distinct from actual then raise exception 'Replay receipt changed';end if;
 if exists(select * from expected_stored except select * from public.static_weekly_approved_initial_baselines) then raise exception 'Stored original changed';end if;
 if exists(select * from original_inventory where restore_order<>100614 except select * from public.custodial_release_authority_restore_inventory) then raise exception 'Unrelated recovery row changed';end if;
 foreach test_kind in array array['null','array','false','digest','lunch','mapping'] loop
  select document into doc from fixture;
  case test_kind when 'null' then doc:=null;when 'array' then doc:='[]';when 'false' then doc:='false';
   when 'digest' then doc:=jsonb_set(doc,'{digest}','"wrong"');
   when 'lunch' then doc:=jsonb_set(doc,'{lunch,status}','"UNKNOWN"');
   when 'mapping' then doc:=jsonb_set(doc,'{mapping,unchanged}','false');end case;
  select * into strict expected_error from negative_results n where n.kind=test_kind;
  begin
   perform public.static_weekly_manual_store_initial_baseline('82000000-0000-4000-8000-000000000001','synthetic-template',doc);
   raise exception 'Invalid fixture accepted';
  exception when others then
   if sqlstate is distinct from expected_error.sqlstate or sqlerrm is distinct from expected_error.message then raise;end if;
  end;
 end loop;
 begin update public.custodial_release_authority_restore_inventory set definition_sql='changed' where restore_order=42;raise exception 'Guard did not refuse';
 exception when others then if sqlerrm<>'immutable original' then raise;end if;end;
 raise notice 'PASS exact migration, identical receipt/replay/storage,6 refusal outcomes, unchanged unrelated recovery and ALWAYS guard';
end $after$;
`+`do $negative$ begin begin execute $repair$${body}$repair$;raise exception 'Duplicate accepted';exception when others then if sqlerrm<>'Exact activation baseline predecessor differs' then raise;end if;end;raise notice 'PASS duplicate/changed exact predecessor refused';end $negative$;\n`;
const name='custodial-baseline-test-'+randomUUID().slice(0,12);
const image='public.ecr.aws/supabase/postgres:17.6.1.165';
const run=(args,options={})=>spawnSync('docker',args,{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,...options});
assert.equal(run(['image','inspect',image]).status,0,'Use the already available exact PostgreSQL fixture image; no implicit pull');
assert.notEqual(run(['inspect',name]).status,0,'Refuse any existing container');
try {
 const result=run(['run','--rm','-i','--network','none','--name',name,'--user','postgres','--tmpfs','/tmp:rw,size=512m,mode=1777','--entrypoint','bash',image,'-c',
  "set -e; initdb -D /tmp/test-data -A trust -U postgres >/dev/null; pg_ctl -D /tmp/test-data -l /tmp/postgres.log -o '-k /tmp -h 127.0.0.1 -c shared_buffers=32MB -c jit=off' -w start >/dev/null; psql -h /tmp -U postgres -d postgres; pg_ctl -D /tmp/test-data -m fast -w stop >/dev/null"],{input:sql});
 process.stdout.write(result.stdout||'');process.stdout.write(result.stderr||'');
 assert.equal(result.status,0,result.error?.message||'Exact repair SQL fixture failed');
} finally {
 run(['rm','-f',name]);
 assert.notEqual(run(['inspect',name]).status,0,'Owned PostgreSQL fixture must be removed');
}
console.log(JSON.stringify({status:'PASS',scope:'exact live owner and proposed SQL repair; synthetic dependency ports',production:false,full_activation:false,owned_container_removed:true}));
