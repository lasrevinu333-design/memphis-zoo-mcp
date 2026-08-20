#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  archiveSignatureBinding,
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

console.log("DISASTER_RECOVERY_CRYPTO_TESTS_PASS");
