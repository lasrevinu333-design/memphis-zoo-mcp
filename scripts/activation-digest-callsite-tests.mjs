// Exact captured owner expansion and metadata/recovery qualification.
// Dependency tables are synthetic DDL ports; this is not full activation proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const stem='../docs/pending-repairs/20261110054150_custodial_activation_digest_callsite_retention';
const data=JSON.parse(readFileSync(new URL(stem+'.json',import.meta.url),'utf8'));
const repair=readFileSync(new URL(stem+'.sql',import.meta.url),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
assert.equal(data.targets.length,8);
let sites=0;
for(const t of data.targets){
 assert.equal(sha(t.definition),t.preimage_sha256);
 let expected=t.definition;
 for(const seam of t.prior_qualified_seams){assert.equal(expected.split(seam.before).length-1,1);expected=expected.replace(seam.before,seam.after);}
 for(const s of [...t.digest_substitutions].reverse()){
  assert.equal(expected.slice(s.start,s.end),s.before);
  assert.ok(s.before.startsWith('public.static_weekly_digest_jsonb('));
  assert.equal(s.after,"pg_catalog.encode(extensions.digest(pg_catalog.convert_to(("+s.before.slice('public.static_weekly_digest_jsonb('.length,-1)+")::text,'UTF8'),'sha256'),'hex')");
  expected=expected.slice(0,s.start)+s.after+expected.slice(s.end);sites++;
 }
 assert.equal(expected,t.replacement,'No guard/control-flow/writes changed beyond qualified exact seams and helper expansion');
 assert.equal(sha(expected),t.replacement_sha256);
}
assert.equal(sites,31);
assert.equal(data.global_helpers[0].definition.split('AS $function$')[1].split('$function$')[0].trim(),
 'select public.static_weekly_digest_text(p_value::text)');
assert.match(data.global_helpers[0].definition,/STABLE STRICT SECURITY DEFINER/);
assert.match(data.global_helpers[1].definition,/STABLE STRICT SECURITY DEFINER/);
assert.equal((repair.match(/disable trigger/g)||[]).length,1);
assert.equal((repair.match(/enable always trigger/g)||[]).length,1);
const q=s=>"'"+s.replaceAll("'","''")+"'";
const schemas=new Set(['extensions','custodial_coverall']);
const tables=new Set();
for(const t of data.targets)for(const m of t.definition.matchAll(/\b([a-z_]+)\.([a-z_]+)%rowtype/g)){
 schemas.add(m[1]);tables.add(m[1]+'.'+m[2]);
}
let sql='\\set ON_ERROR_STOP on\n'+[...schemas].map(s=>`create schema if not exists ${s};`).join('\n')+'\n';
sql+=`create extension pgcrypto with schema extensions;create role static_weekly_control_plane;create role fixture_wrong_owner;
create role anon;create role authenticated;create role service_role;create role dashboard_user;
grant usage on schema extensions to anon,authenticated,service_role;
grant usage,create on schema extensions to dashboard_user;
grant execute on function extensions.digest(bytea,text) to postgres with grant option;
grant execute on function extensions.digest(bytea,text) to dashboard_user;
`;
for(const table of tables)sql+=`create table ${table}(fixture_only int);\n`;
for(const h of [...data.global_helpers].reverse()){sql+=h.definition+`;revoke all on function ${h.identity} from public;\n`;}
for(const t of data.targets){
 sql+=t.definition+`;revoke all on function ${t.identity} from public;\n`;
 if(t.metadata.acl.includes('static_weekly_control_plane='))sql+=`grant execute on function ${t.identity} to static_weekly_control_plane;\n`;
}
sql+=`create table public.custodial_release_authority_restore_inventory(object_kind text,object_identity text,restore_order integer,definition_sql text,definition_sha256 text,captured_at timestamptz default now());
create function public.fixture_inventory_guard() returns trigger language plpgsql as $$begin raise exception 'Immutable recovery inventory';end$$;
create trigger trg_custodial_release_authority_restore_inventory_immutable before update or delete on public.custodial_release_authority_restore_inventory for each row execute function public.fixture_inventory_guard();
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
create function public.custodial_release_canary_authority_surface() returns table(object_kind text,object_identity text,reason text) language sql as $$select object_kind,object_identity,'fixture surface'::text from public.custodial_release_authority_restore_inventory$$;
`;
for(const t of data.targets)for(const r of t.inventory)sql+=`insert into public.custodial_release_authority_restore_inventory(object_kind,object_identity,restore_order,definition_sql,definition_sha256) values(${q(r.object_kind)},${q(r.object_identity)},${r.restore_order},${q(r.definition_sql)},${q(r.definition_sha256)});\n`;
sql+="insert into public.custodial_release_authority_restore_inventory values('fixture','unrelated original',9999999,'preserve','preserve',now());\n";
const body=repair.slice(repair.indexOf('do $digest_callsite$'),repair.lastIndexOf('commit;'));
const id=data.targets[0].identity;
const refusal=(setup,expected)=>`begin ${setup} execute $repair$${body}$repair$;raise exception 'Invalid predecessor accepted';
exception when others then if sqlerrm not like ${q(expected+'%')} then raise;end if;end;\n`;
sql+=`do $refusals$ begin
${refusal(`alter function ${id} owner to fixture_wrong_owner;`,'Exact digest caller metadata differs:')}
${refusal(`grant execute on function ${id} to public;`,'Exact digest caller metadata differs:')}
${refusal(`insert into public.custodial_release_authority_restore_inventory values('grant',${q(id)},1,'unexpected','unexpected',now());`,'Exact digest caller recovery predecessor differs:')}
${refusal('alter function public.static_weekly_digest_jsonb(jsonb) security invoker;','Exact unchanged digest helper differs:')}
${refusal('grant usage on schema extensions to static_weekly_control_plane;','Exact existing pgcrypto binding differs')}
raise notice 'PASS changed owner/ACL/recovery/helper refused, transactionally unchanged';end $refusals$;\n`;
sql+=repair;
sql+=`do $duplicate$ begin ${refusal('', 'Exact digest caller predecessor differs:')}
if not exists(select 1 from public.custodial_release_authority_restore_inventory where object_identity='unrelated original' and definition_sql='preserve') then raise exception 'Unrelated recovery changed';end if;
raise notice 'PASS exact eight-owner DDL/readback, two recovery rows, unchanged grants/surface and duplicate refusal';end $duplicate$;\n`;
sql+=`do $parity$ declare d jsonb;begin
 for d in select value from jsonb_array_elements('[null,true,1.0,"é𝄞",{"b":2,"a":[false,null,"x"]},[]]'::jsonb) loop
  if public.static_weekly_digest_jsonb(d) is distinct from pg_catalog.encode(extensions.digest(pg_catalog.convert_to(d::text,'UTF8'),'sha256'),'hex') then raise exception 'Digest bytes differ';end if;
 end loop;
 if public.static_weekly_digest_jsonb(null::jsonb) is distinct from pg_catalog.encode(extensions.digest(pg_catalog.convert_to((null::jsonb)::text,'UTF8'),'sha256'),'hex') then raise exception 'SQL NULL strictness differs';end if;
 select jsonb_agg(jsonb_build_object('n',i,'value',i/3.0,'unicode','é𝄞')) into d from generate_series(1,2000)i;
 if public.static_weekly_digest_jsonb(d-array['digest','initialBaseline']) is distinct from pg_catalog.encode(extensions.digest(pg_catalog.convert_to((d-array['digest','initialBaseline'])::text,'UTF8'),'sha256'),'hex') then raise exception 'Structured digest differs';end if;
 raise notice 'PASS exact helper input/output parity including NULL Unicode numeric structured values';end $parity$;\n`;
sql+=`create function public.fixture_crypto_invoker(d jsonb) returns text language plpgsql set search_path=pg_catalog,public as $$begin return pg_catalog.encode(extensions.digest(pg_catalog.convert_to(d::text,'UTF8'),'sha256'),'hex');end$$;
revoke all on function public.fixture_crypto_invoker(jsonb) from public;
create function public.fixture_crypto_definer(d jsonb) returns text language plpgsql security definer set search_path=pg_catalog,public as $$begin return public.fixture_crypto_invoker(d);end$$;
revoke all on function public.fixture_crypto_definer(jsonb) from public;
grant execute on function public.fixture_crypto_definer(jsonb) to static_weekly_control_plane;
set role static_weekly_control_plane;
select public.fixture_crypto_definer('{"unicode":"é𝄞"}'::jsonb) is not null as definer_to_invoker_crypto_succeeds;
do $$begin begin perform extensions.digest('test'::bytea,'sha256');raise exception 'Direct crypto unexpectedly allowed';exception when insufficient_privilege then null;end;raise notice 'PASS direct control-plane crypto access remains denied';end$$;
reset role;
do $$begin if has_schema_privilege('static_weekly_control_plane','extensions','USAGE') then raise exception 'Crypto privilege widened';end if;end$$;
`;
const name='custodial-digest-callsite-test-'+randomUUID().slice(0,12),image='public.ecr.aws/supabase/postgres:17.6.1.165';
const run=(args,options={})=>spawnSync('docker',args,{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,...options});
assert.equal(run(['image','inspect',image]).status,0);
assert.notEqual(run(['inspect',name]).status,0);
try{
 const result=run(['run','--rm','-i','--network','none','--name',name,'--user','postgres','--tmpfs','/tmp:rw,size=256m,mode=1777','--entrypoint','bash',image,'-c',
 "set -e; initdb -D /tmp/test-data -A trust -U postgres >/dev/null; pg_ctl -D /tmp/test-data -l /tmp/postgres.log -o '-k /tmp -h 127.0.0.1 -c shared_buffers=32MB -c jit=off' -w start >/dev/null; psql -h /tmp -U postgres -d postgres; pg_ctl -D /tmp/test-data -m fast -w stop >/dev/null"],{input:sql});
 process.stdout.write(result.stdout||'');process.stdout.write(result.stderr||'');assert.equal(result.status,0,result.error?.message||'Exact digest callsite fixture failed');
}finally{run(['rm','-f',name]);assert.notEqual(run(['inspect',name]).status,0);}
console.log(JSON.stringify({status:'PASS',targets:8,digest_substitutions:sites,scope:'exact source expansion/DDL/metadata/recovery; synthetic dependency ports',production:false,full_activation:false,owned_container_removed:true}));
