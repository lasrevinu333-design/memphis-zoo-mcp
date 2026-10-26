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
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { archiveSignatureBinding, stableJson, verifyBinding } from "./disaster-recovery-crypto.mjs";
import { productionBackupTextColumnsDataEncoding, decodeProductionBackupTextColumnsDataRow } from "./production-backup-pg-dump-command.mjs";

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const DIRECTORY_FLAGS = READ_FLAGS | constants.O_DIRECTORY;

// Evidence only, never initial-install/restore admission. The private receipt
// is minted ONLY after the existing archive signature and copied bytes verify.
const schemaSectionSnapshots = new WeakMap();
// Parsed DATA only, keyed by the private snapshot context and exact mode.
// No cached source lifetime/currentness or target/import admission verdict.
const restoreTableSelectionParses = new WeakMap();
const immutableBootstrapInventoryReads = new WeakMap();
const schemaSectionProfiles = Object.freeze([
  Object.freeze({ section: "pre-data", path: "inventory/application-schema-pre-data.sql" }),
  Object.freeze({ section: "post-data", path: "inventory/application-schema-post-data.sql" }),
]);

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireSectionFile(rootFd, record, originalIdentity = null, readSql = false) {
  const fd = openPinnedArchiveFile(rootFd, record.path);
  try {
    const before = fstatSync(fd);
    if (before.size === 0 || before.nlink !== 1
        || (originalIdentity && !sameFileIdentity(before, originalIdentity))) {
      throw new Error("Schema section snapshot file is empty, aliased or replaced.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(before.size, 1024 * 1024));
    // ignoreBOM:true preserves the actual U+FEFF character; do not silently
    // strip original SQL bytes. Streaming fatal decoding never substitutes.
    const decoder = readSql ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }) : null;
    const text = readSql ? [] : null;
    const decode = (bytes, stream) => {
      try { return decoder.decode(bytes, { stream }); }
      catch { throw new Error("Schema section SQL is not exact valid UTF-8."); }
    };
    let offset = 0;
    while (offset < before.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (count === 0) throw new Error("Schema section snapshot file changed during validation.");
      hash.update(buffer.subarray(0, count));
      if (readSql) text.push(decode(buffer.subarray(0, count), true));
      offset += count;
    }
    if (readSql) text.push(decode(undefined, false));
    const after = fstatSync(fd);
    if (!sameFileIdentity(before, after) || after.size !== before.size || after.nlink !== 1
        || hash.digest("hex") !== record.sha256) {
      throw new Error("Schema section snapshot file does not match its authenticated digest.");
    }
    if (readSql) {
      if (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error("Schema section SQL snapshot changed during its read.");
      }
      const namedFd = openPinnedArchiveFile(rootFd, record.path);
      try {
        const named = fstatSync(namedFd);
        if (!sameFileIdentity(before, named) || named.nlink !== 1 || named.size !== before.size
            || named.mtimeMs !== before.mtimeMs || named.ctimeMs !== before.ctimeMs) {
          throw new Error("Schema section SQL snapshot file changed before return.");
        }
      } finally { closeSync(namedFd); }
      return { dev: before.dev, ino: before.ino, sql: text.join(""),
        observed: { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs } };
    }
    return { dev: before.dev, ino: before.ino };
  } finally {
    closeSync(fd);
  }
}

function validateSchemaSectionEvidence(summary, checksums, directory) {
  const identity = summary.source_identity;
  if (!identity || !Object.hasOwn(identity, "application_schema_sections")) return null;
  const records = identity.application_schema_sections;
  if (summary.format !== "memphis-zoo-disaster-recovery.v4" || !Array.isArray(records) || records.length !== 2) {
    throw new Error("Schema section evidence requires the exact ordered v4 descriptor pair.");
  }
  const sections = Object.freeze(records.map((record, index) => {
    const profile = schemaSectionProfiles[index];
    if (!record || typeof record !== "object" || Array.isArray(record)
        || Object.keys(record).length !== 3 || !["section", "path", "sha256"].every(key => Object.hasOwn(record, key))
        || record.section !== profile.section || record.path !== profile.path
        || typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256)
        || checksums.get(profile.path) !== record.sha256) {
      throw new Error("Schema section evidence has an unknown, missing, reordered or conflicting descriptor/checksum.");
    }
    return Object.freeze({ section: record.section, path: record.path, sha256: record.sha256 });
  }));
  const rootFd = openSync(directory, DIRECTORY_FLAGS);
  try {
    const root = fstatSync(rootFd);
    return { sections, rootIdentity: { dev: root.dev, ino: root.ino },
      files: sections.map(record => requireSectionFile(rootFd, record)) };
  } finally {
    closeSync(rootFd);
  }
}

// Explicit future section-aware selection refuses legacy/unbound input. The
// returned closed records name unchanged evidence in archive.directory; they
// are NOT a SQL execution plan, signature/target authority or restore permit.
export function selectVerifiedApplicationSchemaSections(archive) {
  const context = schemaSectionSnapshots.get(archive);
  if (!context || context.closed || archive.directory !== context.directory) {
    throw new Error("Schema section selection requires the original live verified archive snapshot.");
  }
  if (!context.evidence) throw new Error("Schema section evidence is absent; no legacy/full-schema split may be inferred.");
  const rootFd = openSync(context.directory, DIRECTORY_FLAGS);
  try {
    if (!sameFileIdentity(fstatSync(rootFd), context.evidence.rootIdentity)) {
      throw new Error("Schema section snapshot directory was replaced.");
    }
    context.evidence.sections.forEach((record, index) => requireSectionFile(rootFd, record, context.evidence.files[index]));
    return context.evidence.sections;
  } finally {
    closeSync(rootFd);
  }
}

// Exact detached SQL TEXT evidence, not commands or initialization/restore
// permission. Never reopen the source directory or consume caller paths/text.
export function readVerifiedApplicationSchemaSectionSql(archive) {
  const context = schemaSectionSnapshots.get(archive);
  if (!context || context.closed || archive.directory !== context.directory) {
    throw new Error("Schema section SQL requires the original live verified archive snapshot.");
  }
  if (!context.evidence) throw new Error("Schema section evidence is absent; legacy SQL sections cannot be inferred.");
  const rootFd = openSync(context.directory, DIRECTORY_FLAGS);
  try {
    if (!sameFileIdentity(fstatSync(rootFd), context.evidence.rootIdentity)) {
      throw new Error("Schema section SQL snapshot directory was replaced.");
    }
    const observations = [];
    const records = context.evidence.sections.map((record, index) => {
      const read = requireSectionFile(rootFd, record, context.evidence.files[index], true);
      observations.push(read.observed);
      return Object.freeze({ section: record.section, path: record.path, sha256: record.sha256, sql: read.sql });
    });
    if (context.closed || archive.directory !== context.directory) {
      throw new Error("Schema section SQL snapshot lifetime changed before return.");
    }
    const namedRootFd = openSync(context.directory, DIRECTORY_FLAGS);
    try {
      if (!sameFileIdentity(fstatSync(rootFd), context.evidence.rootIdentity)
          || !sameFileIdentity(fstatSync(namedRootFd), context.evidence.rootIdentity)) {
        throw new Error("Schema section SQL snapshot directory changed before return.");
      }
      records.forEach((record, index) => {
        const namedFd = openPinnedArchiveFile(namedRootFd, record.path);
        try {
          const named = fstatSync(namedFd);
          if (!sameFileIdentity(named, context.evidence.files[index]) || named.nlink !== 1
              || named.size !== observations[index].size || named.mtimeMs !== observations[index].mtimeMs
              || named.ctimeMs !== observations[index].ctimeMs) {
            throw new Error("Schema section SQL snapshot file identity changed before return.");
          }
        } finally { closeSync(namedFd); }
      });
    } finally { closeSync(namedRootFd); }
    return Object.freeze(records);
  } finally { closeSync(rootFd); }
}

