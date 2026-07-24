#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const backupDir = resolve(String(process.env.BACKUP_DIR || "").trim());
const targetAssertion = String(process.env.RESTORE_TARGET_ASSERTION || "").trim();
const databaseUrl = String(process.env.RESTORE_DATABASE_URL || "").trim();
const storageDir = String(process.env.RESTORE_STORAGE_DIR || "").trim()
  ? resolve(String(process.env.RESTORE_STORAGE_DIR).trim())
  : "";
const targetProjectRef = String(process.env.RESTORE_SUPABASE_PROJECT_REF || "").trim();
const targetSecret = String(process.env.RESTORE_SUPABASE_SECRET || "").trim();
const restoreStorage = String(process.env.RESTORE_STORAGE || "true").toLowerCase() !== "false";

if (!process.env.BACKUP_DIR) throw new Error("BACKUP_DIR is required.");
if (targetAssertion !== "DISPOSABLE_OR_NEW_TARGET") {
  throw new Error("RESTORE_TARGET_ASSERTION=DISPOSABLE_OR_NEW_TARGET is required. Restoration can overwrite the target.");
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const manifestPath = join(backupDir, "SHA256SUMS");
if (!existsSync(manifestPath)) throw new Error("Backup SHA256SUMS is missing.");
for (const line of readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean)) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
  const path = resolve(backupDir, match[2]);
  if (!path.startsWith(`${backupDir}/`) || !existsSync(path)) throw new Error(`Backup file is missing or unsafe: ${match[2]}`);
  if (hashFile(path) !== match[1]) throw new Error(`Backup hash mismatch: ${match[2]}`);
}

const summary = JSON.parse(readFileSync(join(backupDir, "backup-summary.json"), "utf8"));
const dumpPath = join(backupDir, "data", "public-database.dump");
let databaseRestored = false;
if (summary.data_backup_included) {
  if (!databaseUrl) throw new Error("RESTORE_DATABASE_URL is required to restore the database snapshot.");
  if (summary.source_project_ref && databaseUrl.includes(String(summary.source_project_ref))) {
    throw new Error("Refusing to restore the database snapshot over the source Supabase project.");
  }
  await execFileAsync(
    "pg_restore",
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      `--dbname=${databaseUrl}`,
      dumpPath,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  databaseRestored = true;
}

const objectManifest = JSON.parse(readFileSync(join(backupDir, "storage-object-manifest.json"), "utf8"));
const bucketManifest = JSON.parse(readFileSync(join(backupDir, "storage-bucket-manifest.json"), "utf8"));
let restoredObjects = 0;
let restoredBytes = 0;

async function supabaseRequest(path, { method = "GET", body = null, contentType = "application/json" } = {}) {
  const response = await fetch(`https://${targetProjectRef}.supabase.co${path}`, {
    method,
    headers: {
      apikey: targetSecret,
      Authorization: `Bearer ${targetSecret}`,
      ...(body == null ? {} : { "Content-Type": contentType }),
      ...(contentType === "application/octet-stream" ? { "x-upsert": "true" } : {}),
    },
    body,
  });
  if (!response.ok && !(method === "POST" && path === "/storage/v1/bucket" && response.status === 409)) {
    const text = await response.text();
    throw new Error(`Storage restore request failed (${response.status}) ${path}: ${text.slice(0, 400)}`);
  }
  return response;
}

if (restoreStorage && objectManifest.length) {
  if (!storageDir && (!/^[a-z0-9]{20}$/.test(targetProjectRef) || !targetSecret)) {
    throw new Error("RESTORE_STORAGE_DIR or RESTORE_SUPABASE_PROJECT_REF plus RESTORE_SUPABASE_SECRET is required.");
  }
  if (targetProjectRef && summary.source_project_ref && targetProjectRef === summary.source_project_ref) {
    throw new Error("Refusing to restore Storage over the source Supabase project.");
  }
  if (!storageDir) {
    for (const bucket of bucketManifest) {
      await supabaseRequest("/storage/v1/bucket", {
        method: "POST",
        body: JSON.stringify({
          id: bucket.id,
          name: bucket.name || bucket.id,
          public: bucket.public === true,
          file_size_limit: bucket.file_size_limit ?? null,
          allowed_mime_types: bucket.allowed_mime_types ?? null,
        }),
      });
    }
  }
  for (const item of objectManifest) {
    if (!/^[0-9a-f]{64}\.object$/.test(String(item.archive_name || ""))) {
      throw new Error(`Unsafe Storage archive name: ${item.archive_name}`);
    }
    const source = join(backupDir, "storage", "objects", item.archive_name);
    const bytes = readFileSync(source);
    if (bytes.length !== Number(item.bytes) || hashFile(source) !== item.sha256) {
      throw new Error(`Storage archive object failed integrity verification: ${item.bucket_id}/${item.name}`);
    }
    if (storageDir) {
      const destination = join(storageDir, item.archive_name);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      copyFileSync(source, destination);
      chmodSync(destination, 0o600);
    } else {
      const bucket = encodeURIComponent(String(item.bucket_id));
      const objectName = String(item.name).split("/").map((part) => encodeURIComponent(part)).join("/");
      await supabaseRequest(`/storage/v1/object/${bucket}/${objectName}`, {
        method: "POST",
        body: bytes,
        contentType: String(item.metadata?.mimetype || "application/octet-stream"),
      });
    }
    restoredObjects += 1;
    restoredBytes += bytes.length;
  }
}

const result = {
  ok: true,
  verified_backup_manifest: true,
  database_restored: databaseRestored,
  storage_restored: restoreStorage,
  restored_storage_objects: restoredObjects,
  restored_storage_bytes: restoredBytes,
  completed_at: new Date().toISOString(),
};
writeFileSync(join(backupDir, "restore-verification.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
