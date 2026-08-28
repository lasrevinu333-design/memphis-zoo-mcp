#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  archiveSignatureBinding,
  releaseMigrationRehearsalAttestationBinding,
  restoreIntentBinding,
  signBinding,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";

const archiveKey = "archive-key-fixture-0000000000000000000000001";
const intentKey = "intent-key-fixture-00000000000000000000000002";
const archive = archiveSignatureBinding({
  archiveDigest: "a".repeat(64),
  projectRef: "abcdefghijklmnopqrst",
  sourceIdentity: { migration_head: "20260820125325", release: { release_id: "fixture" } },
});
const signature = signBinding(archive, archiveKey);
assert.equal(verifyBinding(archive, signature, archiveKey), true);
assert.equal(verifyBinding({ ...archive, archive_digest: "b".repeat(64) }, signature, archiveKey), false);
assert.equal(verifyBinding(archive, signature, intentKey), false);

const intent = restoreIntentBinding({ restore_id: "fixture", authority_generation: 7, archive_digest: "a".repeat(64) });
const intentSignature = signBinding(intent, intentKey);
assert.equal(verifyBinding(intent, intentSignature, intentKey), true);
assert.equal(verifyBinding({ ...intent, authority_generation: 8 }, intentSignature, intentKey), false);

const rehearsal = releaseMigrationRehearsalAttestationBinding({
  receipt_sha256: "c".repeat(64),
  repository: "lasrevinu333-design/memphis-zoo-mcp",
  run_id: "100",
});
const rehearsalSignature = signBinding(rehearsal, intentKey);
assert.equal(verifyBinding(rehearsal, rehearsalSignature, intentKey), true);
assert.equal(verifyBinding({ ...rehearsal, run_id: "101" }, rehearsalSignature, intentKey), false);

console.log("DISASTER_RECOVERY_CRYPTO_TESTS_PASS");
