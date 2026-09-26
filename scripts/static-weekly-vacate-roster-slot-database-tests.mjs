import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const container='mz_schema_rebuild_roster_'+process.pid;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const migrationFiles=readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
assert.equal(migrationFiles.length,153,'current exact migration count for each vacancy fixture');
assert.equal(migrationFiles.at(-1),'20260925190000_gps_exact_location_authority_boundary.sql','current exact migration head');
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...opts});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text});
const defaultsSql="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['', 'in schema public'])sql(`alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role; alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
const aclDigestSql="select md5(coalesce(string_agg(c.relname||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'<owner-default>'),E'\\n' order by c.relname,c.relkind),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S')";
const fixtures=[
 'static-weekly-midweek-vacancy-database-fixture.mjs',
 'static-weekly-vacate-roster-slot-fixture-tests.mjs',
];
for(const [fixtureIndex,fixture] of fixtures.entries()){
let owned=false;const records=[];
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);
 owned=true;console.log('OWNED_TEST_CONTAINER',container);
 const info=JSON.parse(docker(['inspect',container]))[0];
 assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
 let consecutive=0;
 for(let attempt=0;attempt<120&&consecutive<5;attempt++){
  try{sql('select 1');consecutive++;}catch{consecutive=0;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(consecutive,5,'isolated test database ready');
 assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'").trim(),'0');
 sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
 removeDefaults();
 assert.equal(sql(defaultsSql).trim(),'0','global and public-schema automatic Data API grants absent before replay');
 console.log('AUTOMATIC_PUBLIC_TABLE_AND_SEQUENCE_DATA_API_GRANTS_ABSENT');
 for(const file of migrationFiles){
  const bytes=readFileSync(path.join(root,'supabase/migrations',file));
  assert.equal(sql(defaultsSql).trim(),'0',`automatic grants absent before ${file}`);
  sql(bytes);records.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),exit:0});
  if(Number(sql(defaultsSql))){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file),`unexpected automatic grant in ${file}`);
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i,'known historical default-grant normalization must not create objects before removal');
   removeDefaults();
  }
  assert.equal(sql(defaultsSql).trim(),'0',`automatic grants absent after ${file}`);
  if(records.length%25===0)console.log('APPLIED_SOURCE_MIGRATIONS',records.length);
 }
 assert.equal(records.length,153,'both fixtures replay the exact current migration baseline');
 const aclDigest=sql(aclDigestSql).trim();
 assert.equal(aclDigest,'72df064663cf70bcbe58d49822723930','current public table/sequence ACLs match the exact reviewed 152-migration replay');
 for(const role of ['anon','authenticated']){
  assert.equal(sql(`select has_table_privilege('${role}','public.weekly_schedule_lunch_documents','SELECT,INSERT,UPDATE,DELETE')`).trim(),'f',`RPC-only lunch document table remains inaccessible to ${role}`);
  assert.equal(sql(`select has_any_column_privilege('${role}','public.weekly_schedule_lunch_documents','SELECT,INSERT,UPDATE,REFERENCES')`).trim(),'f',`RPC-only lunch document columns remain inaccessible to ${role}`);
 }
 sql('alter default privileges for role supabase_admin grant select on tables to public;');
 assert.ok(Number(sql(defaultsSql))>0,'PUBLIC default grant is detected as effective automatic Data API access');
 removeDefaults();
 assert.equal(sql(defaultsSql).trim(),'0','PUBLIC default grant is removed in disposable sensitivity probe');
 sql('grant select(document_identity) on public.weekly_schedule_lunch_documents to authenticated;');
 assert.equal(sql("select has_any_column_privilege('authenticated','public.weekly_schedule_lunch_documents','SELECT')").trim(),'t','column-only direct access is detected');
 sql('revoke select(document_identity) on public.weekly_schedule_lunch_documents from authenticated;');
 assert.equal(sql("select has_any_column_privilege('authenticated','public.weekly_schedule_lunch_documents','SELECT,INSERT,UPDATE,REFERENCES')").trim(),'f','column-only probe leaves no direct lunch-document access');
 assert.equal(sql(aclDigestSql).trim(),aclDigest,'disposable sensitivity probes leave the final table/sequence ACL unchanged');
 console.log('FINAL_PUBLIC_TABLE_SEQUENCE_ACL_DIGEST',aclDigest);
 console.log('COMPLETE_SCHEMA',records.length);
 if(fixtureIndex===0&&process.env.VACANCY_SCHEMA_RECORDS)writeFileSync(process.env.VACANCY_SCHEMA_RECORDS,JSON.stringify(records,null,2)+'\n',{flag:'wx'});
 if(fixtureIndex===0&&process.env.VACANCY_REFRESH_CATALOG==='1')execFileSync(process.execPath,[path.join(root,'scripts/refresh-schema-fingerprint.mjs')],{cwd:root,env:{...process.env,SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,SCHEMA_FINGERPRINT_DATABASE:'postgres'},stdio:'inherit',timeout:180000});
 execFileSync(process.execPath,[path.join(root,'scripts',fixture)],{cwd:root,env:{...process.env,ROSTER_PUBLICATION_TEST_CONTAINER:container},stdio:'inherit',timeout:180000});
 console.log('STATIC_WEEKLY_VACATE_ROSTER_SLOT_DATABASE_PASS');
}finally{
 if(owned){docker(['rm','-f',container]);assert.equal(docker(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).trim(),'');console.log('OWNED_TEST_CONTAINER_REMOVED',container);}
}
}
