import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {reverseCurrent310ProductionRoleOrderOnly} from './current310-production-role-order-proof.mjs';
import {CURRENT_TAIL_STAGES} from './release-migration-current308-refusal.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const historicalText=read('release/production-forward-source/current309-tail-projection.json');
const historical=JSON.parse(historicalText),proof=JSON.parse(read('release/production-forward-source/current309-production-role-order-projection.json'));
const grant=JSON.parse(read('release/production-forward-source/private-custody-production-role-order.json')).differences[1];
assert.equal(sha(historicalText),proof.historical_projection_sha256);
assert.equal(proof.source_run,41766993454);assert.equal(proof.rollback_verified,true);
assert.equal(proof.all_240_relation_predecessors_exact,true);assert.equal(proof.differences.length,1);
assert.deepEqual(proof.measured_canary,historical.measured_canary);assert.deepEqual(proof.measured_renderer,historical.measured_renderer);
const aggregate=rows=>sha([...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.object_kind+'\0'+a.object_identity),Buffer.from(b.object_kind+'\0'+b.object_identity))).map(x=>[x.restore_order,x.object_kind,x.object_identity,x.definition_sha256,x.actual_definition_sha256].join('\n')).join('\n---\n'));
const delta=proof.differences[0];assert.equal(delta.observed.object_identity,grant.object_identity);
assert.equal(delta.observed.restore_order,950012);assert.equal(delta.observed.definition_sha256,sha(grant.current_definition_sql));
assert.equal(delta.observed.actual_definition_sha256,delta.observed.definition_sha256);
assert.deepEqual({...delta.observed,definition_sha256:delta.expected.definition_sha256,actual_definition_sha256:delta.expected.actual_definition_sha256},delta.expected);
const measured=historical.inventory_metadata_before.map(row=>{
 if(row.object_kind===delta.expected.object_kind&&row.object_identity===delta.expected.object_identity){assert.deepEqual(row,delta.expected);return delta.observed;}
 return row;
});
assert.equal(measured.length,7700);assert.equal(aggregate(measured),proof.measured_inventory.sha256);
const canonical=read('supabase/migrations/'+CURRENT_TAIL_STAGES[0].file);
const relations=[...canonical.matchAll(/\('([^']+)',(\d+),'([a-f0-9]{64})','([a-f0-9]{64})',(true|false),ARRAY\[([^\]]*)\]::text\[\]\)/g)].map(m=>({identity:m[1],old:m[3],next:m[4],update:m[5]==='true'}));
assert.equal(relations.length,240);let changed=0;
const projected=measured.map(row=>{let next=row.definition_sha256;
 if(row.object_kind==='relation'){const r=relations.find(x=>x.identity===row.object_identity);assert.equal(next,r.old);if(r.update)next=r.next;}
 if(row.object_kind==='function'&&row.object_identity==='custodial_release_authority_current_relation_definition(text)')next='11e37500c91e07715543c4f15cdcc221b7a1764c32153cc6086ce2a6137214b5';
 if(next!==row.definition_sha256)changed++;return {...row,definition_sha256:next,actual_definition_sha256:next};
});
assert.equal(changed,239);assert.equal(aggregate(projected),proof.derived_current310_inventory_sha256);
assert.deepEqual(projected.find(x=>x.object_kind==='grant'&&x.object_identity===grant.object_identity),delta.observed,'Grant must stay bound to current named ACL order');
for(const change of [rows=>rows.pop(),rows=>rows.push({...rows[0],object_identity:'unqualified'}),rows=>rows[0].restore_order++,rows=>rows[0].definition_sha256='0'.repeat(64),rows=>rows[0].actual_definition_sha256='0'.repeat(64),rows=>rows[0].object_identity+='other']){
 const rows=structuredClone(measured);change(rows);assert.notEqual(aggregate(rows),proof.measured_inventory.sha256);assert.notEqual(aggregate(rows),proof.prior_inventory.sha256);
}
for(const stage of CURRENT_TAIL_STAGES){
 const sql=read('release/production-forward-source/'+stage.file);assert.equal(sha(sql),stage.forward_sha256);
 reverseCurrent310ProductionRoleOrderOnly(sql,stage.order);
 const block=sql.split(` -- BEGIN FINITE CURRENT31${stage.order-176} PRODUCTION ROLE ORDER\n`)[1].split(` -- END FINITE CURRENT31${stage.order-176} PRODUCTION ROLE ORDER`)[0];
 assert.ok(block.includes(`IF actual='${stage.order===176?proof.measured_inventory.sha256:proof.derived_current310_inventory_sha256}' THEN`));
 assert.ok(block.includes(`definition_sql=$role_order_v8$${grant.saved_definition_sql}$role_order_v8$`));
 assert.ok(block.includes(`IS DISTINCT FROM $role_order_v8$${grant.current_definition_sql}$role_order_v8$`));
 assert.ok(block.includes(`public.static_weekly_digest_text(definition_sql)='${grant.saved_sha256}'`));
 assert.ok(block.includes("'static_weekly_control_plane'::regrole::oid<'custodial_application_reader'::regrole::oid"));
 assert.ok(!/\n\s*(?:GRANT|REVOKE|ALTER|DELETE|INSERT|EXECUTE)\b/i.test(block));
 assert.ok(!/UPDATE public\./i.test(block));
 assert.ok(sql.indexOf(block)<sql.indexOf(stage.order===176?'CREATE TEMP TABLE q310_inventory_before':'CREATE TEMP TABLE events_cancel_inventory_before'));
}
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',measured_inventory_rows:7700,measured_grant_differences:1,projected_changed_rows:changed,projected_postcondition:proof.derived_current310_inventory_sha256,actual_SQL:false,production:false}));
