// Offline deterministic Source compiler. Never connects to a database or reads an archive.
// Output is a separately pinned program; the restore runtime cannot choose substitutions.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadImmutableDomainSourceRecipes} from './immutable-private-domain-source.mjs';
import {loadImmutableMessageSourceRecipes} from './immutable-private-message-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const body=s=>s.split('AS $function$')[1].slice(0,-'$function$\n'.length);
const once=(s,a,b)=>{assert.equal(s.split(a).length,2);return s.replace(a,()=>b);};
const installedPath='release/installed-source/20261031225210_custodial_sealed_repairs_current_eight.sql';
const installed=readFileSync(installedPath,'utf8');
assert.equal(sha(installed),'f4e3dc5be9a465e2099bd9b23488f99b3f9e4c1d9d969844b2fa06b1fbdc7a73');
const specs=[
 ['public.events_app_validate_scope_venue()','function','883b8dc797f7a837b8d2e32f5d26de89d304e9d485d8656c921ca2c52e405f39'],
 ['public.ops_manager_notification_validate_owner()','owner','ca87ecf25e05d0d7e85960ca288bf7c4ab9244294215babeeb898b46c6c915b5'],
 ['public.ops_manager_enqueue_message_push()','message','49e3dd0cd122a801b0ace6ff0bb24877c633ce4d49ad7cce1a605ae4d013e227'],
];
const current=new Map(specs.map(([identity,tag,hash])=>{
 const start=installed.indexOf('CREATE OR REPLACE FUNCTION '+identity+'\n');assert.ok(start>0);
 const begin=installed.indexOf('AS $'+tag+'$',start),end=installed.indexOf('$'+tag+'$;',begin+tag.length+5);assert.ok(end>begin);
 const originalBody=installed.slice(begin+tag.length+5,end);
 const header=tag==='function'?installed.slice(start,begin):'CREATE OR REPLACE FUNCTION '+identity+'\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO \'pg_catalog\', \'public\'\n';
 const definition=header+'AS $function$'+originalBody+'$function$\n';assert.equal(sha(definition),hash);
 return [identity,definition];
}));
const domain=loadImmutableDomainSourceRecipes(),messages=loadImmutableMessageSourceRecipes();
const oldRecipes=[...domain.recipes,...messages.recipes];
const recipes=oldRecipes.map(r=>{
 assert.ok(!r.before.includes('supabase_admin'));
 let before=current.get(r.identity)||r.before,after=r.after;
 if(current.has(r.identity)){
  const insertion='\nbegin\n',position=r.before.indexOf(insertion)+insertion.length;assert.ok(position>=insertion.length);
  assert.ok(r.after.startsWith(r.before.slice(0,position)));
  const branch=r.after.slice(position,position+r.after.length-r.before.length);
  assert.equal(r.after.slice(0,position)+r.after.slice(position+branch.length),r.before);
  const target=before.includes('\nbegin\n')?'\nbegin\n':'\nBEGIN\n';
  after=once(before,target,target+branch);
 }
 after=after.replaceAll('supabase_admin','postgres');
 return {...r,before,after,beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(body(before)),afterBodyHash:sha(body(after))};
});
const order=['immutable-private-owner-context.sql','immutable-original-event-restore.sql','immutable-original-employee-restore.sql','immutable-original-messenger-restore.sql','immutable-original-message-guards-restore.sql','immutable-original-message-effects-restore.sql','immutable-original-message-audit-restore.sql','immutable-original-message-receipts-restore.sql','immutable-original-device-boundary-restore.sql','immutable-original-authority-reconciliation.sql','immutable-original-authority-target-shape.sql','immutable-original-manager-push-restore.sql','immutable-original-employee-push-authority-restore.sql'];
const extraPins={'immutable-private-owner-context.sql':'9624907a8e154e07f266597c23d7052739931d634115b68434dd712c346cc007','immutable-original-authority-reconciliation.sql':'e60545804e8c76d94769c6b80426e3dcb86f0bdf47527cd42b5735eb7eff600a','immutable-original-authority-target-shape.sql':'265185d8860131d5472db2a70f036332758b4b2f577b48582980f36ff7eacc3e'};
const all=[...domain.statements,...messages.statements,...Object.entries(extraPins).map(([name,pin])=>{const sql=readFileSync('proposals/'+name,'utf8');assert.equal(sha(sql),pin);return {sourcePath:'proposals/'+name,sourceSha256:pin,sql};})];
// Exact token changes in trusted pinned program Source only. No original body
// contains this actor token. The emitted artifact is fully hash-pinned at runtime.
// The current authenticated owner is postgres itself. The installed grant
// exporter (20260825174500) excludes the owner, so its legacy non-owner
// postgres grant cannot be part of this profile's exact expected DATA.
// These closed substitutions change no catalog ACL, role, owner or predicate.
const ownerGrantProfiles={
 'immutable-original-messenger-restore.sql':['msg_enforce_canonical_active_pair_participants','msg_enforce_canonical_active_pair_thread','msg_reject_retired_ops_manager_shared_participation','msg_reject_retired_ops_manager_shared_thread_mutation'],
 'immutable-original-message-guards-restore.sql':['msg_reject_retired_ops_manager_shared_message_mutation','mz_reject_event_messenger_message'],
 'immutable-original-message-effects-restore.sql':['msg_enqueue_background_work','msg_memphis_pre_generate_schedule','msg_audit_persisted_message','mz_enqueue_employee_message_push','ops_manager_enqueue_message_push'],
 'immutable-original-message-audit-restore.sql':['msg_reject_retired_ops_manager_shared_message_audit_mutation'],
 'immutable-original-message-receipts-restore.sql':['msg_reject_retired_ops_manager_shared_receipt_mutation'],
};
const ownerAclStatements=['immutable-original-device-boundary-restore.sql','immutable-original-manager-push-restore.sql','immutable-original-employee-push-authority-restore.sql'];
const statements=order.map(name=>{
 const old=all.find(s=>s.sourcePath==='proposals/'+name);assert.ok(old);
 let sql=old.sql;
 for(let i=0;i<recipes.length;i++){
  const a=oldRecipes[i],b=recipes[i];
  if(a.before!==b.before){
   sql=sql.replaceAll(JSON.stringify(a.before),JSON.stringify(b.before));
   sql=sql.replaceAll(a.before,b.before);
  }
  for(const field of ['beforeHash','beforeBodyHash','afterHash','afterBodyHash'])if(a[field]!==b[field])sql=sql.replaceAll(a[field],b[field]);
 }
 sql=sql.replaceAll("current_user NOT IN('postgres','supabase_admin')","current_user <> 'postgres'");
 sql=sql.replaceAll('supabase_admin','postgres');
 if(name==='immutable-original-manager-push-restore.sql')sql=once(sql,"insertion_point constant text:=E'\\nbegin\\n';","insertion_point constant text:=E'\\nBEGIN\\n';");
 if(name==='immutable-original-message-effects-restore.sql'){
  // One exact current predecessor has uppercase BEGIN; keep the four other
  // unchanged strategies and all their single insertion/byte hash assertions.
  sql=once(sql,"insertion_point constant text",'insertion_point text');
  const anchor="    before_definition := pg_catalog.pg_get_functiondef(function_oid);";
  sql=once(sql,anchor,anchor+"\n    insertion_point := CASE WHEN profile->>'lookup_identity'='public.ops_manager_enqueue_message_push()' THEN E'\\nBEGIN\\n' ELSE E'\\nbegin\\n' END;");
 }
 for(const identity of ownerGrantProfiles[name]||[]){
  const after="select public.custodial_release_authority_reset_grants('"+identity+"()');";
  const before=after+' grant execute on function '+identity+'() to postgres;';
  sql=once(sql,JSON.stringify(before),JSON.stringify(after));
  sql=once(sql,sha(before),sha(after));
 }
 if(ownerAclStatements.includes(name)){
  // Both exact OID lookups are postgres in this separately pinned profile.
  // Retain grantee/grantor/EXECUTE/no-grant-option and explicit owner checks.
  const predicate="IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))))<>";
  sql=once(sql,predicate+'2',predicate+'1');
 }
 const wrapper=name==='immutable-original-employee-push-authority-restore.sql'?'DO_ONLY':
 ['immutable-private-owner-context.sql','immutable-original-employee-restore.sql','immutable-original-device-boundary-restore.sql','immutable-original-authority-reconciliation.sql','immutable-original-manager-push-restore.sql'].includes(name)?'OUTER_TRANSACTION':'NONE';
 return {sourcePath:old.sourcePath,originalSourceSha256:old.sourceSha256,sourceSha256:sha(sql),wrapper,sql};
});
const result={format:'custodial.immutable-private-current-postgres-program.v1',profile:{id:'immutable-private-current-postgres',actor:'postgres'},provenance:{sourcePath:installedPath,sourceSha256:sha(installed),definitions:specs.map(([identity,,sha256])=>({identity,sha256}))},recipes,statements};
domain.assertCurrent();messages.assertCurrent();
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--check'))assert.equal(readFileSync('proposals/immutable-private-current-postgres-program.json','utf8'),output);
else writeFileSync('proposals/immutable-private-current-postgres-program.json',output,{flag:'wx'});
console.log(JSON.stringify({ok:true,sha256:sha(output),bytes:Buffer.byteLength(output),recipes:recipes.length,statements:statements.length}));