function captureVerifiedSourceBinding(summaryBytes, archiveDigest, signatureBytes, checksums, directory) {
  // Independent pristine JSON graph, captured after authentication and before
  // the mutable public summary escapes. No caller object/getter is consumed.
  const summary = JSON.parse(summaryBytes.toString("utf8"));
  const pending = [summary];
  while (pending.length) {
    const value = pending.pop();
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) pending.push(child);
      Object.freeze(value);
    }
  }
  const rootFd = openSync(directory, DIRECTORY_FLAGS);
  try {
    const root = fstatSync(rootFd);
    const controls = [
      { path: "backup-summary.json", sha256: checksums.get("backup-summary.json") },
      { path: "SHA256SUMS", sha256: archiveDigest },
      { path: "archive-signature.json", sha256: sha256(signatureBytes) },
    ].map(record => {
      const original = requireSectionFile(rootFd, record);
      const fd = openPinnedArchiveFile(rootFd, record.path);
      try {
        const state = fstatSync(fd);
        if (!sameFileIdentity(state, original) || state.nlink !== 1) throw new Error("Authenticated source snapshot changed during capture.");
        return { ...record, original, size: state.size, mtimeMs: state.mtimeMs, ctimeMs: state.ctimeMs };
      } finally { closeSync(fd); }
    });
    const identity = summary.source_identity;
    const available = typeof summary.project_ref === "string" && /^[a-z0-9]{20}$/.test(summary.project_ref)
      && identity && typeof identity === "object" && !Array.isArray(identity);
    return { rootIdentity: { dev: root.dev, ino: root.ino }, controls,
      binding: available ? Object.freeze({ format: summary.format, project_ref: summary.project_ref,
        archive_digest: archiveDigest, source_identity: identity,
        source_identity_sha256: sha256(stableJson(identity)), summary }) : null };
  } finally { closeSync(rootFd); }
}

// Authenticated SOURCE facts only. No target/actor/signer/generation, approved
// flag, initialization permission or reinterpretation of normal v1 intent.
export function readVerifiedArchiveSourceBinding(archive) {
  const context = schemaSectionSnapshots.get(archive);
  if (!context || context.closed || archive.directory !== context.directory) {
    throw new Error("Source binding requires the original live verified archive snapshot.");
  }
  if (!context.source.binding) throw new Error("Authenticated source identity/project is unavailable; no defaults may be invented.");
  const rootFd = openSync(context.directory, DIRECTORY_FLAGS);
  try {
    if (!sameFileIdentity(fstatSync(rootFd), context.source.rootIdentity)) throw new Error("Authenticated source snapshot root changed.");
    for (const control of context.source.controls) requireSectionFile(rootFd, control, control.original);
    if (context.closed || archive.directory !== context.directory) throw new Error("Authenticated source snapshot lifetime changed.");
    const namedRootFd = openSync(context.directory, DIRECTORY_FLAGS);
    try {
      if (!sameFileIdentity(fstatSync(rootFd), context.source.rootIdentity)
          || !sameFileIdentity(fstatSync(namedRootFd), context.source.rootIdentity)) {
        throw new Error("Authenticated source snapshot root changed before return.");
      }
      for (const control of context.source.controls) {
        const fd = openPinnedArchiveFile(namedRootFd, control.path);
        try {
          const state = fstatSync(fd);
          if (!sameFileIdentity(state, control.original) || state.nlink !== 1 || state.size !== control.size
              || state.mtimeMs !== control.mtimeMs || state.ctimeMs !== control.ctimeMs) {
            throw new Error("Authenticated source snapshot control changed before return.");
          }
        } finally { closeSync(fd); }
      }
    } finally { closeSync(namedRootFd); }
    return context.source.binding;
  } finally { closeSync(rootFd); }
}

// A successful comparison is only key-independence DATA, never restore or
// signing authority. The archive verification key/digest is never public.
export function assertVerifiedArchiveIndependentIntentKey(verifiedArchive, intentVerifyKey) {
  const context = schemaSectionSnapshots.get(verifiedArchive);
  if (!context || context.closed || Object.getPrototypeOf(verifiedArchive) !== Object.prototype) {
    throw new Error("Original archive/independent intent verification key is unavailable.");
  }
  const directory = Object.getOwnPropertyDescriptor(verifiedArchive, "directory");
  if (!directory || !Object.hasOwn(directory, "value") || directory.value !== context.directory) {
    throw new Error("Original archive/independent intent verification key is unavailable.");
  }
  // Read the actual original live WeakMap-bound Source before comparison.
  readVerifiedArchiveSourceBinding(verifiedArchive);
  if (typeof intentVerifyKey !== "string" || intentVerifyKey.length > 65536) {
    throw new Error("Original archive/independent intent verification key is unavailable.");
  }
  const bytes = Buffer.byteLength(intentVerifyKey, "utf8");
  if (bytes < 32 || bytes > 65536
      || typeof context.archiveVerificationKeySha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(context.archiveVerificationKeySha256)
      || sha256(intentVerifyKey) === context.archiveVerificationKeySha256) {
    throw new Error("Original archive/independent intent verification key is unavailable.");
  }
}

function sameSnapshotFile(state, original) {
  return state.isFile() && Number.isSafeInteger(state.size) && state.size >= 0
    && state.nlink === 1 && sameFileIdentity(state, original)
    && state.size === original.size && state.mtimeMs === original.mtimeMs && state.ctimeMs === original.ctimeMs;
}

// Authenticated SOURCE selection only: neither a fresh-target assertion nor
// permission to bypass immutable triggers. Include EVERY private catalog
// member, even zero-row/unknown-kind members; the owning importer must refuse
// unsupported target/guard paths rather than silently drop their DATA.
export function readVerifiedRestoreTableSelection(archive, { databaseOnly = false } = {}) {
  const binding = readVerifiedArchiveSourceBinding(archive);
  const context = schemaSectionSnapshots.get(archive), path = 'inventory/table-catalog.json';
  const original = context.files.get(path), digest = binding.source_identity.database_catalog_sha256;
  if (!original || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)
      || context.checksums.get(path) !== digest) throw new Error('Restore selection requires its signed original catalog.');
  const rootFd = openSync(context.directory, DIRECTORY_FLAGS);
  let fd = null, bytes;
  try {
    if (!sameFileIdentity(fstatSync(rootFd), context.source.rootIdentity)) throw new Error('Restore selection root changed.');
    fd = openPinnedArchiveFile(rootFd, path);
    if (!sameSnapshotFile(fstatSync(fd), original)) throw new Error('Restore selection catalog identity changed.');
    bytes = Buffer.alloc(original.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('Restore selection catalog read was partial.');
      offset += count;
    }
    if (!sameSnapshotFile(fstatSync(fd), original) || sha256(bytes) !== digest)
      throw new Error('Restore selection catalog checksum changed.');
    // Lookup only AFTER the complete pinned read, identity checks and hash.
    // Keep an owned byte copy as well as the signed digest: reuse must match
    // the exact validated catalog, not merely a caller object or mode flag.
    const cached = restoreTableSelectionParses.get(context)?.get(databaseOnly);
    let selection;
    if (cached) {
      if (cached.binding !== binding || cached.original !== original || cached.digest !== digest
          || !cached.bytes.equals(bytes)) throw new Error('Restore selection validated catalog changed.');
      selection = cached.selection;
    } else {
      const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
      selection = selectVerifiedRestoreTables({summary: binding.summary, catalog,
        checksumPaths: new Set(context.checksums.keys()), databaseOnly});
      const pending = [catalog, selection];
      while (pending.length) {
        const value = pending.pop();
        if (value && typeof value === 'object') { pending.push(...Object.values(value)); Object.freeze(value); }
      }
    }
    if (readVerifiedArchiveSourceBinding(archive) !== binding) throw new Error('Restore selection source binding changed.');
    const namedRoot = openSync(context.directory, DIRECTORY_FLAGS);
    try {
      if (!sameFileIdentity(fstatSync(namedRoot), context.source.rootIdentity)) throw new Error('Restore selection named root changed.');
      const named = openPinnedArchiveFile(namedRoot, path);
      try { if (!sameSnapshotFile(fstatSync(named), original)) throw new Error('Restore selection named catalog changed.'); }
      finally { closeSync(named); }
    } finally { closeSync(namedRoot); }
    // Publish only after ALL original before/after binding and named-file
    // checks. Hits take that same validation path on every subsequent call.
    if (!cached) {
      const modes = restoreTableSelectionParses.get(context) || new Map();
      modes.set(databaseOnly, Object.freeze({binding, original, digest, bytes: Buffer.from(bytes), selection}));
      restoreTableSelectionParses.set(context, modes);
    }
    return selection;
  } finally { bytes?.fill(0); if (fd !== null) closeSync(fd); closeSync(rootFd); }
}

