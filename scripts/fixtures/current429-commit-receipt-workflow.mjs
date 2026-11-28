import {withRehearsalContext} from './rehearsal-shell-source.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sha = text => createHash('sha256').update(text).digest('hex');

// Reverse only the verified addition of the original transaction receipts.
export function beforeCurrent429CommitReceipts(source) {
  source = withRehearsalContext(source);
  // Historical checks use the exact predecessor of the CLI pagination repair.
  if (sha(source) === '2c766a3d081399c9fd53004838f083c9ed987663fc7e050f44d332dc19639d47') {
    source = source.replace('gh api --paginate "', 'gh api --paginate --slurp "')
      .replace('jq -ser --arg name "$art_name"', 'jq -er --arg name "$art_name"');
    assert.equal(sha(source), '84ac722914db32f2631fb8dbe1f441a23ac0e9a48a8a6d284249710a13c20485');
  }
  if (sha(source) !== '84ac722914db32f2631fb8dbe1f441a23ac0e9a48a8a6d284249710a13c20485') return source;
  const previous = source.replace("          path: |\n            ${{ runner.temp }}/current429-apply-receipt.jsonl\n            ${{ runner.temp }}/current429-production-migration-commit-*.json",
    "          path: ${{ runner.temp }}/current429-apply-receipt.jsonl");
  assert.equal(sha(previous), '955f0a738adce02b5c342eb50e0c7a6cc808091c7f3a074a854c7aae57c2ceb0');
  return previous;
}
