import assert from 'node:assert/strict';

// Positive contract consumers follow the one release-pair authority, never a
// second historical commit literal. Runtime signed admission stays unchanged.
export function assertExactFrontendPair(manifest, input) {
  assert.match(input.frontend_commit_sha || '', /^[0-9a-f]{40}$/,
    'release authority must name one exact frontend commit');
  assert.equal(input.frontend_commit_state, 'final_pair_bound');
  assert.equal(manifest.frontend_commit_sha, input.frontend_commit_sha,
    'frontend manifest must equal the exact release-pair authority');
  assert.equal(manifest.frontend_commit_state, input.frontend_commit_state);
}
