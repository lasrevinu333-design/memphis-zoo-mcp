#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeVerifiedArchive, restoreArchiveAdmission } from "./disaster-recovery-archive.mjs";
import { archiveSignatureBinding, signBinding } from "./disaster-recovery-crypto.mjs";

const work = mkdtempSync(join(tmpdir(), "disaster-recovery-archive-test-"));
const key = "disaster-recovery-archive-materialization-test-key-0001";
const keyId = "archive-materialization-test-v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function writeArchive(directory) {
  mkdirSync(join(directory, "inventory"), { recursive: true, mode: 0o700 });
  const summary = {
    ok: true,
    format: "memphis-zoo-disaster-recovery.v4",
    consistent_database_snapshot: true,
    project_ref: "abcdefghijklmnopqrst",
    source_identity: { backup_tool_commit: "a".repeat(40), backup_tool_tree: "b".repeat(40) },
  };
  writeFileSync(join(directory, "backup-summary.json"), `${JSON.stringify(summary)}\n`);
  writeFileSync(join(directory, "inventory", "proof.json"), "{\"proof\":\"signed original\"}\n");
  const checksumBytes = Buffer.from([
    `${sha256(readFileSync(join(directory, "backup-summary.json")))}  backup-summary.json`,
    `${sha256(readFileSync(join(directory, "inventory", "proof.json")))}  inventory/proof.json`,
  ].join("\n") + "\n");
  writeFileSync(join(directory, "SHA256SUMS"), checksumBytes);
  const archiveDigest = sha256(checksumBytes);
  writeFileSync(join(directory, "archive-signature.json"), `${JSON.stringify({
    format: "memphis-zoo-disaster-recovery-signature.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    archive_digest: archiveDigest,
    signature: signBinding(archiveSignatureBinding({
      archiveDigest,
      projectRef: summary.project_ref,
      sourceIdentity: summary.source_identity,
      archiveFormat: summary.format,
    }), key),
  })}\n`);
}

function writeRestoreIntentArchive(directory, format, objects = [], objectFiles = new Map()) {
  mkdirSync(join(directory, "inventory"), { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, "storage", "objects"), { recursive: true, mode: 0o700 });
  const summary = {
    ok: true,
    format,
    consistent_database_snapshot: true,
    project_ref: "abcdefghijklmnopqrst",
    source_identity: { backup_tool_commit: "a".repeat(40), backup_tool_tree: "b".repeat(40) },
  };
  const entries = new Map([
    ["backup-summary.json", `${JSON.stringify(summary)}\n`],
    ["inventory/table-catalog.json", "[]\n"],
    ["inventory/storage-buckets.json", "[]\n"],
    ["inventory/storage-objects.json", `${JSON.stringify(objects)}\n`],
    ...objectFiles,
  ]);
  for (const [relativePath, bytes] of entries) {
    mkdirSync(join(directory, relativePath, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, relativePath), bytes);
  }
  const checksumBytes = Buffer.from([...entries].sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath]) => `${sha256(readFileSync(join(directory, relativePath)))}  ${relativePath}`)
    .join("\n") + "\n");
  writeFileSync(join(directory, "SHA256SUMS"), checksumBytes);
  const archiveDigest = sha256(checksumBytes);
  writeFileSync(join(directory, "archive-signature.json"), `${JSON.stringify({
    format: "memphis-zoo-disaster-recovery-signature.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    archive_digest: archiveDigest,
    signature: signBinding(archiveSignatureBinding({
      archiveDigest,
      projectRef: summary.project_ref,
      sourceIdentity: summary.source_identity,
      archiveFormat: summary.format,
    }), key),
  })}\n`);
}

