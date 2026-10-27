import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Compare the historical validator with the materialized-array version on an
// ACTUAL accepted disposable projection. The historical test function and all
// hostile documents live only in this rolled-back transaction.
export async function testLunchMaterialization({pool,projectionId,lunch,check}) {
 const client=await pool.connect();
 const signature='public.static_weekly_v8_assert_lunch_document(uuid,jsonb)';
 const roles=['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'];
 const scalar=async(sql,args=[])=>(await client.query(sql,args)).rows[0].result;
 try {
  await client.query('begin');await client.query("set local statement_timeout='120s'");
  const historical=readFileSync(new URL('../supabase/migrations/20260922163000_static_weekly_lunch_publication.sql',import.meta.url),'utf8');
  const start=historical.indexOf('create or replace function public.static_weekly_v8_assert_lunch_document(');
  const end=historical.indexOf('end $function$;',start)+'end $function$;'.length;
  assert.ok(start>=0&&end>start);
  await client.query(historical.slice(start,end).replace('public.static_weekly_v8_assert_lunch_document(', 'public.test_historical_lunch_assertion('));
  await client.query('revoke all on function public.test_historical_lunch_assertion(uuid,jsonb) from public,'+roles.join(','));
  const outcomes=async(document)=>{
   const results=[];
   for(const name of ['test_historical_lunch_assertion','static_weekly_v8_assert_lunch_document']){
    await client.query('savepoint validation_attempt');const before=performance.now();
    try {await client.query(`select public.${name}($1,$2::jsonb)`,[projectionId,JSON.stringify(document)]);results.push({state:'ACCEPTED',ms:performance.now()-before});}
    catch(error){results.push({state:'REJECTED',code:error.code,message:error.message,ms:performance.now()-before});}
    finally {await client.query('rollback to savepoint validation_attempt');}
   }
   return results;
  };
  const valid=await outcomes(lunch);
  check('both lunch validators accept exact actual document',valid.map(x=>x.state),['ACCEPTED','ACCEPTED']);
  console.log('ACTUAL_LUNCH_VALIDATOR_TIMINGS_MS',JSON.stringify({historical:Math.round(valid[0].ms),materialized:Math.round(valid[1].ms)}));
  // Rehash malformed documents so rejection exercises inner semantic checks,
  // rather than only their outer document-identity guard.
  const rehash=async doc=>scalar(`with d as (select jsonb_set($1::jsonb,'{semantic_snapshot}',jsonb_build_object(
   'schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
   'loans_digest',public.static_weekly_digest_jsonb($1::jsonb->'loans'),
   'responsibilities_digest',public.static_weekly_digest_jsonb($1::jsonb->'responsibilities'),
   'notification_intents_digest',public.static_weekly_digest_jsonb($1::jsonb->'notification_intents'))) body)
   select jsonb_set(body,'{document_identity}',to_jsonb(public.static_weekly_digest_jsonb(body-'document_identity'))) as result from d`,[JSON.stringify(doc)]);
  const cases=[
   ['missing working owner',d=>d.loans.pop()],
   ['wrong owner',d=>{d.loans[0].normal_owner_person_id='ffffffff-ffff-4fff-8fff-ffffffffffff';}],
   ['unavailable helper',d=>{d.loans.find(x=>x.helper_slot_ids.length).helper_slot_ids[0]='MISSING_SLOT';}],
   ['wrong coverer',d=>{d.responsibilities[0].coverer_person_id='ffffffff-ffff-4fff-8fff-ffffffffffff';}],
   ['wrong borrowed work',d=>{d.responsibilities[0].segments[0].workId='MISSING_WORK';}],
   ['missing segment',d=>{d.responsibilities[0].segments.pop();}],
   ['extra segment',d=>{d.responsibilities[0].segments.push(structuredClone(d.responsibilities[0].segments[0]));}],
   ['wrong notification time',d=>{d.notification_intents[0].scheduled_time='00:00';}],
  ];
  for(const [label,mutate] of cases){const doc=structuredClone(lunch);mutate(doc);const results=await outcomes(await rehash(doc));
   check('both validators reject '+label,results.map(x=>x.state),['REJECTED','REJECTED']);
   check('unchanged rejection '+label,results.map(({state,code,message})=>({state,code,message}))[1],results.map(({state,code,message})=>({state,code,message}))[0]);
  }
  const grants=await scalar('select jsonb_object_agg(role,has_function_privilege(role,$1,\'EXECUTE\')) as result from unnest($2::text[]) role',[signature,roles]);
  check('materialized validator retains original narrow callers',grants,Object.fromEntries(roles.map(role=>[role,role==='static_weekly_control_plane'])));
  const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
  check('lunch materialization exact recovery inventory',recovery.map(x=>x.object_kind),['function','grant']);
  check('lunch materialization stored exact function',recovery[0].definition_sql,await scalar('select pg_get_functiondef($1::regprocedure) as result',[signature]));
  await client.query('drop function '+signature);for(const row of recovery)await client.query(row.definition_sql);
  check('restored lunch validator exact grants',await scalar('select jsonb_object_agg(role,has_function_privilege(role,$1,\'EXECUTE\')) as result from unnest($2::text[]) role',[signature,roles]),grants);
  await client.query('select public.static_weekly_v8_assert_lunch_document($1,$2::jsonb)',[projectionId,JSON.stringify(lunch)]);
  check('restored validator accepts exact actual document',true,true);
  return{status:'PASS',scope:'actual isolated old/new acceptance and semantic rejection equivalence, ACL and recovery; not independent audit',timingsMs:{historical:valid[0].ms,materialized:valid[1].ms}};
 } finally {await client.query('rollback');client.release();}
}
