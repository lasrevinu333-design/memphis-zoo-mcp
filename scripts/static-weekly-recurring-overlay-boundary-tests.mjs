#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptRegisteredRecurringSource } from '../src/static-weekly-recurring-staffing-adaptation.js';
import { postgresJsonbContentDigest } from '../src/static-weekly-schedule-compiler.js';

const packetPath = process.env.STATIC_WEEKLY_TEST_SIX_PACKET;
assert.ok(packetPath, 'exact frozen six-person source packet required');
const six = JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260926.json', import.meta.url)));
const full = JSON.parse(readFileSync(new URL('../config/custodial-recurring-schedule-20260924.json', import.meta.url)));
const sixSource = JSON.parse(readFileSync(packetPath)).compilerInput;
const fullSource = JSON.parse(readFileSync(full.basePacket.path)).compilerInput;
let checks = 0;
for (const staffed of [6, 9]) {
  const config = structuredClone(staffed === 6 ? six : full);
  config.effectiveDate = six.effectiveDate;
  config.slots = structuredClone(six.slots);
  if (staffed === 9) for (const [index, key] of ['OPTION1', 'OPTION2', 'OPTION4'].entries()) {
    Object.assign(config.slots[key], { vacancy: false,
      personId: `12345678-1234-4234-8234-123456789ab${index + 1}`,
      name: `Synthetic Hire ${index + 1}` });
  }
  const source = structuredClone(staffed === 6 ? sixSource : fullSource);
  for (const slot of Object.values(config.slots)) {
    source.slots.find(row => row.id === slot.slotId).incumbencies = slot.vacancy ? [] : [{
      personId: slot.personId, displayName: slot.name, effectiveStart: config.effectiveDate, effectiveEnd: null,
    }];
  }
  const adapt = input => adaptRegisteredRecurringSource({ registeredSource: input,
    fullNineSource: staffed === 9 ? input : null, patternConfig: config }).compilerInput;
  const baseline = adapt(source);
  for (const type of ['daily_absence', 'partial_absence', 'pto', 'cover_all', 'lunch', 'reverse']) {
    const overlay = structuredClone(source);
    overlay.exceptions = [{ id: `synthetic-${type}`, type, serviceDate: config.effectiveDate,
      baseVersionId: source.version.id, publicationId: '11111111-1111-4111-8111-111111111111',
      actorId: '22222222-2222-4222-8222-222222222222', reason: 'Synthetic dated overlay',
      idempotencyKey: `synthetic-${type}`, expectedRevision: 42,
      payload: { slotId: config.slots.KAREN.slotId } }];
    overlay.version.namedAbsentSlotIds = [config.slots.KAREN.slotId];
    const before = structuredClone(overlay);
    const candidate = adapt(overlay);
    assert.deepEqual(candidate.exceptions, [], `${staffed}/${type}: dated overlay cannot enter recurring candidate`); checks++;
    assert.deepEqual(candidate.version.namedAbsentSlotIds, []); checks++;
    assert.equal(postgresJsonbContentDigest(candidate), postgresJsonbContentDigest(baseline),
      `${staffed}/${type}: dated overlay cannot alter recurring source identity`); checks++;
    assert.deepEqual(overlay, before, 'accepted dated history is not edited or deleted'); checks++;
  }
  assert.deepEqual(baseline.proximity, adapt(source).proximity); checks++;
  assert.deepEqual(baseline.version.slotAvailability.map(row => row.restrictions),
    source.version.slotAvailability.map(row => row.restrictions), 'recurring restrictions retained'); checks++;
}
console.log(JSON.stringify({ status: 'PASS', checks, staffingCounts: [6, 9],
  sourceOnly: true, productionWritten: false }));
