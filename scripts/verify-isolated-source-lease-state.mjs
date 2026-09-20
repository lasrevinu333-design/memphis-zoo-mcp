#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { verifyIsolatedSourceLeaseState } from "./isolated-restore-lease-shim.mjs";

const sourceDir = String(process.env.RESTORE_SOURCE_DIR || "").trim();
const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
assert.ok(sourceDir && connectionString, "RESTORE_SOURCE_DIR and SUPABASE_DB_URL are required.");
let target;
try { target = new URL(connectionString); } catch { throw new Error("Invalid isolated database URL; value omitted."); }
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname)
  && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname),
"Lease-state verification requires a loopback mz_schema_rebuild_* target.");
// The owning rehearsal already authenticated this v4 archive; recheck that the
// ledger used by this decision is exactly the signed source inventory.
const summary = JSON.parse(readFileSync(join(resolve(sourceDir), "backup-summary.json"), "utf8"));
const bytes = readFileSync(join(resolve(sourceDir), "inventory", "migration-ledger.json"));
const ledger = JSON.parse(bytes.toString("utf8"));
assert.equal(summary.format, "memphis-zoo-disaster-recovery.v4");
assert.equal(createHash("sha256").update(bytes).digest("hex"), summary.source_identity.migration_ledger_sha256);
assert.ok(Array.isArray(ledger) && ledger.length > 0);
assert.equal(ledger.length, summary.source_identity.migration_ledger_count);
assert.equal(String(ledger.at(-1)?.version || ""), summary.source_identity.migration_head);
const db = new pg.Client({ connectionString, application_name: "memphis-zoo-isolated-source-lease-state" });
await db.connect();
try {
  const result = await verifyIsolatedSourceLeaseState(db, { sourceLedger: ledger });
  console.log(JSON.stringify({ stage: "isolated_source_lease_state_verified", ok: true, ...result }));
} finally {
  await db.end();
}
