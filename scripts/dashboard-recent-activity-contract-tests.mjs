import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

assert.match(
  source,
  /from\s+public\.v_recent_scan_activity/i,
  'dashboard summary must query v_recent_scan_activity so rapid same-location scans do not disappear behind the latest location row'
);

assert.match(
  source,
  /recent_activity\s*:/,
  'dashboard summary response must expose a recent_activity array'
);

assert.match(
  source,
  /employee_name[\s\S]{0,240}device_identifier[\s\S]{0,240}submitted_at/i,
  'recent activity payload must carry employee, device, and submitted timestamp fields for dashboard display'
);

console.log('dashboard recent activity backend contract tests passed');