// SOURCE observation for the proposed owner-only importer. File descriptors
// are derived from private checksum/file ancestry, never public checksumBytes
// or caller catalogs. This does NOT mint target/import permission.
export function readVerifiedPrivateImportSource(archive) {
  const sourceBinding = readVerifiedArchiveSourceBinding(archive);
  const selection = readVerifiedRestoreTableSelection(archive, {databaseOnly: true});
  const context = schemaSectionSnapshots.get(archive);
  const rootFd = openSync(context.directory, DIRECTORY_FLAGS);
  try {
    if (!sameFileIdentity(fstatSync(rootFd), context.source.rootIdentity)) throw new Error('Private import source root changed.');
    const privateDataMembers = selection.privateTables.map(table => {
      const original = context.files.get(table.data_file), hash = context.checksums.get(table.data_file);
      const fd = openPinnedArchiveFile(rootFd, table.data_file);
      try {
        if (!original || !sameSnapshotFile(fstatSync(fd), original) || !/^[a-f0-9]{64}$/.test(hash || ''))
          throw new Error('Private import source DATA identity changed.');
        return Object.freeze({schema_name: table.schema_name, table_name: table.table_name, row_count: table.row_count,
          data_file: table.data_file, sha256: hash, bytes: String(original.size), data_encoding: table.data_encoding ?? null});
      } finally { closeSync(fd); }
    });
    if (readVerifiedArchiveSourceBinding(archive) !== sourceBinding) throw new Error('Private import source binding changed.');
    return Object.freeze({sourceBinding, selection, privateDataMembers: Object.freeze(privateDataMembers)});
  } finally { closeSync(rootFd); }
}

// Identity strings select an AUTHENTICATED catalog member, never an arbitrary
// path/hash or caller table object. This is SOURCE consumption, not permission
// to import private originals, initialize a target or reinterpret v1 intent.
export function openVerifiedRestoreTableData(archive, schemaName, tableName) {
  const binding = readVerifiedArchiveSourceBinding(archive);
  const context = schemaSectionSnapshots.get(archive);
  const catalogPath = "inventory/table-catalog.json";
  const catalogOriginal = context.files.get(catalogPath);
  if (typeof schemaName !== "string" || typeof tableName !== "string" || !catalogOriginal
      || !/^[a-f0-9]{64}$/.test(binding.source_identity.database_catalog_sha256 || "")
      || context.checksums.get(catalogPath) !== binding.source_identity.database_catalog_sha256) {
    throw new Error("DATA consumption requires the exact signed catalog and table identity.");
  }
  let rootFd = null, fd = null;
  try {
    rootFd = openSync(context.directory, DIRECTORY_FLAGS);
    if (!sameFileIdentity(fstatSync(rootFd), context.source.rootIdentity)) throw new Error("DATA snapshot root changed.");
    // Read the catalog on its original no-follow FD and hash the same bytes
    // parsed below. Public summary/checksum/catalog objects cannot replace it.
    const catalogFd = openPinnedArchiveFile(rootFd, catalogPath);
    let catalogBytes;
    try {
      if (!sameSnapshotFile(fstatSync(catalogFd), catalogOriginal)) throw new Error("DATA catalog identity changed.");
      catalogBytes = Buffer.alloc(catalogOriginal.size);
      let offset = 0;
      while (offset < catalogBytes.length) {
        const count = readSync(catalogFd, catalogBytes, offset, catalogBytes.length - offset, offset);
        if (count === 0) throw new Error("DATA catalog read was partial.");
        offset += count;
      }
      if (!sameSnapshotFile(fstatSync(catalogFd), catalogOriginal)
          || sha256(catalogBytes) !== binding.source_identity.database_catalog_sha256) throw new Error("DATA catalog checksum changed.");
    } finally { closeSync(catalogFd); }
    const catalog = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(catalogBytes));
    const selection = selectVerifiedRestoreTables({ summary: binding.summary, catalog,
      checksumPaths: new Set(context.checksums.keys()), databaseOnly: true });
    const table = selection.databaseTables.find(value => value.schema_name === schemaName && value.table_name === tableName);
    if (!table) throw new Error("DATA table identity is absent from the authenticated catalog.");
    const graph = [table];
    while (graph.length) {
      const value = graph.pop();
      if (value && typeof value === "object") { graph.push(...Object.values(value)); Object.freeze(value); }
    }
    const original = context.files.get(table.data_file), expectedHash = context.checksums.get(table.data_file);
    fd = openPinnedArchiveFile(rootFd, table.data_file);
    if (!original || !sameSnapshotFile(fstatSync(fd), original)) throw new Error("DATA file is replaced, aliased or changed.");
    const requireCurrent = () => {
      if (context.closed || archive.directory !== context.directory
          || !sameFileIdentity(fstatSync(rootFd), context.source.rootIdentity)
          || !sameSnapshotFile(fstatSync(fd), original)) throw new Error("DATA snapshot lifetime or file changed.");
      const namedRootFd = openSync(context.directory, DIRECTORY_FLAGS);
      try {
        if (!sameFileIdentity(fstatSync(namedRootFd), context.source.rootIdentity)) throw new Error("DATA named root changed.");
        for (const [path, pin] of [[catalogPath, catalogOriginal], [table.data_file, original]]) {
          const namedFd = openPinnedArchiveFile(namedRootFd, path);
          try { if (!sameSnapshotFile(fstatSync(namedFd), pin)) throw new Error("DATA named file changed."); }
          finally { closeSync(namedFd); }
        }
      } finally { closeSync(namedRootFd); }
    };
    requireCurrent();
    let resolveVerified, rejectVerified, completed = false, offset = 0, cleanupFailure = null;
    const verified = new Promise((resolve, reject) => { resolveVerified = resolve; rejectVerified = reject; });
    // The caller still awaits this original promise. Install a rejection
    // handler immediately so parser/query failure or archive cleanup cannot
    // leave an unhandled rejection while its transaction is rolling back.
    verified.catch(() => {});
    const hash = createHash("sha256");
    const stream = new Readable({
      highWaterMark: 64 * 1024,
      read() {
        try {
          requireCurrent();
          const buffer = Buffer.allocUnsafe(64 * 1024);
          const count = readSync(fd, buffer, 0, buffer.length, offset);
          if (count !== 0) {
            offset += count;
            if (offset > original.size) throw new Error("DATA file grew during consumption.");
            // Hash owned source bytes BEFORE the normal fatal UTF8/row decoder.
            hash.update(buffer.subarray(0, count));
            requireCurrent();
            this.push(buffer.subarray(0, count));
            return;
          }
          if (offset !== original.size || hash.digest("hex") !== expectedHash) throw new Error("DATA EOF/checksum does not match its authenticated member.");
          readVerifiedArchiveSourceBinding(archive);
          requireCurrent();
          completed = true;
          this.push(null);
        } catch (error) { this.destroy(error); }
      },
      destroy(error, callback) {
        // EOF may have been prefetched while unread chunks remain buffered.
        // Only the actual end event may settle successful consumption.
        let failure = error || (!completed || !this.readableEnded ? new Error("DATA consumption ended before verified EOF.") : null);
        if (!failure) {
          try { readVerifiedArchiveSourceBinding(archive); requireCurrent(); }
          catch (currentError) { failure = currentError; }
        }
        for (const ownedFd of [fd, rootFd]) {
          try { closeSync(ownedFd); }
          catch (cleanupError) { cleanupFailure ||= cleanupError; failure ||= cleanupError; }
        }
        fd = rootFd = null;
        context.readers.delete(abort);
        if (failure) rejectVerified(failure);
        else resolveVerified(Object.freeze({ data_file: table.data_file, sha256: expectedHash, bytes: offset }));
        callback(failure);
      },
    });
    // A caller may close before attaching pipeline/iteration. The verified
    // promise, not an unhandled stream error, carries its refusal.
    stream.on("error", () => {});
    const abort = () => { if (!stream.destroyed) stream.destroy(new Error("DATA source owner closed before consumption settled.")); };
    context.readers.add(abort);
    return Object.freeze({ table, stream, verified,
      close: async () => {
        if (!stream.destroyed) abort();
        await verified.catch(() => {});
        // Expected abort/source failure remains on verified; a literal FD
        // cleanup failure is ALSO returned to the owning caller, which must
        // preserve its first parser/query failure when closing in finally.
        if (cleanupFailure) throw cleanupFailure;
      } });
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (rootFd !== null) closeSync(rootFd);
    throw error;
  }
}

