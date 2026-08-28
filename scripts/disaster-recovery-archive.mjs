import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { archiveSignatureBinding, verifyBinding } from "./disaster-recovery-crypto.mjs";

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const DIRECTORY_FLAGS = READ_FLAGS | constants.O_DIRECTORY;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validatedRelativePath(value) {
  const relative = String(value || "");
  const parts = relative.split("/");
  if (!relative || isAbsolute(relative) || relative.includes("\\") || relative.includes("\0")
      || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe disaster-recovery archive path: ${relative || "<empty>"}.`);
  }
  return { relative, parts };
}

function openPinnedArchiveFile(rootFd, relativePath) {
  const { parts } = validatedRelativePath(relativePath);
  let directoryFd = rootFd;
  try {
    for (const component of parts.slice(0, -1)) {
      const nextFd = openSync(`/proc/self/fd/${directoryFd}/${component}`, DIRECTORY_FLAGS);
      const state = fstatSync(nextFd);
      if (!state.isDirectory()) {
        closeSync(nextFd);
        throw new Error(`Archive path component is not a directory: ${relativePath}.`);
      }
      if (directoryFd !== rootFd) closeSync(directoryFd);
      directoryFd = nextFd;
    }
    const fileFd = openSync(`/proc/self/fd/${directoryFd}/${parts.at(-1)}`, READ_FLAGS);
    const state = fstatSync(fileFd);
    if (!state.isFile()) {
      closeSync(fileFd);
      throw new Error(`Archive path is not a regular file: ${relativePath}.`);
    }
    return fileFd;
  } finally {
    if (directoryFd !== rootFd) closeSync(directoryFd);
  }
}

function readPinnedArchiveFile(rootFd, relativePath, maxBytes) {
  const fd = openPinnedArchiveFile(rootFd, relativePath);
  try {
    const state = fstatSync(fd);
    if (state.size > maxBytes) throw new Error(`Archive control file exceeds its size limit: ${relativePath}.`);
    const output = Buffer.alloc(Number(state.size));
    let offset = 0;
    while (offset < output.length) {
      const count = readSync(fd, output, offset, output.length - offset, offset);
      if (count === 0) throw new Error(`Archive control file changed while being read: ${relativePath}.`);
      offset += count;
    }
    if (fstatSync(fd).size !== state.size) throw new Error(`Archive control file changed while being read: ${relativePath}.`);
    return output;
  } finally {
    closeSync(fd);
  }
}

function copyPinnedArchiveFile(rootFd, relativePath, destinationRoot, expectedSha256) {
  const sourceFd = openPinnedArchiveFile(rootFd, relativePath);
  const destinationPath = join(destinationRoot, relativePath);
  mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
  const destinationFd = openSync(destinationPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const count = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      let written = 0;
      while (written < count) written += writeSync(destinationFd, buffer, written, count - written);
    }
  } finally {
    closeSync(sourceFd);
    closeSync(destinationFd);
  }
  const actualSha256 = hash.digest("hex");
  if (actualSha256 !== expectedSha256) throw new Error(`Backup checksum verification failed for ${relativePath}.`);
  chmodSync(destinationPath, 0o400);
}

export function materializeVerifiedArchive({
  sourceDir,
  archiveVerifyKey,
  archiveVerifyKeyId,
  supportedFormats = ["memphis-zoo-disaster-recovery.v3", "memphis-zoo-disaster-recovery.v4"],
  requiredEntries = ["backup-summary.json"],
}) {
  if (!String(sourceDir || "").trim()) throw new Error("A disaster-recovery archive source directory is required.");
  const sourceRoot = resolve(String(sourceDir));
  let snapshotDirectory = null;
  let rootFd = null;
  let exitCleanup = null;
  try {
    rootFd = openSync(sourceRoot, DIRECTORY_FLAGS);
    if (!fstatSync(rootFd).isDirectory()) throw new Error("The disaster-recovery archive source is not a directory.");

    const checksumBytes = readPinnedArchiveFile(rootFd, "SHA256SUMS", 16 * 1024 * 1024);
    const checksumLines = checksumBytes.toString("utf8").trim().split("\n").filter(Boolean);
    const checksums = new Map();
    for (const line of checksumLines) {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) throw new Error("The backup SHA256SUMS inventory is malformed.");
      const { relative } = validatedRelativePath(match[2]);
      if (checksums.has(relative) || ["SHA256SUMS", "archive-signature.json"].includes(relative)) {
        throw new Error("The backup SHA256SUMS inventory contains a duplicate or reserved path.");
      }
      checksums.set(relative, match[1]);
    }
    if (requiredEntries.some((entry) => !checksums.has(entry))) {
      throw new Error("The signed backup inventory is missing a required recovery entry.");
    }

    snapshotDirectory = mkdtempSync(join(tmpdir(), "memphis-zoo-verified-archive-"));
    chmodSync(snapshotDirectory, 0o700);
    for (const [relativePath, expectedSha256] of checksums) {
      copyPinnedArchiveFile(rootFd, relativePath, snapshotDirectory, expectedSha256);
    }

    const signatureBytes = readPinnedArchiveFile(rootFd, "archive-signature.json", 1024 * 1024);
    writeFileSync(join(snapshotDirectory, "SHA256SUMS"), checksumBytes, { mode: 0o400, flag: "wx" });
    writeFileSync(join(snapshotDirectory, "archive-signature.json"), signatureBytes, { mode: 0o400, flag: "wx" });
    const summary = JSON.parse(readPrivateSnapshotFile(join(snapshotDirectory, "backup-summary.json")).toString("utf8"));
    const archiveSignature = JSON.parse(signatureBytes.toString("utf8"));
    const archiveDigest = sha256(checksumBytes);
    if (!supportedFormats.includes(summary.format) || summary.ok !== true || summary.consistent_database_snapshot !== true
        || archiveSignature.format !== "memphis-zoo-disaster-recovery-signature.v1"
        || archiveSignature.algorithm !== "hmac-sha256" || archiveSignature.key_id !== archiveVerifyKeyId
        || archiveSignature.archive_digest !== archiveDigest
        || !verifyBinding(archiveSignatureBinding({
          archiveDigest,
          projectRef: summary.project_ref,
          sourceIdentity: summary.source_identity,
          archiveFormat: summary.format,
        }), archiveSignature.signature, archiveVerifyKey)) {
      throw new Error("Disaster-recovery archive signature verification failed.");
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (exitCleanup) process.off("exit", exitCleanup);
      rmSync(snapshotDirectory, { recursive: true, force: true });
    };
    exitCleanup = cleanup;
    process.once("exit", exitCleanup);
    return {
      directory: snapshotDirectory,
      summary,
      archiveDigest,
      checksumBytes,
      checksumPaths: new Set(checksums.keys()),
      cleanup,
    };
  } catch (error) {
    if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (rootFd != null) closeSync(rootFd);
  }
}

export function restoreArchiveAdmission(archiveFormat, { apply = false } = {}) {
  const format = String(archiveFormat || "");
  const restoreCompatible = format === "memphis-zoo-disaster-recovery.v4";
  if (apply && !restoreCompatible) {
    throw new Error("Production restore apply requires a v4 disaster-recovery archive; v3 is historical verification evidence only.");
  }
  return {
    archive_format: format,
    restore_compatible: restoreCompatible,
    historical_verification_only: !restoreCompatible,
  };
}

// The snapshot path is private and immutable to the archive caller. This small
// wrapper keeps all post-copy reads on the snapshot rather than the source.
function readPrivateSnapshotFile(path) {
  const fd = openSync(path, READ_FLAGS);
  try {
    const state = fstatSync(fd);
    const bytes = Buffer.alloc(Number(state.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("A private archive snapshot file changed while being read.");
      offset += count;
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}
