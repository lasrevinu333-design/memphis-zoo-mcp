import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Test-only historical source authority. This does not query a database, accept
// surviving inventory, or require unpublished git objects/absolute local files.
export const PREPARE_FIXTURE_SHA='54b3ec397e8dc83ea1a9fabf7eca6986e041a516ca36cad61739f0177adff421';
export const PREPARE_PRIOR_SHA='33d72de69db3e6735bec2827642bea966b89920d4c7b7bf338d73b7aca907ff2';
export const PREPARE_CURRENT_SHA='f92cb203c31ebb06322984cdcc10ab64cc37719e58e4a0ba1aa4fd2e0ae80ed5';
export const PREPARE_GRANT_SHA='67aa32e1273a26d411f190d8cbaf66fe2b7788fe0ab03faad22cf7cb9e0c9453';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const name='mz_prepare_employee_native_push_delivery';
const hash=x=>createHash('sha256').update(x).digest('hex');
const encoded=value=>JSON.stringify(value,null,2)+'\n';
export function assertMessagePreparePredecessor(bytes){
 assert.ok(Buffer.isBuffer(bytes)||typeof bytes==='string');
 assert.equal(hash(bytes),PREPARE_FIXTURE_SHA,'exact included historical fixture bytes');
 const value=JSON.parse(bytes);assert.equal(hash(encoded(value)),PREPARE_FIXTURE_SHA,'canonical fixture encoding');
 assert.equal(value.schema,'custodial.employee-message-prepare-predecessor.v1');
 assert.equal(value.provenance.kind,'EXACT_HISTORICAL_218_CANONICAL_EXTRACTION');
 assert.equal(value.provenance.canonical.commit,'9d02081c78f50a07a1c863707408056505e6a782');
 assert.equal(value.provenance.canonical.sha256,'71eaff3d5cd2209630b6be97a0d7416185860049fed90e1b08bfe9d4d2ca2bef');
 assert.equal(value.provenance.canonical.migration_count,218);
 assert.equal(value.function.definition_sha256,PREPARE_PRIOR_SHA);
 assert.equal(hash(value.function.catalog_row.definition),PREPARE_PRIOR_SHA);
 assert.equal(value.grant.definition_sha256,PREPARE_GRANT_SHA);
 assert.equal(hash(value.grant.definition_sql),PREPARE_GRANT_SHA);
 return value;
}
export function deriveMessagePrepareCurrent(prior,migration){
 assert.equal(hash(prior),PREPARE_PRIOR_SHA,'only original historical body is a predecessor');
 assert.equal(hash(migration),'20ff06f8c0c5e82814189e1e2969b928ffa48eb1181098a73156962dc9ac1e7f','exact MESSAGE correction');
 const literal=field=>{const found=migration.match(new RegExp(' '+field+" text:='([^']*)';"));assert.ok(found);return found[1];};
 const oldDecl=literal('old_decl'),oldInsert=literal('old_insert');
 const oldReturn=migration.match(/ old_return text:=\$old\$([\s\S]*?)\$old\$;/)?.[1];
 const addition=migration.match(/ addition text:=\$message\$([\s\S]*?)\$message\$;/)?.[1];
 const newReturn=migration.match(/\$new\$([\s\S]*?)\$new\$\);/)?.[1];
 assert.ok(oldReturn&&addition&&newReturn);
 for(const seam of [oldDecl,oldInsert,oldReturn])assert.equal(prior.split(seam).length,2);
 const current=prior.replace(oldDecl,oldDecl+' v_message_projection jsonb;').replace(oldInsert,addition+oldInsert).replace(oldReturn,newReturn);
 assert.equal(hash(current),PREPARE_CURRENT_SHA,'independent exact corrected body');
 assert.equal(current.replace(oldDecl+' v_message_projection jsonb;',oldDecl).replace(addition,'').replace(newReturn,oldReturn),prior);
 return current;
}
export function assertMessagePrepareCanonical(canonical,fixture,current){
 assertMessagePreparePredecessor(encoded(fixture));assert.equal(hash(current),PREPARE_CURRENT_SHA);
 assert.ok(canonical&&typeof canonical==='object'&&!Array.isArray(canonical));
 assert.ok(Array.isArray(canonical.functions)&&Array.isArray(canonical.routine_grants));
 const rows=canonical.functions.filter(row=>row.function_name===name);assert.equal(rows.length,1,'exact unique prepare identity, not another overload');
 const row=rows[0],definition=row.definition,prior=fixture.function.catalog_row;
 const profile=definition===prior.definition?'HISTORICAL_218':definition===current?'CURRENT_219':null;
 assert.ok(profile,'canonical prepare must be exact known historical or corrected body');
 assert.deepEqual({...row,definition:prior.definition},prior,'canonical identity/owner/security metadata preserved');
 assert.deepEqual(canonical.routine_grants.filter(row=>row.function_name===name),fixture.canonical_routine_grants,'exact source-pinned canonical grants, not arbitrary current grants');
 return {profile,definition_sha256:hash(definition),predecessor_sha256:PREPARE_PRIOR_SHA,grant_sha256:PREPARE_GRANT_SHA};
}
export function readMessagePreparePredecessor(root=ROOT){
 const fixture=assertMessagePreparePredecessor(readFileSync(join(root,'scripts/fixtures/employee-message-prepare-predecessor.json')));
 for(const row of fixture.provenance.source_migrations)assert.equal(hash(readFileSync(join(root,'supabase/migrations',row.file))),row.sha256,'unchanged governing source '+row.file);
 const prior=fixture.function.catalog_row.definition;
 const current=deriveMessagePrepareCurrent(prior,readFileSync(join(root,'supabase/migrations/20261003121757_employee_message_source_admission.sql'),'utf8'));
 const canonical=JSON.parse(readFileSync(join(root,'supabase/canonical/schema-fingerprint-input.json')));
 const observation=assertMessagePrepareCanonical(canonical,fixture,current);
 return {fixture,prior,current,grant:fixture.grant.definition_sql,observation};
}
