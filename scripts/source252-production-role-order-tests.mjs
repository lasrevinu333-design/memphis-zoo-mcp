import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reverseSource252ProductionRoleOrderOnly,source252RoleOrderPredecessorPlan} from './source252-production-role-order-proof.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const source=read('release/production-forward-source/20261010193211_native_private_custody_chunk_retention.sql');
const profile=JSON.parse(read('release/production-forward-source/private-custody-existing-postgres-profile.json'));
const variant=JSON.parse(read('release/production-forward-source/private-custody-production-role-order.json'));
const key=x=>JSON.stringify([x.object_kind,x.object_identity]);
const aggregate=rows=>sha([...rows].sort((a,b)=>Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0]))||Buffer.compare(Buffer.from(a[1]),Buffer.from(b[1]))).map(x=>[x[2],x[0],x[1],x[3]].join('\n')).join('\n---\n'));
const prior=profile.original_rows.map(x=>[...x]);
const priorMap=new Map(prior.map(x=>[JSON.stringify(x.slice(0,2)),x]));
for(const e of profile.exceptions)priorMap.get(key(e))[3]=e.saved_sha256;
const observed=structuredClone(prior),observedMap=new Map(observed.map(x=>[JSON.stringify(x.slice(0,2)),x]));
for(const e of variant.differences)observedMap.get(key(e))[3]=e.saved_sha256;
test('old entire SQL and immutable profile are preserved by exact finite reversal',()=>{
  assert.equal(sha(reverseSource252ProductionRoleOrderOnly(source)),variant.prior_forward_sha256);
  assert.equal(sha(read('release/production-forward-source/private-custody-existing-postgres-profile.json')),variant.historical_profile_sha256);
  assert.deepEqual(JSON.parse(source.match(/\$production_role_order\$([\s\S]*?)\$production_role_order\$/)[1]),variant);
});
test('captured complete6884 production preimage is independently reconstructed from only two literal swaps',()=>{
  assert.equal(aggregate(prior),profile.preimage_aggregate_sha256);
  assert.equal(aggregate(observed),variant.preimage_aggregate_sha256);
  assert.equal(observed.length,6884);assert.equal(variant.differences.length,2);
  assert.equal(observed.filter((x,i)=>JSON.stringify(x)!==JSON.stringify(prior[i])).length,2);
  for(const e of variant.differences){
    const old=profile.exceptions.find(x=>key(x)===key(e));
    assert.equal(Number(old.restore_order),e.restore_order);
    assert.equal(sha(e.saved_definition_sql),e.saved_sha256);
    assert.equal(sha(e.current_definition_sql),e.current_sha256);
    assert.equal(sha(e.replacement_sql),e.replacement_sha256);
    // The reset statement is identical; only the final two literal clauses move.
    const a=old.saved_definition_sql.split(';'),b=e.saved_definition_sql.split(';');
    assert.deepEqual(b,[a[0],a[1],a[3],a[2],a[4]]);
  }
});
test('three finite metadata replacements converge to original qualified6884 and unchanged6968 successor',()=>{
  const post=structuredClone(observed),map=new Map(post.map(x=>[JSON.stringify(x.slice(0,2)),x]));
  for(const e of profile.repairs)map.get(key(e))[3]=e.replacement_sha256;
  const v8=variant.differences.find(x=>x.object_identity==='static_weekly_v8_read_lunch_document(date)');
  map.get(key(v8))[3]=v8.replacement_sha256;
  assert.equal(aggregate(post),profile.post_repair_aggregate_sha256);
  assert.equal(aggregate(post),variant.post_repair_aggregate_sha256);
  const next=JSON.parse(read('release/production-forward-source/private-custody-source253-existing-profile.json'));
  const nextMap=new Map(next.runtime_rows.map(x=>[JSON.stringify(x.slice(0,2)),x]));
  for(const x of post)if(x[1]!=='custodial_release_canary_authority_surface()')assert.equal(nextMap.get(JSON.stringify(x.slice(0,2)))[3],x[3],x[1]);
});
for(const [name,mutate] of [
  ['unrelated changed digest',r=>r[0][3]='0'.repeat(64)],
  ['extra tuple',r=>r.push(['grant','public.unexpected',1,'0'.repeat(64)])],
  ['missing tuple',r=>r.pop()],
  ['restore order changed',r=>r[0][2]='999'],
  ['only one ordering difference',r=>r.find(x=>x[1]===variant.differences[0].object_identity&&x[0]==='grant')[3]=variant.differences[0].prior_saved_sha256],
])test('unrecognized complete preimage cannot select production variant: '+name,()=>{const rows=structuredClone(observed);mutate(rows);assert.notEqual(aggregate(rows),variant.preimage_aggregate_sha256);});
test('actual SQL variant cannot bypass current catalog, full census or original transaction boundaries',()=>{
  const block=source.match(/  -- BEGIN FINITE PRODUCTION SOURCE252 ROLE ORDER\n[\s\S]*?  -- END FINITE PRODUCTION SOURCE252 ROLE ORDER\n/)[0];
  const code=block.replace(/\$production_role_order\$[\s\S]*?\$production_role_order\$/,'');
  assert.doesNotMatch(code,/\b(?:UPDATE|INSERT|DELETE|GRANT|REVOKE|ALTER|EXECUTE)\s+(?:public\.|TABLE|ROLE|FUNCTION|SELECT|EXECUTE)/i);
  for(const s of ['i.definition_sql=role_order_item','i.definition_sha256=role_order_item','INTO STRICT exception_index','INTO STRICT repair_index',"'service_role'::regrole::oid < 'static_weekly_control_plane'::regrole::oid","'static_weekly_control_plane'::regrole::oid < 'custodial_application_reader'::regrole::oid",'current_grant_definition(role_order_item'])assert.ok(code.includes(s),s);
  assert.ok(source.indexOf('-- END FINITE PRODUCTION SOURCE252 ROLE ORDER')<source.indexOf('FOR pass IN 0..1 LOOP'));
  assert.ok(source.indexOf('exact current body/owner/options/named privilege profile changed')<source.indexOf('DISABLE TRIGGER'));
  assert.ok(source.includes('old.catalog=actual'));
});
test('rehearsal creates and verifies the measured relative role order without touching production',()=>{
  const sql=read('supabase/canonical/production-source-role-catalog.sql');
  assert.ok(sql.indexOf('create role static_weekly_control_plane;')<sql.indexOf('create role custodial_application_reader;'));
  assert.ok(sql.includes("'static_weekly_control_plane'::regrole::oid < 'custodial_application_reader'::regrole::oid"));
  assert.doesNotMatch(read('.github/workflows/build52-production-migration-apply.yml'),/production-source-role-catalog/);
});
test('isolated capture predecessor projection changes only the exact signed119 digest',()=>{
  const plan=JSON.parse(read('release/production-migration-state.json')).pending_migrations;
  const projected=source252RoleOrderPredecessorPlan(plan);
  assert.equal(sha(source),plan[118].sha256);
  assert.deepEqual(projected.filter(x=>x.order!==119),plan.filter(x=>x.order!==119));
  const item=structuredClone(projected[118]);item.sha256=plan[118].sha256;item.forward_source.sha256=plan[118].sha256;
  assert.deepEqual(item,plan[118]);
  for(const field of ['sha256','file']){const bad=structuredClone(plan);bad[118][field]='UNEXPECTED';assert.throws(()=>source252RoleOrderPredecessorPlan(bad));}
});
