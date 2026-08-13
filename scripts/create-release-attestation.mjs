#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { chmodSync, closeSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertExactReleaseAttestation, releaseAttestationPayload } from "../src/release-contract.js";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, values) => {
  if (value.startsWith("--")) rows.push([value.slice(2), values[index + 1]]);
  return rows;
}, []));
for (const name of ["private-key", "output", "key-id"]) assert.ok(args[name], `--${name} is required`);
for (const name of ["private-key", "output"]) assert.ok(isAbsolute(args[name]), `--${name} must be absolute`);
const outside = (path) => { const value = relative(root, realpathSync(resolve(path))); return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value); };
const privatePath = realpathSync(args["private-key"]);
const privateEntry = lstatSync(privatePath);
assert.equal(privateEntry.isSymbolicLink(), false, "release private key must not be a symlink");
assert.equal(privateEntry.isFile(), true, "release private key must be a regular file");
assert.equal(privateEntry.mode & 0o077, 0, "release private key must not be accessible to group or other users");
assert.equal(outside(privatePath), true, "release private key must remain outside the worktree");
const outputParent = realpathSync(resolve(args.output, ".."));
assert.equal(outside(outputParent), true, "release attestation must be written outside the worktree");
assert.match(args["key-id"], /^[a-z0-9][a-z0-9._-]{2,63}$/);
const git = (gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trim();
assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all"]), "", "release attestation requires a clean worktree");
const commit = git(["rev-parse", "HEAD"]);
const tree = git(["rev-parse", "HEAD^{tree}"]);
const evidencePath = resolve(root, "release/integrated-backend-authority-evidence.json");
const evidenceBytes = readFileSync(evidencePath);
const input = JSON.parse(readFileSync(resolve(root, "release/schema-alignment-input.json"), "utf8"));
const fingerprint = readFileSync(resolve(root, "supabase/canonical/schema-fingerprint.txt"), "utf8").trim();
const privateKey = createPrivateKey(readFileSync(privatePath));
const publicKey = createPublicKey(privateKey);
const attestation = {
  artifact: "memphis-zoo-integrated-release-attestation.v2",
  release_id: input.release_id,
  backend_commit_sha: commit,
  backend_tree_sha: tree,
  backend_evidence_blob_sha: git(["rev-parse", `${commit}:release/integrated-backend-authority-evidence.json`]),
  backend_evidence_sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
  frontend_commit_sha: input.frontend_commit_sha,
  schema_fingerprint: fingerprint,
  signature: { algorithm: "ed25519", key_id: args["key-id"], value_base64: "" },
};
attestation.signature.value_base64 = sign(null, Buffer.from(`${JSON.stringify(releaseAttestationPayload(attestation))}\n`), privateKey).toString("base64");
assertExactReleaseAttestation(attestation, { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) });
const fd = openSync(args.output, "wx", 0o400);
try { writeFileSync(fd, `${JSON.stringify(attestation, null, 2)}\n`); } finally { closeSync(fd); }
chmodSync(args.output, 0o444);
console.log(JSON.stringify({ ok: true, output: args.output, release_id: attestation.release_id,
  backend_commit_sha: commit, backend_tree_sha: tree, frontend_commit_sha: attestation.frontend_commit_sha,
  schema_fingerprint: fingerprint, key_id: args["key-id"] }, null, 2));
