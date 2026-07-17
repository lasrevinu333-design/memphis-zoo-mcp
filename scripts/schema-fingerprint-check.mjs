import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableJson(item)]),
    );
  }
  return value;
}

const root = resolve(new URL("..", import.meta.url).pathname);
const inputPath = resolve(root, "supabase/canonical/schema-fingerprint-input.json");
const expectedPath = resolve(root, "supabase/canonical/schema-fingerprint.txt");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const expected = readFileSync(expectedPath, "utf8").trim();
const actual = createHash("sha256").update(JSON.stringify(stableJson(input))).digest("hex");

if (actual !== expected) {
  console.error(JSON.stringify({ ok: false, expected, actual, inputPath, expectedPath }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, schema_fingerprint: actual }, null, 2));
