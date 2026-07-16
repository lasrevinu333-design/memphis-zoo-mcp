import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schedule = readFileSync(new URL('../src/schedule-api.js', import.meta.url), 'utf8');
const moxie = readFileSync(new URL('../src/routes/moxie.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260716150000_foundation_repair_v1.sql', import.meta.url), 'utf8');

const readiness = schedule.match(/async function assertScheduleReadyForRead[\s\S]*?\n  }\n  async function loadFullDayScheduleItems/)?.[0] || '';
assert.ok(readiness, 'read-only schedule readiness helper must exist');
assert.doesNotMatch(readiness, /runRpc|runWriteSql|sch_ensure_daily_schedule/);
assert.match(readiness, /schedule_not_ready/);

const windowRoute = schedule.match(/router\.get\("\/generation-window"[\s\S]*?\n  }\);/)?.[0] || '';
assert.ok(windowRoute, 'generation-window route must exist');
assert.doesNotMatch(windowRoute, /await maybeAutoGenerateWindow/);
assert.match(windowRoute, /trigger_auto_ignored/);
assert.match(schedule, /router\.post\("\/generate-range", requireSchedulePin/);

assert.doesNotMatch(moxie, /if\(r\.ok\)\{msg\.textContent="Password changed/);
assert.match(moxie, /d\?\.changed===true/);
assert.match(moxie, /there is no active password to rotate/);

assert.match(migration, /sch_ensure_schedule_window/);
assert.match(migration, /v_audit := public\.sch_audit_schedule_day\(v_date\)/);
assert.match(migration, /case when v_failed = 0 then 'completed' else 'failed' end/);
assert.doesNotMatch(migration, /then 'completed' else 'partial'/);
assert.match(migration, /mz-rolling-schedule-window-ready/);
assert.match(migration, /sch_audit_schedule_day_detail/);
assert.match(migration, /'readiness_status'/);
assert.match(migration, /truncate table public\.migration_log/);
assert.match(migration, /employee_planned_time_off[\s\S]*active = false/);

console.log('FOUNDATION_REPAIR_TESTS_PASS');
