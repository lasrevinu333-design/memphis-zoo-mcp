import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readCurrentCandidateReplayProfile} from './current-candidate-replay-profile.mjs';
import {source252FreshOrderSql} from './source252-fresh-replay-order.mjs';
import {source291FreshCanarySql} from './source291-fresh-canary-order.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),read=p=>readFileSync(resolve(root,p)),sha=v=>createHash('sha256').update(v).digest('hex');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const profile=readCurrentCandidateReplayProfile(root),description=profile.description;
check('only the exact original304 plus declared305/306/307/308 source order',()=>{
 assert.equal(description.migration_count,308);assert.equal(description.effective_sql.length,308);
 for(const key of ['production_execution_authorized','release_admission','recovery_admission'])assert.equal(description[key],false);
 assert.equal(description.memory_bytes,536870912);assert.equal(description.combined_memory_swap_bytes,536870912);
});
check('only supplied source289 SQL counterpart differs from original migration bytes',()=>{
 assert.deepEqual(description.effective_sql.filter(row=>row.sha256!==row.effective_sha256).map(row=>row.name),['20261022041249_original_schedule_delivery_outcome.sql']);
 for(const row of description.effective_sql)assert.equal(sha(profile.migrationSql(row.name)),row.effective_sha256);
});
check('original guarded253 and292 application SQL stays byte identical',()=>{
 for(const name of ['20261010193211_native_private_custody_chunk_retention.sql','20261025094420_authority_identity_renderer_counterparts.sql'])
  assert.equal(profile.migrationSql(name),read('supabase/migrations/'+name).toString());
 assert.throws(()=>profile.migrationSql('../unlisted.sql'),/Undeclared/);
 assert.equal(profile.beforeMigration('unlisted.sql'),null);
});
const reference=read('release/production-forward-source/private-custody-source252-reference.json');
check('Source252 generator binds the exact sealed reference and observed SQL receipt',()=>{
 const sql=source252FreshOrderSql(reference);
 assert.equal(sha(sql),'8a6ff20cdf812de02b8db6b9df753993fcaa0aa3f4180adda01ebf511076529d');
 assert.equal(profile.beforeMigration('20261010193211_native_private_custody_chunk_retention.sql'),sql);
 assert.ok(sql.includes('629aa8e6c31bfc8e2b656f3f43cc7ff4663395b97022be24b86ddfca46f8fb23'));
 assert.ok(sql.includes('THEN 17 ELSE 11 END'));
 assert.ok(sql.includes('maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey'));
 assert.ok(sql.includes('public.static_weekly_digest_text(a.definition_sql)<>e.digest'));
 assert.ok(sql.includes('ENABLE ALWAYS TRIGGER'));

 for(const altered of [Buffer.concat([reference,Buffer.from('\n')]),Buffer.from('{}'),Buffer.from(reference.toString().replace('6884','6883'))])
  assert.throws(()=>source252FreshOrderSql(altered),/Exact sealed/);
});
const source292=read('supabase/migrations/20261025094420_authority_identity_renderer_counterparts.sql');
const expected=source292.toString().split('$EXACT_SOURCE291_CANARY_PREIMAGE$')[1];
check('Source291 generator accepts the unchanged original literal only',()=>{
 const sql=source291FreshCanarySql(source292,expected);
 assert.ok(sql.includes(expected));assert.ok(sql.includes('7312'));assert.ok(sql.includes('ENABLE ALWAYS TRIGGER'));
 assert.equal(profile.beforeMigration('20261025094420_authority_identity_renderer_counterparts.sql',expected),sql);
});
check('changed canary facts, formatting, source or absent preimage cannot mint repair SQL',()=>{
 for(const altered of [expected+'\n',expected.replace('public.','other.'),'',undefined])
  assert.throws(()=>source291FreshCanarySql(source292,altered));
 assert.throws(()=>source291FreshCanarySql(Buffer.concat([source292,Buffer.from('\n')]),expected),/Exact source292/);
});
console.log(JSON.stringify({scope:'SOURCE_GENERATOR_NEGATIVES_AND_EXACT_PROFILE_BYTES_ONLY',checks,passed:checks,failed:0,
 sql_execution:false,hosted:false,release_or_recovery_admission:false}));
