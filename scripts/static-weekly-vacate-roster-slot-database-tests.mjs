import { createCiFreshOnlyFixture, loadCiFreshOnlyReplay } from './ci-fresh-only-replay.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const fixtureName='mz_schema_rebuild_roster_'+process.pid;
let container=fixtureName;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const migrationFiles=readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
// The selector binds every original297 byte and admits only the exact one-file
// source298 successor. Its no-auto-grants choices retain their own identities.
const selectedManifest=JSON.parse(readFileSync(path.join(root,'release/fresh-only-replay/MANIFEST.json'),'utf8'));
const selectedSource=loadCiFreshOnlyReplay(root,selectedManifest.image,migrationFiles,{noAutoTableGrants:true});
assert.equal(migrationFiles.length,selectedSource.entries.length,'current exactly selected migration count for each vacancy fixture');
assert.deepEqual(migrationFiles.slice(294,297),[
 '20261027230000_accepted_actual_lunch_windows.sql',
 '20261027231000_canonical_coverall_capacity_links.sql',
 '20261027234814_mcp_oauth_durable_token_families.sql',
],'the three reviewed successors follow the retained294 prefix');
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...opts});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:text});
const defaultsSql="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['', 'in schema public'])sql(`alter default privileges for role ${owner} ${scope} revoke all on tables from public,anon,authenticated,service_role; alter default privileges for role ${owner} ${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
const aclDigestSql="select md5(coalesce(string_agg(c.relname||'|'||c.relkind::text||'|'||coalesce(c.relacl::text,'<owner-default>'),E'\\n' order by c.relname,c.relkind),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S')";
if(process.env.VACANCY_REFRESH_CATALOG==='1')throw new Error('The noncanonical no-auto-grants test fixture cannot refresh the canonical schema fingerprint.');
const fixtures=[
 'static-weekly-midweek-vacancy-database-fixture.mjs',
 'static-weekly-vacate-roster-slot-fixture-tests.mjs',
];
for(const [fixtureIndex,fixtureScript] of fixtures.entries()){

let owned=false;let fixture=null;const records=[];
try{
 fixture=await createCiFreshOnlyFixture({name:fixtureName,hostSocket:false,noAutoTableGrants:true});
 container=fixture.container;owned=true;
 assert.equal(fixture.name,fixtureName);
 assert.equal(fixture.receipt.name,fixtureName);
 await fixture.assertOwned();
 assert.equal(fixture.receipt.state,'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE');
 assert.equal(fixture.receipt.no_auto_table_grants,true);
 assert.equal(fixture.receipt.fingerprint_check,'NOT_CANONICAL_PROFILE_MEASURED_ONLY');
 assert.equal(fixture.receipt.full_suite_PASS,false);
 assert.equal(fixture.receipt.synthetic_fixture_checks_executed,false);
 assert.equal(fixture.receipt.measured_no_auto_catalog.canonical_fingerprint_PASS,false);
 assert.equal(fixture.receipt.measured_no_auto_catalog.new_authority,false);
 const manifest=JSON.parse(readFileSync(path.join(root,'release/fresh-only-replay/MANIFEST.json'),'utf8'));
 const replay=loadCiFreshOnlyReplay(root,manifest.image,migrationFiles,{noAutoTableGrants:true});
 const witnesses=fixture.receipt.migration_witnesses;
 assert.equal(witnesses.length,migrationFiles.length);
 console.log('OWNED_TEST_CONTAINER',container);
 console.log('AUTOMATIC_PUBLIC_TABLE_AND_SEQUENCE_DATA_API_GRANTS_ABSENT');
 for(const [index,witness]of witnesses.entries()){
  const file=migrationFiles[index];const selected=replay.entries[index];const bytes=Buffer.from(selected.sql,'utf8');
  assert.equal(witness.order,index+1);assert.equal(typeof witness.normalization_removed,'boolean');
  assert.equal(witness.name,file);assert.equal(selected.name,file);
  assert.equal(witness.original_sha256,createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations',file))).digest('hex'));
  assert.equal(witness.selected_sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(witness.atomic_mode,selected.atomicMode);assert.equal(witness.exit,0);
  assert.equal(witness.before_default_grants,0,'automatic grants absent before '+file);
  if(witness.normalization_removed){
   assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file),'unexpected automatic grant in '+file);
   assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i,'known historical default-grant normalization must not create objects before removal');
  }
  assert.equal(witness.after_default_grants,0,'automatic grants absent after '+file);
  records.push({file,sha256:witness.selected_sha256,original_sha256:witness.original_sha256,exit:0});
  if(records.length%25===0)console.log('APPLIED_SOURCE_MIGRATIONS',records.length);
 }
 replay.assertPreserved();
 assert.equal(records.length,migrationFiles.length,'both fixtures replay the exact current migration baseline');
 const aclDigest=sql(aclDigestSql).trim();
 const historical153 = witnesses[152];
 assert.equal(historical153.order,153);
 assert.equal(historical153.name,'20260925190000_gps_exact_location_authority_boundary.sql');
 assert.match(historical153.current_profile_153_raw_public_r_S_acl_md5,/^[a-f0-9]{32}$/,
  'current28f/profile source-prefix153 raw ACL digest is retained as an observation, not historical runtime reproduction');
 const aclReference=JSON.parse(readFileSync(path.join(root,manifest.no_auto_profile.reference.path),'utf8'));
 const aclContract=aclReference.current294_public_r_S_acl_contract;
 // Keep the historical294 reference literal. The three appended migrations
 // add exactly these RPC-only/OAuth tables and five explicit service grants.
 // The appended full-hour source changes functions only; this exact relation
 // and grant census is unchanged and is still checked without an exception.
 const addedTables=['static_weekly_coverall_access_links','mcp_oauth_replay_artifacts_v2','mcp_oauth_token_families_v2'];
 const expectedRelations=[...aclContract.expected_public_r_S_relations,...addedTables.map(relation_name=>({schema_name:'public',relation_name,relation_kind:'r',owner_name:'migration_owner'}))];
 const expectedGrants=[...aclContract.expected_public_r_S_nonowner_grants,
  ...[['mcp_oauth_replay_artifacts_v2',['SELECT','INSERT']],['mcp_oauth_token_families_v2',['SELECT','INSERT','UPDATE']]].flatMap(([table_name,privileges])=>privileges.map(privilege_type=>({schema_name:'public',table_name,grantee:'service_role',grantor:'migration_owner',privilege_type,is_grantable:false})))];
 const historicalContext=aclContract.historical153_source_context;
 assert.equal(historicalContext.status,'UNVERIFIED_HISTORICAL_SOURCE_CLAIM');
 assert.equal(historicalContext.historical_expected_raw_md5,'72df064663cf70bcbe58d49822723930');
 assert.equal(historicalContext.actual_historical153_PASS_or_raw_rows,null);
 assert.equal(historicalContext.current_profile_reproduces_historical_runtime,false);
 const ownerAlias=name=>['postgres','supabase_admin'].includes(name)?'migration_owner':name;
 const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
 const exactSet=rows=>rows.map(row=>canonical(row)).sort();
 const relations=JSON.parse(sql(`select coalesce(json_agg(row_to_json(r)),'[]'::json) from (select n.nspname as schema_name,c.relname as relation_name,c.relkind::text as relation_kind,pg_get_userbyid(c.relowner) as owner_name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','S')) r`));
 for(const row of relations)row.owner_name=ownerAlias(row.owner_name);
 assert.deepEqual(exactSet(relations),exactSet(expectedRelations),'exact current297 public r/S identity, kind and owner set; historical294 plus three reviewed tables');
 const grants=JSON.parse(sql(`select coalesce(json_agg(row_to_json(r)),'[]'::json) from (select n.nspname as schema_name,c.relname as table_name,coalesce(grantee.rolname,'PUBLIC') as grantee,pg_get_userbyid(a.grantor) as grantor,a.privilege_type,a.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a left join pg_roles grantee on grantee.oid=a.grantee where n.nspname='public' and c.relkind in ('r','S') and coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin')) r`));
 for(const row of grants)row.grantor=ownerAlias(row.grantor);
 assert.deepEqual(exactSet(grants),exactSet(expectedGrants),'exact source-derived current297 nonowner public r/S privilege, grantor and grantability set');
 assert.equal(sql("select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('static_weekly_coverall_access_links','mcp_oauth_replay_artifacts_v2','mcp_oauth_token_families_v2') and relrowsecurity").trim(),'3','all three new tables have RLS enabled without automatic grants');
 for(const table of addedTables)for(const role of ['anon','authenticated']){
  assert.equal(sql(`select has_table_privilege('${role}','public.${table}','SELECT,INSERT,UPDATE,DELETE')`).trim(),'f',`${table} denies direct ${role} access`);
 }
 assert.equal(sql("select has_table_privilege('service_role','public.static_weekly_coverall_access_links','SELECT,INSERT,UPDATE,DELETE')").trim(),'f','CoverAll link storage remains RPC-only for service_role');
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
 if(fixtureIndex===0&&process.env.VACANCY_REFRESH_CATALOG==='1'){await fixture.assertOwned();try{execFileSync(process.execPath,[path.join(root,'scripts/refresh-schema-fingerprint.mjs')],{cwd:root,env:{...process.env,SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,SCHEMA_FINGERPRINT_DATABASE:'postgres'},stdio:'inherit',timeout:180000});}finally{await fixture.assertOwned();}}
 await fixture.assertOwned();
 try{
 execFileSync(process.execPath,[path.join(root,'scripts',fixtureScript)],{cwd:root,env:{...process.env,ROSTER_PUBLICATION_TEST_CONTAINER:fixture.name},stdio:'inherit',timeout:180000});
 }finally{await fixture.assertOwned();}
 console.log('STATIC_WEEKLY_VACATE_ROSTER_SLOT_DATABASE_PASS');
}finally{
 if(owned){await fixture.cleanup();owned=false;assert.equal(docker(['ps','-a','--filter','name=^/'+fixture.name+'$','--format','{{.Names}}']).trim(),'');console.log('OWNED_TEST_CONTAINER_REMOVED',container);}
}
}
