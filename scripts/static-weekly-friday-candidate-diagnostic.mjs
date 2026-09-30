#!/usr/bin/env node
// Diagnostic only: evaluate a bounded Friday redistribution without modifying
// the handout source, emitting a publication, or changing a release gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNormalOwnerEligibility, validateOwnerEligibilityConfig } from '../src/static-weekly-owner-eligibility.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const source = read('../config/custodial-six-person-static-20260928.json');
const base = JSON.parse(readFileSync(source.basePacket.path, 'utf8')).compilerInput;
const draft = JSON.parse(JSON.stringify(source));
validateOwnerEligibilityConfig(source);
assert.equal(source.sourceHandout.pdfSha256, '925751c37e454e0fadb9d88eb57a46dd6a47c1ffe19deadf85189ad9bba2f0aa');

const friday = draft.overrides['5'];
const move = ['CATHOUSE_CAFE_RESTROOMS', 'EXPO'];
const requiredKathy = ['BREEZEWAY_RESTROOMS', 'COURTYARD_RESTROOMS', 'EAST_ADMIN', 'WEST_ADMIN'];
const people = ['KAREN', 'KATHY', 'ALIJAH'];
const weights = source.weights;
const minutes = (clock) => { const [h,m] = clock.split(':').map(Number); return 60*h+m; };
const overlap = (a,b,c,d) => Math.max(0, Math.min(b,d)-Math.max(a,c));
const capacity = (owner, phase) => {
  const slot = source.slots[owner];
  const start = phase === 'morning' ? minutes(slot.shift[0]) : minutes('09:45');
  const end = phase === 'morning' ? minutes('09:45') : minutes(slot.shift[1]);
  const lunch = slot.lunchByDay['5'];
  return (end-start-overlap(start,end,minutes(lunch[0]),minutes(lunch[1])))/60;
};
const load = (overrides, phase, owner) => overrides[phase][owner]
  .reduce((sum, family) => sum + weights[family], 0);
const owners = (overrides, phase) => {
  const families = Object.values(overrides[phase]).flat();
  assert.equal(families.length, 23, `${phase}: 23 families`);
  assert.equal(new Set(families).size, 23, `${phase}: no duplicate owner`);
  return [...families].sort();
};
const before = {};
for (const phase of ['morning', 'equalized']) {
  before[phase] = Object.fromEntries(people.map((owner) => [owner, load(friday,phase,owner)]));
  const originalFamilies = owners(friday, phase);
  for (const family of move) {
    assert.ok(friday[phase].KAREN.includes(family), `${phase}: Karen initially owns ${family}`);
    friday[phase].KAREN = friday[phase].KAREN.filter((item) => item !== family);
    friday[phase].KATHY.push(family);
  }
  assert.deepEqual(owners(friday, phase), originalFamilies, `${phase}: coverage unchanged`);
  assert.ok(requiredKathy.every((family) => friday[phase].KATHY.includes(family)), `${phase}: Kathy core retained`);
  assert.ok(!friday[phase].ALIJAH.includes('HERPETARIUM'), `${phase}: Alijah restriction retained`);
}

// A normal geography expansion is required; the existing configuration does
// not silently authorize these areas for Kathy.
for (const family of move) {
  assert.ok(!source.slots.KATHY.normalAssignmentFamilies.includes(family));
  assert.ok(!(source.slots.KATHY.hardForbiddenFamilies || []).includes(family));
  draft.slots.KATHY.normalAssignmentFamilies.push(family);
  assertNormalOwnerEligibility({key:'KATHY',...draft.slots.KATHY},family);
}
for (const owner of people) {
  for (const field of ['workDays','shift','lunchByDay','personId'])
    assert.deepEqual(draft.slots[owner][field], source.slots[owner][field], `${owner} ${field} unchanged`);
}
for (const day of Object.keys(source.overrides).filter((day) => day !== '5'))
  assert.deepEqual(draft.overrides[day], source.overrides[day], `${day}: no other day changed`);

const rows = base.version.assignments.filter((row) => row.dayOfWeek === 5 && row.window.start === '09:45');
const locationIds = new Map();
for (const row of rows) {
  const ids = locationIds.get(row.locationCodeSnapshot) || new Set();
  for (const location of row.includedLocations || []) ids.add(location.locationId);
  locationIds.set(row.locationCodeSnapshot, ids);
}
const edge = new Map(base.proximity.filter((row) => row.verified === true)
  .map((row) => [`${row.fromLocationId}:${row.toLocationId}`,row.minutes]));
const proximity = {};
for (const family of move) {
  let closest = Infinity;
  for (const core of requiredKathy) for (const a of locationIds.get(core) || [])
    for (const b of locationIds.get(family) || [])
      closest = Math.min(closest, edge.get(`${a}:${b}`) ?? Infinity, edge.get(`${b}:${a}`) ?? Infinity);
  assert.ok(Number.isFinite(closest) && closest <= 4, `${family}: verified proximity to Kathy core`);
  proximity[family] = closest;
}

const after = Object.fromEntries(['morning','equalized'].map((phase) => [phase,
  Object.fromEntries(people.map((owner) => [owner,load(friday,phase,owner)]))]));
const rates = (loads, phase) => people.map((owner) => loads[owner]/capacity(owner,phase));
const spread = (values) => Math.max(...values)-Math.min(...values);
assert.ok(spread(rates(after.equalized,'equalized')) < spread(rates(before.equalized,'equalized')),
  'Friday post-09:45 capacity-adjusted spread must improve');
console.log(JSON.stringify({ok:true,classification:'diagnostic_candidate_only_not_publishable',move,
  verifiedProximityMinutes:proximity,before,after,
  equalizedRatesBefore:rates(before.equalized,'equalized'),
  equalizedRatesAfter:rates(after.equalized,'equalized'),
  handoutSourceUnchanged:true,normalGeographyExpansionRequired:true},null,2));
