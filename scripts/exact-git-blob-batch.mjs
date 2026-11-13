import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Retain the existing per-command Git output limit. Small batches avoid
// retaining a second complete copy of the release tree while reading it.
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const TARGET_BATCH_BYTES = 4 * 1024 * 1024;
const sha1Blob = bytes => createHash("sha1")
  .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

export function readExactGitBlobs(entries, { expectedCommit, readGit }) {
  assert.match(expectedCommit, /^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(entries) && entries.length > 0, "expected tree must contain tracked paths");
  const paths = new Set();
  for (const entry of entries) {
    assert.match(entry.path, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/);
    assert.equal(paths.has(entry.path), false, "duplicate expected tree path");
    paths.add(entry.path);
    assert.match(entry.object_id, /^[a-f0-9]{40}$/);
    assert.ok(Number.isSafeInteger(entry.byteLength) && entry.byteLength >= 0
      && entry.byteLength <= MAX_GIT_OUTPUT_BYTES, "expected blob exceeds the existing Git output limit");
  }
  const result = [];
  let batch = [], responseBytes = 0;
  const append = (entry, bytes) => {
    assert.equal(bytes.length, entry.byteLength, `expected blob length differs: ${entry.path}`);
    assert.equal(sha1Blob(bytes), entry.object_id, `expected blob content identity differs: ${entry.path}`);
    result.push({ path: entry.path, mode: entry.mode, object_id: entry.object_id, bytes });
  };
  const flush = () => {
    if (!batch.length) return;
    const input = Buffer.from(batch.map(entry => `${expectedCommit}:${entry.path}\n`).join(""));
    const output = readGit(["cat-file", "--batch"], input);
    assert.ok(Buffer.isBuffer(output), "Git blob batch must return bytes");
    assert.equal(output.length, responseBytes, "Git blob batch is truncated or contains extra bytes");
    let offset = 0;
    for (const entry of batch) {
      const end = output.indexOf(10, offset);
      assert.ok(end >= offset, "Git blob batch header is incomplete");
      const header = output.subarray(offset, end).toString("ascii");
      const match = header.match(/^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/);
      assert.ok(match, `expected tracked object is not a blob: ${entry.path}`);
      assert.equal(match[1], entry.object_id, `commit/tree blob mismatch for ${entry.path}`);
      assert.equal(match[2], String(entry.byteLength), `expected blob length differs: ${entry.path}`);
      const start = end + 1, stop = start + entry.byteLength;
      assert.equal(output[stop], 10, "Git blob batch body terminator is missing");
      append(entry, output.subarray(start, stop));
      offset = stop + 1;
    }
    assert.equal(offset, output.length, "Git blob batch has trailing bytes");
    batch = []; responseBytes = 0;
  };
  for (const entry of entries) {
    const framedBytes = Buffer.byteLength(`${entry.object_id} blob ${entry.byteLength}\n`)
      + entry.byteLength + 1;
    if (batch.length && responseBytes + framedBytes > TARGET_BATCH_BYTES) flush();
    if (framedBytes > MAX_GIT_OUTPUT_BYTES) {
      // A blob at the original 64 MiB boundary cannot fit its batch header.
      // Keep the original individual-command route and its unchanged limit.
      flush();
      assert.equal(readGit(["rev-parse", `${expectedCommit}:${entry.path}`]).toString("utf8").trim(),
        entry.object_id, `commit/tree blob mismatch for ${entry.path}`);
      assert.equal(readGit(["cat-file", "-t", entry.object_id]).toString("utf8").trim(), "blob",
        `expected tracked object is not a blob: ${entry.path}`);
      append(entry, readGit(["cat-file", "blob", entry.object_id]));
    } else {
      batch.push(entry); responseBytes += framedBytes;
    }
  }
  flush();
  return result;
}
