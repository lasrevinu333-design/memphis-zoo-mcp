// The report module also exports retained-fixture helpers. Importing that module
// intentionally does not run its CLI checks; this unconditional owning lane does.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const child = spawnSync(process.execPath, [fileURLToPath(new URL('./static-weekly-opening-coverage-report-tests.mjs', import.meta.url))], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  env: { PATH: dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'America/Chicago' },
});
if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
assert.equal(child.error, undefined, 'opening report CLI must launch and finish');
assert.equal(child.signal, null, 'opening report CLI cannot time out');
assert.equal(child.status, 0, 'opening report checks must pass, not merely import');
const receipts = child.stdout.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
assert.ok(receipts.some(receipt => receipt.status === 'PASS' && receipt.checks === 95
  && receipt.fixtureSha256 === 'e17235bac82589cb4b05693005e41bdb468084cdeb3b0ab5ec88e1026a662b19'),
  'the exact 95-check retained-source proof must actually execute');
