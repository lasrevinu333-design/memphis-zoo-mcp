import {withRehearsalContext} from './rehearsal-shell-source.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sha = text => createHash('sha256').update(text).digest('hex');

// Reverse only the verified addition of the original transaction receipts.
export function beforeCurrent429CommitReceipts(source) {
  source = withRehearsalContext(source);
  if (sha(source) !== '84ac722914db32f2631fb8dbe1f441a23ac0e9a48a8a6d284249710a13c20485') return source;
  const previous = source.replace("          path: |\n            ${{ runner.temp }}/current429-apply-receipt.jsonl\n            ${{ runner.temp }}/current429-production-migration-commit-*.json",
    "          path: ${{ runner.temp }}/current429-apply-receipt.jsonl");
  assert.equal(sha(previous), '955f0a738adce02b5c342eb50e0c7a6cc808091c7f3a074a854c7aae57c2ceb0');
  return previous;
}
