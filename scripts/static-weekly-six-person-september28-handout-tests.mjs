#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../config/custodial-six-person-handout-20260928.json', import.meta.url), 'utf8'));
const draft = JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260928.json', import.meta.url), 'utf8'));
assert.equal(source.schema, 'custodial.six-person-owner-handout.v1');
assert.equal(source.source_pdf_sha256, '925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa');
assert.equal(source.pages, 30);
assert.deepEqual(Object.keys(source.days).sort(), ['0', '1', '2', '3', '4', '5', '6']);

const families = new Set([
  'AQUARIUM', 'BONOBOS_RESTROOMS', 'BREEZEWAY_RESTROOMS', 'CATHOUSE_CAFE_RESTROOMS',
  'CAT_COUNTRY', 'CHINA', 'COURTYARD_RESTROOMS', 'EAST_ADMIN', 'EAST_END_RESTROOMS',
  'EDUCATION', 'EVENT_CENTER', 'EXPO', 'HERPETARIUM', 'KOMODOS', 'MEMMEX_RESTROOMS',
  'NOCTURNAL', 'NORTH_WEST_PASSAGE', 'PRIMATE_CANYON', 'PRIMATE_PAVILLION', 'TETON',
  'TROPICAL_BIRDS', 'WEST_ADMIN', 'ZAMBEZI',
]);
const expectedStaff = {
  0: ['ALIJAH', 'GREGORY', 'KAILI', 'TAMMY'],
  1: ['ALIJAH', 'GREGORY', 'KAILI', 'KAREN', 'TAMMY'],
  2: ['GREGORY', 'KAILI', 'KAREN', 'KATHY', 'TAMMY'],
  3: ['GREGORY', 'KAILI', 'KAREN', 'KATHY', 'TAMMY'],
  4: ['ALIJAH', 'KAILI', 'KATHY', 'TAMMY'],
  5: ['ALIJAH', 'KAREN', 'KATHY'],
  6: ['ALIJAH', 'GREGORY', 'KAREN', 'KATHY'],
};
let pages = 0;
for (const [day, roster] of Object.entries(source.days)) {
  assert.deepEqual(Object.keys(roster).sort(), expectedStaff[day], `staff on ${day}`);
  for (const phase of ['morning', 'checks']) {
    const assigned = Object.values(roster).flatMap((row) => row[phase]);
    assert.equal(assigned.length, families.size, `${day}/${phase} must assign 23 areas`);
    assert.deepEqual(new Set(assigned), families, `${day}/${phase} must have no omission or duplicate`);
  }
  for (const [employee, row] of Object.entries(roster)) {
    pages += 1;
    assert.ok(Number.isInteger(row.page) && row.page >= 1 && row.page <= 30);
    assert.equal(row.shift.length, 2);
    assert.equal(row.lunch.length, 2);
    assert.ok(row.shift[0] < row.lunch[0] && row.lunch[0] < row.lunch[1] && row.lunch[1] < row.shift[1], `${day}/${employee} lunch inside shift`);
    assert.ok(!row.morning.some((area) => area.includes('GIFT_SHOP')));
    assert.ok(!row.checks.some((area) => area.includes('GIFT_SHOP')));
    if (employee === 'ALIJAH') assert.ok(!row.morning.includes('HERPETARIUM') && !row.checks.includes('HERPETARIUM'));
  }
}
assert.equal(pages, 30);
assert.deepEqual(source.days['3'].KAREN.shift, ['05:00', '14:00']);
assert.deepEqual(source.days['3'].KAREN.lunch, ['09:30', '10:30']);
assert.deepEqual(source.days['3'].KAREN.morning, [
  'CATHOUSE_CAFE_RESTROOMS', 'MEMMEX_RESTROOMS', 'ZAMBEZI', 'CAT_COUNTRY', 'HERPETARIUM', 'NOCTURNAL',
]);
for (const day of ['2', '3', '4', '5', '6']) for (const phase of ['morning', 'checks']) {
  const route = new Set(source.days[day].KATHY[phase]);
  assert.deepEqual(route, new Set(['EAST_ADMIN', 'WEST_ADMIN', 'COURTYARD_RESTROOMS', 'BREEZEWAY_RESTROOMS']));
}
assert.match(source.unresolved_tuesday_duty, /employee restrooms inside Elephant Trunk Gift Shop/);
assert.equal(draft.schema, 'custodial.owner-corrected-recurring-schedule.v2');
assert.equal(draft.sourceHandout.pdfSha256, source.source_pdf_sha256);
assert.equal(draft.effectiveDate, '2026-09-28');
assert.deepEqual(draft.retiredAreaFamilies, [
  'BAMBOO_SPRINGS_GIFT_SHOP', 'TRADING_POST_GIFT_SHOP',
  'ELEPHANT_TRUNK_GIFT_SHOP', 'ELEPHANT_TRUNK_RESTROOMS',
]);
assert.deepEqual(draft.slots.TAMMY.workDays,[1,2,3,4,5],
 'direct September 30 owner correction supersedes stale Sunday-to-Thursday handout');
assert.deepEqual(draft.sourceHandout.ownerWorkweekCorrection?.affectedDays,[0,5]);
assert.ok(draft.slots.KATHY.normalAssignmentFamilies.includes('ELEPHANT_TRUNK_RESTROOMS'));
for (const [day, roster] of Object.entries(source.days)) {
  if(day==='0'||day==='5')continue;
  for (const [employee, row] of Object.entries(roster)) {
    assert.deepEqual(new Set(draft.overrides[day].morning[employee]), new Set(row.morning), `${day}/${employee} morning`);
    assert.deepEqual(new Set(draft.overrides[day].equalized[employee]), new Set(row.checks), `${day}/${employee} checks`);
    assert.deepEqual(draft.slots[employee].shift, row.shift, `${day}/${employee} shift`);
    assert.deepEqual(draft.slots[employee].lunchByDay[day], row.lunch, `${day}/${employee} lunch`);
    assert.ok(draft.slots[employee].workDays.includes(Number(day)), `${day}/${employee} workday`);
  }
}
for (const employee of Object.keys(expectedStaff).flatMap((day) => expectedStaff[day])) {
  if(employee==='TAMMY')continue;
  const scheduledDays = Object.entries(source.days).filter(([, roster]) => roster[employee]).map(([day]) => Number(day));
  assert.deepEqual(draft.slots[employee].workDays, scheduledDays, `${employee} exact workdays`);
}
for(const day of [0,5])for(const phase of ['morning','equalized']){
 const rows=Object.values(draft.overrides[String(day)][phase]).flat();
 assert.equal(rows.length,23,`${day}/${phase} all areas retained`);
 assert.equal(new Set(rows).size,23,`${day}/${phase} each area has one owner`);
 assert.deepEqual(new Set(rows),families,`${day}/${phase} exact physical area set retained`);
}
console.log(JSON.stringify({ ok: true, pages, days: 7, completeUniqueAreaFamiliesPerPhase: 23,
  ownerCorrectedSundayFriday:true,unchangedDaysMatchHistoricalHandout:true,sourcePdfSha256: source.source_pdf_sha256 }));
