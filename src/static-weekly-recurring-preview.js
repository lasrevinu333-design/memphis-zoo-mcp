import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { postgresJsonbContentDigest } from './static-weekly-schedule-compiler.js';

export const RECURRING_DECISION_SCHEMA = 'memphis-zoo.recurring-manager-decision.v1';

// Loaded once by each immutable deployed process. Bind all scheduler source,
// its exact dependency lock and its three policy inputs, not just a manually
// maintained version string. The result contains hashes, never source bytes.
const sourceDirectory = new URL('./', import.meta.url);
const sourceFiles = readdirSync(sourceDirectory).filter(name => name.startsWith('static-weekly-')
  && name.endsWith('.js')).sort();
const implementationFiles = [...sourceFiles.map(name => [name, new URL(name, sourceDirectory)]),
  ...['custodial-six-person-static-20260926.json', 'custodial-recurring-schedule-20260924.json',
    'custodial-full-nine-family-owners-20260926.json'].map(name => [name, new URL(`../config/${name}`, import.meta.url)]),
  ['package-lock.json', new URL('../package-lock.json', import.meta.url)]];
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
}
