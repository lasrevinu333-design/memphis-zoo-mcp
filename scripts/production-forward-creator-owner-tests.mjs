import assert from 'node:assert/strict';import fs from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {productionForwardSourceManifest,bindExistingPostgresForwardSources,resolveReleaseMigrationSource} from './production-forward-source.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex'),read=p=>fs.readFileSync(join(root,p),'utf8');
const proof=JSON.parse(read('release/production-forward-source/creator-owner-equivalence-evidence.json'));let checks=0;const test=(name,fn)=>{fn();checks++;};
const orders=[100,101,103,104,105,106,107,108,109,110,111,112,113,123];
test('finite closure is genuine104 refusal + exact first CREATE family only',()=>{assert.equal(proof.actual_refusal.sha256,'706e12c8643d65d0999d0849fad9ca617755726618826997e1f9b3113e6ae84e');assert.equal(proof.actual_refusal.sqlstate,'42501');assert.equal(proof.actual_refusal.rollback_verified,true);assert.deepEqual(proof.orders,orders);assert.deepEqual(proof.changes.map(x=>x.order),orders);assert.equal(proof.production_authorized,false);assert.equal(proof.actual_SQL,false);assert.equal(proof.changes.flatMap(x=>x.new_functions).length,40);assert.equal(proof.changes.flatMap(x=>x.new_relations).length,5);assert.equal(proof.changes.flatMap(x=>x.revocation_changes).length,19);});
for(const c of proof.changes){
 const canonical=read('supabase/migrations/'+c.file),forward=read('release/production-forward-source/'+c.file);
 test('exact whole-file reconstruction, only owner token removed and guards added '+c.order,()=>{
  assert.equal(sha(canonical),c.canonical_sha256);assert.equal(sha(forward),c.forward_sha256);let reversed=forward;
  for(const part of [c.header,c.pre_guard,c.table_before_guard,c.function_before_guard,c.pre_capture_guard,c.after_guard])if(part){assert.equal(reversed.split(part).length-1,1);reversed=reversed.replace(part,'');}
  for(const r of c.revocation_changes){assert.equal(r.canonical.replace(/(\bfrom\s+public),postgres,/i,'$1,'),r.proposed_owner_preserving);assert.equal(reversed.split(r.proposed_owner_preserving).length-1,1);reversed=reversed.replace(r.proposed_owner_preserving,r.canonical);}
  assert.equal(reversed,canonical,'every other canonical byte remains exact');
 });
 test('actual creator boundary precedes all new CREATEs and refuses every overload '+c.order,()=>{
  const at=forward.indexOf(c.pre_guard);for(const f of c.new_functions)assert.ok(at<forward.indexOf(f.canonical_header));
  for(const s of ["current_user<>'postgres' OR session_user<>current_user","'rqquvtjdmugpigbndmne'","AND NOT rolsuper AND rolbypassrls","current_setting('session_replication_role')<>'origin'","relowner='postgres'::regrole","tgenabled='A'","pronamespace='public'::regnamespace AND proname=ANY("])assert.ok(c.pre_guard.includes(s));
  for(const f of c.new_functions)assert.ok(c.pre_guard.includes("'"+f.name.split('.')[1]+"'"));
  for(const t of c.new_relations)assert.ok(c.pre_guard.includes("'"+t.name+"'"));
  assert.ok(c.pre_guard.includes('WHERE to_regclass(x) IS NOT NULL'));
  assert.ok(c.after_guard.includes('exact new-object signature/OID census changed'));
 });
 test('ordinary creator privileges observed before exact canonical ACL statements '+c.order,()=>{
  const at=forward.indexOf(c.function_before_guard),revoke=c.revocation_changes.find(x=>x.canonical.toLowerCase().includes('function'));
  assert.ok(at<forward.indexOf(revoke.proposed_owner_preserving));
  for(const spec of c.specs){assert.ok(c.function_before_guard.includes(spec.body_md5));assert.ok(c.function_before_guard.includes(spec.signature));}
  for(const s of ["p.proowner<>'postgres'::regrole","has_function_privilege(current_user,p.oid,'EXECUTE')","a.grantee=p.proowner AND a.privilege_type='EXECUTE'","md5(pg_get_functiondef(p.oid))"])assert.ok(c.function_before_guard.includes(s));
  assert.ok(c.after_guard.includes('actual_acl IS DISTINCT FROM before.owner_acl'));assert.ok(c.after_guard.includes('md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5'));
  assert.ok(c.after_guard.includes('IS DISTINCT FROM spec.nonowner_execute'));
 });
 if(c.new_relations.length)test('new tables retain existing seven creator rights and exact RLS/trigger/data boundary '+c.order,()=>{
  assert.ok(c.table_before_guard.includes("SELECT DISTINCT privilege_type privilege FROM aclexplode(acldefault('r',c.relowner))"));
  assert.ok(c.table_before_guard.includes('NOT has_table_privilege(current_user,c.oid,privilege)'));
  assert.ok(c.table_before_guard.includes('a.grantee=c.relowner AND a.privilege_type=privilege'));
  for(const s of ['c.relowner<>before.owner_oid','actual_acl IS DISTINCT FROM before.owner_acl','a.grantee<>c.relowner',"tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62",'t.tgtype=x.type',"c.relrowsecurity OR NOT c.relforcerowsecurity",'SELECT EXISTS(SELECT 1 FROM ONLY %s)','IF populated THEN'])assert.ok(c.after_guard.includes(s));
  assert.equal(c.triggers.length,c.new_relations.length);assert.ok(c.triggers.every(t=>t.enabled==='A'));
 });
 test('pre-capture and terminal ACL boundaries both retained '+c.order,()=>{assert.equal(c.pre_capture_guard,c.after_guard.replaceAll('$creator_after$','$creator_before_capture$'));assert.ok(forward.indexOf(c.pre_capture_guard)<forward.indexOf(c.after_guard));const tail=forward.slice(forward.indexOf(c.pre_capture_guard)+c.pre_capture_guard.length,forward.indexOf(c.after_guard));assert.ok(tail.includes('COMMIT;')===false);});
 test('no new grants/owner changes/guard disabling inserted '+c.order,()=>{
  for(const part of [c.pre_guard,c.table_before_guard,c.function_before_guard,c.pre_capture_guard,c.after_guard]){
   const outside=part.replace(/\$creator_(?:specs|triggers)\$[\s\S]*?\$creator_(?:specs|triggers)\$/g,'').replace(/'[^']*'/g,'');
   assert.ok(!/\b(?:grant|revoke|alter\s+(?:role|function|table)|set\s+role|set\s+session_replication_role)\b/i.test(outside));
  }
  // Keep the complete original function-revocation loops; never skip nonowner work.
  for(const sourceLoop of canonical.matchAll(/FOR f IN SELECT[\s\S]*?END LOOP;/g)){
   const expected=sourceLoop[0].replace(/(\bfrom\s+public),postgres,/ig,'$1,');assert.ok(forward.includes(expected));
  }
 });
 test('new actual source binding reaches shipping resolver without owner inference '+c.order,()=>{
  const [bound]=bindExistingPostgresForwardSources(root,[{order:c.order,file:c.file,source_migration_version:c.file.slice(0,14),sha256:c.canonical_sha256}]);
  assert.equal(bound.sha256,c.forward_sha256);assert.equal(resolveReleaseMigrationSource(root,bound).sql,forward);assert.equal(resolveReleaseMigrationSource(root,bound).canonical_sha256,c.canonical_sha256);
 });
}
test('all old eight finite variants remain exact and late owner-aware Source unchanged',()=>{
 const m=productionForwardSourceManifest(root);assert.equal(m.migrations.length,24);
 const old=new Map([['20261002120000_october_dated_recovery_inventory_rebind.sql','688e336bc4b985bbc5ba0847f9d6c0e0f64fc05bf027d217f95e3778649d9a16'],['20261003220000_current_release_authority_completion.sql','90e31443af8e2b2ba563c7a965d7a6afeba37f8cb67d2d4ff333034066c88a33'],['20261006190426_manager_scheduler_recovery_binding.sql','178cc832516e2aa78835b8441da04fe801204caf123477e3c7a6eda5dc405906'],['20261015040830_same_original_retained_completion_read.sql','18298fc042702b47e56e30ec21bcde0bfeac3646d806f488b02d453811c8961d'],['20261017225101_approved_static_dated_original_materialization.sql','cee7ef97a7aef12f75de1d568e53ff0d987daa428b42f53fde25eb957d095f6f']]);
 for(const[file,hash]of old)assert.equal(sha(read('release/production-forward-source/'+file)),hash);
 for(const n of ['20261013171946_messenger_original_group_creation.sql','20261017200958_approved_static_original_confirmation_receipts.sql','20261017225101_approved_static_dated_original_materialization.sql'])assert.ok(!proof.changes.some(c=>c.file===n));
});
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',checks,new_variants:14,new_functions:40,new_relations:5,revocation_owner_tokens_only:19,actual_SQL:false,production_authorized:false}));
