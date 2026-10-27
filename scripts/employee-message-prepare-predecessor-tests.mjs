import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertMessagePreparePredecessor,deriveMessagePrepareCurrent,assertMessagePrepareCanonical,
 readMessagePreparePredecessor,PREPARE_PRIOR_SHA,PREPARE_CURRENT_SHA,PREPARE_GRANT_SHA} from './fixtures/employee-message-prepare-predecessor.mjs';

export function runMessagePreparePredecessorTests(){
 let checks=0;const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const rejects=fn=>{assert.throws(fn);checks++;};
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const raw=readFileSync(new URL('./fixtures/employee-message-prepare-predecessor.json',import.meta.url));
 const source=readMessagePreparePredecessor();const {fixture,prior,current,grant}=source;
 equal(assertMessagePreparePredecessor(raw),fixture);equal(hash(prior),PREPARE_PRIOR_SHA);equal(hash(current),PREPARE_CURRENT_SHA);equal(hash(grant),PREPARE_GRANT_SHA);
 const historical={functions:[structuredClone(fixture.function.catalog_row)],routine_grants:structuredClone(fixture.canonical_routine_grants)};
 const refreshed=structuredClone(historical);refreshed.functions[0].definition=current;
 equal(assertMessagePrepareCanonical(historical,fixture,current).profile,'HISTORICAL_218');
 equal(assertMessagePrepareCanonical(refreshed,fixture,current).profile,'CURRENT_219');
 // Actual former owning test logic fails on a correctly refreshed definition.
 rejects(()=>assert.equal(hash(refreshed.functions.find(row=>row.function_name==='mz_prepare_employee_native_push_delivery').definition),PREPARE_PRIOR_SHA));
 // Both known canonical epochs use the same included old bytes, never the
 // refreshed definition as a mutable/surviving source of expected predecessor.
 for(const canonical of [historical,refreshed]){
  const observed=assertMessagePrepareCanonical(canonical,fixture,current);
  equal(observed.predecessor_sha256,PREPARE_PRIOR_SHA);equal(observed.grant_sha256,PREPARE_GRANT_SHA);
  equal(prior,fixture.function.catalog_row.definition);
 }
 const migration=readFileSync(new URL('../supabase/migrations/20261003121757_employee_message_source_admission.sql',import.meta.url),'utf8');
 equal(deriveMessagePrepareCurrent(prior,migration),current);
 rejects(()=>deriveMessagePrepareCurrent(current,migration));rejects(()=>deriveMessagePrepareCurrent(prior+' ',migration));rejects(()=>deriveMessagePrepareCurrent(prior,migration+' '));
 for(const mutate of [
  x=>{x.schema='unknown';},x=>{x.provenance.kind='SURVIVOR_ADOPTION';},x=>{x.provenance.canonical.commit='0'.repeat(40);},
  x=>{x.provenance.canonical.sha256='0'.repeat(64);},x=>{x.provenance.canonical.migration_count=219;},
  x=>{x.provenance.source_migrations[0].sha256='a'.repeat(64);},x=>{x.provenance.corroboration.receipt_sha256='a'.repeat(64);},
  x=>{x.function.catalog_row.definition=current;x.function.definition_sha256=hash(current);},
  x=>{x.function.catalog_row.definition+=' ';x.function.definition_sha256=hash(x.function.catalog_row.definition);},
  x=>{x.grant.definition_sql+=' grant execute to anon;';x.grant.definition_sha256=hash(x.grant.definition_sql);},
  x=>{x.canonical_routine_grants[0].grantee='anon';},x=>{x.extra='unknown';},
 ]){const value=structuredClone(fixture);mutate(value);rejects(()=>assertMessagePreparePredecessor(JSON.stringify(value,null,2)+'\n'));}
 for(const bad of ['','{malformed',raw.toString()+'\n',raw.toString().replaceAll('\n','\r\n')])rejects(()=>assertMessagePreparePredecessor(bad));
 for(const profile of [historical,refreshed])for(const mutate of [
  x=>{x.functions=[];},x=>{x.functions.push(structuredClone(x.functions[0]));},
  x=>{x.functions[0].schema_name='private';},x=>{x.functions[0].owner_name='anon';},
  x=>{x.functions[0].identity_arguments+=' , arbitrary text';},x=>{x.functions[0].definition+=' ';},
  x=>{x.functions[0].definition=x.functions[0].definition.replace('SECURITY DEFINER','SECURITY INVOKER');},
  x=>{x.functions[0].comment='unknown';},x=>{x.functions[0].extra=true;},
  x=>{x.routine_grants=[];},x=>{x.routine_grants[0].grantee='anon';},
  x=>{x.routine_grants[0].grantor='unknown';},x=>{x.routine_grants[0].is_grantable=true;},
  x=>{x.routine_grants.push(structuredClone(x.routine_grants[0]));},
 ]){const value=structuredClone(profile);mutate(value);rejects(()=>assertMessagePrepareCanonical(value,fixture,current));}
 for(const value of [null,[],{}, {functions:[],routine_grants:null}])rejects(()=>assertMessagePrepareCanonical(value,fixture,current));
 rejects(()=>assertMessagePrepareCanonical(refreshed,fixture,prior));
 equal(source.observation.predecessor_sha256,PREPARE_PRIOR_SHA);
 return {status:'PASS',checks,scope:'historical source fixture and known canonical epoch compatibility only; no SQL/HTTP/JVM',
  canonical_profile:source.observation.profile,predecessor_sha256:PREPARE_PRIOR_SHA,current_sha256:PREPARE_CURRENT_SHA,grant_sha256:PREPARE_GRANT_SHA};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(runMessagePreparePredecessorTests()));
