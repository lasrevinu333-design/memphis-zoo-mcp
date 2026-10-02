import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { postgresJsonbContentDigest } from './static-weekly-schedule-compiler.js';
import {assertOpeningCoverageDecisionReport,assertOpeningCoverageCanonicalReport} from './static-weekly-opening-coverage-report.js';

export const RECURRING_DECISION_SCHEMA = 'memphis-zoo.recurring-manager-decision.v1';

// The complete selected 09:45 week may change the preliminary adapter's
// equalized owners. Show those final owners against the original accepted
// 09:45 baseline, while retaining the adapter's separately verified morning
// impact (the phase proof deliberately keeps its generated morning fixed).
export function createRecurringFinalManagerChanges({ preliminaryChanges, phaseSource,
  finalSource, ownerConfig }) {
  assert.ok(Array.isArray(preliminaryChanges) && preliminaryChanges.length === 14);
  const sourceVersion = phaseSource?.version || (phaseSource?.versions?.length === 1 ? phaseSource.versions[0] : null);
  const finalVersion = finalSource?.version || (finalSource?.versions?.length === 1 ? finalSource.versions[0] : null);
  assert.ok(Array.isArray(sourceVersion?.assignments) && Array.isArray(finalVersion?.assignments));
  const keyBySlot = new Map(Object.entries(ownerConfig?.slots || {}).map(([key, slot]) => [slot.slotId, key]));
  assert.equal(keyBySlot.size, 9, 'nine stable owner identities required');
  const publicSites = new Set(ownerConfig.publicRestroomFamilies || []);
  const changes = [];
  for (let day = 0; day < 7; day += 1) for (const phase of ['morning', 'equalized']) {
    const prior = preliminaryChanges.find(row => row.day === day && row.phase === phase);
    assert.ok(prior && preliminaryChanges.filter(row => row.day === day && row.phase === phase).length === 1,
      `unique preliminary manager impact required ${day}/${phase}`);
    if (phase === 'morning') { changes.push(structuredClone(prior)); continue; }
    const rowsFor = source => source.assignments.filter(row => row.dayOfWeek === day
      && row.window?.start === '09:45');
    const before = rowsFor(sourceVersion), after = rowsFor(finalVersion);
    const owned = rows => {
      const result = new Map();
      for (const row of rows) {
        const family = row.locationCodeSnapshot;
        const owner = keyBySlot.get(row.originSlotId || row.ownerSlotId);
        assert.ok(typeof family === 'string' && family && owner && !result.has(family),
          `unique source family/owner required ${day}/equalized/${family}`);
        result.set(family, owner);
      }
      return result;
    };
    const original = owned(before), final = owned(after);
    assert.deepEqual([...original.keys()].sort(), [...final.keys()].sort(),
      `final selected phase cannot add or remove area families ${day}`);
    const owners = prior.employees.map(entry => entry.owner);
    assert.equal(new Set(owners).size, owners.length);
    assert.deepEqual(owners.slice().sort(), Object.keys(ownerConfig.slots)
      .filter(key => ownerConfig.slots[key].vacancy !== true && ownerConfig.slots[key].workDays.includes(day)).sort(),
    `all staffed phase owners required ${day}`);
    const employees = owners.map(owner => {
      const families = [...final].filter(([, assigned]) => assigned === owner).map(([family]) => family).sort();
      const baseline = [...original].filter(([, assigned]) => assigned === owner).map(([family]) => family).sort();
      const weightedLoad = families.reduce((sum, family) => {
        const weight = ownerConfig.weights?.[family];
        assert.ok(Number.isFinite(weight) && weight > 0, `explicit weight required ${family}`);
        return sum + weight;
      }, 0);
      return { owner, weightedLoad, restroomSites: families.filter(family => publicSites.has(family)).length,
        gained: families.filter(family => original.get(family) !== owner),
        released: baseline.filter(family => final.get(family) !== owner) };
    });
    changes.push({ ...structuredClone(prior), employees });
  }
  return changes;
}

// Loaded once by each immutable deployed process. Bind all scheduler source,
// its exact dependency lock and its three policy inputs, not just a manually
// maintained version string. The result contains hashes, never source bytes.
const sourceDirectory = new URL('./', import.meta.url);
const sourceFiles = readdirSync(sourceDirectory).filter(name => name.startsWith('static-weekly-')
  && name.endsWith('.js')).sort();
const implementationFiles = [...sourceFiles.map(name => [name, new URL(name, sourceDirectory)]),
  ...['custodial-six-person-static-20260926.json', 'custodial-recurring-schedule-20260924.json',
    'custodial-full-nine-family-owners-20260926.json'].map(name => [name, new URL(`../config/${name}`, import.meta.url)]),
  ['package-lock.json', new URL('../package-lock.json', import.meta.url)],
  ['schedule-component-weight-authority.js',new URL('./schedule-component-weight-authority.js',import.meta.url)],
  ['custodial-component-weight-authority-v1.json',new URL('../config/custodial-component-weight-authority-v1.json',import.meta.url)]];
export const RECURRING_IMPLEMENTATION_DIGEST = postgresJsonbContentDigest(
  implementationFiles.map(([path, url]) => ({ path,
    sha256: createHash('sha256').update(readFileSync(url)).digest('hex') })));

