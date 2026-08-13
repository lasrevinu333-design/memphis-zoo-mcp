#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--order"),
  "usage: integrated-backend-authority-suite-order-isolated-tests.mjs [--order final-first|named-first]");
const orders = args.length === 0 ? ["final-first", "named-first"] : [args[1]];
assert.ok(orders.every((order) => ["final-first", "named-first"].includes(order)),
  "order must be final-first or named-first");

function rebuild() {
  const output = execFileSync(process.execPath, ["scripts/empty-database-rebuild-check.mjs"], {
    env: {
      ...process.env,
      SCHEMA_REBUILD_DOCKER_IMAGE: process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
      SCHEMA_REBUILD_KEEP_DATABASE: "1",
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(output);
  const match = output.match(/\{"retained_test_container":"([^"]+)","retained_test_database":"([^"]+)"\}/);
  assert.ok(match, "clean rebuild did not return its retained disposable database identity");
  return { container: match[1], database: match[2] };
}

for (const order of orders) {
  const resource = rebuild();
  try {
    execFileSync(process.execPath, ["scripts/integrated-backend-authority-suite-order-tests.mjs", "--order", order], {
      env: {
        ...process.env,
        CUSTODIAL_SUITE_ORDER_DOCKER_CONTAINER: resource.container,
        CUSTODIAL_SUITE_ORDER_DATABASE: resource.database,
      },
      stdio: "inherit",
    });
  } finally {
    execFileSync("docker", ["rm", "-f", resource.container], { stdio: "ignore" });
  }
}

console.log(JSON.stringify({ ok: true, orders, isolation: "separate_clean_database_per_order" }, null, 2));
