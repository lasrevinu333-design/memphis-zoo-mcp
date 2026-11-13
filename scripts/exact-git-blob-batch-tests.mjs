import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readExactGitBlobs } from "./exact-git-blob-batch.mjs";

const expectedCommit = "a".repeat(40);
const make = (path, bytes) => ({ path, mode: "100644", bytes,
  object_id: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
  byteLength: bytes.length });
const entries = [make("empty.txt", Buffer.alloc(0)),
  make("binary.dat", Buffer.from([0, 10, 255, 13, 10, 0]))];
const frame = entry => Buffer.concat([Buffer.from(`${entry.object_id} blob ${entry.byteLength}\n`), entry.bytes, Buffer.from("\n")]);
const output = Buffer.concat(entries.map(frame));
let calls = 0;
const result = readExactGitBlobs(entries, { expectedCommit, readGit(args, input) {
  calls++;
  assert.deepEqual(args, ["cat-file", "--batch"]);
  assert.equal(input.toString(), entries.map(entry => `${expectedCommit}:${entry.path}\n`).join(""));
  return output;
} });
assert.equal(calls, 1);
assert.deepEqual(result.map(entry => entry.bytes), entries.map(entry => entry.bytes));
assert.deepEqual(Object.keys(result[0]), ["path", "mode", "object_id", "bytes"]);
let checks = 4;
const refuses = (name, mutate, reason) => {
  assert.throws(() => readExactGitBlobs(entries, { expectedCommit, readGit: () => mutate(Buffer.from(output)) }), reason, name);
  checks++;
};
refuses("truncated body", bytes => bytes.subarray(0, -1), /truncated|extra bytes/);
refuses("trailing body", bytes => Buffer.concat([bytes, Buffer.from("x")]), /truncated|extra bytes/);
refuses("wrong resolved commit/path blob", bytes => { bytes[0] = bytes[0] === 97 ? 98 : 97; return bytes; }, /commit\/tree blob mismatch/);
refuses("wrong object type", bytes => { bytes.write("tree", 41); return bytes; }, /not a blob/);
refuses("wrong declared size", bytes => { bytes[46] = 49; return bytes; }, /blob length differs/);
refuses("corrupt binary content", bytes => { bytes[bytes.length - 3] ^= 1; return bytes; }, /content identity differs/);
refuses("wrong body terminator", bytes => { bytes[bytes.length - 1] = 0; return bytes; }, /terminator is missing/);
refuses("noncanonical header size", bytes => { bytes[46] = 45; return bytes; }, /not a blob/);
for (const bad of ["../outside", "/absolute", "line\nbreak"]) {
  assert.throws(() => readExactGitBlobs([{ ...entries[0], path: bad }], { expectedCommit, readGit: () => assert.fail("invalid path reached Git") }));
  checks++;
}
assert.throws(() => readExactGitBlobs([entries[0], entries[0]], { expectedCommit, readGit: () => assert.fail("duplicate path reached Git") }), /duplicate/); checks++;
assert.throws(() => readExactGitBlobs([{ ...entries[0], byteLength: 64 * 1024 * 1024 + 1 }], { expectedCommit, readGit: () => assert.fail("over-limit blob reached Git") }), /output limit/); checks++;
// Batches remain ordered and bounded, including a single larger valid blob.
const large = make("large.dat", Buffer.alloc(4 * 1024 * 1024, 123));
const sequence = [entries[0], large, entries[1]];
let next = 0, batches = 0;
const chunked = readExactGitBlobs(sequence, { expectedCommit, readGit(args, input) {
  assert.deepEqual(args, ["cat-file", "--batch"]);
  const count = input.toString().trimEnd().split("\n").length;
  const selected = sequence.slice(next, next + count); next += count; batches++;
  return Buffer.concat(selected.map(frame));
} });
assert.equal(batches, 3);
assert.deepEqual(chunked.map(entry => entry.object_id), sequence.map(entry => entry.object_id)); checks += 2;
// Preserve the individual route when batch framing alone exceeds 64 MiB.
const boundary = { ...entries[0], byteLength: 64 * 1024 * 1024 };
const individual = [];
assert.throws(() => readExactGitBlobs([boundary], { expectedCommit, readGit(args) {
  individual.push(args);
  if (args[0] === "rev-parse") return Buffer.from(boundary.object_id + "\n");
  if (args[1] === "-t") return Buffer.from("blob\n");
  return Buffer.alloc(0);
} }), /blob length differs/);
assert.deepEqual(individual, [["rev-parse", `${expectedCommit}:${boundary.path}`],
  ["cat-file", "-t", boundary.object_id], ["cat-file", "blob", boundary.object_id]]); checks++;
console.log(JSON.stringify({ marker: "EXACT_GIT_BLOB_BATCH_PASS", checks, subprocesses_for_two_blobs: calls, production_touched: false }));
