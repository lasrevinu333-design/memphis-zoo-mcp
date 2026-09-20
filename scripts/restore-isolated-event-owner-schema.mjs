#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { planEventOwnerRestore, executeEventOwnerPlan } from "./isolated-event-owner-schema.mjs";

// The owning rehearsal authenticates the complete archive before invoking this
// loopback-only adapter. No input SQL is rewritten or serialized again.
const sourceDir = String(process.env.RESTORE_SOURCE_DIR || "").trim();
const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
assert.ok(sourceDir && connectionString, "RESTORE_SOURCE_DIR and SUPABASE_DB_URL are required.");
let target;
try { target = new URL(connectionString); } catch { throw new Error("Invalid isolated database URL; value omitted."); }
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname)
  && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname),
"Schema owner restoration requires a loopback mz_schema_rebuild_* target.");
const bytes = readFileSync(join(resolve(sourceDir), "inventory", "application-schema.sql"));
const plan = planEventOwnerRestore(bytes.toString("utf8"));
console.log(JSON.stringify({
  stage: "isolated_event_owner_plan_validated",
  statement_count: plan.statementCount,
  event_count: plan.eventCount,
  psql_guards: plan.psqlGuards,
  unchanged_schema_sha256: createHash("sha256").update(bytes).digest("hex"),
}));
const db = new pg.Client({ connectionString, application_name: "memphis-zoo-isolated-event-owner-restore" });
await db.connect();
try {
  const result = await executeEventOwnerPlan(db, plan);
  console.log(JSON.stringify({ stage: "isolated_event_owner_restore_complete", ...result }));
} finally {
  await db.query("RESET ROLE").catch(() => {});
  await db.query("RESET SESSION AUTHORIZATION").catch(() => {});
  await db.end();
}