try {
  assert.deepEqual(restoreArchiveAdmission("memphis-zoo-disaster-recovery.v3"), {
    archive_format: "memphis-zoo-disaster-recovery.v3",
    restore_compatible: false,
    historical_verification_only: true,
  });
  assert.throws(() => restoreArchiveAdmission("memphis-zoo-disaster-recovery.v3", { apply: true }),
    /v4 disaster-recovery archive/i, "a signed v3 archive may be inspected but cannot reach destructive restore or reconciliation");
  assert.equal(restoreArchiveAdmission("memphis-zoo-disaster-recovery.v4", { apply: true }).restore_compatible, true);
  const intentEnvironment = {
    ...process.env,
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    SUPABASE_DB_URL: "postgresql://should-not-connect.invalid:5432/test",
    RESTORE_NAMED_ACTOR: "archive admission test operator",
    RESTORE_INTENT_SIGNING_KEY: "independent-restore-intent-test-key-0000000001",
    RESTORE_INTENT_SIGNING_KEY_ID: "intent-admission-test-v1",
    RESTORE_ARCHIVE_VERIFY_KEY: key,
    RESTORE_ARCHIVE_VERIFY_KEY_ID: keyId,
  };
  const v3IntentSource = join(work, "v3-intent-source");
  writeRestoreIntentArchive(v3IntentSource, "memphis-zoo-disaster-recovery.v3");
  const v3IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: v3IntentSource }, encoding: "utf8",
  });
  assert.notEqual(v3IntentRun.status, 0);
  assert.equal(v3IntentRun.stdout, "", "a historical v3 archive must not emit signed restore authority");
  assert.match(v3IntentRun.stderr, /archive signature verification failed/i);
  assert.doesNotMatch(v3IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "v3 rejection must happen before the target database connection is attempted");

  const malformedV4IntentSource = join(work, "malformed-v4-intent-source");
  const malformedBytes = Buffer.from("malformed-v4-owner-proof");
  const malformedFile = "storage/objects/malformed-owner-proof.bin";
  writeRestoreIntentArchive(malformedV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
    id: "legacy-wrapper-id", bucket_id: "private", name: "malformed-owner-proof.bin", file: malformedFile,
    size_bytes: malformedBytes.length, sha256: sha256(malformedBytes), metadata: { size: malformedBytes.length },
    user_metadata: null, version: "legacy-version", created_at: "2026-08-27T00:00:00Z", updated_at: "2026-08-27T00:00:00Z",
  }], new Map([[malformedFile, malformedBytes]]));
  const malformedV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: malformedV4IntentSource }, encoding: "utf8",
  });
  assert.notEqual(malformedV4IntentRun.status, 0);
  assert.equal(malformedV4IntentRun.stdout, "", "a v3-shaped object relabeled as v4 must not emit signed restore authority");
  assert.match(malformedV4IntentRun.stderr, /complete database_row/i);
  assert.doesNotMatch(malformedV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "malformed v4 Storage schema rejection must happen before target database connection");

  const aliasV4IntentSource = join(work, "alias-v4-intent-source");
  const aliasBytes = Buffer.from("checksummed non-storage control bytes\n");
  const aliasRow = {
    id: "alias-object-id", bucket_id: "private", name: "alias-proof.bin",
    owner_id: "employee-1", owner: "employee-1", metadata: { size: aliasBytes.length }, user_metadata: null,
    version: "alias-version", created_at: "2026-08-27T00:00:00+00:00", updated_at: "2026-08-27T00:00:00+00:00",
    last_accessed_at: "2026-08-27T00:00:00+00:00",
  };
  writeRestoreIntentArchive(aliasV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
    id: aliasRow.id, bucket_id: aliasRow.bucket_id, name: aliasRow.name, file: "inventory/proof.json",
    size_bytes: aliasBytes.length, sha256: sha256(aliasBytes), metadata: aliasRow.metadata,
    user_metadata: aliasRow.user_metadata, version: aliasRow.version,
    created_at: aliasRow.created_at, updated_at: aliasRow.updated_at, database_row: aliasRow,
  }], new Map([["inventory/proof.json", aliasBytes]]));
  const aliasV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: aliasV4IntentSource }, encoding: "utf8",
  });
  assert.notEqual(aliasV4IntentRun.status, 0);
  assert.equal(aliasV4IntentRun.stdout, "", "a checksummed control file alias must not emit signed restore authority");
  assert.match(aliasV4IntentRun.stderr, /deterministic producer archive path/i);
  assert.doesNotMatch(aliasV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "Storage file-path substitution must fail before target database connection");

  const numericOwnerV4IntentSource = join(work, "numeric-owner-v4-intent-source");
  const numericOwnerBytes = Buffer.from("numeric-owner-object-bytes\n");
  const numericOwnerName = "numeric-owner-proof.bin";
  const numericOwnerFile = `storage/objects/${sha256(`private\0${numericOwnerName}`)}.bin`;
  const numericOwnerRow = {
    id: "numeric-owner-object-id", bucket_id: "private", name: numericOwnerName,
    owner_id: 123, owner: 123, metadata: { size: numericOwnerBytes.length }, user_metadata: null,
    version: "numeric-owner-version", created_at: "2026-08-27T00:00:00+00:00", updated_at: "2026-08-27T00:00:00+00:00",
    last_accessed_at: "2026-08-27T00:00:00+00:00",
  };
  writeRestoreIntentArchive(numericOwnerV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
    id: numericOwnerRow.id, bucket_id: numericOwnerRow.bucket_id, name: numericOwnerRow.name, file: numericOwnerFile,
    size_bytes: numericOwnerBytes.length, sha256: sha256(numericOwnerBytes), metadata: numericOwnerRow.metadata,
    user_metadata: numericOwnerRow.user_metadata, version: numericOwnerRow.version,
    created_at: numericOwnerRow.created_at, updated_at: numericOwnerRow.updated_at, database_row: numericOwnerRow,
  }], new Map([[numericOwnerFile, numericOwnerBytes]]));
  const numericOwnerV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: { ...intentEnvironment, RESTORE_SOURCE_DIR: numericOwnerV4IntentSource }, encoding: "utf8",
  });
  assert.notEqual(numericOwnerV4IntentRun.status, 0);
  assert.equal(numericOwnerV4IntentRun.stdout, "", "numeric owner fields must not emit signed restore authority");
  assert.match(numericOwnerV4IntentRun.stderr, /owner fields must be null or nonblank strings/i);
  assert.doesNotMatch(numericOwnerV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
    "numeric owner rejection must happen before target database connection");

  for (const [label, invalidTimestamp] of [
    ["zero", "0"],
    ["informal", "Aug 27 2026"],
    ["date-only", "2026-08-27"],
    ["zero-fraction", "2026-08-27T00:00:00.0+00:00"],
    ["trailing-fraction-zero", "2026-08-27T00:00:00.123400+00:00"],
    ["negative-zero-offset", "2026-08-27T00:00:00-00:00"],
  ]) {
    const timestampV4IntentSource = join(work, `${label}-timestamp-v4-intent-source`);
    const timestampBytes = Buffer.from(`${label}-timestamp-object-bytes\n`);
    const timestampName = `${label}-timestamp-proof.bin`;
    const timestampFile = `storage/objects/${sha256(`private\0${timestampName}`)}.bin`;
    const timestampRow = {
      id: `${label}-timestamp-object-id`, bucket_id: "private", name: timestampName,
      owner_id: "employee-1", owner: "employee-1", metadata: { size: timestampBytes.length }, user_metadata: null,
      version: `${label}-timestamp-version`, created_at: "2026-08-27T00:00:00+00:00", updated_at: invalidTimestamp,
      last_accessed_at: "2026-08-27T00:00:00+00:00",
    };
    writeRestoreIntentArchive(timestampV4IntentSource, "memphis-zoo-disaster-recovery.v4", [{
      id: timestampRow.id, bucket_id: timestampRow.bucket_id, name: timestampRow.name, file: timestampFile,
      size_bytes: timestampBytes.length, sha256: sha256(timestampBytes), metadata: timestampRow.metadata,
      user_metadata: timestampRow.user_metadata, version: timestampRow.version,
      created_at: timestampRow.created_at, updated_at: timestampRow.updated_at, database_row: timestampRow,
    }], new Map([[timestampFile, timestampBytes]]));
    const timestampV4IntentRun = spawnSync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
      env: { ...intentEnvironment, RESTORE_SOURCE_DIR: timestampV4IntentSource }, encoding: "utf8",
    });
    assert.notEqual(timestampV4IntentRun.status, 0);
    assert.equal(timestampV4IntentRun.stdout, "", `${label} non-producer timestamp must not emit signed restore authority`);
    assert.match(timestampV4IntentRun.stderr, /PostgreSQL row_to_json timestamp/i);
    assert.doesNotMatch(timestampV4IntentRun.stderr, /ENOTFOUND|ECONNREFUSED|should-not-connect/i,
      `${label} non-producer timestamp must fail before target database connection`);
  }
  const source = join(work, "source");
  writeArchive(source);
  const verified = materializeVerifiedArchive({
    sourceDir: source,
    archiveVerifyKey: key,
    archiveVerifyKeyId: keyId,
    supportedFormats: ["memphis-zoo-disaster-recovery.v4"],
    requiredEntries: ["backup-summary.json", "inventory/proof.json"],
  });
  writeFileSync(join(source, "inventory", "proof.json"), "{\"proof\":\"replaced after verification\"}\n");
  assert.equal(readFileSync(join(verified.directory, "inventory", "proof.json"), "utf8"), "{\"proof\":\"signed original\"}\n",
    "all restore consumers must read the private verified snapshot after source replacement");
  verified.cleanup();

  const symlinkSource = join(work, "symlink-source");
  const outside = join(work, "outside");
  writeArchive(symlinkSource);
  mkdirSync(outside, { mode: 0o700 });
  writeFileSync(join(outside, "proof.json"), "{\"proof\":\"signed original\"}\n");
  rmSync(join(symlinkSource, "inventory"), { recursive: true });
  symlinkSync(outside, join(symlinkSource, "inventory"), "dir");
  assert.throws(() => materializeVerifiedArchive({
    sourceDir: symlinkSource,
    archiveVerifyKey: key,
    archiveVerifyKeyId: keyId,
    requiredEntries: ["backup-summary.json", "inventory/proof.json"],
  }), /ELOOP|not a directory/i, "an intermediate archive symlink must be rejected before any evidence is trusted");
  console.log("DISASTER_RECOVERY_ARCHIVE_TESTS_PASS");
} finally {
  rmSync(work, { recursive: true, force: true });
}
