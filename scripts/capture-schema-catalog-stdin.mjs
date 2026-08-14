#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const outputDir = resolve(String(process.argv[2] || "").trim());
if (!process.argv[2]) throw new Error("Output directory is required.");

const required = [
  "extensions", "types", "sequences", "tables", "columns", "constraints",
  "indexes", "functions", "views", "triggers", "policies", "owned_scheduler_roles",
  "owned_scheduler_role_memberships", "privilege_bearing_roles", "role_memberships",
  "table_grants", "column_grants", "sequence_grants", "routine_grants", "type_grants",
  "schema_grants", "default_privileges", "cron_jobs",
];
const inventory = {};
const encodedChunks = new Map();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const item = JSON.parse(line);
  if (item.end === true) break;
  if (!required.includes(item.name)) {
    throw new Error("Catalog input contains an invalid category.");
  }
  if (typeof item.chunk === "string") {
    const chunks = encodedChunks.get(item.name) || [];
    chunks.push(item.chunk);
    encodedChunks.set(item.name, chunks);
    if (item.final === true) {
      const rows = JSON.parse(Buffer.from(chunks.join(""), "base64").toString("utf8"));
      if (!Array.isArray(rows)) throw new Error("Catalog chunk payload must decode to an array.");
      inventory[item.name] = rows;
      encodedChunks.delete(item.name);
    }
  } else if (Array.isArray(item.rows)) {
    inventory[item.name] = item.rows;
  } else {
    throw new Error("Catalog input contains an invalid category payload.");
  }
}

const missing = required.filter((name) => !Array.isArray(inventory[name]));
if (missing.length) throw new Error(`Catalog input is incomplete: ${missing.join(", ")}`);

const ordered = Object.fromEntries(required.map((name) => [name, inventory[name]]));
const normalized = stable(ordered);
const compact = JSON.stringify(normalized);
const fingerprint = createHash("sha256").update(compact).digest("hex");
const capturedAt = new Date().toISOString();
mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const catalogPath = resolve(outputDir, "schema-catalog-production.json");
const summaryPath = resolve(outputDir, "schema-catalog-production-summary.json");
writeFileSync(catalogPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
writeFileSync(summaryPath, `${JSON.stringify({
  captured_at: capturedAt,
  schema_fingerprint: fingerprint,
  counts: Object.fromEntries(required.map((name) => [name, inventory[name].length])),
}, null, 2)}\n`, { mode: 0o600 });
chmodSync(catalogPath, 0o600);
chmodSync(summaryPath, 0o600);
console.log(JSON.stringify({ ok: true, captured_at: capturedAt, schema_fingerprint: fingerprint }));
