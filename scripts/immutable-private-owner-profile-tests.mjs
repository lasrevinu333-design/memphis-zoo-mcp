import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inspectImmutableOriginalOwnerData,readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {loadImmutableCurrentPostgresSource} from './immutable-private-postgres-source.mjs';
import {loadImmutableDomainSourceRecipes} from './immutable-private-domain-source.mjs';
import {loadImmutableMessageSourceRecipes} from './immutable-private-message-source.mjs';
import {readVerifiedImmutableBootstrapOwnerProfile,readVerifiedImmutableBootstrapStatement} from './immutable-private-source-bootstrap.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(actor='postgres'){
 const group=readFileSync('supabase/migrations/20261013171946_messenger_original_group_creation.sql','utf8').split('as $ledger_guard_body$')[1].split('$ledger_guard_body$')[0];
 const sql=readFileSync('supabase/migrations/20260827150000_disaster_recovery_global_mutation_fence.sql','utf8');
 const app=sql.slice(sql.indexOf('create or replace function custodial_dr.guard_application_mutation()')).split('as $$')[1].split('$$;')[0];
 const defs=[['custodial_release_identity.guard_group_original_creation()',group," SET search_path TO 'pg_catalog', 'public', 'extensions'\n"],['custodial_dr.guard_application_mutation()',app," SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'custodial_dr'\n"]];
 const guards=defs.map(([id,prosrc,header])=>({owner:actor,prosrc,definition:'CREATE OR REPLACE FUNCTION '+id+'\n RETURNS trigger\n LANGUAGE plpgsql\n'+header+'AS $function$'+prosrc+'$function$\n'}));
 const tables=[['custodial_release_identity','group_original_creations'],['custodial_release_identity','employee_message_original_outcomes'],['public','release_deployment_manifest'],['public','custodial_release_authority_restore_inventory']];
 const recipes=actor==='postgres'?loadImmutableCurrentPostgresSource().recipes:[...loadImmutableDomainSourceRecipes().recipes,...loadImmutableMessageSourceRecipes().recipes];
 const acls={routines:[...recipes.map(r=>({kind:'FUNCTION',identity:r.identity,owner_name:actor})),{kind:'FUNCTION',identity:defs[0][0],owner_name:actor}],relations:tables.map(([schema_name,object_name])=>({kind:'TABLE',schema_name,object_name,owner_name:actor})),namespaces_columns:[{kind:'SCHEMA',schema_name:'custodial_release_identity',owner_name:actor}]};
 const relations=tables.map(([schema_name,table_name])=>({schema_name,table_name,owner_name:actor}));
 return {inventory:{'inventory/original-guards.json':JSON.stringify(guards),'inventory/original-relations.json':JSON.stringify(relations),'inventory/original-acls.json':JSON.stringify(acls)},catalog:{functions:recipes.map(r=>({schema_name:'public',function_name:r.identity.slice(7,-2),identity_arguments:'',definition:r.before}))}};
}
const mutate=(data,file,fn)=>{const v=JSON.parse(data.inventory[file]);fn(v);data.inventory[file]=JSON.stringify(v);};
test('exact25 current original definitions and complete postgres owner evidence derive fixed DATA',()=>{
 const p=inspectImmutableOriginalOwnerData(fixture());assert.deepEqual(p,{id:'immutable-private-current-postgres',actor:'postgres'});assert.ok(Object.isFrozen(p));
});
test('legacy source program stays explicit and unchanged',()=>{
 assert.deepEqual(inspectImmutableOriginalOwnerData(fixture('supabase_admin')),{id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'});
});
test('missing, duplicate or mixed owners cannot select an actor profile',()=>{
 const edits=[v=>v.routines.pop(),v=>v.routines.push(v.routines[0]),v=>v.routines[0].owner_name='supabase_admin',v=>v.relations[0].owner_name='supabase_admin',v=>v.namespaces_columns[0].owner_name='supabase_admin'];
 for(const edit of edits){const f=fixture();mutate(f,'inventory/original-acls.json',edit);assert.throws(()=>inspectImmutableOriginalOwnerData(f));}
 for(const edit of [v=>v.pop(),v=>v[1].owner='supabase_admin',v=>v[0].prosrc+=' ',v=>v[0].definition=v[0].definition.replace(' LANGUAGE plpgsql',' LANGUAGE plpgsql\n SECURITY DEFINER')]){const f=fixture();mutate(f,'inventory/original-guards.json',edit);assert.throws(()=>inspectImmutableOriginalOwnerData(f));}
});
test('normal bodies, definer flags and current recipe set are exact not observed-source allowlists',()=>{
 for(const edit of [f=>f.catalog.functions[0].definition+=' ',f=>f.catalog.functions[0].definition=f.catalog.functions[0].definition.replace(' SECURITY DEFINER\n',''),f=>f.catalog.functions.push(f.catalog.functions[0]),f=>f.catalog.functions.pop()]){const f=fixture();edit(f);assert.throws(()=>inspectImmutableOriginalOwnerData(f));}
 const f=fixture();const legacy=loadImmutableDomainSourceRecipes().recipes.find(r=>r.identity==='public.events_app_validate_scope_venue()');f.catalog.functions.find(r=>r.function_name==='events_app_validate_scope_venue').definition=legacy.before;assert.throws(()=>inspectImmutableOriginalOwnerData(f));
});
test('caller supplied objects never become branded archive/source/statement authority',()=>{
 assert.throws(()=>readVerifiedImmutableArchiveOwnerProfile(fixture()));assert.throws(()=>readVerifiedImmutableBootstrapOwnerProfile({ownerProfile:{actor:'postgres'}},{}));assert.throws(()=>readVerifiedImmutableBootstrapStatement({statements:[]},{},{}));
});
test('fixed program reproduces from pinned public Source; every emitted SQL and recipe hash matches',()=>{
 execFileSync(process.execPath,['scripts/build-immutable-postgres-program.mjs','--check']);const p=loadImmutableCurrentPostgresSource();
 assert.equal(p.recipes.length,23);assert.equal(p.statements.length,13);
 for(const r of p.recipes){assert.equal(sha(r.before),r.beforeHash);assert.equal(sha(r.after),r.afterHash);assert.ok(!r.after.includes('supabase_admin'));}
 for(const s of p.statements){assert.equal(sha(s.sql),s.sourceSha256);assert.ok(!s.sql.includes('supabase_admin'));}
 p.assertCurrent();assert.throws(()=>loadImmutableCurrentPostgresSource('postgres'));assert.throws(()=>p.assertCurrent('ignored'));
});

test('all current original normal bodies survive restore additions byte-for-byte',()=>{
 const p=loadImmutableCurrentPostgresSource();
 for(const r of p.recipes){
  if(r.identity==='public.msg_memphis_pre_generate_schedule()'){
   const body=r.before.split('AS $function$')[1].slice(0,-'$function$\n'.length);
   assert.equal(r.after.split(body).length,2);assert.ok(r.after.endsWith(body+'end;\n$function$\n'));
  }else{
   let prefix=0;while(r.before[prefix]===r.after[prefix])prefix++;
   const length=r.after.length-r.before.length;assert.ok(length>0);
   assert.equal(r.after.slice(0,prefix)+r.after.slice(prefix+length),r.before,r.identity);
  }
 }
 const owner=p.recipes.find(r=>r.identity==='public.ops_manager_notification_validate_owner()');
 assert.ok(owner.before.includes('custodial_leadership_private.notification_credential'));
 const event=p.recipes.find(r=>r.identity==='public.events_app_validate_scope_venue()');
 assert.ok(event.before.includes('OFFSITE event cannot allocate Zoo cleaning or staffing areas'));
 const push=p.recipes.find(r=>r.identity==='public.ops_manager_enqueue_message_push()');
 assert.ok(push.before.includes('CUSTODIAL_LEADERSHIP_REGISTRATION'));
});

test('postgres expected ACL DATA excludes only its owner and legacy source stays distinct',()=>{
 const p=loadImmutableCurrentPostgresSource();let changed=0,alreadyOwnerOnly=0;
 for(const s of p.statements){
  const legacy=readFileSync(s.sourcePath,'utf8');
  const tags=[...legacy.matchAll(/\$(\w+)\$\s*\[/g)];
  for(const match of tags){
   const tag='$'+match[1]+'$',before=JSON.parse(legacy.split(tag)[1].trim()),after=JSON.parse(s.sql.split(tag)[1].trim());
   assert.equal(after.length,before.length);
   for(let i=0;i<before.length;i++)if(before[i].before_grant_definition){
    const b=before[i],a=after[i],suffix=' grant execute on function '+b.identity+' to postgres;';
    if(b.before_grant_definition.endsWith(suffix)){
     assert.equal(a.before_grant_definition,b.before_grant_definition.slice(0,-suffix.length));changed++;
    }else{assert.equal(a.before_grant_definition,b.before_grant_definition);alreadyOwnerOnly++;}
    assert.equal(sha(a.before_grant_definition),a.before_grant_sha256);
   }
  }
 }
 assert.equal(changed,13);assert.equal(alreadyOwnerOnly,1);
 for(const name of ['immutable-original-device-boundary-restore.sql','immutable-original-manager-push-restore.sql','immutable-original-employee-push-authority-restore.sql']){
  const legacy=readFileSync('proposals/'+name,'utf8'),current=p.statements.find(s=>s.sourcePath==='proposals/'+name).sql;
  const block=sql=>sql.slice(sql.indexOf("IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,"),sql.indexOf('THEN RAISE EXCEPTION',sql.indexOf("IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,")));
  assert.ok(block(legacy).includes('))<>2'));assert.equal(block(current),block(legacy).replace('))<>2','))<>1'));
  assert.equal((current.match(/SELECT oid INTO (?:owner_oid|postgres_oid) FROM pg_catalog.pg_roles WHERE rolname='postgres';/g)||[]).length,2);
 }
});

test('synthetic native qualifier matches the unchanged owned target namespace before any resource birth',async()=>{
 const {assertPrivatePgOwnerProfile}=await import('./run-official-local-storage-rehearsal.mjs');
 const {immutablePostgresAclFixtureSql}=await import('./qualify-immutable-postgres-acls.mjs');
 const source=readFileSync(new URL('./qualify-immutable-postgres-acls.mjs',import.meta.url),'utf8');
 const line=source.match(/const owner=randomBytes\(16\)\.toString\('hex'\),name=[^\n]+;/)[0];
 const {owner,name,networkName}=new Function('randomBytes',line+'return {owner,name,networkName};')(()=>Buffer.alloc(16,1));
 const profile={id:'immutable-private-current-postgres',actor:'postgres'};
 const metadata={Name:'/'+name,Config:{Labels:{'custodial.private-backup-rehearsal':owner,'custodial.private-owner-profile':profile.id,'custodial.private-owner-actor':profile.actor},ExposedPorts:{'5432/tcp':{}}},HostConfig:{PortBindings:{},PublishAllPorts:false,NetworkMode:networkName},NetworkSettings:{Networks:{[networkName]:{}},Ports:{}}};
 assert.equal(assertPrivatePgOwnerProfile(metadata,profile),true);
 for(const bad of ['mz_acl_qualification_'+owner,'mz_schema_rebuild_acl_qualification_'+owner+'_other'])assert.throws(()=>assertPrivatePgOwnerProfile({...metadata,Name:'/'+bad},profile));
 const fixture=immutablePostgresAclFixtureSql();assert.equal(fixture.checks,69);assert.ok(fixture.sql.startsWith('begin read only;'));assert.ok(fixture.sql.endsWith('rollback;\n'));
 assert.doesNotMatch(fixture.sql,/\b(?:create|alter|drop|insert|update|delete|revoke)\b/i);
});