// Fixed Storage upload SOURCE only. No caller path/digest/metadata selection
// and no target/effect permission. All errors crossing these DATA APIs are
// bounded; native file errors may contain private signed names/paths.
function storageUploadSourceFailure() {
  return Object.assign(new Error('Verified original Storage upload source unavailable.'),{
    code:'VERIFIED_STORAGE_UPLOAD_UNAVAILABLE',
  });
}

function storageUploadObjectFields(raw) {
  const value=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw storageUploadSourceFailure();
  originalRowKeys(raw); // Reject duplicate decoded top-level aliases.
  const fields=new Map();let i=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(raw[i]||'\0'))i++;};
  const stringEnd=start=>{let end=start+1;while(end<raw.length){if(raw[end]==='\\'){end+=2;continue;}
    if(raw[end]==='"')return end+1;end++;}throw storageUploadSourceFailure();};
  ws();i++;ws();
  while(raw[i]!=='}'){
    const end=stringEnd(i),key=JSON.parse(raw.slice(i,end));i=end;ws();i++;ws();
    const start=i;let depth=0;
    while(i<raw.length){const c=raw[i];if(c==='"'){i=stringEnd(i);continue;}
      if(depth===0&&(c===','||c==='}'))break;
      if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;i++;
    }fields.set(key,raw.slice(start,i).trim());if(raw[i]===','){i++;ws();}else break;
  }return fields;
}

function storageUploadInventoryRows(text) {
  const parsed=JSON.parse(text);
  if(!Array.isArray(parsed)||parsed.length>65536)throw storageUploadSourceFailure();
  const rows=[];let i=text.indexOf('[')+1;
  const ws=()=>{while(/[\x20\t\r\n]/.test(text[i]||'\0'))i++;};
  ws();
  while(text[i]!==']'){
    const start=i;let depth=0;
    do {const c=text[i++];if(c==='"'){while(i<text.length){const q=text[i++];if(q==='\\'){i++;continue;}if(q==='"')break;}}
      else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;
    }while(depth>0&&i<text.length);
    rows.push(storageUploadObjectFields(text.slice(start,i)));
    ws();if(text[i]===','){i++;ws();}
  }
  if(rows.length!==parsed.length)throw storageUploadSourceFailure();return rows;
}

function storageUploadObjectRecords(text) {
  const records=[],ids=new Set(),keys=new Set(),files=new Set();
  for(const fields of storageUploadInventoryRows(text)){
    const string=key=>{const token=fields.get(key);if(typeof token!=='string')throw storageUploadSourceFailure();
      const value=JSON.parse(token);if(typeof value!=='string'||!value||value.includes('\0'))throw storageUploadSourceFailure();return value;};
    const id=string('id'),bucket_id=string('bucket_id'),name=string('name'),file=string('file'),digest=string('sha256');
    const size=fields.get('size_bytes'),identity=JSON.stringify([bucket_id,name]);
    if(typeof size!=='string'||!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(size)||BigInt(size)>9007199254740991n
      ||!/^[a-f0-9]{64}(?![\s\S])/.test(digest)||file!=='storage/objects/'+sha256(bucket_id+'\0'+name)+'.bin'
      ||ids.has(id)||keys.has(identity)||files.has(file))throw storageUploadSourceFailure();
    ids.add(id);keys.add(identity);files.add(file);
    const databaseRow=storageUploadObjectFields(fields.get('database_row'));
    for(const [key,expected]of [['id',id],['bucket_id',bucket_id],['name',name]])
      if(JSON.parse(databaseRow.get(key))!==expected)throw storageUploadSourceFailure();
    records.push(Object.freeze({object_id:id,bucket_id,name,file,sha256:digest,size_bytes:Number(size)}));
  }
  return Object.freeze(records);
}

export function readVerifiedStorageUploadInventory(archive) {
  let root=null;
  try {
    const sourceBinding=readVerifiedArchiveSourceBinding(archive),context=schemaSectionSnapshots.get(archive);
    const members=['inventory/storage-buckets.json','inventory/storage-objects.json'].map(path=>{
      const original=context.files.get(path),digest=context.checksums.get(path);
      if(!original||original.size<=0||original.size>16*1024*1024||typeof digest!=='string')throw storageUploadSourceFailure();
      return {path,original,sha256:digest};
    });
    requireBootstrapMemberPins(archive,sourceBinding,context,members);
    root=openSync(context.directory,DIRECTORY_FLAGS);
    const [bucketsText,objectsText]=members.map(member=>requireSectionFile(root,member,member.original,true).sql);
    const objectRecords=storageUploadObjectRecords(objectsText);
    const bucketIds=new Set(),bucketRecords=storageUploadInventoryRows(bucketsText).map(fields=>{
      const id=JSON.parse(fields.get('id'));if(typeof id!=='string'||!id||id.includes('\0')||bucketIds.has(id))throw storageUploadSourceFailure();
      bucketIds.add(id);return Object.freeze({id});
    });
    const expectedFiles=new Set(objectRecords.map(record=>record.file));
    if([...context.checksums.keys()].some(path=>path.startsWith('storage/objects/')&&!expectedFiles.has(path)))throw storageUploadSourceFailure();
    requireBootstrapMemberPins(archive,sourceBinding,context,members);
    return Object.freeze({sourceBinding,bucketsText,objectsText,bucketRecords:Object.freeze(bucketRecords),objectRecords});
  }catch {throw storageUploadSourceFailure();}
  finally {if(root!==null)try{closeSync(root);}catch{throw storageUploadSourceFailure();}}
}

export function assertVerifiedStorageUploadCurrent(archive) {
  try {
    const inventory=readVerifiedStorageUploadInventory(archive),context=schemaSectionSnapshots.get(archive);
    const selection=readVerifiedRestoreTableSelection(archive,{databaseOnly:true});
    const tables=['buckets','objects'].map(name=>selection.storageTables.find(table=>table.table_name===name));
    if(tables.some(table=>!table))throw storageUploadSourceFailure();
    for(const path of [...tables.map(table=>table.data_file),...inventory.objectRecords.map(record=>record.file)]){
      const original=context.files.get(path),sha256=context.checksums.get(path);
      if(!original||typeof sha256!=='string')throw storageUploadSourceFailure();
      requireBootstrapMemberPins(archive,inventory.sourceBinding,context,[{path,original,sha256}]);
    }
    if(readVerifiedArchiveSourceBinding(archive)!==inventory.sourceBinding)throw storageUploadSourceFailure();
  }catch {throw storageUploadSourceFailure();}
}

// Detached immutable bytes. The fixed signed object ID selects the original
// manifest entry; a caller cannot choose a file/hash. Explicit 64MiB per-file
// bound and the preparer's aggregate bound refuse, never truncate/prefix-pass.
export function readVerifiedStorageUploadBlob(archive,objectId) {
  let root=null,fd=null,bytes;
  try {
    const inventory=readVerifiedStorageUploadInventory(archive),context=schemaSectionSnapshots.get(archive);
    if(typeof objectId!=='string')throw storageUploadSourceFailure();
    const record=inventory.objectRecords.find(value=>value.object_id===objectId);
    if(!record||record.size_bytes>64*1024*1024||context.checksums.get(record.file)!==record.sha256)throw storageUploadSourceFailure();
    const original=context.files.get(record.file);
    if(!original||original.size!==record.size_bytes)throw storageUploadSourceFailure();
    requireBootstrapMemberPins(archive,inventory.sourceBinding,context,[{path:record.file,original,sha256:record.sha256}]);
    root=openSync(context.directory,DIRECTORY_FLAGS);fd=openPinnedArchiveFile(root,record.file);
    if(!sameSnapshotFile(fstatSync(fd),original))throw storageUploadSourceFailure();
    bytes=Buffer.alloc(record.size_bytes);let offset=0;
    while(offset<bytes.length){const count=readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(!count)throw storageUploadSourceFailure();offset+=count;}
    if(sha256(bytes)!==record.sha256||!sameSnapshotFile(fstatSync(fd),original))throw storageUploadSourceFailure();
    requireBootstrapMemberPins(archive,inventory.sourceBinding,context,[{path:record.file,original,sha256:record.sha256}]);
    return Object.freeze({...record,blob:new Blob([bytes])});
  }catch {throw storageUploadSourceFailure();}
  finally {
    let failed=false;try{bytes?.fill(0);}catch{failed=true;}
    for(const descriptor of [fd,root])if(descriptor!==null)try{closeSync(descriptor);}catch{failed=true;}
    if(failed)throw storageUploadSourceFailure();
  }
}

