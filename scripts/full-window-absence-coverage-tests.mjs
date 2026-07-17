import assert from 'node:assert/strict';
import fs from 'node:fs';

const current = new URL('../supabase/migrations/20260714235500_full_window_absence_coverage.sql', import.meta.url);
const legacy = new URL('../supabase/legacy_migrations/20260714235500_full_window_absence_coverage.sql', import.meta.url);
const migration = fs.readFileSync(fs.existsSync(current) ? current : legacy, 'utf8');

assert.match(migration, /dwr\.shift_start <= p_coverage_start/);
assert.match(migration, /dwr\.shift_end >= p_coverage_end/);
assert.match(migration, /p_coverage_start as overlap_start/);
assert.match(migration, /p_coverage_end as overlap_end/);
assert.match(migration, /Full-window shift coverage verified/);
assert.doesNotMatch(migration, /dwr\.shift_start < p_coverage_end\s+and dwr\.shift_end > p_coverage_start/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'full_window_shift_start_required',
    'full_window_shift_end_required',
    'absence_reassignment_never_silently_truncates_coverage',
  ],
}, null, 2));
