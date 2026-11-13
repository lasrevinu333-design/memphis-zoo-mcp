// Source identity for the private recurring operation. This intentionally
// binds the complete backend src tree, not a regex approximation of imports:
// dynamic imports, the CP, the fused compiler, the DB adapter and every local
// helper are covered together with the exact package manifests.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "src/static-weekly-recurring-operation-source.js",
  "src/static-weekly-recurring-operation-owner.js",
  "src/static-weekly-recurring-operation-child.js",
  "src/static-weekly-recurring-operation-envelope.js",
  "src/static-weekly-recurring-operation-runner.js",
  "src/static-weekly-recurring-operation-handler.js",
  "src/restore-mutation-gate.js",
  "src/static-weekly-control-plane.js",
  "src/static-weekly-control-plane-runtime.js",
  "src/static-weekly-schedule-compiler-runtime.js",
  "src/static-weekly-schedule-compiler-worker.js",
  "src/static-weekly-schedule-solver.js",
  "src/static-weekly-schedule-database-adapter.js",
]);
const hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

function sourceFiles(root) {
  const paths = ["package.json", "package-lock.json"];
  for (const path of paths) {
    const stat = lstatSync(join(root, path));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Recurring operation manifest is not a regular file: ${path}`);
  }
  function visit(dir) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw new Error(`Recurring operation source symlink is not allowed: ${path}`);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) paths.push(path);
      else throw new Error(`Recurring operation source has a non-file entry: ${path}`);
    }
  }
  visit("src");
  return paths.sort();
}

export function recurringOperationSourceManifest({ root = DEFAULT_ROOT } = {}) {
  const exactRoot = resolve(root);
  const files = sourceFiles(exactRoot).map((path) => {
    const absolute = join(exactRoot, path);
    const bytes = readFileSync(absolute);
    return Object.freeze({ path, bytes: bytes.length, sha256: hex(bytes) });
  });
  const present = new Set(files.map((row) => row.path));
  for (const required of REQUIRED_PATHS) if (!present.has(required)) throw new Error(`Recurring operation required source is absent: ${required}`);
  const schema = "custodial.static-weekly-recurring-operation-source.v1";
  const digest = hex(Buffer.from(JSON.stringify({ schema, files }), "utf8"));
  return Object.freeze({ schema, digest, files: Object.freeze(files) });
}

export function assertMatchingRecurringOperationSource(expected, { root = DEFAULT_ROOT } = {}) {
  const current = recurringOperationSourceManifest({ root });
  if (expected?.schema !== current.schema || expected.digest !== current.digest
    || JSON.stringify(expected.files) !== JSON.stringify(current.files)) throw new Error("The complete recurring operation source and dependency lock changed.");
  return current;
}
