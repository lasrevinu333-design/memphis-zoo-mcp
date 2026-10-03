import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadSixPersonAbsenceSource} from './six-person-absence-source.mjs';
import {loadFullNineV6Source} from './full-nine-v6-source.mjs';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-program.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const CURRENT_MANAGER_MIGRATION_MANIFEST='5d529ec0c3edac509ae4fc77817600b9024366fd43a3963f2551a5835523fa99';
export function assertCurrentManagerMigrationSet(root=new URL('../../',import.meta.url)) {
  const directory=new URL('supabase/migrations/',root);
  const manifest=readdirSync(directory).filter(file=>file.endsWith('.sql')).sort()
    .map(file=>({file,sha256:sha(readFileSync(new URL(file,directory)))}));
  assert.equal(manifest.length,216,'current manager fixture requires all216 migrations');
  assert.equal(sha(JSON.stringify(manifest)),CURRENT_MANAGER_MIGRATION_MANIFEST,'exact216 migration bytes changed');
  return manifest;
}

// Synthetic setup adapter only. This does not register a production source,
// reinterpret the approved nine-person pattern, or optimize any assignment.
export function loadCurrentManagerPublicationFixture() {
  const current=loadSixPersonAbsenceSource(),original=loadFullNineV6Source();
  const configBytes=readFileSync(new URL('../../config/custodial-six-person-static-20261005.json',import.meta.url));
  assert.equal(sha(configBytes),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
  const config=JSON.parse(configBytes),source=current.compilerInput,week=source.serviceDate;
  assert.equal(week,'2026-10-05');
  assert.equal(source.version.assignments.length,323);
  assert.equal(original.compilerInput.version.assignments.length,314);
  assert.equal(postgresJsonbContentDigest(source),current.sourceDigest);
  const rosterSlots=Object.values(config.slots).map(slot=>{
    const physical=source.slots.find(s=>s.id===slot.slotId);
    assert.ok(physical&&!physical.contractorCapacity,'exact stable employee position required');
    const currentPeople=physical.incumbencies.filter(p=>p.effectiveStart<=week&&(!p.effectiveEnd||week<p.effectiveEnd));
    assert.equal(currentPeople.length,slot.vacancy===true?0:1,'current-only incumbency required');
    if(slot.vacancy!==true)assert.equal(currentPeople[0].personId,slot.personId);
    const availability=source.version.slotAvailability.filter(a=>a.slotId===slot.slotId);
    assert.deepEqual(availability.map(a=>a.dayOfWeek).sort(),[...slot.workDays].sort(),'owner workdays cannot change');
    for(const row of availability) {
      assert.equal(row.status,slot.vacancy===true?'vacant_unfilled':'working');
      assert.deepEqual([row.shift.start,row.shift.end],slot.shift,'owner shift cannot change');
    }
    return {slotId:slot.slotId,personId:slot.vacancy===true?null:slot.personId,days:[...slot.workDays]};
  });
  assert.equal(rosterSlots.length,9);
  assert.equal(rosterSlots.filter(s=>s.personId!==null).length,6);
  assert.deepEqual([...source.version.vacantSlotIds].sort(),rosterSlots.filter(s=>s.personId===null).map(s=>s.slotId).sort());
  const packet={schema:'custodial.current-manager-publication-fixture.v1',
    sourceId:current.sourceId,sourceDigest:current.sourceDigest,compilerInput:source,rosterSlots,
    expectedDerivedRows:494,expectedLunchLoans:30,
    original:{sourceId:original.sourceId,sourceDigest:original.sourceDigest,compilerInput:original.compilerInput,
      originalPacketSha256:original.provenance.originalPacketSha256,registration:false},
    classification:'SYNTHETIC_CURRENT323_PLUS_IMMUTABLE_ORIGINAL314_NOT_PRODUCTION_REGISTRATION'};
  return {packet,bytes:Buffer.from(JSON.stringify(packet)+'\n'),config};
}