// Private fixed-bootstrap read boundary only. No caller table/path/hash or
// target is admitted by the bootstrap DATA getters below.
function requireBootstrapMemberPins(archive, sourceBinding, context, members) {
  const owned = [], cleanup = [];
  let failed = false, failure;
  try {
    if (schemaSectionSnapshots.get(archive) !== context || readVerifiedArchiveSourceBinding(archive) !== sourceBinding)
      throw new Error("Bootstrap original source changed.");
    const root = openSync(context.directory, DIRECTORY_FLAGS); owned.push(root);
    if (!sameFileIdentity(fstatSync(root), context.source.rootIdentity)) throw new Error("Bootstrap source root changed.");
    const check = member => {
      if (!member.original || context.files.get(member.path) !== member.original
          || context.checksums.get(member.path) !== member.sha256) throw new Error("Bootstrap member binding changed.");
      const fd = openPinnedArchiveFile(root, member.path); owned.push(fd);
      if (!sameSnapshotFile(fstatSync(fd), member.original)) throw new Error("Bootstrap member identity changed.");
    };
    for (const member of members) check(member);
    if (readVerifiedArchiveSourceBinding(archive) !== sourceBinding) throw new Error("Bootstrap source lifetime changed.");
    for (const member of members) check(member);
  } catch (error) { failed = true; failure = error; }
  finally { for (const fd of owned.reverse()) try { closeSync(fd); } catch (error) { cleanup.push(error); } }
  if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup,
    "Bootstrap member check cleanup failed", {cause: failed ? failure : cleanup[0]});
  if (failed) throw failure;
}

// Synchronous lifetime check for a just-consumed legacy scan. No receipt or
// permission is issued: EOF/hash still belong to each original stream. This
// closes the cross-member gap (an earlier member replaced while a later one
// was read), including same-byte inode/ctime replacement. No caller paths.
export function assertVerifiedLegacyRestoreDataCurrent(archive) {
  try {
  const sourceBinding=readVerifiedArchiveSourceBinding(archive),context=schemaSectionSnapshots.get(archive);
  const selection=readVerifiedRestoreTableSelection(archive,{databaseOnly:true});
  const members=selection.databaseTables.filter(table=>table.data_encoding!==postgresTextColumnsLineEncoding).map(table=>{
    const path=table.data_file,original=context.files.get(path),sha256=context.checksums.get(path);
    if(!original||typeof sha256!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(sha256))
      throw new Error('Original legacy DATA lifetime unavailable.');
    return {path,original,sha256};
  });
  // Bound descriptor use independently of archive table count. No stream is
  // reopened/aborted as a substitute for its earlier successful verified EOF.
  for(const member of members)requireBootstrapMemberPins(archive,sourceBinding,context,[member]);
  if(readVerifiedArchiveSourceBinding(archive)!==sourceBinding)throw new Error('Original legacy DATA source changed.');
  } catch {
    // A native open error can contain a signed member/path. It is not public
    // failure DATA. The owning importer also keeps its fixed error boundary.
    throw Object.assign(new Error('Original legacy DATA source unavailable.'),{
      code:'IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN',
    });
  }
}

// Original raw PostgreSQL JSON TEXT, not parsed/re-serialized rows or target
// initialization permission. Read exactly the two fixed metadata members.
export async function collectVerifiedRestoreBootstrapRows(verifiedArchive) {
  const sourceBinding = readVerifiedArchiveSourceBinding(verifiedArchive);
  const context = schemaSectionSnapshots.get(verifiedArchive);
  const selection = readVerifiedRestoreTableSelection(verifiedArchive, {databaseOnly: true});
  const members = ["release_deployment_manifest", "custodial_release_authority_restore_inventory"].map(name => {
    const table = selection.databaseTables.find(value => value.schema_name === "public" && value.table_name === name);
    if (!table || (name === "release_deployment_manifest" ? table.row_count !== "1" : BigInt(table.row_count) === 0n))
      throw Object.assign(new Error("Bootstrap requires one original release and nonempty original registry."), {
        code: "IMMUTABLE_BOOTSTRAP_ORIGINAL_ROWS_UNAVAILABLE", source_member: "public." + name,
      });
    const path = table.data_file, original = context.files.get(path), sha256 = context.checksums.get(path);
    if (!original || !Number.isSafeInteger(original.size) || original.size <= 0 || !/^[a-f0-9]{64}$/.test(sha256 || ""))
      throw Object.assign(new Error("Bootstrap original member is unavailable."), {
        code: "IMMUTABLE_BOOTSTRAP_ORIGINAL_ROWS_UNAVAILABLE", source_member: "public." + name,
      });
    return Object.freeze({table, path, original, sha256});
  });
  const current = () => {
    requireBootstrapMemberPins(verifiedArchive, sourceBinding, context, members);
    if (readVerifiedRestoreTableSelection(verifiedArchive, {databaseOnly: true}) !== selection
        || members.some(member => !selection.databaseTables.includes(member.table)))
      throw new Error("Bootstrap original selection changed.");
  };
  const collected = [], memberProofs = [];
  current();
  for (const member of members) {
    current();
    const data = openVerifiedRestoreTableData(verifiedArchive, "public", member.table.table_name);
    let decoder, settled, failed = false, failure, eof;
    const cleanup = [], rows = [];
    try {
      if (stableJson(data.table) !== stableJson(member.table)) throw new Error("Bootstrap opened a foreign member.");
      decoder = createRestoreRowLineBatchDecoder();
      settled = pipeline(data.stream, decoder); settled.catch(() => {});
      const iterator = decoder[Symbol.asyncIterator]();
      let bytes = 0;
      while (true) {
        current(); const next = await iterator.next(); current();
        if (next.done) break;
        for (const line of next.value) {
          if (BigInt(rows.length) >= BigInt(member.table.row_count)) throw new Error("Bootstrap original row count exceeded.");
          const raw = decodeRestoreTableRowLine(line, member.table);
          bytes += Buffer.byteLength(raw, "utf8");
          if (!Number.isSafeInteger(bytes) || bytes > member.original.size) throw new Error("Bootstrap decoded rows exceed original member bytes.");
          rows.push(raw);
        }
        current();
      }
      current(); await settled; current();
      current(); eof = await data.verified; current();
      if (String(rows.length) !== member.table.row_count || eof.data_file !== member.path
          || eof.sha256 !== member.sha256 || eof.bytes !== member.original.size)
        throw new Error("Bootstrap original row count/EOF/hash differs.");
    } catch (error) { failed = true; failure = error; }
    finally {
      // Currentness failure must not skip stream/FD cleanup. Keep its first
      // failure even when cleanup or a later source boundary also refuses.
      const check = () => { try { current(); } catch (error) { cleanup.push(error); } };
      data.stream.destroy(); decoder?.destroy();
      if (settled) {
        check(); try { await settled; } catch (error) { if (!failed || error !== failure) cleanup.push(error); } check();
      }
      check(); try { await data.close(); } catch (error) { cleanup.push(error); } check();
    }
    if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup,
      "Bootstrap row consumption/cleanup failed", {cause: failed ? failure : cleanup[0]});
    if (failed) throw failure;
    collected.push(Object.freeze(rows));
    memberProofs.push(Object.freeze({schema_name: "public", table_name: member.table.table_name,
      row_count: member.table.row_count, data_file: eof.data_file, sha256: eof.sha256, bytes: eof.bytes}));
  }
  current();
  return Object.freeze({sourceBinding, releaseRows: collected[0], registryRows: collected[1], memberProofs: Object.freeze(memberProofs)});
}

