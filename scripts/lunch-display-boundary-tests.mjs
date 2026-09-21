import assert from 'node:assert/strict';
import { consolidateScheduleItems } from '../src/schedule-display.js';

// Synthetic published rows: no live assignments, staff identities or clocks.
const lunch = (start, end, fields = {}) => ({
  location_group_id: 'fixture-group', group_code: 'FIXTURE',
  group_name: 'Fixture Restrooms', coverage_purpose: 'lunch_coverage',
  coverage_start: start, coverage_end: end, service_date: '2026-09-21',
  included_locations: ['Fixture Men', 'Fixture Women'], ...fields,
});
const results = [];
function check(name, body) {
  try { body(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
function display(rows) {
  const before = JSON.stringify(rows);
  const result = consolidateScheduleItems(rows);
  assert.equal(JSON.stringify(rows), before, 'Display must not rewrite source rows');
  return result.items.filter(item => item.section_key === 'lunch');
}
check('overlapping anonymous loans retain separate ending times', () => {
  const items = display([lunch('11:00', '12:00'), lunch('11:30', '12:30')]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.coverage_end), ['12:00 PM', '12:30 PM']);
});
check('adjacent loans are not merged into a two-hour loan', () => {
  assert.equal(display([lunch('11:00', '12:00'), lunch('12:00', '13:00')]).length, 2);
});
check('one occurrence with separate windows still retains each loan boundary', () => {
  const fields = { occurrence_id: 'fixture-occurrence' };
  assert.equal(display([lunch('11:00', '12:00', fields), lunch('11:30', '12:30', fields)]).length, 2);
});
check('the same occurrence and same normalized window can deduplicate', () => {
  const fields = { occurrence_id: 'fixture-occurrence' };
  const items = display([lunch('11:00', '12:00', fields), lunch('11:00 AM', '12:00 PM', fields)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].source_rows, 2);
});
check('distinct source segment identities never collapse into one loan', () => {
  assert.equal(display([lunch('11:00', '12:00', { segment_id: 'segment-a' }),
    lunch('11:00', '12:00', { segment_id: 'segment-b' })]).length, 2);
});
check('different service dates never merge the same recurring occurrence', () => {
  assert.equal(display([lunch('11:00', '12:00', { occurrence_id: 'repeat' }),
    lunch('11:00', '12:00', { occurrence_id: 'repeat', service_date: '2026-09-22' })]).length, 2);
});
check('rows without an identity are not assumed to be duplicate loans', () => {
  assert.equal(display([lunch('11:00', '12:00'), lunch('11:00', '12:00')]).length, 2);
});
check('separate source record identities are retained even without segment IDs', () => {
  assert.equal(display([lunch('11:00', '12:00', { id: 'source-a' }),
    lunch('11:00', '12:00', { id: 'source-b' })]).length, 2);
});
check('invalid windows cannot absorb a valid identified lunch', () => {
  const fields = { occurrence_id: 'same-occurrence' };
  assert.equal(display([lunch('11:00', '12:00', fields), lunch('invalid', '12:00', fields)]).length, 2);
});
check('regular assignment consolidation remains unchanged', () => {
  const regular = (start, end) => lunch(start, end, { coverage_purpose: 'area_owner' });
  const items = consolidateScheduleItems([regular('09:45', '14:00'), regular('10:00', '12:00')]).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].coverage_end, '02:00 PM');
  assert.equal(items[0].source_rows, 2);
});
check('restroom pairs remain together inside each independent lunch item', () => {
  const items = display([lunch('11:00', '12:00'), lunch('11:30', '12:30')]);
  assert.equal(items.length, 2);
  for (const item of items) assert.deepEqual(item.included_locations, ['Fixture Men', 'Fixture Women']);
});
check('a merged loan cannot turn an ended loan into a current one', () => {
  const items = display([lunch('11:00', '12:00', { is_current: false }),
    lunch('11:30', '12:30', { is_current: true })]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.is_current), [false, true]);
});
console.log(JSON.stringify({
  scope: 'Actual shared schedule-display module with synthetic lunch rows; not allocation or delivery',
  passed: results.filter(row => row.passed).length,
  failed: results.filter(row => !row.passed).length, results,
}, null, 2));
process.exitCode = results.some(row => !row.passed) ? 1 : 0;
