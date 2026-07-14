import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /from\s+public\.v_recent_scan_activity/i,
  'public dashboard summary must not query v_recent_scan_activity'
);

assert.doesNotMatch(
  source,
  /recent_activity\s*:/,
  'public dashboard summary response must not expose a recent_activity array'
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
  /app\.get\(["']\/dashboard-api\/work-session-alerts["'],\s*requireOpsManagerAuth[\s\S]{0,2200}where se\.event_type = 'work_position_check'[\s\S]{0,1600}res\.status\(200\)\.json\(\{\s*ok:\s*true,\s*data:\s*rows \|\| \[\]/,
  'dashboard work-session alerts must return authoritative GPS evidence for open sessions instead of a permanent empty fallback'
);

console.log('dashboard backend contract tests passed');
