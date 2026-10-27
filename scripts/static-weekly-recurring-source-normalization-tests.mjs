import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adaptRegisteredRecurringSource} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {normalizeStaticWeeklyAuthority,postgresJsonbContentDigest as digest,admitStaticWeeklyRawInput} from '../src/static-weekly-schedule-program.js';
assert.ok(process.env.STATIC_WEEKLY_TEST_SIX_PACKET,'explicit frozen six-person source required');
const bytes=readFileSync(process.env.STATIC_WEEKLY_TEST_SIX_PACKET);
const packet=JSON.parse(bytes),source=packet.compilerInput;
assert.equal(digest(source),packet.sourceDigest);
const pattern=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260926.json',import.meta.url)));
const candidate=adaptRegisteredRecurringSource({registeredSource:source,patternConfig:pattern}).compilerInput;
const normalized=normalizeStaticWeeklyAuthority(candidate.version,candidate.slots,candidate.exceptions,candidate.proximity,candidate.serviceDate);
assert.equal(digest(candidate),digest(normalized),
 'manager-derived insertion bytes must already use the compiler canonical collection order');
const fresh=structuredClone(candidate);fresh.version.id='60000000-0000-4000-8000-000000000172';
fresh.version.publicationId='70000000-0000-4000-8000-000000000172';
const draft=normalizeStaticWeeklyAuthority(fresh.version,fresh.slots,[],fresh.proximity,fresh.serviceDate);
const registeredIdentity=input=>{
 const s=structuredClone(input);delete s.serviceDate;delete s.exceptions;
 for(const key of ['id','publicationId','status','effectiveStart','effectiveEnd','vacantSlotIds'])delete s.version[key];
 s.slots=s.slots.map(({incumbencies,...slot})=>slot);return s;
};
assert.equal(digest(registeredIdentity(candidate)),digest(registeredIdentity(draft)),
 'fresh draft identity still matches all source-bound work, constraints, fixed lunch and route fields');
assert.equal(candidate.version.assignments.length,312);
assert.equal(candidate.version.slotAvailability.length,source.version.slotAvailability.length);
assert.deepEqual(candidate.version.namedAbsentSlotIds,[]);assert.deepEqual(candidate.exceptions,[]);
assert.deepEqual(readFileSync(process.env.STATIC_WEEKLY_TEST_SIX_PACKET),bytes);
// Canonical registered documents intentionally omit request-only timezone.
// Mirror the production caller default, not an undefined property that the
// fail-closed raw boundary correctly rejects before any solving takes place.
assert.equal(Object.hasOwn(candidate,'timezone'),false);
const request={serviceDate:candidate.serviceDate,timezone:candidate.timezone,slots:candidate.slots,
 proximity:candidate.proximity,exceptions:[],versions:[candidate.version]};
assert.equal(admitStaticWeeklyRawInput(request).code,'unsupported_input_value');
request.timezone=candidate.timezone||'America/Chicago';
assert.equal(admitStaticWeeklyRawInput(request).code,undefined);
assert.equal(admitStaticWeeklyRawInput(request).assignmentCount,312);
console.log(JSON.stringify({status:'PASS',checks:11,sourceDigest:packet.sourceDigest,
 candidateDigest:digest(candidate),scope:'canonical insertion/draft identity; no SQL or publication acceptance'}));
