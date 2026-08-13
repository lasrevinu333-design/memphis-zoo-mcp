#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const destination = resolve(String(process.argv[2] || ""));
assert.ok(process.argv.length === 3 && isAbsolute(destination),
  "usage: create-release-signing-key.mjs /absolute/external/private-key.pem");
assert.equal(destination.includes("/memphis-zoo-mcp"), false, "release private key must remain outside a project worktree");
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateFd = openSync(destination, "wx", 0o600);
try { writeFileSync(privateFd, privateKey.export({ type: "pkcs8", format: "pem" })); } finally { closeSync(privateFd); }
const publicPath = `${destination}.pub`;
const publicFd = openSync(publicPath, "wx", 0o444);
try { writeFileSync(publicFd, publicKey.export({ type: "spki", format: "pem" })); } finally { closeSync(publicFd); }
console.log(JSON.stringify({ ok: true, private_key_path: destination, public_key_path: publicPath }, null, 2));
