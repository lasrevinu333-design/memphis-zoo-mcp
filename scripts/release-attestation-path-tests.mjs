#!/usr/bin/env node
// Runs the actual release helper in a disposable Git repository with a newly
// generated test key. Never reads the production signer or signs a real release.
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'custodial-signer-test-'));
const repo = join(dir, 'synthetic-repository');
const results = [];
const execute = (command, args) => spawnSync(command, args, {
  cwd: repo, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
});
const git = (...args) => {
  const result = execute('git', args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  mkdirSync(repo);
  for (const name of ['scripts', 'src', 'release', 'supabase/canonical']) mkdirSync(join(repo, name), { recursive: true });
  for (const name of ['scripts/create-release-attestation.mjs', 'src/release-contract.js']) copyFileSync(join(source, name), join(repo, name));
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(repo, 'release/schema-alignment-input.json'), JSON.stringify({
    release_id: 'release-synthetic-signer-test', frontend_commit_sha: '1'.repeat(40),
  }));
  writeFileSync(join(repo, 'supabase/canonical/schema-fingerprint.txt'), '2'.repeat(64) + '\n');
  writeFileSync(join(repo, 'release/integrated-backend-authority-evidence.json'), '{"synthetic":true}\n');
  // Pin ONLY the disposable copied contract to its generated synthetic key.
  // The real source-pinned production contract is never modified or weakened.
  const key = join(dir, 'synthetic-only.pem');
  const { privateKey,publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(key, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const copiedContract=join(repo,'src/release-contract.js');
  let contract=readFileSync(copiedContract,'utf8');
  const anchor=/export const RELEASE_ATTESTATION_TRUST_ROOT = Object\.freeze\(\{[\s\S]*?\}\);/;
  assert.equal((contract.match(new RegExp(anchor.source,'g'))||[]).length,1);
  contract=contract.replace(anchor,`export const RELEASE_ATTESTATION_TRUST_ROOT = Object.freeze(${JSON.stringify({keyId:'synthetic-test-only',publicKeySpkiSha256:createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex')})});`);
  writeFileSync(copiedContract,contract);
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=Synthetic Signer Test', '-c', 'user.email=fixture@example.invalid',
    '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Synthetic test input');
  const invoke = (keyPath, output, keyId = 'synthetic-test-only') => execute(process.execPath, [
    'scripts/create-release-attestation.mjs', '--private-key', keyPath,
    '--output', output, '--key-id', keyId,
  ]);
  const positive = join(dir, 'positive.json');
  let result = invoke(key, positive);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(positive, 'utf8')).release_id, 'release-synthetic-signer-test');
  assert.doesNotMatch(result.stdout + result.stderr, /BEGIN PRIVATE KEY/);
  results.push({ name: 'regular private fixture key signs and verifies synthetic release', pass: true });

  const cases = [{name:'reject another key identity even with matching signing material',key,keyId:'wrong-synthetic-key',error:/source-pinned trust root/}];
  const link = join(dir, 'linked-test-key.pem'); symlinkSync(key, link);
  cases.push({ name: 'reject symlink before resolving its target', key: link, error: /must not be a symlink/ });
  const brokenLink = join(dir, 'broken-test-key.pem'); symlinkSync(join(dir, 'missing-key.pem'), brokenLink);
  cases.push({ name: 'reject broken symlink as a symlink', key: brokenLink, error: /must not be a symlink/ });
  const directoryKey = join(dir, 'directory-not-key'); mkdirSync(directoryKey);
  cases.push({ name: 'reject directory instead of key file', key: directoryKey, error: /must be a regular file/ });
  const readableKey = join(dir, 'group-readable-test-key.pem');
  writeFileSync(readableKey, readFileSync(key), { mode: 0o640 });
  chmodSync(readableKey, 0o640); // Make the permission fixture independent of process umask.
  cases.push({ name: 'reject group-readable fixture key', key: readableKey, error: /must not be accessible to group/ });
  cases.push({ name: 'reject output inside repository', key, output: join(repo, 'bad-output.json'), error: /must be written outside/ });
  cases.push({ name: 'reject malformed key identity', key, keyId: '!', error: /AssertionError/ });
  const inRepoKey = join(repo, 'inside-test-key.pem');
  writeFileSync(inRepoKey, readFileSync(key), { mode: 0o600 });
  cases.push({ name: 'reject key inside repository', key: inRepoKey, error: /must remain outside/ });
  // Only this path test needs an untracked key inside the synthetic repository.
  for (const [index, test] of cases.entries()) {
    if (test.key !== inRepoKey && existsSync(inRepoKey)) rmSync(inRepoKey);
    if (test.key === inRepoKey && !existsSync(inRepoKey)) writeFileSync(inRepoKey, readFileSync(key), { mode: 0o600 });
    const output = test.output || join(dir, `negative-${index}.json`);
    result = invoke(test.key, output, test.keyId);
    const pass = result.status !== 0 && test.error.test(result.stderr) && !existsSync(output);
    results.push({ name: test.name, pass, actual_exit: result.status });
  }
  if (existsSync(inRepoKey)) rmSync(inRepoKey);
  const collision = join(dir, 'already-exists.json'); writeFileSync(collision, 'preserve-existing-artifact');
  result = invoke(key, collision);
  results.push({ name: 'never overwrite an existing artifact', pass: result.status !== 0 &&
    readFileSync(collision, 'utf8') === 'preserve-existing-artifact' });
  const failed = results.filter(row => !row.pass);
  console.log(JSON.stringify({ result: failed.length ? 'RELEASE_SIGNER_PATH_TESTS_FAIL' : 'RELEASE_SIGNER_PATH_TESTS_PASS',
    cases: results.length, passed: results.length - failed.length, failed: failed.length, results,
    source_sha256: createHash('sha256').update(readFileSync(join(source, 'scripts/create-release-attestation.mjs'))).digest('hex'),
    production_key_accessed: false, production_attestation_created: false,
    synthetic_contract_trust_root_only:true,production_contract_sha256:createHash('sha256').update(readFileSync(join(source,'src/release-contract.js'))).digest('hex'),
    scope: 'Exact helper with synthetic Git input and disposable test keys; not production signing authorization.' }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} finally { rmSync(dir, { recursive: true, force: true }); }
