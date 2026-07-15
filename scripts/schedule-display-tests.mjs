import assert from 'node:assert/strict';
import { consolidateScheduleItems, summarizeScheduleAreas } from '../src/schedule-display.js';
import { summarizeEmployeeWorkStatus } from '../src/ai/memphis-ai-work-status.js';

const rows = [
  { location_group_id: 'g1', group_code: 'AQUARIUM', group_name: 'Aquarium', coverage_purpose: 'deep_clean', coverage_start: '06:00 AM', coverage_end: '09:45 AM', source_type: 'coverage_template', included_locations: ['Aquarium', 'Aquarium'], is_current: false },
  { location_group_id: 'g1', group_code: 'AQUARIUM', group_name: 'Aquarium', coverage_purpose: 'area_owner', coverage_start: '09:45 AM', coverage_end: '03:00 PM', source_type: 'coverage_template', included_locations: ['Aquarium'], is_current: true },
  { location_group_id: 'g1', group_code: 'AQUARIUM', group_name: 'Aquarium', coverage_purpose: 'area_owner', coverage_start: '09:45 AM', coverage_end: '10:00 AM', source_type: 'coverage_template:lunch_split_before', included_locations: ['Aquarium'], is_current: false },
  { location_group_id: 'g1', group_code: 'AQUARIUM', group_name: 'Aquarium', coverage_purpose: 'area_owner', coverage_start: '11:00 AM', coverage_end: '03:00 PM', source_type: 'coverage_template:lunch_split_after', included_locations: ['Aquarium'], is_current: false },
  { location_group_id: 'g2', group_code: 'CHINA', group_name: 'China', coverage_purpose: 'lunch_coverage', coverage_start: '12:00 PM', coverage_end: '01:00 PM', source_type: 'lunch_coverage', included_locations: ['China'], is_current: false },
];

const consolidated = consolidateScheduleItems(rows);
assert.equal(consolidated.sections.length, 3);
assert.deepEqual(consolidated.sections.map((section) => section.key), ['morning', 'rebalance', 'lunch']);
assert.equal(consolidated.items.filter((item) => item.name === 'Aquarium').length, 2, 'Aquarium should appear once in morning and once in rebalance, not once per raw segment');
const rebalanceAquarium = consolidated.items.find((item) => item.name === 'Aquarium' && item.section_key === 'rebalance');
assert.ok(rebalanceAquarium);
assert.equal(rebalanceAquarium.source_rows, 3);
assert.equal(rebalanceAquarium.time_ranges.length, 1, 'Overlapping lunch-split rows must collapse into one display window');
assert.equal(rebalanceAquarium.time_label, '09:45 AM – 03:00 PM');
assert.equal(rebalanceAquarium.is_current, true);
assert.deepEqual(rebalanceAquarium.included_locations, ['Aquarium']);

const areas = summarizeScheduleAreas(rows);
assert.equal(areas.find((section) => section.key === 'rebalance').items.length, 1);

const workStatus = summarizeEmployeeWorkStatus({
  ok: true,
  employee_name: 'Test Employee',
  service_date: '2026-07-15',
  weekday: 'Wednesday',
  work_status: 'working_assigned',
  shift: { shift_start: '06:00:00', shift_end: '15:00:00', lunch: '10:00-11:00' },
  assignments: rows.map((row) => ({ ...row, coverage_start: row.coverage_start.replace(/ AM| PM/g, ''), coverage_end: row.coverage_end.replace(/ AM| PM/g, '') })),
});
assert.equal((workStatus.match(/Aquarium/g) || []).length, 2, 'Memphis work-status answer should list a location once per meaningful schedule phase');
assert.match(workStatus, /Morning Full Clean Schedule/);
assert.match(workStatus, /Restroom Rebalance Schedule/);

console.log('SCHEDULE_DISPLAY_TESTS_PASS');