// Eight fixed signed SOURCE inventory members, exact fatal-UTF8 strings only.
// Historical source-pins.json is deliberately not installer authority/input.
export function readVerifiedImmutableBootstrapInventory(archive) {
  const sourceBinding = readVerifiedArchiveSourceBinding(archive), context = schemaSectionSnapshots.get(archive);
  const members = [
    ["application-schema.sql", "application_schema_sha256"], ["migration-ledger.json", "migration_ledger_sha256"],
    ["cron-jobs.json", "cron_jobs_sha256"], ["extensions.json", "extensions_sha256"],
    ["table-catalog.json", "database_catalog_sha256"], ["original-relations.json", "original_relations_sha256"],
    ["original-guards.json", "original_guards_sha256"], ["original-acls.json", "original_acls_sha256"],
  ].map(([name, field]) => {
    const path = "inventory/" + name, original = context.files.get(path), sha256 = sourceBinding.source_identity[field];
    if (!original || !Number.isSafeInteger(original.size) || original.size <= 0 || original.size > 32 * 1024 * 1024
        || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) || context.checksums.get(path) !== sha256)
      throw Object.assign(new Error("Fixed signed bootstrap inventory is unavailable."), {
        code: "IMMUTABLE_BOOTSTRAP_INVENTORY_UNAVAILABLE", source_member: "inventory/" + name,
      });
    return Object.freeze({path, original, sha256});
  });
  // Immutable SOURCE bytes only. Every hit still opens/checks the original
  // named members, inode/size/mtime/ctime/link count and live binding before
  // and after use. A same-byte rewrite is not an admissible original.
  // Avoid rehashing/decoding the 5MiB schema at every per-table await; this
  // cache carries no target observation, SQL evidence or effect authority.
  const cached=immutableBootstrapInventoryReads.get(context);
  if(cached){
    requireBootstrapMemberPins(archive,sourceBinding,context,members);
    if(cached.sourceBinding!==sourceBinding)throw new Error('Bootstrap inventory cached source changed.');
    requireBootstrapMemberPins(archive,sourceBinding,context,members);
    return cached;
  }
  const inventory = {}, owned = [], cleanup = [];
  let failed = false, failure;
  try {
    requireBootstrapMemberPins(archive, sourceBinding, context, members);
    const root = openSync(context.directory, DIRECTORY_FLAGS); owned.push(root);
    if (!sameFileIdentity(fstatSync(root), context.source.rootIdentity)) throw new Error("Bootstrap inventory root changed.");
    for (const member of members) {
      requireBootstrapMemberPins(archive, sourceBinding, context, members);
      inventory[member.path] = requireSectionFile(root, member, member.original, true).sql;
      requireBootstrapMemberPins(archive, sourceBinding, context, members);
    }
    requireBootstrapMemberPins(archive, sourceBinding, context, members);
  } catch (error) { failed = true; failure = error; }
  finally { for (const fd of owned) try { closeSync(fd); } catch (error) { cleanup.push(error); } }
  if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup,
    "Bootstrap inventory cleanup failed", {cause: failed ? failure : cleanup[0]});
  if (failed) throw failure;
  requireBootstrapMemberPins(archive, sourceBinding, context, members);
  const result=Object.freeze({sourceBinding, inventory: Object.freeze(inventory)});
  immutableBootstrapInventoryReads.set(context,result);
  return result;
}

// Fixed signed metadata only for rollback-only target preparation. A live
// verified snapshot and the original named members are required throughout.
export function readVerifiedMigrationTargetCaptureSource(archive) {
  const sourceBinding=readVerifiedArchiveSourceBinding(archive),context=schemaSectionSnapshots.get(archive);
  const names=[['source-schema-binding.json','source_schema_binding_sha256'],
    ['source-catalog.json','source_catalog_sha256'],['migration-ledger.json','migration_ledger_sha256']];
  const members=names.map(([name,field])=>{
    const path='inventory/'+name,original=context.files.get(path),sha256=sourceBinding.source_identity[field];
    if(!original||!Number.isSafeInteger(original.size)||original.size<=0||original.size>32*1024*1024
      ||! /^[a-f0-9]{64}$/.test(sha256||'')||context.checksums.get(path)!==sha256)
      throw new Error('Exact signed target-capture source metadata unavailable.');
    return {path,original,sha256};
  });
  requireBootstrapMemberPins(archive,sourceBinding,context,members);
  const fd=openSync(context.directory,DIRECTORY_FLAGS),values=[];
  try {for(const member of members){
    values.push(JSON.parse(requireSectionFile(fd,member,member.original,true).sql));
    requireBootstrapMemberPins(archive,sourceBinding,context,members);
  }} finally {closeSync(fd);}
  requireBootstrapMemberPins(archive,sourceBinding,context,members);
  return {sourceBinding,binding:values[0],catalog:values[1],ledger:values[2]};
}

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
  const fd = openSync(destinationPath, READ_FLAGS);
  try {
    const state = fstatSync(fd);
    if (!state.isFile() || state.nlink !== 1) throw new Error("Copied archive file is not an owned regular file.");
    return { dev: state.dev, ino: state.ino, size: state.size, mtimeMs: state.mtimeMs, ctimeMs: state.ctimeMs };
  } finally { closeSync(fd); }
}

export function materializeVerifiedArchive({
  sourceDir,
  archiveVerifyKey,
  archiveVerifyKeyId,
  supportedFormats = ["memphis-zoo-disaster-recovery.v3", "memphis-zoo-disaster-recovery.v4"],
  requiredEntries = ["backup-summary.json"],
}) {
  if (typeof archiveVerifyKey !== "string") throw new Error("Archive verification requires primitive string key material.");
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
    const files = new Map();
    for (const [relativePath, expectedSha256] of checksums) {
      files.set(relativePath, copyPinnedArchiveFile(rootFd, relativePath, snapshotDirectory, expectedSha256));
    }

    const signatureBytes = readPinnedArchiveFile(rootFd, "archive-signature.json", 1024 * 1024);
    writeFileSync(join(snapshotDirectory, "SHA256SUMS"), checksumBytes, { mode: 0o400, flag: "wx" });
    writeFileSync(join(snapshotDirectory, "archive-signature.json"), signatureBytes, { mode: 0o400, flag: "wx" });
    const summaryBytes = readPrivateSnapshotFile(join(snapshotDirectory, "backup-summary.json"));
    const summary = JSON.parse(summaryBytes.toString("utf8"));
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

    const sectionEvidence = validateSchemaSectionEvidence(summary, checksums, snapshotDirectory);
    const sourceBinding = captureVerifiedSourceBinding(summaryBytes, archiveDigest, signatureBytes, checksums, snapshotDirectory);
    const sectionContext = { directory: snapshotDirectory, evidence: sectionEvidence, source: sourceBinding,
      archiveVerificationKeySha256: sha256(archiveVerifyKey),
      checksums, files, readers: new Set(), closed: false };
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      sectionContext.closed = true;
      const parsedSelections = restoreTableSelectionParses.get(sectionContext);
      if (parsedSelections) for (const cached of parsedSelections.values()) cached.bytes.fill(0);
      restoreTableSelectionParses.delete(sectionContext);
      for (const abort of sectionContext.readers) abort();
      cleaned = true;
      if (exitCleanup) process.off("exit", exitCleanup);
      rmSync(snapshotDirectory, { recursive: true, force: true });
    };
    exitCleanup = cleanup;
    process.once("exit", exitCleanup);
    const archive = {
      directory: snapshotDirectory,
      summary,
      archiveDigest,
      checksumBytes,
      checksumPaths: new Set(checksums.keys()),
      cleanup,
    };
    schemaSectionSnapshots.set(archive, sectionContext);
    return archive;
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

