import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scheduleApi = readFileSync(resolve('src/schedule-api.js'), 'utf8');
const migrationPath = resolve('supabase/migrations/20260715062000_schedule_source_type_contract.sql');
const migration = readFileSync(
  existsSync(migrationPath)
    ? migrationPath
    : resolve('supabase/legacy_migrations/20260715062000_schedule_source_type_contract.sql'),
  'utf8'
);

assert.match(
  scheduleApi,
  /from public\.sch_get_daily_schedule_with_purpose\('\$\{esc\(serviceDate\)\}'::date\) x/
);
assert.match(scheduleApi, /\bx\.source_type\b/);

assert.match(
  migration,
  /returns table\([\s\S]*\bsource_type text[\s\S]*\)/i,
  'The SQL function contract must expose a named source_type column.'
);
assert.match(
  migration,
  /nullif\(btrim\(dsa\.source_type\), ''\)/i,
  'Generated daily assignments must preserve their authoritative source_type.'
);
assert.match(
  migration,
  /case when ct\.id is not null then 'coverage_template' else 'schedule' end/i,
  'Static fallback rows must receive a deterministic source_type.'
);
assert.match(
  migration,
  /revoke all on function public\.sch_get_daily_schedule_with_purpose\(date\)[\s\S]*from public, anon, authenticated/i
);
assert.match(
  migration,
  /grant execute on function public\.sch_get_daily_schedule_with_purpose\(date\)[\s\S]*to service_role/i
);

console.log('SCHEDULE_SOURCE_TYPE_CONTRACT_TESTS_PASS');
