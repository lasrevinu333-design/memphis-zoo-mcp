// Original owner profile DATA, derived solely from authenticated archive Source.
// This reader grants no target authority; every consumer retains actual target
// ownership, current_user=session_user, transaction and held-fence assertions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readVerifiedPrivateImportSource,readVerifiedImmutableBootstrapInventory,readVerifiedMigrationTargetCaptureSource} from './disaster-recovery-archive.mjs';
import {loadImmutableDomainSourceRecipes} from './immutable-private-domain-source.mjs';
import {loadImmutableMessageSourceRecipes} from './immutable-private-message-source.mjs';
import {loadImmutableCurrentPostgresSource} from './immutable-private-postgres-source.mjs';
const profileReads=new WeakMap();
const sha=s=>createHash('sha256').update(s).digest('hex');
const guards=[
 ['custodial_release_identity.guard_group_original_creation()','29708f9ca161950f4e3b4b71b2e7dd85b2f31a6031407a353635713678a3386f','e96d343db164beb142b385847e4adc07d951a776d53c14e96666fe6be0665d51'],
 ['custodial_dr.guard_application_mutation()','aba484a103212b76c82f119ece6279c917fce4b0806e07381ef4fce527a9bc95','c951e5a94562536ef46ccd3bfc4c3dfc6df2a526f3fa75891604ca625cd7c8b7'],
];
const tables=[['custodial_release_identity','group_original_creations'],['custodial_release_identity','employee_message_original_outcomes'],['public','release_deployment_manifest'],['public','custodial_release_authority_restore_inventory']];
const one=rows=>{assert.equal(rows.length,1);return rows[0];};
// Pure testable DATA validator. Its return value is never a Source capability.
function inspectOriginalOwnerData({inventory,catalog}){
 const originals=JSON.parse(inventory['inventory/original-guards.json']),relations=JSON.parse(inventory['inventory/original-relations.json']),acls=JSON.parse(inventory['inventory/original-acls.json']);
 assert.ok(Array.isArray(originals)&&originals.length===2&&Array.isArray(relations)&&Array.isArray(acls.routines)&&Array.isArray(acls.relations)&&Array.isArray(acls.namespaces_columns));
 const actor=originals[0].owner;assert.ok(actor==='postgres'||actor==='supabase_admin');
 for(let i=0;i<2;i++){const g=originals[i],[id,bodyHash,definitionHash]=guards[i];assert.equal(g.owner,actor);assert.equal(sha(g.prosrc),bodyHash);assert.equal(sha(g.definition),definitionHash);assert.ok(g.definition.startsWith('CREATE OR REPLACE FUNCTION '+id+'\n'));}
 const ns=one(acls.namespaces_columns.filter(r=>r.kind==='SCHEMA'&&r.schema_name==='custodial_release_identity'));assert.equal(ns.owner_name,actor);
 for(const [schema_name,table_name] of tables){
  assert.equal(one(relations.filter(r=>r.schema_name===schema_name&&r.table_name===table_name)).owner_name,actor);
  assert.equal(one(acls.relations.filter(r=>r.kind==='TABLE'&&r.schema_name===schema_name&&r.object_name===table_name)).owner_name,actor);
 }
 const domain=loadImmutableDomainSourceRecipes(),messages=loadImmutableMessageSourceRecipes(),current=loadImmutableCurrentPostgresSource();
 const recipes=actor==='postgres'?current.recipes:[...domain.recipes,...messages.recipes];
 assert.equal(recipes.length,23);assert.ok(Array.isArray(catalog.functions));
 for(const r of recipes){
  const fn=one(catalog.functions.filter(f=>`${f.schema_name}.${f.function_name}(${f.identity_arguments})`===r.identity));
  assert.equal(sha(fn.definition),r.beforeHash); // Exact original includes SECURITY DEFINER/INVOKER, config and body.
  assert.equal(one(acls.routines.filter(f=>f.kind==='FUNCTION'&&f.identity===r.identity)).owner_name,actor);
 }
 assert.equal(one(acls.routines.filter(f=>f.kind==='FUNCTION'&&f.identity===guards[0][0])).owner_name,actor);
 // custodial_dr is intentionally outside ACL capture scope. Its exact signed
 // original-guards entry above, NOT another routine's owner, is its authority.
 assert.equal(acls.routines.filter(f=>f.identity===guards[1][0]).length,0);
 domain.assertCurrent();messages.assertCurrent();current.assertCurrent();
 return {profile:Object.freeze({id:actor==='postgres'?'immutable-private-current-postgres':'immutable-private-legacy-supabase-admin',actor}),domain,messages,current};
}
export function inspectImmutableOriginalOwnerData(input){return inspectOriginalOwnerData(input).profile;}
export function readVerifiedImmutableArchiveOwnerProfile(verifiedArchive){
 const original=readVerifiedPrivateImportSource(verifiedArchive);
 assert.deepEqual(original.selection.privateTables.map(t=>t.table_name).sort(),['employee_message_original_outcomes','group_original_creations']);
 const observed=readVerifiedImmutableBootstrapInventory(verifiedArchive),capture=readVerifiedMigrationTargetCaptureSource(verifiedArchive);
 assert.equal(observed.sourceBinding,original.sourceBinding);assert.equal(capture.sourceBinding,original.sourceBinding);
 let record=profileReads.get(verifiedArchive);
 if(record){
  assert.equal(record.sourceBinding,original.sourceBinding);assert.equal(record.inventory,observed.inventory);assert.equal(record.catalog,capture.catalog);
 }else record={...inspectOriginalOwnerData({inventory:observed.inventory,catalog:capture.catalog}),sourceBinding:original.sourceBinding,inventory:observed.inventory,catalog:capture.catalog};
 // Immutable derived DATA may be reused, never its earlier currentness verdict.
 record.domain.assertCurrent();record.messages.assertCurrent();record.current.assertCurrent();
 assert.equal(readVerifiedPrivateImportSource(verifiedArchive).sourceBinding,original.sourceBinding);
 assert.deepEqual(readVerifiedImmutableBootstrapInventory(verifiedArchive).inventory,observed.inventory);
 assert.deepEqual(readVerifiedMigrationTargetCaptureSource(verifiedArchive).catalog,capture.catalog);
 profileReads.set(verifiedArchive,record);return record.profile;
}
