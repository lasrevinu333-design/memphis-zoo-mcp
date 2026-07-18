#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const outputPath = resolve(String(process.argv[2] || "").trim());
if (!process.argv[2]) throw new Error("Output path is required.");

let payload;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const item = JSON.parse(line);
  if (item.end === true) break;
  if (payload !== undefined) throw new Error("Exactly one JSON payload is allowed.");
  payload = item;
}
if (payload === undefined) throw new Error("A JSON payload is required.");

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
writeFileSync(outputPath, serialized, { mode: 0o600 });
chmodSync(outputPath, 0o600);
console.log(JSON.stringify({
  ok: true,
  path: outputPath,
  bytes: Buffer.byteLength(serialized),
  sha256: createHash("sha256").update(serialized).digest("hex"),
}));
