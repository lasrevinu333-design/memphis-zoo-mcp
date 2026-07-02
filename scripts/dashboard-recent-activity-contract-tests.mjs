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
  /app\.get\(["']\/dashboard-api\/work-session-alerts["'],\s*requireOpsManagerAuth[\s\S]{0,700}json\(\{\s*ok:\s*true,\s*data:\s*\[\]/,
  'dashboard work-session alert endpoint must exist and return an empty array fallback instead of 404ing when no alert producer is configured'
);

console.log('dashboard backend contract tests passed');
