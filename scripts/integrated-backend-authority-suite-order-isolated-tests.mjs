#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from 'pg';
import {captureSchemaCatalog,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import { createCiFreshOnlyFixture } from "./ci-fresh-only-replay.mjs";

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--order"),
  "usage: integrated-backend-authority-suite-order-isolated-tests.mjs [--order final-first|named-first]");
const orders = args.length === 0 ? ["final-first", "named-first"] : [args[1]];
assert.ok(orders.every((order) => ["final-first", "named-first"].includes(order)),
  "order must be final-first or named-first");


for (const order of orders) {
  const resource = await createCiFreshOnlyFixture({
    name: `mz_schema_rebuild_suite_order_${order.replaceAll("-", "_")}_${process.pid}_${Date.now()}`,
  });
  try {
    await resource.assertOwned();
    if(process.env.CUSTODIAL_CURRENT308_OWNED_CI_DESCRIPTOR){
      assert.ok(resource.pgClientConfig);assert.equal(resource.receipt.source_profile.migration_count,308);
      const pool=new pg.Pool({...resource.pgClientConfig,database:'postgres',user:'supabase_admin',max:1,connectionTimeoutMillis:5000});pool.on('error',()=>{});
      const capture=async()=>{await resource.assertOwned();const inventory=await captureSchemaCatalog({query:async sql=>{const r=await pool.query(sql);return {rows:r.rows.map(row=>{if(!Object.hasOwn(row,'object_comment'))return row;const x={...row,comment:row.object_comment};delete x.object_comment;return x;})};}});return fingerprintSchemaCatalog(inventory);};
      try{
        const before=await capture();
        const children=order==='final-first'?['final-operational-correction-database-tests.mjs','named-manager-messenger-retirement-correction-database-tests.mjs']:['named-manager-messenger-retirement-correction-database-tests.mjs','final-operational-correction-database-tests.mjs'];
        for(const script of children){await resource.assertOwned();execFileSync(process.execPath,['scripts/'+script],{env:{...process.env,CUSTODIAL_FINAL_OPERATIONAL_TEST_DOCKER_CONTAINER:resource.name,CUSTODIAL_FINAL_OPERATIONAL_TEST_DATABASE:'postgres',NAMED_MANAGER_RETIREMENT_TEST_DOCKER_CONTAINER:resource.name,NAMED_MANAGER_RETIREMENT_TEST_DATABASE:'postgres'},stdio:'inherit',timeout:90000});}
        const after=await capture();assert.deepEqual(after.normalized,before.normalized,'Original suites must restore the exact current local catalog');assert.equal(after.fingerprint,before.fingerprint);
        const result=await pool.query("select json_build_object('barrier_absent',to_regclass('public.named_manager_test_barrier') is null,'claimed_final_operational',(select count(*)::int from public.custodial_offline_reconciliation_outbox where notification_key like 'final-operational:%' and state='claimed'),'active_final_operational',(select count(*)::int from public.custodial_offline_reconciliation_outbox where notification_key like 'final-operational:%' and state in ('pending','claimed','retry'))) as cleanup");
        assert.deepEqual(result.rows[0].cleanup,{barrier_absent:true,claimed_final_operational:0,active_final_operational:0});
        console.log(JSON.stringify({ok:true,order,current_local_migrations:308,actual_before_after_schema_fingerprint:after.fingerprint,canonical304_equivalence:false,production:false,release_admission:false,cleanup:result.rows[0].cleanup}));
      }finally{await pool.end();}
    }else execFileSync(process.execPath, ["scripts/integrated-backend-authority-suite-order-tests.mjs", "--order", order], {
      env: {
        ...process.env,
        CUSTODIAL_SUITE_ORDER_DOCKER_CONTAINER: resource.name,
        CUSTODIAL_SUITE_ORDER_DATABASE: "postgres",
      },
      stdio: "inherit",
    });
    await resource.assertOwned();
  } finally {
    await resource.cleanup();
  }
}

console.log(JSON.stringify({ ok: true, orders, isolation: "separate_clean_database_per_order" }, null, 2));