// Structural selection ONLY. The owning caller must first authenticate and
// materialize the archive, validate its catalog digest, and independently
// verify the normal restore intent. No JSON field here grants restore or
// custody authority, and this helper does not establish signature provenance.
export function selectVerifiedRestoreTables({summary, catalog, checksumPaths, databaseOnly = false}) {
  const schemas = ["public", "auth", "storage", "custodial_release_identity"];
  if (typeof databaseOnly !== "boolean" || summary?.format !== "memphis-zoo-disaster-recovery.v4"
      || !Array.isArray(catalog) || !(checksumPaths instanceof Set)
      || !Array.isArray(summary.backed_up_schemas) || summary.backed_up_schemas.length < 3
      || new Set(summary.backed_up_schemas).size !== summary.backed_up_schemas.length
      || summary.backed_up_schemas.some(schema=>typeof schema !== "string" || !schemas.includes(schema))
      || ["public","auth","storage"].some(schema=>!summary.backed_up_schemas.includes(schema))
      || !Number.isSafeInteger(summary.table_count) || summary.table_count !== catalog.length
      || !Number.isSafeInteger(summary.database_row_count) || summary.database_row_count < 0) {
    throw new Error("Signed restore table/schema/count coverage is incomplete or unsupported.");
  }
  const identifier = value=>typeof value === "string" && value.length>0 && value===value.trim()
    && Buffer.byteLength(value,"utf8")<=63 && !/[\x00-\x1f\x7f/\\]/.test(value);
  const keys = new Set(), files = new Set(), representedSchemas = new Set();
  let rows = 0;
  for (const table of catalog) {
    if (!table || !schemas.includes(table.schema_name) || !summary.backed_up_schemas.includes(table.schema_name)
        || !identifier(table.table_name) || !Array.isArray(table.primary_key) || !Array.isArray(table.columns)
        || table.columns.length === 0 || typeof table.row_count !== "string" || !/^(0|[1-9][0-9]*)$/.test(table.row_count)
        || !Number.isSafeInteger(Number(table.row_count))) {
      throw new Error("Restore catalog contains an invalid, undeclared or non-restored table.");
    }
    restoreTableDataEncoding(table);
    const identity = JSON.stringify([table.schema_name,table.table_name]);
    const expectedFile = `database/${table.schema_name}.${table.table_name}.jsonl`;
    if (keys.has(identity) || files.has(table.data_file) || table.data_file !== expectedFile || !checksumPaths.has(expectedFile)) {
      throw new Error("Restore table has a duplicate identity or lacks its exact checksummed producer data file.");
    }
    const columnNames = new Set();
    for (const column of table.columns) {
      if (!column || !identifier(column.name) || columnNames.has(column.name)
          || !["","s"].includes(column.generated) || !["","a","d"].includes(column.identity)
          || typeof column.data_type !== "string" || !column.data_type.trim()) {
        throw new Error("Restore table column metadata is missing, duplicated or unsupported.");
      }
      columnNames.add(column.name);
    }
    if (new Set(table.primary_key).size !== table.primary_key.length
        || table.primary_key.some(name=>!identifier(name) || !columnNames.has(name))) {
      throw new Error("Restore table primary key does not match its original columns.");
    }
    rows += Number(table.row_count);
    if (!Number.isSafeInteger(rows)) throw new Error("Signed restore row coverage exceeds its exact supported bound.");
    representedSchemas.add(table.schema_name); keys.add(identity); files.add(table.data_file);
  }
  // The normal producer requires Storage namespace USAGE even when its
  // complete catalog contains no Storage tables. Keep that signed declaration
  // required above; absence of a Storage member is not a missing DATA file.
  // All actual catalog members still require exact counts/checksummed paths,
  // and the existing non-Storage (including private) coverage stays required.
  if (rows !== summary.database_row_count
      || summary.backed_up_schemas.some(schema=>schema !== "storage" && schema !== "custodial_release_identity" && !representedSchemas.has(schema))) {
    throw new Error("Restore catalog does not cover the exact signed schema and row summary.");
  }
  // Storage metadata remains API-owned in ordinary full restore and SQL-owned
  // only in the already restricted loopback database-only mode.
  // Empty fixed private schema is signed archive DATA only. Its authenticated
  // table catalog and complete checksummed file inventory must agree; retained
  // private bytes cannot be hidden behind a caller-supplied absence verdict.
  if(!representedSchemas.has("custodial_release_identity")
    && [...checksumPaths].some(path=>path.startsWith("database/custodial_release_identity.")))
    throw new Error("Private original files exist without their signed table catalog.");
  return Object.freeze({
    databaseTables: Object.freeze(catalog.filter(table=>table.schema_name !== "storage" || databaseOnly)),
    storageTables: Object.freeze(catalog.filter(table=>table.schema_name === "storage")),
    privateTables: Object.freeze(catalog.filter(table=>table.schema_name === "custodial_release_identity")),
    catalogRows: rows,
  });
}

export const postgresJsonTextLineEncoding = "postgres-json-text-line.v1";
// Explicit signed DATA representation only, never SQL/import admission.
export const postgresTextColumnsLineEncoding = productionBackupTextColumnsDataEncoding;

// Reject invalid/truncated UTF-8 BEFORE readline can substitute U+FFFD. Valid
// chunks pass byte-for-byte; this is representation checking, not authority.
export function createRestoreRowUtf8Guard() {
  const decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
  return new Transform({
    transform(chunk,_encoding,callback){
      try { decoder.decode(chunk,{stream:true}); callback(null,chunk); }
      catch { callback(new Error("Malformed UTF-8 in original restore row wire.")); }
    },
    flush(callback){
      try { decoder.decode(); callback(); }
      catch { callback(new Error("Truncated UTF-8 in original restore row wire.")); }
    },
  });
}

// Batch only exact decoded line boundaries; callers retain row/EOF/source
// validation. One chunk's completed lines share a frozen, dense DATA array.
export function createRestoreRowLineBatchDecoder() {
  const decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
  let pending="",skipLf=false;
  const split=text=>{
    const lines=[];
    let start=0;
    if(skipLf && text.length>0){
      if(text.charCodeAt(0)===10)start=1;
      skipLf=false;
    }
    for(let i=start;i<text.length;i++){
      const code=text.charCodeAt(i);
      if(code!==10 && code!==13)continue;
      lines.push(pending+text.slice(start,i));
      pending="";
      if(code===13){
        if(i+1<text.length){
          if(text.charCodeAt(i+1)===10)i++;
        }else skipLf=true;
      }
      start=i+1;
    }
    pending+=text.slice(start);
    return lines;
  };
  return new Transform({
    writableObjectMode:false,
    readableObjectMode:true,
    transform(chunk,_encoding,callback){
      try {
        const lines=split(decoder.decode(chunk,{stream:true}));
        callback(null,lines.length>0?Object.freeze(lines):undefined);
      }catch { callback(new Error("Malformed UTF-8 in original restore row wire.")); }
    },
    flush(callback){
      try {
        const lines=split(decoder.decode());
        if(pending!==""){lines.push(pending);pending="";}
        callback(null,lines.length>0?Object.freeze(lines):undefined);
      }catch { callback(new Error("Truncated UTF-8 in original restore row wire.")); }
    },
  });
}

function restoreTableDataEncoding(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("Restore table metadata is required.");
  // Missing is the EXISTING V4 object-line representation. Do not guess from
  // row bytes, or interpret null/empty/unknown markers as legacy permission.
  if (!Object.hasOwn(table,"data_encoding")) return null;
  if (table.data_encoding === postgresTextColumnsLineEncoding) return postgresTextColumnsLineEncoding;
  if (table.data_encoding !== postgresJsonTextLineEncoding) throw new Error("Unsupported signed restore table data_encoding.");
  return postgresJsonTextLineEncoding;
}

