// Static-test view of the shell executed in the current rehearsal step.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const digest = value => createHash('sha256').update(value).digest('hex');
const include = '          source scripts/prepare-backup-rehearsal-context.sh\n';

export function withRehearsalContext(workflow) {
  if (!workflow.includes(include)) return workflow;
  if (digest(workflow) !== 'b85c0df99b6b402585d4ed7228030a53d12ddac4314a876104fa51662d4cdad3') return workflow;
  const shell = readFileSync(new URL('../prepare-backup-rehearsal-context.sh', import.meta.url), 'utf8');
  assert.equal(digest(shell), '5f92ccd7bea6d6f6262f40b36cfd2658ba4a050b28b07f29324e45af44b67d66', 'registered backup verification and cleanup shell');
  assert.equal(workflow.split(include).length, 2);
  const expanded = workflow.replace(include, () => shell.replace(/^(.+)$/gm, '          $1'));
  assert.equal(digest(expanded), '2c766a3d081399c9fd53004838f083c9ed987663fc7e050f44d332dc19639d47', 'complete current shell and surrounding workflow');
  return expanded;
}
