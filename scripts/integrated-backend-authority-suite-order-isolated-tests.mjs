#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    execFileSync(process.execPath, ["scripts/integrated-backend-authority-suite-order-tests.mjs", "--order", order], {
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