// Scan only original top-level keys after JSON grammar validation. Nested
// JSON values remain opaque: even numeric spelling and legitimate duplicate
// nested keys in a PostgreSQL json column must not be normalized/replaced.
function originalRowKeys(raw) {
  const keys=new Set();
  let i=0;
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(raw[i] || "\0"))i++;};
  const stringEnd=start=>{
    let cursor=start+1;
    while(cursor<raw.length){
      if(raw[cursor]==="\\"){cursor+=2;continue;}
      if(raw[cursor]==='"')return cursor+1;
      cursor++;
    }
    throw new Error("Malformed original restore row string.");
  };
  whitespace(); i++; whitespace(); // JSON.parse already proved a row object.
  while(raw[i]!=="}"){
    const end=stringEnd(i),key=JSON.parse(raw.slice(i,end));
    if(keys.has(key))throw new Error("Duplicate original restore row column.");
    keys.add(key); i=end; whitespace(); i++; whitespace(); // colon
    let depth=0;
    while(i<raw.length){
      const c=raw[i];
      if(c==='"'){i=stringEnd(i);continue;}
      if(depth===0 && (c==="," || c==="}"))break;
      if(c==="{" || c==="[")depth++;
      else if(c==="}" || c==="]")depth--;
      i++;
    }
    if(raw[i]===","){i++;whitespace();}
    else break;
  }
  return keys;
}

export function decodeRestoreTableRowLine(line, table) {
  if (typeof line !== "string" || line.length===0) throw new Error("Restore row line must be nonempty text.");
  const encoding=restoreTableDataEncoding(table);
  let raw=line;
  try {
    if(encoding===postgresTextColumnsLineEncoding){
      raw=decodeProductionBackupTextColumnsDataRow(line);
    }else if(encoding===postgresJsonTextLineEncoding){
      raw=JSON.parse(line);
      if(typeof raw!=="string")throw new Error("Encoded PostgreSQL row must be a JSON string line.");
    }
    // Literal lone surrogates would change during the driver's UTF-8 encoding.
    // Textual JSON \\u escapes are kept exact and interpreted only by SQL.
    for(let i=0;i<raw.length;i++){
      const c=raw.charCodeAt(i);
      if(c>=0xd800 && c<=0xdbff){
        const low=raw.charCodeAt(++i);
        if(!(low>=0xdc00 && low<=0xdfff))throw new Error("Original restore row is not lossless Unicode text.");
      }else if(c>=0xdc00 && c<=0xdfff)throw new Error("Original restore row is not lossless Unicode text.");
    }
    const parsed=JSON.parse(raw);
    if(parsed===null || typeof parsed!=="object" || Array.isArray(parsed))throw new Error("Original restore row must be an object.");
    if(!Array.isArray(table.columns) || table.columns.length===0)throw new Error("Original restore column metadata is required.");
    const columns=new Set(table.columns.map(column=>column?.name));
    const keys=originalRowKeys(raw);
    if(columns.size!==table.columns.length || [...columns].some(name=>typeof name!=="string" || !name)
      || keys.size!==columns.size || [...keys].some(key=>!columns.has(key)))throw new Error("Original restore row does not match its exact column metadata.");
  } catch {
    throw new Error("Malformed or metadata-mismatched original restore row representation.");
  }
  // NEVER JSON.stringify(parsed). Unsafe integers were parsed ONLY for shape
  // validation; the exact original PostgreSQL JSON text is the SQL parameter.
  return raw;
}

// Pure DATA refusal, NOT archive/target admission. Generic legacy readers
// above deliberately remain available. The importer must additionally bind
// these formatted built-in names to the original schema, and verify every
// member's actual EOF before effects. Never parse/re-render a value here:
// nested json duplicate keys and arbitrary-precision numeric tokens survive.
export function assertRestoreRowMutationFidelity(line, table) {
  try { return restoreRowMutationFidelity(line,table); }
  catch(error) {
    // Never coerce/inspect an arbitrary thrown object (including a caller
    // getter's Error/Proxy). Only this closed vocabulary can cross the API.
    const reason=typeof error==='string'&&['ROW_UNSUPPORTED','TYPE_UNSUPPORTED','ARRAY_BOUNDARIES_UNRECORDED',
      'JSON_NULL_AMBIGUOUS','FLOAT_PROFILE_UNRECORDED'].includes(error)?error:'ROW_UNSUPPORTED';
    throw Object.assign(new Error("Original row fidelity is unproven."),{
      code:"IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN",fidelity_reason:reason,
    });
  }
}

function restoreRowMutationFidelity(line, table) {
  const refuse=reason=>{throw reason;};
  let raw, encoding;
  try { encoding=restoreTableDataEncoding(table); raw=decodeRestoreTableRowLine(line,table); }
  catch { refuse("ROW_UNSUPPORTED"); }
  if(encoding===postgresTextColumnsLineEncoding)return raw;
  const fields=new Map();let i=0;
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(raw[i]||"\0"))i++;};
  const endString=start=>{let end=start+1;while(end<raw.length){
    if(raw[end]==="\\"){end+=2;continue;}if(raw[end]==='"')return end+1;end++;
  }refuse("ROW_UNSUPPORTED");};
  whitespace();i++;whitespace();
  while(raw[i]!=="}"){
    const end=endString(i),key=JSON.parse(raw.slice(i,end));i=end;whitespace();i++;whitespace();
    const start=i;let depth=0;
    while(i<raw.length){const c=raw[i];if(c==='"'){i=endString(i);continue;}
      if(depth===0&&(c===","||c==="}"))break;
      if(c==="{"||c==="[")depth++;else if(c==="}"||c==="]")depth--;i++;
    }
    if(fields.has(key))refuse("ROW_UNSUPPORTED");
    fields.set(key,raw.slice(start,i).trim());
    if(raw[i]===","){i++;whitespace();}else break;
  }
  for(const column of table.columns){
    const type=column.data_type,value=fields.get(column.name);
    if(typeof type!=="string"||value===undefined)refuse("TYPE_UNSUPPORTED");
    const array=type.endsWith("[]"),base=array?type.slice(0,-2):type;
    const numeric=/^(?:smallint|integer|bigint|numeric(?:\([0-9]+(?:,\s*-?[0-9]+)?\))?)(?![\s\S])/.test(base);
    const floating=base==="real"||base==="double precision";
    const json=base==="json"||base==="jsonb";
    const boolean=base==="boolean";
    const string=/^(?:text|uuid|bytea|date|oid|xid|xid8|pg_lsn|inet|cidr|macaddr|macaddr8|character(?: varying)?(?:\([0-9]+\))?|bit(?: varying)?(?:\([0-9]+\))?|(?:timestamp|time)(?:\([0-9]+\))? (?:with|without) time zone)(?![\s\S])/.test(base);
    if(!(numeric||floating||json||boolean||string))refuse("TYPE_UNSUPPORTED");
    if(array){if(value!=="null")refuse("ARRAY_BOUNDARIES_UNRECORDED");continue;}
    if(json){if(value==="null")refuse("JSON_NULL_AMBIGUOUS");continue;}
    if(value==="null")continue; // Only known NON-json SQL types have an unambiguous NULL.
    if(floating)refuse("FLOAT_PROFILE_UNRECORDED");
    if(boolean){if(value!=="true"&&value!=="false")refuse("ROW_UNSUPPORTED");}
    else if(numeric){
      if(!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?![\s\S])/.test(value)
        &&!(base.startsWith("numeric")&&['"NaN"','"Infinity"','"-Infinity"'].includes(value)))refuse("ROW_UNSUPPORTED");
      if(['smallint','integer','bigint'].includes(base)){
        const bound=base==='smallint'?32768n:base==='integer'?2147483648n:9223372036854775808n;
        if(!/^-?(?:0|[1-9][0-9]*)(?![\s\S])/.test(value)||BigInt(value)<-bound||BigInt(value)>=bound)refuse("ROW_UNSUPPORTED");
      }
    }else if(["oid","xid","xid8"].includes(base)){
      if(!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(value))refuse("ROW_UNSUPPORTED");
    }else{
      if(value[0]!=='"')refuse("ROW_UNSUPPORTED");
      // Decode ONLY a scalar string atom to check native-text representability;
      // never numbers/JSON-column payloads, and never serialize the DATA back.
      const atom=JSON.parse(value);
      for(let at=0;at<atom.length;at++){
        const unit=atom.charCodeAt(at);
        if(unit===0)refuse("ROW_UNSUPPORTED");
        if(unit>=0xd800&&unit<=0xdbff){const low=atom.charCodeAt(++at);
          if(!(low>=0xdc00&&low<=0xdfff))refuse("ROW_UNSUPPORTED");
        }else if(unit>=0xdc00&&unit<=0xdfff)refuse("ROW_UNSUPPORTED");
      }
    }
  }
  return raw;
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