export function createRecurringManagerDecision({ candidateInput, compiled, lunch, changes }) {
  assert.equal(compiled?.status, 'FEASIBLE');
  assert.equal(compiled?.publicationAuthority, 'ACCEPTABLE');
  assert.equal(compiled?.verifier?.ok, true);
  assert.deepEqual(candidateInput.exceptions, [], 'dated exceptions cannot enter recurring preview');
  assert.ok(Array.isArray(compiled.weeklyAssignments) && compiled.weeklyAssignments.length > 0);
  assert.ok(Array.isArray(compiled.openWork) && Array.isArray(compiled.reviewWork));
  assert.ok(Array.isArray(lunch?.loans) && Array.isArray(lunch?.responsibilities)
    && Array.isArray(lunch?.notification_intents));
  assert.ok(Array.isArray(changes));
  return structuredClone({
    schema: RECURRING_DECISION_SCHEMA,
    implementationDigest: RECURRING_IMPLEMENTATION_DIGEST,
    effectiveDate: candidateInput.serviceDate,
    timezone: compiled.timezone,
    compilerVersion: compiled.compilerVersion,
    candidateSourceDigest: postgresJsonbContentDigest(candidateInput),
    recurringAvailabilityDigest: postgresJsonbContentDigest(candidateInput.version.slotAvailability),
    geographyDigest: postgresJsonbContentDigest(candidateInput.proximity),
    // Complete dated rows include original/new owner, physical locations,
    // opening/09:45/closing windows, eligibility explanations and truthful gaps.
    assignments: compiled.weeklyAssignments,
    gaps: { open: compiled.openWork, review: compiled.reviewWork },
    fixedLunch: { loans: lunch.loans, responsibilities: lunch.responsibilities,
      notificationIntents: lunch.notification_intents },
    shiftEnd: compiled.canonicalAuthority.shiftEndDerivation || null,
    metrics: compiled.metrics,
    changes,
  });
}

// Recheck the public display payload against the independently returned
// compiler witnesses before binding it into the named manager preview.
export function assertRecurringManagerDecision(candidate) {
  assertOpeningCoverageDecisionReport(candidate);
  const decision = candidate?.decision;
  assert.equal(decision?.schema, RECURRING_DECISION_SCHEMA, 'complete recurring decision required');
  assert.equal(decision.implementationDigest, RECURRING_IMPLEMENTATION_DIGEST,
    'recurring implementation identity changed');
  assert.equal(candidate.decisionDigest, postgresJsonbContentDigest(decision), 'recurring decision bytes changed');
  assert.equal(decision.effectiveDate, candidate.effectiveDate);
  assert.equal(decision.compilerVersion, candidate.compilerVersion);
  assert.equal(decision.candidateSourceDigest, candidate.candidateSourceDigest);
  assert.ok(Array.isArray(decision.assignments) && decision.assignments.length > 0);
  assert.ok(Array.isArray(decision.gaps?.open) && Array.isArray(decision.gaps?.review));
  assert.ok(Array.isArray(decision.fixedLunch?.loans) && Array.isArray(decision.fixedLunch?.responsibilities)
    && Array.isArray(decision.fixedLunch?.notificationIntents));
  for (const [value, digest] of [[decision.assignments, candidate.weeklyAssignmentsDigest],
    [decision.metrics, candidate.metricsDigest], [decision.fixedLunch, candidate.lunchFactsDigest],
    [decision.gaps.open, candidate.openWorkDigest], [decision.shiftEnd, candidate.shiftEndDerivationDigest]]) {
    assert.equal(postgresJsonbContentDigest(value), digest, 'recurring display does not match verified witness');
  }
  assert.equal(decision.fixedLunch.loans.length, candidate.lunchLoanCount);
  assert.equal(decision.gaps.open.length, candidate.openWorkCount);
  assert.equal(decision.gaps.review.length, candidate.reviewWorkCount);
  assert.deepEqual(decision.changes, candidate.changes);
  for (const digest of [decision.recurringAvailabilityDigest, decision.geographyDigest]) {
    assert.match(digest, /^[a-f0-9]{64}$/);
  }
}

// Used only by the server transaction owner after a fresh locked recompile.
// It is not permission to register/publish; PostgreSQL still binds the actual
// inserted JSONB to the transaction-bound parent and computes its own digest.
export function assertRecurringAdmissionCandidate(reply) {
  assert.equal(reply?.schema, 'static-weekly.recurring-admission-candidate.v1');
  assertRecurringManagerDecision(reply.candidate);
  const source = reply.canonicalSource;
  assert.ok(source && typeof source === 'object' && !Array.isArray(source));
  assert.equal(postgresJsonbContentDigest(source), reply.candidate.candidateSourceDigest,
    'private recurring source bytes do not match the preview');
  assert.equal(source.serviceDate, reply.candidate.effectiveDate);
  assert.equal(source.version?.effectiveStart, reply.candidate.effectiveDate);
  assert.equal(source.version?.effectiveEnd, null);
  assert.deepEqual(source.exceptions, [], 'recurring source cannot import a dated overlay');
  assert.deepEqual(source.version?.namedAbsentSlotIds, [], 'recurring source cannot import dated absence');
  assert.equal(source.version?.assignments?.length, reply.candidate.assignmentCount);
  assert.equal(reply.candidate.status, 'CANDIDATE_ONLY');
  assert.equal(reply.candidate.registrationRequired, true);
  assert.equal(reply.candidate.managerConfirmationRequired, true);
  assertOpeningCoverageCanonicalReport(reply.candidate,source);
}
