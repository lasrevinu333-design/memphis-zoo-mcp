#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workflowDirectory = resolve(root, ".github", "workflows");
const approvedActions = new Map([
  ["actions/checkout", ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"]],
  ["actions/setup-node", ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"]],
  ["actions/upload-artifact", ["043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"]],
]);

const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

for (const name of workflowNames) {
  const source = readFileSync(resolve(workflowDirectory, name), "utf8");
  assert.doesNotMatch(source, /runs-on:\s*ubuntu-latest/, `${name} must pin its runner image`);
  if (source.includes("runs-on: ubuntu-")) {
    assert.match(source, /runs-on:\s*ubuntu-24\.04/, `${name} must use Ubuntu 24.04`);
  }
  if (source.includes("actions/setup-node")) {
    const versions = [...source.matchAll(/node-version:\s*['"]?([^'"\s]+)['"]?/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, `${name} must declare a Node version`);
    assert.deepEqual([...new Set(versions)], ["22.23.1"], `${name} must use Node 22.23.1 exactly`);
  }
  for (const match of source.matchAll(/uses:\s*([^@\s#]+)@([^\s#]+)(?:\s+#\s*(v\d+(?:\.\d+){0,2}))?/g)) {
    const [, action, revision, comment] = match;
    const expected = approvedActions.get(action);
    assert.ok(expected, `${name} uses an unapproved action: ${action}`);
    assert.equal(revision, expected[0], `${name} must pin ${action} to its verified commit`);
    assert.equal(comment, expected[1], `${name} must retain the readable ${expected[1]} comment`);
  }
}

const foundationGate = readFileSync(resolve(workflowDirectory, "foundation-security-gate.yml"), "utf8");
const productionRepairGate = readFileSync(resolve(workflowDirectory, "custodial-production-repair.yml"), "utf8");
assert.match(foundationGate, /npm run --silent test:manager-device-auth-v2/,
  "the required security gate must execute manager device-auth v2 crypto, attestation, route, and lifecycle tests");
assert.match(productionRepairGate, /npm run --silent test:manager-device-auth-v2-db/,
  "the production repair gate must execute manager device-auth v2 disposable-database concurrency and restart tests");

console.log(JSON.stringify({ ok: true, workflows_checked: workflowNames.length }, null, 2));
