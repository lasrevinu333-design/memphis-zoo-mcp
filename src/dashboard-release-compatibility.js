import assert from 'node:assert/strict';

// A matching release manifest cannot establish that the application SQL reader
// can execute this release's real Dashboard query. Consume its existing canary.
export function assertDashboardReleaseCompatibility({ canary, health, releaseId, appVersion, backendCommitSha }) {
  assert.ok(typeof releaseId === 'string' && releaseId.length > 0, 'Expected release identity is missing');
  assert.ok(typeof appVersion === 'string' && appVersion.length > 0, 'Backend manifest app version is missing');
  assert.match(backendCommitSha ?? '', /^[a-f0-9]{40}$/, 'Expected backend commit is missing');
  assert.equal(canary?.backend_commit_sha, backendCommitSha, 'Dashboard canary is from another backend commit');
  assert.equal(health?.backend_commit_sha, backendCommitSha, 'Dashboard reader health is from another backend commit');
  assert.equal(health?.read_authority_ready, true, 'Dashboard requires the dedicated restricted SQL reader');
  assert.equal(canary?.release_id, releaseId, 'Dashboard canary is from another release');
  assert.equal(canary?.version, appVersion, 'Dashboard canary version differs from deployed backend');
  assert.equal(canary?.ok, true, 'Dashboard execution canary failed');
  assert.equal(canary?.failure_count, 0, 'Dashboard execution canary has failures');
  assert.deepEqual(canary?.failures, [], 'Dashboard execution canary failure list is not empty');
  for (const name of ['dashboard_summary', 'open_session_consistency', 'ticket_count_consistency']) {
    assert.equal(canary?.checks?.[name]?.ok, true, `Dashboard execution proof missing: ${name}`);
  }
  assert.ok(Number.isSafeInteger(canary.checks.dashboard_summary.restrooms_count)
    && canary.checks.dashboard_summary.restrooms_count > 0, 'Dashboard restroom canary missing');
  assert.ok(Number.isSafeInteger(canary.checks.dashboard_summary.exhibits_count)
    && canary.checks.dashboard_summary.exhibits_count > 0, 'Dashboard exhibit canary missing');
  return true;
}
