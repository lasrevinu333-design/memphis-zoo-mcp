// Static-test view of the shell executed in the original rehearsal step.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const digest = value => createHash('sha256').update(value).digest('hex');
const include = '          source scripts/prepare-backup-rehearsal-context.sh\n';

export function withRehearsalContext(workflow) {
  if (!workflow.includes(include)) return workflow;
  if (digest(workflow) !== 'b85c0df99b6b402585d4ed7228030a53d12ddac4314a876104fa51662d4cdad3') return workflow;
  const shell = readFileSync(new URL('../prepare-backup-rehearsal-context.sh', import.meta.url), 'utf8');
  assert.equal(digest(shell), '5d65e38a7b3bd878d3d5c48a3c296115524ea8ea72f0f035eaf2172de0307c8e', 'registered backup verification and cleanup shell');
  assert.equal(workflow.split(include).length, 2);
  const expanded = workflow.replace(include, () => shell.replace(/^(.+)$/gm, '          $1'));
  assert.equal(digest(expanded), '84ac722914db32f2631fb8dbe1f441a23ac0e9a48a8a6d284249710a13c20485', 'identical complete shell and surrounding workflow');
  return expanded;
}
