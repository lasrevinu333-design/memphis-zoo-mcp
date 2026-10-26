#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, chmodSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCiFreshOnlyRetainedFixture } from "./ci-fresh-only-replay.mjs";

const selectedImage = JSON.parse(readFileSync(new URL("../release/fresh-only-replay/MANIFEST.json", import.meta.url), "utf8")).image;

// Arm cleanup before producer birth; stdout is never cleanup authority.
const privateTmp = mkdtempSync(join(tmpdir(), "custodial-final-closure-"));
chmodSync(privateTmp, 0o700);
function discoverPrivateBirth() {
  const parent = lstatSync(privateTmp);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
  assert.equal(parent.uid, process.getuid());
  assert.equal(parent.mode & 0o777, 0o700);
  const entries = readdirSync(privateTmp);
  assert.ok(entries.length <= 32, "unexpected private rebuild namespace size");
  const candidates = entries.filter(name => name.startsWith("custodial-ci-fresh-custody-"));
  assert.ok(candidates.length <= 1, "ambiguous original private rebuild custody");
  if (!candidates.length) return null;
  const custodyDirectory = join(privateTmp, candidates[0]);
  const directory = lstatSync(custodyDirectory);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
  assert.equal(directory.uid, process.getuid());
  assert.equal(directory.mode & 0o777, 0o700);
  const receipt = join(custodyDirectory, "PREBIRTH_ORIGINAL_CONTAINER.json");
  if (!existsSync(receipt)) return null; // Original helper writes birth authority before Docker birth.
  const file = lstatSync(receipt);
  assert.ok(file.isFile() && !file.isSymbolicLink() && file.nlink === 1);
  assert.equal(file.uid, process.getuid());
  assert.equal(file.mode & 0o777, 0o600);
  assert.ok(file.size <= 1024 * 1024);
  const birth = JSON.parse(readFileSync(receipt, "utf8"));
  assert.equal(birth.directory, custodyDirectory);
  assert.match(birth.name, /^mz_schema_rebuild_[A-Za-z0-9_]+$/);
  return { name: birth.name, container: null, custodyDirectory };
}
try {
const output = execFileSync(process.execPath, ["scripts/empty-database-rebuild-check.mjs"], {
  env: {
    ...process.env,
    TMPDIR: privateTmp,
    SCHEMA_REBUILD_DOCKER_IMAGE: selectedImage,
    SCHEMA_REBUILD_FRESH_ONLY: "1",
    SCHEMA_REBUILD_KEEP_DATABASE: "1",
  },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(output);
const retained = output.split(/\r?\n/).filter(line => line.startsWith("{")).map(line => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(row => row && Object.hasOwn(row, "retained_test_container"));
assert.equal(retained.length, 1, "clean rebuild did not return exactly one retained disposable database identity");
const { retained_test_container: container, retained_test_container_id: containerId,
  retained_test_custody_directory: custodyDirectory, retained_test_database: database } = retained[0];
const privateIdentity = discoverPrivateBirth();
assert.ok(privateIdentity, "retained rebuild did not leave its private birth receipt");
assert.equal(custodyDirectory, privateIdentity.custodyDirectory);
assert.equal(container, privateIdentity.name);
const retainedIdentity = { name: container, container: containerId, custodyDirectory };

  assert.match(container, /^mz_schema_rebuild_[A-Za-z0-9_]+$/);
  assert.equal(database, "postgres");
  await assertCiFreshOnlyRetainedFixture(retainedIdentity);
  try {
  execFileSync(process.execPath, ["scripts/release-canary-recovery-database-tests.mjs"], {
    env: { ...process.env, RELEASE_CANARY_TEST_DOCKER_CONTAINER: container, RELEASE_CANARY_TEST_DATABASE: database },
    stdio: "inherit",
  });
  } finally {
    await assertCiFreshOnlyRetainedFixture(retainedIdentity);
  }
  await assertCiFreshOnlyRetainedFixture(retainedIdentity);
  try {
  execFileSync(process.execPath, ["scripts/final-uncertainty-closure-database-tests.mjs"], {
    env: { ...process.env, FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER: container, FINAL_UNCERTAINTY_TEST_DATABASE: database },
    stdio: "inherit",
  });
  } finally {
    await assertCiFreshOnlyRetainedFixture(retainedIdentity);
  }
} finally {
  const privateIdentity = discoverPrivateBirth();
  if (privateIdentity) await assertCiFreshOnlyRetainedFixture({ ...privateIdentity, remove: true });
  // Preserve the owned private receipts and original child evidence for Root.
}

console.log(JSON.stringify({ ok: true, clean_rebuild: true, release_canary_recovery: true, final_uncertainty_closure: true }, null, 2));
