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

assert.match(
  source,
  /import\s*\{\s*runReadOnlySql\s+as\s+runSupabaseReadOnlySql\s*\}\s*from\s*["']\.\/supabase\/read\.js["']/,
  'index backend must import the shared read-only SQL wrapper so WITH queries used by dashboard summary are wrapped before RPC execution'
);

assert.match(
  source,
  /async function runReadOnlySql\(sql\)\s*\{[\s\S]{0,240}runSupabaseReadOnlySql\(\{\s*client,\s*sql\s*\}\)[\s\S]{0,120}return result\.rows;/,
  'local runReadOnlySql helper must delegate to the shared wrapper and return rows so dashboard canary WITH queries do not fail with SELECT-only RPC guards'
);

assert.match(
  source,
  /app\.get\(["']\/dashboard-api\/work-session-alerts["'],\s*requireOpsManagerAuth[\s\S]{0,700}json\(\{\s*ok:\s*true,\s*data:\s*\[\]/,
  'dashboard work-session alert endpoint must exist and return an empty array fallback instead of 404ing when no alert producer is configured'
);

console.log('dashboard recent activity backend contract tests passed');
