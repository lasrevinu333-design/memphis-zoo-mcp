#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "memphis-backup-roundtrip-"));
const source = join(temp, "source");
const backup = join(temp, "backup");
const restored = join(temp, "restored-storage");
mkdirSync(join(source, "inventory"), { recursive: true });
mkdirSync(join(source, "storage", "objects"), { recursive: true });

const inventoryNames = [
  "database", "schemas", "extensions", "types", "sequences", "tables", "columns",
  "constraints", "indexes", "functions", "views", "view_dependencies", "triggers",
  "policies", "table_grants", "routine_grants", "cron_jobs", "supabase_migrations",
  "application_migrations",
];
for (const name of inventoryNames) {
  writeFileSync(join(source, "inventory", `${name}.json`), "[]\n");
}

const objectBytes = Buffer.from("private feedback image test bytes\n", "utf8");
const archiveName = `${createHash("sha256").update("system-feedback-private\0feedback/test.png").digest("hex")}.object`;
const objectHash = createHash("sha256").update(objectBytes).digest("hex");
writeFileSync(join(source, "storage", "objects", archiveName), objectBytes);
writeFileSync(join(source, "storage-object-manifest.json"), `${JSON.stringify([{
  id: "00000000-0000-4000-8000-00000000b401",
  bucket_id: "system-feedback-private",
  name: "feedback/test.png",
  metadata: { size: objectBytes.length, mimetype: "image/png" },
  user_metadata: null,
  archive_name: archiveName,
  bytes: objectBytes.length,
  sha256: objectHash,
}], null, 2)}\n`);
writeFileSync(join(source, "storage-bucket-manifest.json"), `${JSON.stringify([{
  id: "system-feedback-private",
  name: "system-feedback-private",
  public: false,
  file_size_limit: 5242880,
  allowed_mime_types: ["image/png"],
}], null, 2)}\n`);
writeFileSync(join(source, "backup-summary.json"), `${JSON.stringify({
  data_backup_included: false,
  storage_metadata_sha256: createHash("sha256").update("fixture").digest("hex"),
})}\n`);

try {
  await execFileAsync(process.execPath, [join(root, "scripts", "production-backup.mjs")], {
    env: {
      ...process.env,
      BACKUP_SOURCE_DIR: source,
      BACKUP_DIR: backup,
      INCLUDE_DATA: "false",
      INCLUDE_STORAGE: "true",
    },
  });
  const summary = JSON.parse(readFileSync(join(backup, "backup-summary.json"), "utf8"));
  assert.equal(summary.storage_object_count, 1);
  assert.equal(summary.storage_bytes, objectBytes.length);
  assert.equal(summary.storage_consistency_verified, true);

  await execFileAsync(process.execPath, [join(root, "scripts", "restore-production-backup.mjs")], {
    env: {
      ...process.env,
      BACKUP_DIR: backup,
      RESTORE_TARGET_ASSERTION: "DISPOSABLE_OR_NEW_TARGET",
      RESTORE_STORAGE_DIR: restored,
      RESTORE_STORAGE: "true",
    },
  });
  const restoredBytes = readFileSync(join(restored, archiveName));
  assert.deepEqual(restoredBytes, objectBytes);
  const result = JSON.parse(readFileSync(join(backup, "restore-verification.json"), "utf8"));
  assert.equal(result.verified_backup_manifest, true);
  assert.equal(result.restored_storage_objects, 1);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("BACKUP_STORAGE_ROUNDTRIP_PASS");
