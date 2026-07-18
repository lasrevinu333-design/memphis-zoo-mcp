#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(String(process.argv[2] || "").trim());
if (!process.argv[2]) throw new Error("Backup directory is required.");

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Backup may not contain a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...walk(path));
    if (entry.isFile() && entry.name !== "SHA256SUMS") files.push(path);
  }
  return files.sort();
}

const files = walk(root);
for (const path of files) {
  const stat = lstatSync(path);
  if ((stat.mode & 0o077) !== 0) throw new Error(`Backup artifact is not private (mode ${stat.mode.toString(8)}): ${path}`);
  if (path.endsWith(".json")) JSON.parse(readFileSync(path, "utf8"));
}
const lines = files.map((path) => {
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  return `${hash}  ${relative(root, path)}`;
});
const output = join(root, "SHA256SUMS");
writeFileSync(output, `${lines.join("\n")}\n`, { mode: 0o600 });
chmodSync(output, 0o600);
console.log(JSON.stringify({ ok: true, directory: root, files: files.length }));
